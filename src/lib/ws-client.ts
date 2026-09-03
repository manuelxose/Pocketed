export type WsEventHandler = (data: unknown) => void;

// Connection lifecycle state, surfaced to the rest of the app (WsProvider)
// so the UI can show something real instead of guessing from a boolean:
//  - 'connecting'    first attempt, socket not open yet
//  - 'open'          connected and usable
//  - 'reconnecting'  lost connection, backoff timer scheduled
//  - 'closed'        closed by the app (WsProvider unmount, logout) — no retry
//  - 'auth-required' server closed with the session/auth close code (4401) —
//                    will NOT retry on its own; the app must reauth and call
//                    connect() again
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'auth-required';
export type ConnectionStateHandler = (state: ConnectionState) => void;

// Builds ws(s)://<host>/ws matching the page's own scheme (http:->ws:, https:->wss:).
export function wsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/ws`;
}

export class WsDisconnected extends Error {
  constructor(message = 'WebSocket disconnected') {
    super(message);
    this.name = 'WsDisconnected';
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// WebSocket.readyState values (spec-fixed 0-3). Read as numeric literals
// rather than `WebSocket.CONNECTING`/`.OPEN` so this works identically
// against a test double that doesn't define those statics.
const WS_CONNECTING = 0;
const WS_OPEN = 1;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const RECONNECT_JITTER_MS = 300;
const DEFAULT_RPC_TIMEOUT_MS = 15000;

// Gateway-side custom close code for "no/invalid session" (webserver/main.py's
// /ws handler). Reconnecting on this code would just spin forever against an
// unauthenticated socket — surface it instead so AuthGate can reauth.
export const AUTH_REQUIRED_CLOSE_CODE = 4401;

export class WsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private listeners = new Map<string, Set<WsEventHandler>>();
  private stateListeners = new Set<ConnectionStateHandler>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private state: ConnectionState = 'closed';

  constructor(private url: string) {}

  get connected(): boolean {
    return this.state === 'open';
  }

  getState(): ConnectionState {
    return this.state;
  }

  onStateChange(handler: ConnectionStateHandler): () => void {
    this.stateListeners.add(handler);
    return () => {
      this.stateListeners.delete(handler);
    };
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const handler of this.stateListeners) handler(next);
  }

  connect(): void {
    // Single-active-connection guard: a connect() while one is already
    // CONNECTING or OPEN is a no-op, not a second socket. Protects against
    // React StrictMode double-invocation and any accidental repeat calls.
    if (this.ws && (this.ws.readyState === WS_CONNECTING || this.ws.readyState === WS_OPEN)) {
      return;
    }
    this.closedByUser = false;
    this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    const socket = new WebSocket(this.url);
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return; // superseded by a newer socket
      this.reconnectAttempt = 0;
      this.setState('open');
    };
    socket.onmessage = (e: MessageEvent) => this.handleMessage(e.data as string);
    socket.onclose = (e: CloseEvent) => {
      if (this.ws !== socket) return; // stale handler from a superseded socket
      this.rejectAllPending(new WsDisconnected());
      if (e?.code === AUTH_REQUIRED_CLOSE_CODE) {
        this.setState('auth-required');
        return; // do not reconnect against an unauthenticated session
      }
      if (this.closedByUser) {
        this.setState('closed');
        return;
      }
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
    } else {
      this.setState('closed');
    }
  }

  request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return Promise.reject(new WsDisconnected());
    }
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timeout });
      this.ws!.send(JSON.stringify({ type: 'rpc', id, method, params }));
    });
  }

  on(event: string, handler: WsEventHandler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'rpc') {
      const id = msg.id as string;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(String(msg.error ?? 'rpc error')));
    } else if (msg.type === 'event') {
      // Wire contract: {"type":"event","event":<name>,"data":...} — must
      // match every producer (python/service.py::emit_event,
      // webserver/main.py's backend:startError, webserver/supervisor.py's
      // backend:workerExited). See ws-client.test.ts's contract test.
      const name = msg.event as string;
      for (const handler of this.listeners.get(name) ?? []) handler(msg.data);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(err);
    }
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    const base = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    const jitter = Math.random() * RECONNECT_JITTER_MS;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, base + jitter);
  }
}

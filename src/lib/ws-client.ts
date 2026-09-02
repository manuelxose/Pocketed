export type WsEventHandler = (data: unknown) => void;

export class WsDisconnected extends Error {
  constructor(message = 'WebSocket disconnected') {
    super(message);
    this.name = 'WsDisconnected';
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export class WsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private listeners = new Map<string, Set<WsEventHandler>>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  constructor(private url: string) {}

  get connected(): boolean {
    return this.ws?.readyState === 1;
  }

  connect(): void {
    this.closedByUser = false;
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
    };
    this.ws.onmessage = (e: MessageEvent) => this.handleMessage(e.data as string);
    this.ws.onclose = () => {
      this.rejectAllPending(new WsDisconnected());
      if (!this.closedByUser) this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || this.ws.readyState !== 1) {
      return Promise.reject(new WsDisconnected());
    }
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
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
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(String(msg.error ?? 'rpc error')));
    } else if (msg.type === 'event') {
      const name = msg.event as string;
      for (const handler of this.listeners.get(name) ?? []) handler(msg.data);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

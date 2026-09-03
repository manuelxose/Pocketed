import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConnectionState } from '../lib/ws-client';
import { WsClient } from '../lib/ws-client';
import { useToast } from './ToastProvider';
import { useAuthSession } from './AuthGate';

interface WsContextValue {
  client: WsClient;
  connectionState: ConnectionState;
  backendError: string | null;
}

const WsContext = createContext<WsContextValue | null>(null);

export function useWsClient(): WsClient {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWsClient must be used inside WsProvider');
  return ctx.client;
}

// Reactive connection state — unlike reading `client.connected` directly
// (a non-reactive snapshot), this re-renders the caller on every real
// transport transition (connecting/open/reconnecting/closed/auth-required).
export function useWsConnectionState(): ConnectionState {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWsConnectionState must be used inside WsProvider');
  return ctx.connectionState;
}

// Set from a `backend:startError` push event (worker failed to start) and
// cleared on the next successful connection.
export function useWsBackendError(): string | null {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWsBackendError must be used inside WsProvider');
  return ctx.backendError;
}

// Maps a worker push-event name to the React Query cache key it updates.
// `positions`/`signals` are lists keyed by id — new/update events merge
// into the existing array instead of replacing it wholesale.
const EVENT_QUERY_KEYS: Record<string, unknown[]> = {
  'account:update': ['account'],
  'backend:authChanged': ['authStatus'],
  'backend:reconciled': ['backendReconciled'],
  'backend:loopStalled': ['backendLoopStalled'],
  'crypto15m:autoOff': ['crypto15mAutoOff'],
  'data:reset': ['dataReset'],
};

// Events whose push payload is not a drop-in cache value — invalidate the
// affected queries instead so they refetch from the source of truth.
const EVENT_INVALIDATE_KEYS: Record<string, unknown[][]> = {
  'credentials:changed': [['credentialsStatus'], ['credentialsStatusAll']],
};

export function WsProvider({ url, children }: { url: string; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const clientRef = useRef<WsClient | null>(null);
  if (!clientRef.current) clientRef.current = new WsClient(url);
  const client = clientRef.current;
  const [backendError, setBackendError] = useState<string | null>(null);

  const connectionState = useSyncExternalStore(
    (onChange) => client.onStateChange(onChange),
    () => client.getState(),
  );

  const { status: authStatus } = useAuthSession();
  useEffect(() => {
    // A fresh SIWE sign-in completed — (re)connect now rather than assuming
    // this is the socket's only attempt. WsProvider mounts (and makes its
    // first connect() call, below) before the user has necessarily signed
    // in at all, so that first attempt commonly gets rejected 4401
    // "auth-required" — a state ws-client.ts's own comment says deliberately
    // does NOT retry on its own. Without this effect, nothing ever opened a
    // second socket after login actually succeeded, so every account-scoped
    // feature (positions, signals, script logs, ...) silently never
    // connected until the next full page reload. `connect()` is already a
    // no-op while CONNECTING/OPEN (see its own single-active-connection
    // guard), so it's safe to call on every 'loggedIn' transition, even one
    // that fires while a healthy socket is already open.
    if (authStatus === 'loggedIn') client.connect();
  }, [authStatus, client]);

  useEffect(() => {
    client.connect();

    const unsubBackendError = client.on('backend:startError', (data: any) => {
      setBackendError(String(data?.error ?? 'backend worker failed to start'));
    });
    const unsubClearOnOpen = client.onStateChange((state) => {
      if (state === 'open') setBackendError(null);
    });

    const unsubs = Object.entries(EVENT_QUERY_KEYS).map(([event, key]) =>
      client.on(event, (data) => queryClient.setQueryData(key, data)),
    );
    const unsubsInvalidate = Object.entries(EVENT_INVALIDATE_KEYS).map(([event, keys]) =>
      client.on(event, () => {
        for (const key of keys) queryClient.invalidateQueries({ queryKey: key });
      }),
    );

    const unsubPosition = client.on('position:new', (data) => {
      queryClient.setQueryData(['positions'], (old: unknown[] = []) => [data, ...old]);
    });
    const unsubPositionUpdate = client.on('position:update', (data: any) => {
      queryClient.setQueryData(['positions'], (old: any[] = []) =>
        old.map((p) => (p.id === data.id ? data : p)),
      );
    });
    const unsubSignal = client.on('signal:new', (data) => {
      queryClient.setQueryData(['signals'], (old: unknown[] = []) => [data, ...old]);
    });
    // `script:status` merges an { id, enabled, lastError } patch into the
    // ['scriptsList'] cache's nested `scripts` array (same shape as the
    // position:update merge above) and — since a script disabling itself is
    // worth surfacing regardless of which page is open — fires a toast,
    // mirroring the crypto15m:autoOff handler below.
    const unsubScriptStatus = client.on('script:status', (data: any) => {
      queryClient.setQueryData(
        ['scriptsList'],
        (old: { scripts: any[] } | undefined) => {
          if (!old) return old;
          return {
            scripts: old.scripts.map((s) => (s.id === data.id
              ? { ...s, enabled: data.enabled, lastError: data.lastError ?? s.lastError }
              : s)),
          };
        },
      );
      if (!data?.enabled && data?.lastError) {
        toast.warn(`Script disabled: ${String(data.lastError).slice(0, 140)}`);
      }
    });
    // `script:log` appends lines to a per-script log kept at
    // ['scriptsLog', id] — a push-only cache key (see useScriptLogsQuery),
    // capped the same way the old onLog handler capped it (200 lines).
    const unsubScriptLog = client.on('script:log', (data: any) => {
      queryClient.setQueryData(
        ['scriptsLog', data.id],
        (old: string[] = []) => [...old, ...(data.lines ?? [])].slice(-200),
      );
    });
    // Always-mounted toast for the executor auto-disable event — WsProvider
    // wraps the whole app (regardless of which page is mounted), unlike the
    // old AppStateProvider-rooted subscription this replaces.
    const unsubAutoOff = client.on('crypto15m:autoOff', (data: any) => {
      const gained = typeof data?.gained === 'number' ? data.gained : 0;
      const target = typeof data?.target === 'number' ? data.target : 0;
      toast.warn(
        `Crypto take-profit hit (+$${gained.toFixed(2)} ≥ $${target.toFixed(2)}) — crypto engine turned off.`,
      );
    });

    return () => {
      unsubBackendError();
      unsubClearOnOpen();
      unsubs.forEach((u) => u());
      unsubsInvalidate.forEach((u) => u());
      unsubPosition();
      unsubPositionUpdate();
      unsubSignal();
      unsubScriptStatus();
      unsubScriptLog();
      unsubAutoOff();
      client.close();
    };
  }, [client, queryClient, toast]);

  const value = useMemo<WsContextValue>(
    () => ({ client, connectionState, backendError }),
    [client, connectionState, backendError],
  );
  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WsClient } from '../lib/ws-client';
import { useToast } from './ToastProvider';

const WsContext = createContext<WsClient | null>(null);

export function useWsClient(): WsClient {
  const client = useContext(WsContext);
  if (!client) throw new Error('useWsClient must be used inside WsProvider');
  return client;
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

  useEffect(() => {
    client.connect();

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
      unsubs.forEach((u) => u());
      unsubsInvalidate.forEach((u) => u());
      unsubPosition();
      unsubPositionUpdate();
      unsubSignal();
      unsubAutoOff();
      client.close();
    };
  }, [client, queryClient, toast]);

  const value = useMemo(() => client, [client]);
  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

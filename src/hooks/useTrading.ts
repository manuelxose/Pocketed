import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TradingStatus } from '@shared/types';
import { useWsClient } from '../state/WsProvider';
import { usePatchConfigMutation } from './useConfig';

export function useTradingStatusQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['tradingStatus'],
    queryFn: () => client.request<TradingStatus>('tradingStatus', {}),
    refetchInterval: 5000,
  });
}

export function useCancelAllOpenMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request<{ canceled: number }>('cancelAllOpen', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['positions'] }),
  });
}

export function useFlattenMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request<{ closed: number }>('flatten', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['positions'] }),
  });
}

export function useSetTradingEnabledMutation() {
  const patch = usePatchConfigMutation();
  return { ...patch, mutateAsync: (enabled: boolean) => patch.mutateAsync({ enableTrading: enabled }) };
}

export function useRunOnceMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (action: string) => client.request<{ summary: string }>('runOnce', { action }),
  });
}

export function useBackendConnectionStatus(): boolean {
  const client = useWsClient();
  return client.connected;
}

// Read-only cache subscription: populated purely by the `backend:authChanged`
// push event routed into ['authStatus'] by WsProvider (Task 5). Never fetched.
export function useAuthStatusQuery() {
  return useQuery({
    queryKey: ['authStatus'],
    queryFn: () => Promise.resolve(undefined),
    enabled: false,
  });
}

import { useMutation } from '@tanstack/react-query';
import { useWsClient } from '../state/WsProvider';

export function useMarketUrlMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (args: { eventTicker?: string; ticker?: string; env?: string }) =>
      client.request<{ url: string }>('polymarketUrl', args),
  });
}

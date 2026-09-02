import { useQuery } from '@tanstack/react-query';
import type { CopyStatus } from '@shared/types';
import { useWsClient } from '../state/WsProvider';

export function useCopyStatusQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['copyStatus'],
    queryFn: () => client.request<CopyStatus>('copyStatus', {}),
    refetchInterval: 8000,
  });
}

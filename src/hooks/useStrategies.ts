import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StrategyPreset, TraderConfig } from '@shared/types';
import { fetchJson } from '../lib/api';

export function useStrategiesQuery() {
  return useQuery({ queryKey: ['strategies'], queryFn: () => fetchJson<StrategyPreset[]>('/strategies') });
}

export function useApplyStrategyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchJson<TraderConfig>(`/strategies/${id}/apply`, { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(['config'], data),
  });
}

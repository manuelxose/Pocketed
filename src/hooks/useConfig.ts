import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TraderConfig } from '@shared/types';
import { fetchJson } from '../lib/api';

export function useConfigQuery() {
  return useQuery({ queryKey: ['config'], queryFn: () => fetchJson<TraderConfig>('/config') });
}

export function usePatchConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<TraderConfig>) =>
      fetchJson<TraderConfig>('/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => qc.setQueryData(['config'], data),
  });
}

export function useReplaceConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: TraderConfig) =>
      fetchJson<TraderConfig>('/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      }),
    onSuccess: (data) => qc.setQueryData(['config'], data),
  });
}

export function useResetConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<TraderConfig>('/config/reset', { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(['config'], data),
  });
}

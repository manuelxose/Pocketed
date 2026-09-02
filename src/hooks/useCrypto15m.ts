import { useMutation, useQuery } from '@tanstack/react-query';
import type { CollectionStats, Crypto15mBacktest, Crypto15mPosition, Crypto15mSnapshot, Crypto15mStatus } from '@shared/types';
import { useWsClient } from '../state/WsProvider';

export function useCrypto15mSnapshotQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['crypto15m'],
    queryFn: () => client.request<Crypto15mSnapshot>('crypto15m', {}),
  });
}

export function useCrypto15mStatusQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['crypto15mStatus'],
    queryFn: () => client.request<Crypto15mStatus>('crypto15mStatus', {}),
  });
}

export function useCrypto15mHistoryQuery(opts?: { limit?: number }) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['c15History', opts ?? null],
    queryFn: () => client.request<{ rows: Crypto15mPosition[] }>('c15History', (opts as Record<string, unknown>) ?? {}),
  });
}

export function useCrypto15mBacktestMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (args?: { sinceDays?: number; config?: Record<string, unknown> }) =>
      client.request<Crypto15mBacktest | null>('c15Backtest', (args as Record<string, unknown>) ?? {}),
  });
}

export function useMainBacktestMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (args?: { sinceDays?: number; config?: Record<string, unknown> }) =>
      client.request<Crypto15mBacktest | null>('mainBacktest', (args as Record<string, unknown>) ?? {}),
  });
}

export function useCrypto15mParlayGenerateMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (params?: Record<string, unknown>) => client.request('c15ParlayGenerate', params ?? {}),
  });
}

export function useCrypto15mParlayStatusQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['c15ParlayStatus'],
    queryFn: () => client.request('c15ParlayStatus', {}),
  });
}

export function useCrypto15mParlayArmMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (params?: Record<string, unknown>) => client.request('c15ParlayArm', params ?? {}),
  });
}

// Gap fix (carried forward from Task 10): despite the `trading.*` namespace name
// in the old preload API, these map to worker RPC methods `collectionStats`/
// `exportResearch` — an unrelated backtest-data-export feature.
export function useCollectionStatsQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['collectionStats'],
    queryFn: () => client.request<CollectionStats | null>('collectionStats', {}),
  });
}

export function useExportResearchMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: () => client.request<{ dir: string; files: string[] } | null>('exportResearch', {}),
  });
}

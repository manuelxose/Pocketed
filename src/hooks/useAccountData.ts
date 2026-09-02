import { useQuery } from '@tanstack/react-query';
import { useWsClient } from '../state/WsProvider';
import type {
  AccountSnapshot, BotPosition, BotRunsResponse, Network, PnlPoint, PositionFilter, ScannerStats,
  SignalFilter, SignalRow,
} from '@shared/types';

export function useAccountQuery() {
  const client = useWsClient();
  return useQuery({ queryKey: ['account'], queryFn: () => client.request<AccountSnapshot>('account', {}) });
}

export function usePnlSeriesQuery(sinceHours?: number) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['pnlSeries', sinceHours ?? null],
    queryFn: () => client.request<PnlPoint[]>('pnlSeries', sinceHours != null ? { sinceHours } : {}),
    refetchInterval: 30000,
  });
}

export function usePositionsQuery(filter?: PositionFilter) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['positions', filter ?? null],
    queryFn: () => client.request<BotPosition[]>('positions', (filter as Record<string, unknown>) ?? {}),
  });
}

export function useSignalsQuery(filter?: SignalFilter) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['signals', filter ?? null],
    queryFn: () => client.request<SignalRow[]>('signals', (filter as Record<string, unknown>) ?? {}),
  });
}

export function useScannerStatsQuery() {
  const client = useWsClient();
  return useQuery({ queryKey: ['scannerStats'], queryFn: () => client.request<ScannerStats>('scannerStats', {}) });
}

export function useBotRunsQuery(env?: Network | null, limit?: number) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['botRuns', env ?? null, limit ?? null],
    queryFn: () => client.request<BotRunsResponse>('botRuns', { env: env ?? null, limit }),
  });
}

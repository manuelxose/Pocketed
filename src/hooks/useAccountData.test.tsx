import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest } from './testUtils';
import {
  useAccountQuery, usePositionsQuery, useSignalsQuery, usePnlSeriesQuery, useScannerStatsQuery, useBotRunsQuery,
} from './useAccountData';

vi.mock('../state/WsProvider', async () => {
  const { useFakeWsClient } = await import('./testUtils');
  return { useWsClient: () => useFakeWsClient() };
});

beforeEach(() => queryClient.clear());

function wrap(request: (m: string, p?: unknown) => Promise<unknown>) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WsContextForTest request={request}>{children}</WsContextForTest>
    </QueryClientProvider>
  );
}

describe('useAccountQuery', () => {
  it('calls account', async () => {
    const request = vi.fn().mockResolvedValue({ equity: 100 });
    const { result } = renderHook(() => useAccountQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ equity: 100 }));
    expect(request).toHaveBeenCalledWith('account', {});
  });
});

describe('usePositionsQuery', () => {
  it('calls positions with the given filter', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => usePositionsQuery({ limit: 500 }), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('positions', { limit: 500 });
  });
});

describe('useSignalsQuery', () => {
  it('calls signals with the given filter', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useSignalsQuery({ limit: 300 }), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('signals', { limit: 300 });
  });
});

describe('usePnlSeriesQuery', () => {
  it('calls pnlSeries with sinceHours', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => usePnlSeriesQuery(24), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('pnlSeries', { sinceHours: 24 });
  });
});

describe('useScannerStatsQuery', () => {
  it('calls scannerStats', async () => {
    const request = vi.fn().mockResolvedValue({ scanned: 10 });
    const { result } = renderHook(() => useScannerStatsQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ scanned: 10 }));
    expect(request).toHaveBeenCalledWith('scannerStats', {});
  });
});

describe('useBotRunsQuery', () => {
  it('calls botRuns with env and limit', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useBotRunsQuery('mainnet', 50), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('botRuns', { env: 'mainnet', limit: 50 });
  });
});

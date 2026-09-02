import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest } from './testUtils';
import {
  useCrypto15mSnapshotQuery,
  useCrypto15mStatusQuery,
  useCrypto15mHistoryQuery,
  useCrypto15mBacktestMutation,
  useMainBacktestMutation,
  useCrypto15mParlayGenerateMutation,
  useCrypto15mParlayStatusQuery,
  useCrypto15mParlayArmMutation,
  useCollectionStatsQuery,
  useExportResearchMutation,
} from './useCrypto15m';

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

describe('useCrypto15mSnapshotQuery', () => {
  it('calls crypto15m', async () => {
    const request = vi.fn().mockResolvedValue({ assets: [] });
    const { result } = renderHook(() => useCrypto15mSnapshotQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ assets: [] }));
    expect(request).toHaveBeenCalledWith('crypto15m', {});
  });
});

describe('useCrypto15mStatusQuery', () => {
  it('calls crypto15mStatus', async () => {
    const request = vi.fn().mockResolvedValue({ authed: true });
    const { result } = renderHook(() => useCrypto15mStatusQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ authed: true }));
    expect(request).toHaveBeenCalledWith('crypto15mStatus', {});
  });
});

describe('useCrypto15mHistoryQuery', () => {
  it('calls c15History with opts', async () => {
    const request = vi.fn().mockResolvedValue({ rows: [] });
    const { result } = renderHook(() => useCrypto15mHistoryQuery({ limit: 300 }), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ rows: [] }));
    expect(request).toHaveBeenCalledWith('c15History', { limit: 300 });
  });

  it('calls c15History with no opts', async () => {
    const request = vi.fn().mockResolvedValue({ rows: [] });
    const { result } = renderHook(() => useCrypto15mHistoryQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ rows: [] }));
    expect(request).toHaveBeenCalledWith('c15History', {});
  });
});

describe('useCrypto15mBacktestMutation', () => {
  it('calls c15Backtest with args', async () => {
    const request = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useCrypto15mBacktestMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync({ sinceDays: 60 });
    expect(request).toHaveBeenCalledWith('c15Backtest', { sinceDays: 60 });
  });
});

describe('useMainBacktestMutation', () => {
  it('calls mainBacktest with args', async () => {
    const request = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMainBacktestMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync({ sinceDays: 30 });
    expect(request).toHaveBeenCalledWith('mainBacktest', { sinceDays: 30 });
  });
});

describe('useCrypto15mParlayGenerateMutation', () => {
  it('calls c15ParlayGenerate', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useCrypto15mParlayGenerateMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync({ legs: 3 });
    expect(request).toHaveBeenCalledWith('c15ParlayGenerate', { legs: 3 });
  });
});

describe('useCrypto15mParlayStatusQuery', () => {
  it('calls c15ParlayStatus', async () => {
    const request = vi.fn().mockResolvedValue({ active: false });
    const { result } = renderHook(() => useCrypto15mParlayStatusQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ active: false }));
    expect(request).toHaveBeenCalledWith('c15ParlayStatus', {});
  });
});

describe('useCrypto15mParlayArmMutation', () => {
  it('calls c15ParlayArm', async () => {
    const request = vi.fn().mockResolvedValue({ armed: true });
    const { result } = renderHook(() => useCrypto15mParlayArmMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync({ id: 'p1' });
    expect(request).toHaveBeenCalledWith('c15ParlayArm', { id: 'p1' });
  });
});

describe('useCollectionStatsQuery', () => {
  it('calls collectionStats', async () => {
    const request = vi.fn().mockResolvedValue({ c15: {}, main: {} });
    const { result } = renderHook(() => useCollectionStatsQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ c15: {}, main: {} }));
    expect(request).toHaveBeenCalledWith('collectionStats', {});
  });
});

describe('useExportResearchMutation', () => {
  it('calls exportResearch', async () => {
    const request = vi.fn().mockResolvedValue({ dir: '/tmp', files: [] });
    const { result } = renderHook(() => useExportResearchMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync();
    expect(request).toHaveBeenCalledWith('exportResearch', {});
  });
});

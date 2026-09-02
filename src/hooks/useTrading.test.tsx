import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest } from './testUtils';
import { useTradingStatusQuery, useCancelAllOpenMutation, useFlattenMutation, useRunOnceMutation } from './useTrading';

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

describe('useTradingStatusQuery', () => {
  it('calls tradingStatus', async () => {
    const request = vi.fn().mockResolvedValue({ open: 2 });
    const { result } = renderHook(() => useTradingStatusQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ open: 2 }));
    expect(request).toHaveBeenCalledWith('tradingStatus', {});
  });
});

describe('useCancelAllOpenMutation', () => {
  it('calls cancelAllOpen', async () => {
    const request = vi.fn().mockResolvedValue({ canceled: 3 });
    const { result } = renderHook(() => useCancelAllOpenMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync();
    expect(request).toHaveBeenCalledWith('cancelAllOpen', {});
  });
});

describe('useFlattenMutation', () => {
  it('calls flatten', async () => {
    const request = vi.fn().mockResolvedValue({ closed: 1 });
    const { result } = renderHook(() => useFlattenMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync();
    expect(request).toHaveBeenCalledWith('flatten', {});
  });
});

describe('useRunOnceMutation', () => {
  it('calls runOnce with the action', async () => {
    const request = vi.fn().mockResolvedValue({ summary: 'done' });
    const { result } = renderHook(() => useRunOnceMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync('scan');
    expect(request).toHaveBeenCalledWith('runOnce', { action: 'scan' });
  });
});

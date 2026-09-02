import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest } from './testUtils';
import { useCopyStatusQuery } from './useCopyTrading';

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

describe('useCopyStatusQuery', () => {
  it('calls copyStatus', async () => {
    const request = vi.fn().mockResolvedValue({ authed: true, trading: false, wallets: [], todayPnlUsd: 0 });
    const { result } = renderHook(() => useCopyStatusQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ authed: true, trading: false, wallets: [], todayPnlUsd: 0 }));
    expect(request).toHaveBeenCalledWith('copyStatus', {});
  });
});

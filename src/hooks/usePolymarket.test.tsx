import { renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest } from './testUtils';
import { useMarketUrlMutation } from './usePolymarket';

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

describe('useMarketUrlMutation', () => {
  it('calls polymarketUrl with args', async () => {
    const request = vi.fn().mockResolvedValue({ url: 'https://polymarket.com/event/x' });
    const { result } = renderHook(() => useMarketUrlMutation(), { wrapper: wrap(request) });
    const data = await result.current.mutateAsync({ eventTicker: 'EVT', ticker: 'T', env: 'prod' });
    expect(request).toHaveBeenCalledWith('polymarketUrl', { eventTicker: 'EVT', ticker: 'T', env: 'prod' });
    expect(data).toEqual({ url: 'https://polymarket.com/event/x' });
  });
});

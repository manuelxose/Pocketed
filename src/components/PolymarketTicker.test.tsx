import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest } from '../hooks/testUtils';
import { TickerLink } from './PolymarketTicker';

vi.mock('../state/WsProvider', async () => {
  const { useFakeWsClient } = await import('../hooks/testUtils');
  return { useWsClient: () => useFakeWsClient() };
});

beforeEach(() => {
  queryClient.clear();
  (window as unknown as { krypt: { app: { openExternal: (url: string) => Promise<void> } } }).krypt = {
    app: { openExternal: vi.fn().mockResolvedValue(undefined) },
  } as never;
});

function wrap(request: (m: string, p?: unknown) => Promise<unknown>) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WsContextForTest request={request}>{children}</WsContextForTest>
    </QueryClientProvider>
  );
}

describe('TickerLink', () => {
  it('does not fire a second RPC call on rapid double-click while pending', async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    render(<TickerLink ticker="T" eventTicker="EVT" />, { wrapper: wrap(request) });

    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);

    // allow the mutation's pending state to propagate
    await Promise.resolve();
    await Promise.resolve();

    fireEvent.click(button);

    expect(request).toHaveBeenCalledTimes(1);

    resolveRequest({ url: 'https://polymarket.com/event/x' });
  });
});

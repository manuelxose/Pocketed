import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsProvider, useWsClient } from './WsProvider';
import { ToastProvider } from './ToastProvider';

vi.mock('../lib/ws-client', () => {
  const handlers = new Map<string, Set<(d: unknown) => void>>();
  class FakeWsClient {
    connect() {}
    close() {}
    request() {
      return Promise.resolve({});
    }
    on(event: string, handler: (d: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return () => handlers.get(event)?.delete(handler);
    }
    __emit(event: string, data: unknown) {
      for (const h of handlers.get(event) ?? []) h(data);
    }
  }
  return { WsClient: FakeWsClient };
});

function Probe() {
  const client = useWsClient();
  return <div data-testid="probe">{client ? 'ready' : 'missing'}</div>;
}

beforeEach(() => queryClient.clear());

describe('WsProvider', () => {
  it('exposes the client via context', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WsProvider url="ws://test">
            <Probe />
          </WsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('ready');
  });

  it('routes account:update push events into the ["account"] query cache', () => {
    let capturedClient: any;
    function Capture() {
      capturedClient = useWsClient();
      return null;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WsProvider url="ws://test">
            <Capture />
          </WsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    capturedClient.__emit('account:update', { equity: 42 });
    expect(queryClient.getQueryData(['account'])).toEqual({ equity: 42 });
  });

  it('fires a toast on crypto15m:autoOff regardless of which page is mounted', async () => {
    let capturedClient: any;
    function Capture() {
      capturedClient = useWsClient();
      return null;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WsProvider url="ws://test">
            <Capture />
          </WsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    capturedClient.__emit('crypto15m:autoOff', { reason: 'daily target', gained: 12.5, target: 10 });
    expect(
      await screen.findByText(
        'Crypto take-profit hit (+$12.50 ≥ $10.00) — crypto engine turned off.',
      ),
    ).toBeInTheDocument();
  });
});

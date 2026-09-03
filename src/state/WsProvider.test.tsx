import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsProvider, useWsClient, useWsConnectionState, useWsBackendError } from './WsProvider';
import { ToastProvider } from './ToastProvider';

// Controls what useAuthSession() (imported by WsProvider.tsx) reports, so
// the reconnect-on-login test below can drive a 'checking' -> 'loggedIn'
// transition without going through a real SIWE flow.
let mockAuthStatus = 'checking';
vi.mock('./AuthGate', () => ({
  useAuthSession: () => ({ status: mockAuthStatus, error: null, noWallet: false, login: vi.fn(), logout: vi.fn() }),
}));

let lastFake: any = null;

vi.mock('../lib/ws-client', () => {
  class FakeWsClient {
    handlers = new Map<string, Set<(d: unknown) => void>>();
    stateHandlers = new Set<(s: string) => void>();
    state = 'closed';
    closed = false;
    connectCalls = 0;
    constructor() {
      lastFake = this;
    }
    connect() {
      this.connectCalls += 1;
      this.state = 'open';
      for (const h of this.stateHandlers) h(this.state);
    }
    close() {
      this.closed = true;
      this.state = 'closed';
      for (const h of this.stateHandlers) h(this.state);
    }
    getState() {
      return this.state;
    }
    onStateChange(handler: (s: string) => void) {
      this.stateHandlers.add(handler);
      return () => this.stateHandlers.delete(handler);
    }
    request() {
      return Promise.resolve({});
    }
    on(event: string, handler: (d: unknown) => void) {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(handler);
      return () => this.handlers.get(event)?.delete(handler);
    }
    __emit(event: string, data: unknown) {
      for (const h of this.handlers.get(event) ?? []) h(data);
    }
  }
  return { WsClient: FakeWsClient };
});

function Probe() {
  const client = useWsClient();
  return <div data-testid="probe">{client ? 'ready' : 'missing'}</div>;
}

beforeEach(() => {
  queryClient.clear();
  mockAuthStatus = 'checking';
});

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

  it('merges script:status into the ["scriptsList"] cache by id', () => {
    let capturedClient: any;
    function Capture() {
      capturedClient = useWsClient();
      return null;
    }
    queryClient.setQueryData(['scriptsList'], {
      scripts: [{ id: 's1', enabled: true, lastError: null }, { id: 's2', enabled: true, lastError: null }],
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WsProvider url="ws://test">
            <Capture />
          </WsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    capturedClient.__emit('script:status', { id: 's1', enabled: false, lastError: 'boom' });
    expect(queryClient.getQueryData(['scriptsList'])).toEqual({
      scripts: [{ id: 's1', enabled: false, lastError: 'boom' }, { id: 's2', enabled: true, lastError: null }],
    });
  });

  it('fires a toast when script:status reports a script disabled itself', async () => {
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
    capturedClient.__emit('script:status', { id: 's1', enabled: false, lastError: 'sandbox violation' });
    expect(await screen.findByText('Script disabled: sandbox violation')).toBeInTheDocument();
  });

  it('appends script:log lines into ["scriptsLog", id]', () => {
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
    capturedClient.__emit('script:log', { id: 's1', lines: ['line 1', 'line 2'] });
    expect(queryClient.getQueryData(['scriptsLog', 's1'])).toEqual(['line 1', 'line 2']);
    capturedClient.__emit('script:log', { id: 's1', lines: ['line 3'] });
    expect(queryClient.getQueryData(['scriptsLog', 's1'])).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('exposes a reactive connectionState that starts open (fake client connects synchronously)', () => {
    function Probe() {
      const state = useWsConnectionState();
      return <div data-testid="state">{state}</div>;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WsProvider url="ws://test">
            <Probe />
          </WsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('state')).toHaveTextContent('open');
  });

  it('sets backendError from a backend:startError event and clears it on reconnect', async () => {
    function Probe() {
      const err = useWsBackendError();
      return <div data-testid="err">{err ?? 'none'}</div>;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WsProvider url="ws://test">
            <Probe />
          </WsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('err')).toHaveTextContent('none');
    lastFake.__emit('backend:startError', { error: 'worker crashed' });
    expect(await screen.findByText('worker crashed')).toBeInTheDocument();
    // A fresh successful connection clears the error.
    lastFake.connect();
    expect(await screen.findByText('none')).toBeInTheDocument();
  });

  it('reconnects when the SIWE session transitions to loggedIn (regression: WsProvider used to connect only once, at mount — before the user had necessarily signed in — and never retried after a successful login)', () => {
    mockAuthStatus = 'loggedOut';
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WsProvider url="ws://test">
            <div />
          </WsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(lastFake.connectCalls).toBe(1); // the mount-time connect()

    mockAuthStatus = 'loggedIn';
    rerender(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WsProvider url="ws://test">
            <div />
          </WsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(lastFake.connectCalls).toBe(2);
  });

  it('calls client.close() on unmount', () => {
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WsProvider url="ws://test">
            <div />
          </WsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const fake = lastFake;
    expect(fake.closed).toBe(false);
    unmount();
    expect(fake.closed).toBe(true);
  });
});

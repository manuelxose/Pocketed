import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from './lib/queryClient';
import { ToastProvider } from './state/ToastProvider';
import { WsProvider } from './state/WsProvider';
import App from './App';

vi.mock('./lib/ws-client', () => {
  // Requests that are naturally list-shaped return [] so components that
  // .filter()/.map() the result don't crash on a mocked {}. Other requests
  // get the minimal realistic shape their consumers destructure.
  const LIST_REQUESTS = new Set(['positions', 'signals', 'history']);
  const SHAPED_REQUESTS: Record<string, unknown> = {
    tradingStatus: {
      main: [],
      mainFilterCounts: {},
      mainCandidates: 0,
      mainPlaced: 0,
      c15: { enabled: false, live: false, blockReasons: {} },
    },
  };
  class FakeWsClient {
    connected = true;
    connect() {}
    close() {}
    getState() {
      return 'open';
    }
    onStateChange() {
      return () => {};
    }
    request(name: string) {
      if (LIST_REQUESTS.has(name)) return Promise.resolve([]);
      if (name in SHAPED_REQUESTS) return Promise.resolve(SHAPED_REQUESTS[name]);
      return Promise.resolve({});
    }
    on() {
      return () => {};
    }
  }
  return { WsClient: FakeWsClient, wsUrl: () => 'ws://test' };
});

/** Minimal /endpoint -> response map covering what the shell fetches on mount. */
function mockFetch(onboarding: { acceptedDisclaimer: boolean }) {
  return (url: string) => {
    const u = String(url);
    if (u.includes('/onboarding')) return Promise.resolve({ ok: true, json: async () => onboarding });
    if (u.includes('/positions')) return Promise.resolve({ ok: true, json: async () => [] });
    if (u.includes('/account')) return Promise.resolve({ ok: true, json: async () => ({ totalUsd: 0, sessionPnlUsd: 0 }) });
    if (u.includes('/config')) return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
}

function renderApp() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WsProvider url="ws://test">
          <App />
        </WsProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  // jsdom doesn't implement ResizeObserver; recharts (used on the dashboard) needs it.
  if (!('ResizeObserver' in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe('App — public web access model', () => {
  it('shows the Dashboard and usable navigation immediately for a new visitor (no onboarding acceptance)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(mockFetch({ acceptedDisclaimer: false })));

    renderApp();

    // Dashboard content and sidebar navigation are immediately present —
    // nothing blocks first render.
    await waitFor(() => expect(screen.getByText(/all engines paused|engine.*live/i)).toBeInTheDocument());
    expect(screen.getByRole('navigation')).toBeInTheDocument();

    // No fullscreen onboarding overlay covers the app.
    expect(screen.queryByText(/get started/i)).not.toBeInTheDocument();
  });

  it('keeps navigation usable with no wallet/trading auth configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(mockFetch({ acceptedDisclaimer: true })));
    renderApp();
    await waitFor(() => expect(screen.getByRole('navigation')).toBeInTheDocument());
    // Sidebar nav links remain clickable/present even though no auth/config exists.
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('lets a visitor dismiss the welcome card and keeps browsing ("Explore first")', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(mockFetch({ acceptedDisclaimer: false })));

    renderApp();

    const exploreBtn = await screen.findByRole('button', { name: /explore first/i });
    exploreBtn.click();

    await waitFor(() => expect(screen.queryByText(/welcome to pocketed/i)).not.toBeInTheDocument());
    // The rest of the shell stays mounted and usable.
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});

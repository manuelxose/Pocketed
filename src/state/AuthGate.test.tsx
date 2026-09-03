import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthGate, useAuthSession } from './AuthGate';

vi.mock('../lib/wallet', () => ({
  connectWallet: vi.fn().mockResolvedValue('0xAAA'),
  signSiwe: vi.fn().mockResolvedValue({ message: 'msg', signature: '0xsig' }),
}));

function SessionProbe() {
  const { status, login } = useAuthSession();
  return (
    <div>
      <span>status:{status}</span>
      <button onClick={() => void login()}>Sign in</button>
    </div>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AuthGate', () => {
  it('renders children immediately, before the session check resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves
    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>,
    );
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('renders children when a session already exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ wallets: ['0xAAA'], active: '0xAAA' }) }),
    );
    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>,
    );
    await waitFor(() => expect(screen.getByText('protected content')).toBeInTheDocument());
  });

  it('renders children and offers sign-in when no session exists, without blocking', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 }) // GET /auth/session
      .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: 'n1' }) }) // POST /auth/nonce
      .mockResolvedValueOnce({ ok: true, json: async () => ({ address: '0xAAA' }) }); // POST /auth/verify
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthGate>
        <div>protected content</div>
        <SessionProbe />
      </AuthGate>,
    );

    // Content is visible even while logged out — never gated on session.
    expect(screen.getByText('protected content')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('status:loggedOut')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('status:loggedIn')).toBeInTheDocument());
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});

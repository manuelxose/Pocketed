import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthGate } from './AuthGate';

vi.mock('../lib/wallet', () => ({
  connectWallet: vi.fn().mockResolvedValue('0xAAA'),
  signSiwe: vi.fn().mockResolvedValue({ message: 'msg', signature: '0xsig' }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AuthGate', () => {
  it('shows children immediately when a session already exists', async () => {
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

  it('shows a connect button and completes login when no session exists', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 }) // GET /auth/session
      .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: 'n1' }) }) // POST /auth/nonce
      .mockResolvedValueOnce({ ok: true, json: async () => ({ address: '0xAAA' }) }); // POST /auth/verify
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => expect(screen.getByText('protected content')).toBeInTheDocument());
  });
});

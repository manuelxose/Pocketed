import { createContext, useContext, useEffect, useState } from 'react';
import { connectWallet, signSiwe } from '../lib/wallet';

type Status = 'checking' | 'loggedOut' | 'loggingIn' | 'loggedIn' | 'error';

const NO_WALLET_HINT = /no injected wallet|ethereum is not defined|window\.ethereum/i;

interface AuthSessionState {
  status: Status;
  error: string | null;
  noWallet: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionState>({
  status: 'checking',
  error: null,
  noWallet: false,
  login: async () => {},
  logout: async () => {},
});

/** Read the current app-session (wallet sign-in) state — never blocks rendering. */
export function useAuthSession(): AuthSessionState {
  return useContext(AuthSessionContext);
}

/**
 * Provides app-session status (a SIWE wallet sign-in used to scope saved
 * config/history to an account) via context. This is NOT a page gate —
 * `children` render immediately regardless of status. Pocketed itself is
 * public; signing in only personalizes saved data. Pages/components that
 * show session-scoped data should read `useAuthSession()` and degrade
 * gracefully (e.g. "Sign in to see your saved config") rather than the
 * whole app being blocked.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/auth/session', { credentials: 'include' })
      .then((r) => setStatus(r.ok ? 'loggedIn' : 'loggedOut'))
      .catch(() => setStatus('loggedOut'));
  }, []);

  async function login() {
    setStatus('loggingIn');
    setError(null);
    try {
      const address = await connectWallet();
      const nonceResp = await fetch('/auth/nonce', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!nonceResp.ok) throw new Error(`Couldn't reach the server (${nonceResp.status})`);
      const { nonce } = await nonceResp.json();
      const { message, signature } = await signSiwe(nonce, address);
      const verifyResp = await fetch('/auth/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      if (!verifyResp.ok) throw new Error(`Sign-in was rejected (${verifyResp.status})`);
      setStatus('loggedIn');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setStatus('error');
    }
  }

  async function logout() {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      setStatus('loggedOut');
      setError(null);
    }
  }

  const noWallet = !!error && NO_WALLET_HINT.test(error);

  return (
    <AuthSessionContext.Provider value={{ status, error, noWallet, login, logout }}>
      {children}
    </AuthSessionContext.Provider>
  );
}

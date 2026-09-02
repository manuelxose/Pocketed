import { useEffect, useState } from 'react';
import { connectWallet, signSiwe } from '../lib/wallet';

type Status = 'checking' | 'loggedOut' | 'loggingIn' | 'loggedIn' | 'error';

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
      const { nonce } = await nonceResp.json();
      const { message, signature } = await signSiwe(nonce, address);
      const verifyResp = await fetch('/auth/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      if (!verifyResp.ok) throw new Error(`login failed: ${verifyResp.status}`);
      setStatus('loggedIn');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  if (status === 'checking') return null;
  if (status === 'loggedIn') return <>{children}</>;

  return (
    <div>
      <button onClick={login} disabled={status === 'loggingIn'}>
        {status === 'loggingIn' ? 'Connecting…' : 'Connect wallet'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import {
  AlertTriangle, Loader2, Radar, ShieldCheck, SquareTerminal, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { connectWallet, signSiwe } from '../lib/wallet';

type Status = 'checking' | 'loggedOut' | 'loggingIn' | 'loggedIn' | 'error';

const NO_WALLET_HINT = /no injected wallet|ethereum is not defined|window\.ethereum/i;

const FEATURES = [
  {
    icon: Radar,
    title: 'Whale tracker',
    description: "Watches Polymarket's live trade feed for $2.5k+ taker orders and scores them for edge.",
  },
  {
    icon: TrendingUp,
    title: 'Momentum scanner',
    description: 'Catches volume spikes and price moves, with a contrarian-only mode to fade the crowd.',
  },
  {
    icon: Users,
    title: 'Copy trading',
    description: 'Follow chosen wallets and mirror their entries at your own size, with exit tracking.',
  },
  {
    icon: SquareTerminal,
    title: 'Custom strategy scripts',
    description: 'Write your own Python strategy, backtest it on real ticks, trade it under hard safety rails.',
  },
];

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

  if (status === 'checking') {
    return (
      <div className="grid h-screen w-screen place-items-center bg-pocketed-void">
        <Loader2 className="h-6 w-6 animate-spin text-pocketed-muted" />
      </div>
    );
  }
  if (status === 'loggedIn') return <>{children}</>;

  const busy = status === 'loggingIn';
  const noWallet = !!error && NO_WALLET_HINT.test(error);

  return (
    <div className="relative grid h-screen w-screen place-items-center overflow-hidden bg-pocketed-void px-4">
      <div className="pointer-events-none absolute inset-0 bg-pocketed-radial" />
      <div className="pointer-events-none absolute inset-0 bg-pocketed-radial-r" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-pocketed-glow opacity-[0.12] blur-[120px]" />

      <div className="relative grid w-full max-w-4xl animate-fade-in gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="hidden lg:block">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-pocketed-glow shadow-pocketed-glow">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Pocketed</h1>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-pocketed-muted">
            A free, open-source Polymarket auto-trading webapp — whale tracker, momentum scanner,
            copy trading and your own Python strategies, in one polished app.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="pocketed-card pocketed-card-hover">
                <Icon className="h-4 w-4 text-pocketed-purple" />
                <div className="mt-2 text-sm font-medium text-white">{title}</div>
                <p className="mt-1 text-xs leading-relaxed text-pocketed-dim">{description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-pocketed-glow shadow-pocketed-glow">
              <ShieldCheck className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">Pocketed</h1>
            <p className="mt-1 text-sm text-pocketed-muted">
              Sign in securely with your wallet — no password, ever.
            </p>
          </div>

          <div className="pocketed-card border-pocketed-borderHi shadow-pocketed-soft">
            <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-pocketed-muted">
              <Wallet className="h-3.5 w-3.5" />
              Wallet sign-in
            </div>

            <button
              onClick={login}
              disabled={busy}
              className="pocketed-btn-primary w-full py-2.5 text-sm"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirm in your wallet…
                </>
              ) : (
                <>
                  <Wallet className="h-4 w-4" />
                  Connect wallet
                </>
              )}
            </button>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-md border border-pocketed-loss/30 bg-pocketed-loss/10 px-3 py-2.5 text-xs text-pocketed-loss"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <div>
                    {noWallet
                      ? 'No wallet extension detected.'
                      : error}
                  </div>
                  {noWallet && (
                    <a
                      href="https://metamask.io/download"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block underline decoration-dotted underline-offset-2 hover:text-white"
                    >
                      Install MetaMask →
                    </a>
                  )}
                </div>
              </div>
            )}

            <p className="mt-5 text-center text-[11px] leading-relaxed text-pocketed-dim">
              You'll sign a one-time message (SIWE) to prove wallet ownership.
              This never moves funds or requests approvals.
            </p>
          </div>

          <p className="mt-6 text-center text-[11px] text-pocketed-dim">
            Protected session · encrypted cookie · 24h expiry
          </p>
        </div>
      </div>
    </div>
  );
}

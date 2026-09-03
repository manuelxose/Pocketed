import { Loader2, LogIn, Wallet } from 'lucide-react';
import { ShareButton } from './common';
import { BossWidget } from './BossFight';
import { cls, fmtPct, fmtUsd } from '../utils/format';
import { useConfigQuery } from '../hooks/useConfig';
import { useAccountQuery } from '../hooks/useAccountData';
import { useBackendConnectionStatus } from '../hooks/useTrading';
import { useAuthSession } from '../state/AuthGate';

const ENGINES: { key: 'main' | 'crypto' | 'copy' | 'scripts'; label: string }[] = [
  { key: 'main', label: 'Main' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'copy', label: 'Copy' },
  { key: 'scripts', label: 'Scripts' },
];

export function TopBar() {
  const { data: account } = useAccountQuery();
  const connected = useBackendConnectionStatus();
  const { data: config } = useConfigQuery();

  const live: Record<string, boolean> = {
    main: !!config?.enableTrading,
    crypto: !!config?.crypto15mEnabled,
    copy: !!config?.copyEnabled && !!(config?.copyWallets || []).length,
    scripts: !!config?.scriptsLiveEnabled,
  };
  const liveCount = ENGINES.filter((e) => live[e.key]).length;

  return (
    <header className="z-20 flex items-center gap-4 border-b border-pocketed-border bg-pocketed-void/70 px-6 py-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold text-white">
            {liveCount === 0
              ? 'All engines paused'
              : `${liveCount} engine${liveCount === 1 ? '' : 's'} live`}
          </h1>
          <span
            className={cls(
              'text-xs',
              connected ? 'text-pocketed-muted' : 'text-pocketed-warn',
            )}
          >
            · {connected ? 'Backend online' : 'Backend offline'}
          </span>
        </div>

        <div className="hidden items-center gap-1.5 lg:flex">
          {ENGINES.map((e) => (
            <span
              key={e.key}
              title={`${e.label} engine ${live[e.key] ? 'live' : 'off'} — switch it on its own page`}
              className={cls(
                'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                live[e.key]
                  ? 'bg-pocketed-win/15 text-pocketed-win'
                  : 'bg-pocketed-surface2 text-pocketed-dim',
              )}
            >
              {e.label}
            </span>
          ))}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <SessionButton />
        <BossWidget />
        <div className="hidden items-center gap-3 px-3 md:flex">
          <Stat label="Balance" value={fmtUsd(account?.totalUsd ?? 0)} />
          <Stat
            label="Session P&L"
            value={fmtUsd(account?.sessionPnlUsd ?? 0, { sign: true })}
            color={
              (account?.sessionPnlUsd ?? 0) >= 0 ? 'text-pocketed-win' : 'text-pocketed-loss'
            }
          />
          <Stat
            label="ROI"
            value={fmtPct(account?.sessionRoiPct ?? account?.roiPct ?? 0)}
            color={
              (account?.sessionRoiPct ?? account?.roiPct ?? 0) >= 0
                ? 'text-pocketed-win' : 'text-pocketed-loss'
            }
          />
          <ShareButton
            size="xs"
            text={
              `Pocketed: ${fmtUsd(account?.totalUsd ?? 0)} balance · `
              + `${fmtUsd(account?.sessionPnlUsd ?? 0, { sign: true })} this session · `
              + `${fmtPct(account?.sessionRoiPct ?? account?.roiPct ?? 0)} ROI. `
              + `Free Polymarket auto-trader by @YuhgoSlavia · pocketed.online`
            }
          />
        </div>
      </div>
    </header>
  );
}

/**
 * Non-blocking session indicator. Browsing Pocketed never requires signing
 * in — this just offers to personalize/save your config to an account.
 */
function SessionButton() {
  const { status, login } = useAuthSession();

  if (status === 'checking' || status === 'loggedIn') return null;

  return (
    <button
      type="button"
      onClick={() => void login()}
      disabled={status === 'loggingIn'}
      title="Sign in to save your config to an account (optional — Pocketed works without it)"
      className="flex items-center gap-1.5 rounded-md border border-pocketed-border bg-pocketed-surface2 px-2.5 py-1.5 text-xs font-medium text-pocketed-muted transition-colors hover:border-pocketed-purple/40 hover:text-white"
    >
      {status === 'loggingIn' ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Confirm in wallet…
        </>
      ) : (
        <>
          {status === 'error' ? <Wallet className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
          Sign in
        </>
      )}
    </button>
  );
}

function Stat({
  label, value, color,
}: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[10px] uppercase tracking-wider text-pocketed-muted">
        {label}
      </span>
      <span className={cls('font-mono text-sm', color || 'text-white')}>
        {value}
      </span>
    </div>
  );
}

import { useApp } from '../state/AppStateProvider';
import { ShareButton } from './common';
import { BossWidget } from './BossFight';
import { cls, fmtPct, fmtUsd } from '../utils/format';
import { useConfigQuery } from '../hooks/useConfig';

const ENGINES: { key: 'main' | 'crypto' | 'copy' | 'scripts'; label: string }[] = [
  { key: 'main', label: 'Main' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'copy', label: 'Copy' },
  { key: 'scripts', label: 'Scripts' },
];

export function TopBar() {
  const { account, backend } = useApp();
  const { data: config } = useConfigQuery();

  const live: Record<string, boolean> = {
    main: !!config?.enableTrading,
    crypto: !!config?.crypto15mEnabled,
    copy: !!config?.copyEnabled && !!(config?.copyWallets || []).length,
    scripts: !!config?.scriptsLiveEnabled,
  };
  const liveCount = ENGINES.filter((e) => live[e.key]).length;

  return (
    <header className="z-20 flex items-center gap-4 border-b border-krypt-border bg-krypt-void/70 px-6 py-3 backdrop-blur">
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
              backend.status === 'running' ? 'text-krypt-muted' : 'text-krypt-warn',
            )}
          >
            · {backend.status === 'running' ? 'Backend online' : `Backend ${backend.status}`}
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
                  ? 'bg-krypt-win/15 text-krypt-win'
                  : 'bg-krypt-surface2 text-krypt-dim',
              )}
            >
              {e.label}
            </span>
          ))}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <BossWidget />
        <div className="hidden items-center gap-3 px-3 md:flex">
          <Stat label="Balance" value={fmtUsd(account?.totalUsd ?? 0)} />
          <Stat
            label="Session P&L"
            value={fmtUsd(account?.sessionPnlUsd ?? 0, { sign: true })}
            color={
              (account?.sessionPnlUsd ?? 0) >= 0 ? 'text-krypt-win' : 'text-krypt-loss'
            }
          />
          <Stat
            label="ROI"
            value={fmtPct(account?.sessionRoiPct ?? account?.roiPct ?? 0)}
            color={
              (account?.sessionRoiPct ?? account?.roiPct ?? 0) >= 0
                ? 'text-krypt-win' : 'text-krypt-loss'
            }
          />
          <ShareButton
            size="xs"
            text={
              `Krypt PolyBot: ${fmtUsd(account?.totalUsd ?? 0)} balance · `
              + `${fmtUsd(account?.sessionPnlUsd ?? 0, { sign: true })} this session · `
              + `${fmtPct(account?.sessionRoiPct ?? account?.roiPct ?? 0)} ROI. `
              + `Free Polymarket auto-trader by @YuhgoSlavia · krypt.cc/tools/polybot`
            }
          />
        </div>
      </div>
    </header>
  );
}

function Stat({
  label, value, color,
}: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[10px] uppercase tracking-wider text-krypt-muted">
        {label}
      </span>
      <span className={cls('font-mono text-sm', color || 'text-white')}>
        {value}
      </span>
    </div>
  );
}

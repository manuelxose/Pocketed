import { useMemo, useState } from 'react';
import { Ban, RefreshCw } from 'lucide-react';
import type { BotPosition } from '@shared/types';
import { useToast } from '../state/ToastProvider';
import { Empty, Page } from '../components/common';
import { TickerLink } from '../components/PolymarketTicker';
import { cls, fmtCents, fmtRelative, fmtUsd } from '../utils/format';
import { useCancelAllOpenMutation, useRunOnceMutation } from '../hooks/useTrading';
import { usePositionsQuery } from '../hooks/useAccountData';

const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-pocketed-warn/15 text-pocketed-warn border-pocketed-warn/30',
  partial: 'bg-pocketed-warn/15 text-pocketed-warn border-pocketed-warn/30',
  filled: 'bg-pocketed-indigo/15 text-pocketed-indigo border-pocketed-indigo/30',
  canceled: 'bg-pocketed-dim/15 text-pocketed-muted border-pocketed-border',
  expired: 'bg-pocketed-dim/15 text-pocketed-muted border-pocketed-border',
  gone: 'bg-pocketed-dim/15 text-pocketed-muted border-pocketed-border',
  error: 'bg-pocketed-loss/15 text-pocketed-loss border-pocketed-loss/30',
  dry_run: 'bg-pocketed-purple/15 text-pocketed-purple border-pocketed-purple/30',
};

type Tab = 'open' | 'pending' | 'won' | 'lost' | 'errors' | 'all';

export function PositionsPage() {
  const { data: positions = [], refetch: refetchPositions } = usePositionsQuery({ limit: 500 });
  const toast = useToast();
  const cancelAllOpen = useCancelAllOpenMutation();
  const runOnce = useRunOnceMutation();
  const [tab, setTab] = useState<Tab>('open');
  const [src, setSrc] = useState<'all' | 'whale' | 'momentum'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return positions.filter((p) => {
      if (src !== 'all' && p.signalSource !== src) return false;
      switch (tab) {
        case 'open':
          return !p.resolved && (p.status === 'filled' || p.status === 'partial');
        case 'pending':
          return !p.resolved && p.status === 'submitted';
        case 'won':
          return p.resolved && p.outcomeCorrect === 1;
        case 'lost':
          return p.resolved && p.outcomeCorrect === 0;
        case 'errors':
          return p.status === 'error';
        case 'all':
        default:
          return true;
      }
    });
  }, [positions, tab, src]);

  const counts = useMemo(() => {
    let open = 0, pending = 0, won = 0, lost = 0, errors = 0;
    for (const p of positions) {
      if (!p.resolved && (p.status === 'filled' || p.status === 'partial')) open++;
      if (!p.resolved && p.status === 'submitted') pending++;
      if (p.resolved && p.outcomeCorrect === 1) won++;
      if (p.resolved && p.outcomeCorrect === 0) lost++;
      if (p.status === 'error') errors++;
    }
    return { open, pending, won, lost, errors, all: positions.length };
  }, [positions]);

  const cancelAll = async (): Promise<void> => {
    if (!window.confirm('Cancel ALL open orders on Polymarket?')) return;
    setBusy('cancel');
    try {
      const r = await cancelAllOpen.mutateAsync();
      toast.success(`Canceled ${r.canceled} open order${r.canceled === 1 ? '' : 's'}`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to cancel open orders');
    } finally {
      setBusy(null);
    }
  };

  const syncPositions = async (): Promise<void> => {
    setBusy('sync');
    try {
      const r = await runOnce.mutateAsync('syncPositions');
      await refetchPositions();
      toast.success(r.summary || 'Positions synced');
    } catch (e: any) {
      toast.error(e?.message || 'Sync failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page
      title="Positions"
      subtitle="Live + recent positions. Tap Cancel All to flatten any working orders on Polymarket."
      actions={
        <div className="flex items-center gap-2">
          <button onClick={syncPositions} disabled={!!busy} className="pocketed-btn-default">
            <RefreshCw className={cls('h-4 w-4', busy === 'sync' && 'animate-spin')} />
            {busy === 'sync' ? 'Syncing…' : 'Refresh'}
          </button>
          <button onClick={cancelAll} disabled={!!busy} className="pocketed-btn-danger">
            <Ban className="h-4 w-4" /> Cancel All
          </button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={tab} onChange={setTab}
          options={[
            { value: 'open', label: `Open (${counts.open})` },
            { value: 'pending', label: `Pending (${counts.pending})` },
            { value: 'won', label: `Won (${counts.won})` },
            { value: 'lost', label: `Lost (${counts.lost})` },
            { value: 'errors', label: `Errors (${counts.errors})` },
            { value: 'all', label: `All (${counts.all})` },
          ]}
        />
        <div className="ml-auto flex gap-1">
          <Tabs value={src} onChange={setSrc}
            options={[
              { value: 'all', label: 'Both' },
              { value: 'whale', label: 'Whales' },
              { value: 'momentum', label: 'Momentum' },
            ]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="No positions match"
          description="Switch tabs or wait for the trader to open something."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-pocketed-border">
          <table className="pocketed-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Source</th>
                <th>Ticker</th>
                <th>Title</th>
                <th>Side</th>
                <th>Filled</th>
                <th>Cost</th>
                <th>Status</th>
                <th>Outcome</th>
                <th>Edge</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => <PositionRow key={p.id} p={p} />)}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

function Tabs<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-md border border-pocketed-border bg-pocketed-surface2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cls(
            'rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors',
            value === o.value
              ? 'bg-white/10 text-white'
              : 'text-pocketed-muted hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PositionRow({ p }: { p: BotPosition }) {
  const realized = p.resolved;
  const pnl = realized ? p.pnlUsd : p.livePnlUsd;
  return (
    <tr>
      <td className="text-xs text-pocketed-muted">{fmtRelative(p.createdAt)}</td>
      <td>
        <span
          className={cls(
            'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] uppercase',
            p.signalSource === 'whale'
              ? 'bg-pocketed-purple/15 text-pocketed-purple'
              : p.signalSource === 'copy'
                ? 'bg-pocketed-indigo/15 text-pocketed-indigo'
                : p.signalSource === 'external'
                  ? 'bg-pocketed-dim/15 text-pocketed-muted'
                  : 'bg-pocketed-pink/15 text-pocketed-pink',
          )}
        >
          {p.signalSource}
        </span>
      </td>
      <td><TickerLink ticker={p.ticker} eventTicker={p.eventTicker} env={p.network} /></td>
      <td className="max-w-[280px] truncate text-xs text-pocketed-muted">{p.title}</td>
      <td>
        <span
          className={cls(
            'rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase',
            p.direction === 'yes'
              ? 'bg-pocketed-win/10 text-pocketed-win'
              : 'bg-pocketed-loss/10 text-pocketed-loss',
          )}
        >
          {p.direction}
        </span>
      </td>
      <td className="font-mono text-xs">
        {p.filledContracts}/{p.targetContracts}
        <span className="ml-2 text-pocketed-dim">
          @ {fmtCents(p.avgFillPriceCents ?? p.limitPriceCents)}
        </span>
      </td>
      <td className="font-mono text-xs">{fmtUsd(p.costUsd)}</td>
      <td>
        <span
          className={cls(
            'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase',
            STATUS_COLORS[p.status] ?? 'border-pocketed-border bg-pocketed-surface2 text-pocketed-muted',
          )}
        >
          {p.status}
        </span>
      </td>
      <td>
        {!p.resolved ? (
          <span className="text-[10px] uppercase tracking-wider text-pocketed-dim">live</span>
        ) : p.outcomeCorrect === 1 ? (
          <span className="pocketed-pill border-pocketed-win/40 bg-pocketed-win/10 text-pocketed-win">won</span>
        ) : p.outcomeCorrect === 0 ? (
          <span className="pocketed-pill border-pocketed-loss/40 bg-pocketed-loss/10 text-pocketed-loss">lost</span>
        ) : (
          <span className="pocketed-pill text-pocketed-muted">closed</span>
        )}
      </td>
      <td className="font-mono text-xs text-pocketed-purple">
        {p.signalSource === 'external'
          ? <span className="text-pocketed-dim" title="Imported from your Polymarket wallet — no entry signal">—</span>
          : `+${p.edgePts.toFixed(1)}`}
      </td>
      <td
        className={cls(
          'font-mono text-xs',
          pnl == null ? 'text-pocketed-dim' : pnl >= 0 ? 'text-pocketed-win' : 'text-pocketed-loss',
        )}
      >
        {pnl == null ? (
          '—'
        ) : (
          <span title={
            realized
              ? 'Realized P&L'
              : `Unrealized P&L at ${p.markPriceCents != null ? `${Math.round(p.markPriceCents)}¢` : 'current price'}`
          }>
            {fmtUsd(pnl, { sign: true })}
            {!realized && (
              <span className="ml-1 text-[9px] uppercase tracking-wide text-pocketed-dim">live</span>
            )}
          </span>
        )}
      </td>
    </tr>
  );
}

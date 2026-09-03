import { Gift, X } from 'lucide-react';
import { POLYMARKET_REFERRAL_URL } from '../utils/links';

/**
 * Dismissible, non-blocking welcome card shown on the dashboard for
 * first-time visitors. This is NOT a gate: the app, navigation, and all
 * public data are fully usable whether or not this card is visible or
 * dismissed. It only points toward the (optional) live-trading setup flow.
 */
export function WelcomeCard({
  onExplore,
  onSetUpTrading,
}: {
  onExplore: () => void;
  onSetUpTrading: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-pocketed-borderHi bg-pocketed-surface shadow-pocketed-strong">
      <button
        type="button"
        onClick={onExplore}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-md p-1 text-pocketed-muted transition-colors hover:bg-pocketed-surface2 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="space-y-2 pr-6">
          <h2 className="font-pixel text-sm tracking-wider">WELCOME TO POCKETED</h2>
          <p className="text-xs text-pocketed-muted">
            Pocketed watches Polymarket&apos;s whale flow and momentum signals, scores
            them, and can optionally auto-place contrarian bets on the highest-edge
            setups. Explore markets, strategies, and signals freely — no wallet or
            account required.
          </p>
          <p className="text-xs text-pocketed-muted">
            To start live trading you&apos;ll need a Polymarket account and a connected
            wallet. Live trading is <span className="text-white">off by default</span>{' '}
            until you configure and enable it yourself.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:w-48">
          <button type="button" onClick={onSetUpTrading} className="pocketed-btn-primary justify-center">
            Set up trading
          </button>
          <button type="button" onClick={onExplore} className="pocketed-btn-ghost justify-center">
            Explore first
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-pocketed-border bg-pocketed-surface2/50 px-5 py-3 text-xs text-pocketed-muted">
        <Gift className="h-4 w-4 shrink-0 text-pocketed-purple" />
        <span>
          Don&apos;t have a Polymarket account?{' '}
          <button
            type="button"
            onClick={() => window.open(POLYMARKET_REFERRAL_URL, '_blank', 'noopener,noreferrer')}
            className="text-pocketed-purple underline underline-offset-2 hover:text-white"
          >
            Sign up with our referral link
          </button>{' '}
          — it&apos;s optional and supports the tool at no cost to you.
        </span>
      </div>
    </div>
  );
}

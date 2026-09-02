import { useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import { cls } from '../utils/format';
import { useMarketUrlMutation } from '../hooks/usePolymarket';

export function TickerLink({
  ticker,
  eventTicker,
  env,
  label,
  className,
}: {
  ticker: string;
  eventTicker?: string;
  env?: string;
  label?: string;
  className?: string;
}) {
  const marketUrlMutation = useMarketUrlMutation();
  const inFlightRef = useRef(false);
  if (!ticker) return <span className="text-pocketed-dim">{label ?? '—'}</span>;
  const openMarket = async (): Promise<void> => {
    if (inFlightRef.current || marketUrlMutation.isPending) return;
    inFlightRef.current = true;
    try {
      const { url } = await marketUrlMutation.mutateAsync({ ticker, eventTicker, env });
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore
    } finally {
      inFlightRef.current = false;
    }
  };
  return (
    <button
      type="button"
      onClick={() => void openMarket()}
      disabled={marketUrlMutation.isPending}
      title="Open this market on Polymarket"
      className={cls(
        'group inline-flex items-center gap-1 font-mono text-xs text-pocketed-purple',
        'transition-colors hover:text-pocketed-pink hover:underline',
        className,
      )}
    >
      {label ?? ticker}
      <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
    </button>
  );
}

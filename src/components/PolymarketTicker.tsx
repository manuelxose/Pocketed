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
  if (!ticker) return <span className="text-krypt-dim">{label ?? '—'}</span>;
  const openMarket = async (): Promise<void> => {
    try {
      const { url } = await marketUrlMutation.mutateAsync({ ticker, eventTicker, env });
      if (url) await window.krypt.app.openExternal(url);
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={() => void openMarket()}
      title="Open this market on Polymarket"
      className={cls(
        'group inline-flex items-center gap-1 font-mono text-xs text-krypt-purple',
        'transition-colors hover:text-krypt-pink hover:underline',
        className,
      )}
    >
      {label ?? ticker}
      <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
    </button>
  );
}

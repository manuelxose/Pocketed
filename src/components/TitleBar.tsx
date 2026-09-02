import { cls } from '../utils/format';
import { useAuthStatusQuery, useBackendConnectionStatus } from '../hooks/useTrading';

export function TitleBar() {
  const connected = useBackendConnectionStatus();
  const { data: authStatus } = useAuthStatusQuery();
  const dot = connected ? 'bg-krypt-win' : 'bg-krypt-loss';

  return (
    <header className="relative z-30 flex h-9 select-none items-center border-b border-krypt-border bg-krypt-void/95 px-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-pixel text-[10px] uppercase tracking-[0.2em] text-white/90">
            Krypt PolyBot
          </span>
        </div>
        <div className="hidden items-center gap-2 text-[11px] text-krypt-muted lg:flex">
          <span className={cls('h-2 w-2 rounded-full', dot, connected && 'shadow-[0_0_8px_currentColor]')} />
          <span className="capitalize">{connected ? 'connected' : 'disconnected'}</span>
          {authStatus?.authOk ? (
            <span className="krypt-pill border-krypt-win/40 bg-krypt-win/10 text-krypt-win">
              auth ok
            </span>
          ) : (
            <span className="krypt-pill border-krypt-warn/40 bg-krypt-warn/10 text-krypt-warn">
              auth needed
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

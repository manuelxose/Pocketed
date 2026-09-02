import { cls } from '../utils/format';
import { useAuthStatusQuery, useBackendConnectionStatus } from '../hooks/useTrading';

export function TitleBar() {
  const connected = useBackendConnectionStatus();
  const { data: authStatus } = useAuthStatusQuery();
  const dot = connected ? 'bg-pocketed-win' : 'bg-pocketed-loss';

  return (
    <header className="relative z-30 flex h-9 select-none items-center border-b border-pocketed-border bg-pocketed-void/95 px-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-pixel text-[10px] uppercase tracking-[0.2em] text-white/90">
            Pocketed
          </span>
        </div>
        <div className="hidden items-center gap-2 text-[11px] text-pocketed-muted lg:flex">
          <span className={cls('h-2 w-2 rounded-full', dot, connected && 'shadow-[0_0_8px_currentColor]')} />
          <span className="capitalize">{connected ? 'connected' : 'disconnected'}</span>
          {authStatus?.authOk ? (
            <span className="pocketed-pill border-pocketed-win/40 bg-pocketed-win/10 text-pocketed-win">
              auth ok
            </span>
          ) : (
            <span className="pocketed-pill border-pocketed-warn/40 bg-pocketed-warn/10 text-pocketed-warn">
              auth needed
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

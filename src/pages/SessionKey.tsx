import { useState } from 'react';
import { KeyRound, Power, ShieldOff } from 'lucide-react';
import { Card, Page, Section } from '../components/common';
import { useToast } from '../state/ToastProvider';
import { connectWallet, signTypedData } from '../lib/wallet';
import {
  useMintSessionKeyMutation, useActivateSessionKeyMutation, useRevokeSessionKeyMutation,
} from '../hooks/useSessionKey';

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export function SessionKeyPage() {
  const toast = useToast();
  const [dailyCapUsd, setDailyCapUsd] = useState('50');
  const [sessionKeyAddress, setSessionKeyAddress] = useState<string | null>(null);
  const [active, setActive] = useState(false);

  const mintMutation = useMintSessionKeyMutation();
  const activateMutation = useActivateSessionKeyMutation();
  const revokeMutation = useRevokeSessionKeyMutation();
  const busy = mintMutation.isPending || activateMutation.isPending || revokeMutation.isPending;

  const activate = async (): Promise<void> => {
    const capNum = Number(dailyCapUsd);
    if (!Number.isFinite(capNum) || capNum <= 0) {
      toast.error('Daily USD cap must be a positive number.');
      return;
    }
    try {
      const address = await connectWallet();

      const validUntil = Math.floor(Date.now() / 1000) + THIRTY_DAYS_SECONDS;
      const initResult = await mintMutation.mutateAsync({ validUntil, dailyUsdCap: capNum });

      const signature = await signTypedData(address, initResult.enableTypedData);

      await activateMutation.mutateAsync({ signature });

      setSessionKeyAddress(initResult.sessionKeyAddress);
      setActive(true);
      toast.success(`Session key active · daily cap $${capNum}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to activate auto-trading');
    }
  };

  const revoke = async (): Promise<void> => {
    try {
      await revokeMutation.mutateAsync();
      setActive(false);
      setSessionKeyAddress(null);
      toast.success('Session key revoked');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to revoke session key');
    }
  };

  return (
    <Page
      title="Auto-Trading Session Key"
      subtitle="Grant the bot a scoped session key so it can sign and submit Polymarket orders on your behalf, capped at a daily USD limit you set. Revoke it any time."
    >
      <Section title="Session key">
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-krypt-purple/30 bg-krypt-purple/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-krypt-purple">
              <KeyRound className="h-3 w-3" /> ERC-4337
            </span>
            <div className="text-sm font-semibold text-white">Auto-trading</div>
            <span className={
              active
                ? 'ml-auto rounded-md border border-krypt-win/30 bg-krypt-win/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-krypt-win'
                : 'ml-auto rounded-md border border-krypt-border bg-krypt-surface2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-krypt-muted'
            }>
              {active ? 'active' : 'inactive'}
            </span>
          </div>

          {sessionKeyAddress && (
            <div className="mb-3 rounded-lg border border-krypt-border bg-krypt-surface2 px-3 py-2 text-xs text-krypt-muted">
              Session key <span className="font-mono text-white">{sessionKeyAddress}</span>
            </div>
          )}

          <label className="krypt-label" htmlFor="daily-cap-input">Daily USD cap</label>
          <input
            id="daily-cap-input"
            type="number"
            min={1}
            step={1}
            className="krypt-input font-mono"
            value={dailyCapUsd}
            onChange={(e) => setDailyCapUsd(e.target.value)}
            disabled={busy}
          />
          <p className="krypt-help">
            The bot signs CLOB orders with this session key, capped at the daily USD amount
            above. There is no &quot;unlimited&quot; option — the backend rejects a cap of 0 or
            less.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => void activate()} disabled={busy} className="krypt-btn-primary">
              <Power className="h-4 w-4" /> {active ? 'Re-activate' : 'Activate auto-trading'}
            </button>
            {active && (
              <button onClick={() => void revoke()} disabled={busy} className="krypt-btn-danger ml-auto">
                <ShieldOff className="h-4 w-4" /> Revoke
              </button>
            )}
          </div>
        </Card>
      </Section>

      <Section title="Security notes">
        <Card>
          <ul className="list-disc space-y-1.5 pl-5 text-xs text-krypt-muted">
            <li>Activating signs an EIP-712 typed message with your connected wallet (MetaMask or similar) authorizing a scoped session key — your main wallet key never leaves your device.</li>
            <li>The session key can only call the Polymarket CTF Exchange contracts and is capped at the daily USD limit you set.</li>
            <li>Revoke instantly disables the session key server-side.</li>
          </ul>
        </Card>
      </Section>
    </Page>
  );
}

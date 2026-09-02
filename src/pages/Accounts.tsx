import { Check, Plus, Users } from 'lucide-react';
import { Card, Page, Section } from '../components/common';
import { useToast } from '../state/ToastProvider';
import { useAddWalletMutation, useSessionQuery, useSwitchWalletMutation } from '../hooks/useAccounts';
import { cls } from '../utils/format';

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function AccountsPage() {
  const toast = useToast();
  const { data: session, isLoading } = useSessionQuery();
  const addWallet = useAddWalletMutation();
  const switchWallet = useSwitchWalletMutation();

  const add = async () => {
    try {
      await addWallet.mutateAsync();
      toast.success('Wallet added to this session.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add wallet');
    }
  };

  const select = async (address: string) => {
    try {
      await switchWallet.mutateAsync(address);
      toast.success(`Switched to ${shortAddress(address)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not switch wallet');
    }
  };

  return (
    <Page
      title="Accounts"
      subtitle="Add wallets to this session and switch the wallet whose account data is active."
      actions={
        <button onClick={() => void add()} disabled={addWallet.isPending} className="pocketed-btn-primary">
          <Plus className="h-4 w-4" /> {addWallet.isPending ? 'Connecting…' : 'Add wallet'}
        </button>
      }
    >
      <Section title="Connected wallets">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {isLoading && <Card>Loading wallets…</Card>}
          {session?.wallets.map((address) => {
            const active = address === session.active;
            return (
              <Card key={address}>
                <div className="flex items-start gap-3">
                  <div className={cls(
                    'grid h-10 w-10 shrink-0 place-items-center rounded-lg',
                    active ? 'bg-pocketed-glow text-white' : 'bg-pocketed-surface2 text-pocketed-muted',
                  )}>
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm font-medium text-white" title={address}>{address}</div>
                    <div className="mt-1 text-xs text-pocketed-muted">
                      {active ? 'Active wallet' : 'Available in this session'}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  {active ? (
                    <span className="pocketed-pill border-pocketed-purple/40 bg-pocketed-purple/10 text-pocketed-purple">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  ) : (
                    <button
                      onClick={() => void select(address)}
                      disabled={switchWallet.isPending}
                      className="pocketed-btn-default text-xs"
                    >
                      Switch to wallet
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </Section>

      <Section title="How it works">
        <Card>
          <ul className="list-disc space-y-1.5 pl-5 text-xs text-pocketed-muted">
            <li>Each wallet has isolated server-side account data, positions, and configuration.</li>
            <li>Adding a wallet asks it to sign in, then keeps it available in this browser session.</li>
            <li>Switching wallets reloads the app&apos;s data for the selected address.</li>
          </ul>
        </Card>
      </Section>
    </Page>
  );
}

import React, { useEffect, useState } from 'react';
import {
  ExternalLink, Eye, EyeOff, Gift, KeyRound, RefreshCcw,
  Save, ShieldAlert, ShieldCheck, Trash2, Wallet, Wifi, WifiOff,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { CredentialsState } from '@shared/types';
import { useToast } from '../state/ToastProvider';
import { Card, Page, Section } from '../components/common';
import { cls } from '../utils/format';
import { POLYMARKET_REFERRAL_URL } from '../utils/links';
import {
  useCredentialsStatusAllQuery, useSaveCredentialsMutation, useTestCredentialsMutation,
  useClearCredentialsMutation,
} from '../hooks/useCredentials';
import { useAuthStatusQuery } from '../hooks/useTrading';

const SIGNATURE_TYPE_LABELS: Record<number, string> = {
  0: 'EOA',
  1: 'POLY_PROXY',
  2: 'POLY_GNOSIS_SAFE',
  3: 'POLY_1271',
};

export function ApiKeysPage() {
  const { data: authStatus } = useAuthStatusQuery();
  const qc = useQueryClient();
  const { data: statusAll, refetch } = useCredentialsStatusAllQuery();

  const cred: CredentialsState | undefined = statusAll?.mainnet;

  return (
    <Page
      title="Wallet"
      subtitle="Connect a Polygon wallet to trade on Polymarket. Your private key is stored locally (encrypted with your Windows account) under %APPDATA%/Pocketed/credentials and never sent off-machine."
      actions={
        <button onClick={() => void refetch()} className="pocketed-btn-default" title="Re-read credential status from disk">
          <RefreshCcw className="h-4 w-4" /> Refresh
        </button>
      }
    >
      {!cred?.hasWalletKey && <ReferralBanner />}

      <Section title="Connection">
        <Card>
          <div className="flex flex-col items-start gap-4 md:flex-row md:items-center">
            <div className={cls(
              'grid h-10 w-10 shrink-0 place-items-center rounded-lg',
              authStatus?.authOk ? 'bg-pocketed-win/10 text-pocketed-win' : 'bg-pocketed-loss/10 text-pocketed-loss',
            )}>
              {authStatus?.authOk ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
            </div>
            <div className="flex-1">
              <div className="text-sm text-white">
                {authStatus?.authOk ? 'Connected · Polygon mainnet' : 'Not connected'}
              </div>
              <div className="mt-0.5 text-xs text-pocketed-muted">
                {cred?.address
                  ? <>Wallet <span className="font-mono text-white">{cred.address}</span></>
                  : 'The bot signs CLOB orders locally with your wallet key. Connect a funded wallet to trade.'}
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <WalletSlot
        status={cred}
        onSaved={async () => { await refetch(); await qc.invalidateQueries({ queryKey: ['account'] }); }}
      />

      <Section title="Security notes">
        <Card>
          <ul className="list-disc space-y-1.5 pl-5 text-xs text-pocketed-muted">
            <li>Your private key is written to <span className="font-mono text-white">%APPDATA%/Pocketed/credentials/wallet.mainnet.key</span>, encrypted at rest with the Windows user keystore (DPAPI).</li>
            <li>The Python backend derives Polymarket CLOB API credentials from your key and signs every order locally (EIP-712). Nothing is sent anywhere but Polymarket.</li>
            <li>Use a dedicated trading wallet funded only with what you intend to trade. Anyone with this key controls those funds.</li>
            <li>Click &quot;Delete&quot; before uninstalling if you want the key gone.</li>
          </ul>
        </Card>
      </Section>
    </Page>
  );
}

function ReferralBanner() {
  return (
    <div className="mb-4 flex flex-col items-start gap-3 rounded-xl border border-pocketed-purple/40 bg-gradient-to-r from-pocketed-indigo/10 via-pocketed-purple/10 to-pocketed-pink/10 p-4 md:flex-row md:items-center">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-pocketed-glow shadow-pocketed-soft">
        <Gift className="h-5 w-5 text-white" />
      </div>
      <div className="flex-1 text-sm">
        <div className="font-medium text-white">No Polymarket account yet?</div>
        <div className="mt-0.5 text-xs text-pocketed-muted">
          Sign up with our link — deposit $20 and place a first trade for up to $50 in trading
          credits (Polymarket&apos;s current new-user offer). Then fund the wallet with USDC and
          export its private key to connect it here.
        </div>
      </div>
      <button
        onClick={() => window.open(POLYMARKET_REFERRAL_URL, '_blank', 'noopener,noreferrer')}
        className="pocketed-btn-primary"
      >
        <Gift className="h-4 w-4" /> Sign up <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  );
}

interface SlotProps {
  status?: CredentialsState;
  onSaved: () => Promise<void>;
}

function WalletSlot({ status, onSaved }: SlotProps) {
  const toast = useToast();
  const [privateKey, setPrivateKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [funder, setFunder] = useState('');
  useEffect(() => { setFunder(status?.funder || ''); }, [status?.funder]);

  const saveMutation = useSaveCredentialsMutation();
  const testMutation = useTestCredentialsMutation();
  const clearMutation = useClearCredentialsMutation();
  const busy = saveMutation.isPending || testMutation.isPending || clearMutation.isPending;

  const has = !!status?.hasWalletKey;

  const reportTest = (data?: {
    balanceUsd?: number; ready?: boolean; issues?: string[];
  }): void => {
    const balStr = `$${(data?.balanceUsd ?? 0).toFixed(2)}`;
    const issues = data?.issues ?? [];
    if (data?.ready === false || issues.length) {
      const detail = issues[0]
        || ((data?.balanceUsd ?? 0) <= 0 ? 'wallet has no USDC balance' : 'not ready to trade');
      toast.warn(`Connected · balance ${balStr} — but not ready to trade yet: ${detail}`);
    } else {
      toast.success(`Connected · balance ${balStr} · ready to trade`);
    }
  };

  const save = async (): Promise<void> => {
    const pk = privateKey.trim();
    const fund = funder.trim();
    if (fund && !/^0x[0-9a-fA-F]{40}$/.test(fund)) {
      toast.error('Deposit wallet address must be a 0x… 40-hex address (or leave it blank for a raw wallet).');
      return;
    }

    if (!pk && has) {
      if (fund === (status?.funder || '')) {
        toast.error('Nothing to update — paste a new private key to replace the wallet, change the deposit wallet, or click Delete to remove it.');
        return;
      }
      try {
        await saveMutation.mutateAsync({
          funder: fund || undefined,
          signatureType: fund ? 3 : 0,
          env: 'mainnet',
        });
        toast.success(fund ? 'Deposit wallet updated. Verifying…' : 'Deposit wallet cleared. Verifying…');
        try {
          const data = await testMutation.mutateAsync('mainnet');
          reportTest(data as { balanceUsd?: number; ready?: boolean; issues?: string[] });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Could not connect to Polymarket');
        }
        await onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Update failed');
      }
      return;
    }

    const hex = pk.replace(/^0x/, '');
    if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
      toast.error('Paste a 64-character hex private key (optionally 0x-prefixed).');
      return;
    }
    try {
      await saveMutation.mutateAsync({
        privateKey: pk,
        funder: fund || undefined,
        signatureType: fund ? 3 : 0,
        env: 'mainnet',
      });
      toast.success('Wallet saved. Verifying…');
      try {
        const data = await testMutation.mutateAsync('mainnet');
        reportTest(data as { balanceUsd?: number; ready?: boolean; issues?: string[] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not connect to Polymarket');
      }
      setPrivateKey('');
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const test = async (): Promise<void> => {
    try {
      const data = await testMutation.mutateAsync('mainnet');
      reportTest(data as { balanceUsd?: number; ready?: boolean; issues?: string[] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Test failed');
    }
  };

  const clear = async (): Promise<void> => {
    if (!window.confirm('Delete the saved wallet key from disk?')) return;
    try {
      await clearMutation.mutateAsync('mainnet');
      toast.success('Wallet removed');
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <Section title="Wallet key">
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-pocketed-purple/30 bg-pocketed-purple/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-pocketed-purple">
            <Wallet className="h-3 w-3" /> Polygon
          </span>
          <div className="text-sm font-semibold text-white">Trading wallet</div>
          <span className={cls(
            'ml-auto rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wider',
            has
              ? 'border border-pocketed-win/30 bg-pocketed-win/10 text-pocketed-win'
              : 'border border-pocketed-border bg-pocketed-surface2 text-pocketed-muted',
          )}>
            {has ? 'connected' : 'empty'}
          </span>
        </div>

        {has && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-pocketed-border bg-pocketed-surface2 px-3 py-2 text-xs text-pocketed-muted">
            <KeyRound className="h-3.5 w-3.5 text-pocketed-win" />
            <div className="flex-1">
              <div>
                Signer <span className="font-mono text-white">{status?.addressPreview || '—'}</span>
                <span className="mx-2 text-pocketed-dim">·</span>
                API creds {status?.hasApiCreds ? <span className="text-pocketed-win">derived</span> : <span className="text-pocketed-warn">derive on connect</span>}
              </div>
              {status?.funder && (
                <div className="mt-0.5">
                  Deposit wallet{' '}
                  <span className="font-mono text-white">{status.funder.slice(0, 6)}…{status.funder.slice(-4)}</span>
                  <span className="mx-2 text-pocketed-dim">·</span>
                  <span className="text-pocketed-win">{SIGNATURE_TYPE_LABELS[status.signatureType ?? 0] ?? `type ${status.signatureType}`}</span>
                  <span className="mx-2 text-pocketed-dim">·</span>
                  <span className="text-pocketed-dim">detected from the chain</span>
                </div>
              )}
              {status?.walletMode === 'error' && (
                <div className="mt-0.5 text-pocketed-loss">
                  Deposit-wallet setting unreadable: {status.metaError || 'unknown error'}. Re-save your
                  deposit wallet address below.
                </div>
              )}
              <div className="text-[10px] text-pocketed-dim">
                Paste a new key below to replace, or click Delete to remove.
              </div>
            </div>
          </div>
        )}

        {has && status?.keyStoredUnencrypted && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-pocketed-loss/50 bg-pocketed-loss/10 px-3 py-2 text-xs text-pocketed-loss">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Private key stored unencrypted</div>
              <div className="mt-0.5 text-pocketed-muted">
                No OS keystore (Windows DPAPI / macOS Keychain / Secret Service) was
                available, so your wallet key is saved in plaintext on this machine.
                Anyone with access to this device — or to a backup/cloud-sync of it —
                could take your funds. Enable a system keychain and re-save the key,
                or use a small dedicated wallet.
              </div>
            </div>
          </div>
        )}

        <label className="pocketed-label mt-1 flex items-center justify-between">
          Wallet private key (0x-hex)
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="text-xs text-pocketed-muted hover:text-white"
          >
            {showKey ? <><EyeOff className="mr-1 inline h-3 w-3" />hide</> : <><Eye className="mr-1 inline h-3 w-3" />show</>}
          </button>
        </label>
        <input
          type={showKey ? 'text' : 'password'}
          className="pocketed-input font-mono"
          placeholder={has ? 'paste a new key to replace the connected wallet' : '0x' + 'x'.repeat(64)}
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="pocketed-help">
          <strong className="text-white">Polymarket account (email/Google login):</strong> export your
          key on Polymarket (Settings → Export private key) and add your deposit-wallet address below.
          <br />
          A deposit wallet is <strong className="text-white">required</strong>. Polymarket rejects orders
          signed by a bare wallet address, so the bot cannot trade without one.
        </p>

        <div className="mt-4 rounded-lg border border-pocketed-purple/40 bg-pocketed-purple/5 p-3">
          <label className="pocketed-label flex flex-wrap items-center gap-2">
            Deposit wallet address
            <span className="rounded bg-pocketed-purple/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-pocketed-purple">
              needed for Polymarket logins
            </span>
          </label>
          <input
            type="text"
            className="pocketed-input font-mono"
            placeholder="0x… your Polymarket deposit wallet"
            value={funder}
            onChange={(e) => setFunder(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="pocketed-help">
            <strong className="text-white">This is where your Polymarket balance lives.</strong> Copy the
            Polygon <span className="font-mono">0x…</span> address from your Polymarket profile / deposit
            screen (not the Solana one) and paste it here — without it the bot reads your bare signer
            wallet and shows a <span className="font-mono">$0.00</span> balance. The signing scheme is
            detected from the chain automatically (POLY_1271 for email/Google accounts, POLY_PROXY or
            Gnosis Safe for older ones). If orders are ever rejected with{' '}
            <span className="font-mono">signer ≠ api key</span>, click Test to re-detect it.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={save} disabled={busy} className="pocketed-btn-primary">
            <Save className="h-4 w-4" /> Save &amp; connect
          </button>
          <button onClick={test} disabled={busy || !has} className="pocketed-btn-default">
            <ShieldCheck className="h-4 w-4" /> Test
          </button>
          {has && (
            <button onClick={clear} disabled={busy} className="pocketed-btn-danger ml-auto">
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
        </div>
      </Card>
    </Section>
  );
}

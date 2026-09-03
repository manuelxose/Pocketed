import type { Page } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Deterministic, publicly-known test-only private key — Anvil/Hardhat's
 * default account #0. NEVER holds real funds and must never be used outside
 * this test harness. Picking a well-known throwaway key (rather than
 * generating a fresh one per run) keeps the wallet address stable across
 * runs, which is convenient for debugging a failing CI run against local
 * logs, without providing any real security since the key is public anyway.
 */
export const TEST_WALLET_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

// The account signs real EIP-191 ("personal_sign") messages with viem — the
// same cryptography a real MetaMask/Rabby wallet uses — so the backend's
// siwe/eth_account signature verification in webserver/auth.py is exercised
// for real, not stubbed out.
const account = privateKeyToAccount(TEST_WALLET_PRIVATE_KEY);

// A chain id dedicated to this test harness — deliberately NOT Polygon
// mainnet (137), so it can never be mistaken for a real network. The
// gateway's chain allowlist is widened to include it only for the E2E run,
// via POCKETED_SIWE_CHAIN_IDS in e2e/playwright.config.ts.
export const TEST_CHAIN_ID = 1337;

/**
 * Installs a minimal, real EIP-1193 provider (`window.ethereum`) into the
 * page — the same interface a browser extension wallet injects — backed by
 * a Node-side viem account via `page.exposeFunction`. The frontend's own
 * `src/lib/wallet.ts` talks to `window.ethereum` exactly as it would talk to
 * MetaMask; nothing in the app code path is mocked or bypassed.
 *
 * Must be called before the page navigates (uses `addInitScript`, so it
 * re-installs on every navigation/reload too).
 */
export async function installTestWallet(page: Page): Promise<void> {
  await page.exposeFunction('__pocketedTestWalletSign', async (message: string) => {
    return account.signMessage({ message });
  });

  await page.addInitScript(
    ({ address, chainIdHex }) => {
      const ethereum = {
        isTestWallet: true,
        selectedAddress: address,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return [address];
            case 'eth_chainId':
              return chainIdHex;
            case 'personal_sign': {
              const message = (params as [string, string])[0];
              return (window as unknown as {
                __pocketedTestWalletSign: (m: string) => Promise<string>;
              }).__pocketedTestWalletSign(message);
            }
            default:
              throw new Error(`test wallet: unsupported method ${method}`);
          }
        },
      };
      (window as unknown as { ethereum: unknown }).ethereum = ethereum;
    },
    { address: account.address, chainIdHex: `0x${TEST_CHAIN_ID.toString(16)}` },
  );
}

export const TEST_WALLET_ADDRESS = account.address;

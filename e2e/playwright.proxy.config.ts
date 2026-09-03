import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCerts } from './certs/gen-certs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certs = ensureCerts();

export default defineConfig({
  testDir: './tests',
  testMatch: ['auth-ws-tls.spec.ts'],
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  globalSetup: path.join(ROOT, 'e2e', 'proxy-global-setup.mjs'),
  globalTeardown: path.join(ROOT, 'e2e', 'proxy-global-teardown.mjs'),
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-proxy' }]]
    : 'list',
  use: {
    baseURL: 'https://localhost:8443',
    trace: 'retain-on-failure',
    launchOptions: {
      args: [`--ignore-certificate-errors-spki-list=${certs.spkiHash}`],
    },
  },
});

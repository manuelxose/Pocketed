import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCerts } from './certs/gen-certs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const webserverVenvPy = path.join(
  ROOT, 'webserver', '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python',
);

const GATEWAY_PORT = process.env.POCKETED_E2E_TLS_GATEWAY_PORT || '8903';
const FRONTEND_PORT = process.env.POCKETED_E2E_TLS_FRONTEND_PORT || '5903';

const certs = ensureCerts();

const sharedEnv = {
  APP_ENV: 'test',
  POCKETED_SESSION_SECRET: 'e2e-test-session-secret-not-for-production-use-only',
  POCKETED_WORKER_SCRIPT: path.join(ROOT, 'webserver', 'tests', 'fixtures', 'dummy_worker.py'),
  POCKETED_SIWE_CHAIN_IDS: '1337',
  POCKETED_GATEWAY_PORT: GATEWAY_PORT,
  POCKETED_TLS_CERT_FILE: certs.leafCert,
  POCKETED_TLS_KEY_FILE: certs.leafKey,
};

// NOTE: Task 12 adds a third webServer entry (a malicious-origin WSS server,
// e2e/fixtures/malicious-origin-server.mjs) and extends testMatch to include
// malicious-origin.spec.ts once that fixture exists. Until then, only this
// task's uvicorn + Vite servers and auth-ws-tls.spec.ts are wired up —
// Playwright starts every webServer entry regardless of test filtering, so
// referencing a not-yet-created script here would fail every run.
export default defineConfig({
  testDir: './tests',
  testMatch: ['auth-ws-tls.spec.ts'],
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-tls' }]]
    : 'list',
  use: {
    baseURL: `https://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Trust ONLY this run's generated leaf cert (by its public-key hash)
      // — never a blanket --ignore-certificate-errors.
      args: [`--ignore-certificate-errors-spki-list=${certs.spkiHash}`],
    },
  },
  webServer: [
    {
      command:
        `"${webserverVenvPy}" -m uvicorn webserver.main:app --port ${GATEWAY_PORT} ` +
        `--ssl-certfile "${certs.leafCert}" --ssl-keyfile "${certs.leafKey}"`,
      cwd: ROOT,
      env: { ...process.env, ...sharedEnv },
      url: `https://127.0.0.1:${GATEWAY_PORT}/health`,
      reuseExistingServer: false,
      ignoreHTTPSErrors: true,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      cwd: ROOT,
      env: { ...process.env, ...sharedEnv },
      url: `https://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      ignoreHTTPSErrors: true,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});

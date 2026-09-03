import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const webserverVenvPy = path.join(
  ROOT, 'webserver', '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python',
);

const GATEWAY_PORT = process.env.POCKETED_E2E_GATEWAY_PORT || '8901';
const FRONTEND_PORT = process.env.POCKETED_E2E_FRONTEND_PORT || '5901';

// Shared secret/config env for the two webServers below AND for the tests
// themselves (see e2e/tests/*.spec.ts reading process.env.POCKETED_E2E_*).
// All test-only: never set POCKETED_WORKER_SCRIPT in a real deployment.
const sharedEnv = {
  APP_ENV: 'test',
  POCKETED_SESSION_SECRET: 'e2e-test-session-secret-not-for-production-use-only',
  // Points every spawned worker at the deterministic stdio-RPC fixture
  // (ping/pong, no real trading deps) instead of python/service.py.
  POCKETED_WORKER_SCRIPT: path.join(ROOT, 'webserver', 'tests', 'fixtures', 'dummy_worker.py'),
  // e2e/fixtures/test-wallet.ts signs for TEST_CHAIN_ID (1337), a chain that
  // deliberately does not exist in production's allowlist (137 / Polygon).
  POCKETED_SIWE_CHAIN_IDS: '1337',
  POCKETED_GATEWAY_PORT: GATEWAY_PORT,
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // one shared gateway/worker-supervisor process per run
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        `"${webserverVenvPy}" -m uvicorn webserver.main:app --port ${GATEWAY_PORT}`,
      cwd: ROOT,
      env: { ...process.env, ...sharedEnv },
      url: `http://127.0.0.1:${GATEWAY_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Vite dev server, proxying /auth,/ws,... to the gateway above —
      // exactly the local-development topology described in
      // vite.config.ts, so this exercises the real dev proxy path too.
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      cwd: ROOT,
      env: { ...process.env, ...sharedEnv },
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});

// Pocketed dev orchestrator: starts the FastAPI gateway (webserver/) and
// waits for it to report healthy, then starts the Vite frontend — so
// `npm run dev` is the one obvious command a developer needs, instead of
// two manually-coordinated terminals. Cross-platform (spawn only, no
// shell-specific syntax) so it works the same on Windows and POSIX.
import { spawn } from 'node:child_process';
import process from 'node:process';

import { ensureWebserverVenv, ROOT, WEBSERVER_DIR, WEBSERVER_VENV_PY } from './python-utils.mjs';

const GATEWAY_PORT = process.env.POCKETED_GATEWAY_PORT || '8000';
const GATEWAY_HEALTH_URL = `http://127.0.0.1:${GATEWAY_PORT}/health`;
const HEALTH_TIMEOUT_MS = 20000;
const HEALTH_POLL_INTERVAL_MS = 300;

const isWin = process.platform === 'win32';
const children = [];
let shuttingDown = false;

function log(prefix, line) {
  for (const l of line.split(/\r?\n/)) {
    if (l.length) console.log(`[${prefix}] ${l}`);
  }
}

function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (isWin) {
    // `child.kill()` on Windows does not reliably stop a process that has
    // spawned its own children (uvicorn --reload's watcher subprocess) —
    // ask taskkill to terminate the whole tree instead.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) killTree(c);
  // Give taskkill/SIGTERM a moment before the parent process itself exits.
  setTimeout(() => process.exit(code), 300);
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (resp.ok) return true;
    } catch {
      // gateway not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

async function main() {
  console.log('>> Preparing gateway (webserver/) environment...');
  ensureWebserverVenv();

  const gatewayEnv = {
    ...process.env,
    APP_ENV: process.env.APP_ENV || 'development',
    // Dev-only fallback so `npm run dev` works with zero config. Never used
    // in production: webserver/main.py refuses to start with this fallback
    // when APP_ENV=production and POCKETED_SESSION_SECRET is unset.
    POCKETED_SESSION_SECRET:
      process.env.POCKETED_SESSION_SECRET || 'dev-insecure-session-secret-do-not-use-in-prod',
  };

  console.log(`>> Starting gateway: uvicorn webserver.main:app --reload --port ${GATEWAY_PORT}`);
  // Run from the repo root (not webserver/) so the `webserver` package
  // resolves for `webserver.main:app` — see README's own callout.
  const gateway = spawn(
    WEBSERVER_VENV_PY,
    ['-m', 'uvicorn', 'webserver.main:app', '--reload', '--port', GATEWAY_PORT],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: !isWin },
  );
  children.push(gateway);
  gateway.stdout.on('data', (d) => log('api', d.toString()));
  gateway.stderr.on('data', (d) => log('api', d.toString()));

  let gatewayExitedEarly = false;
  gateway.on('exit', (code) => {
    if (!shuttingDown) {
      gatewayExitedEarly = true;
      console.error(`\nPocketed gateway failed to start\nReason: process exited with code ${code} before becoming healthy.\n`);
      shutdown(1);
    }
  });

  const healthy = await waitForHealth(GATEWAY_HEALTH_URL, HEALTH_TIMEOUT_MS);
  if (gatewayExitedEarly) return; // already reported + shutting down
  if (!healthy) {
    console.error(
      `\nPocketed gateway failed to start\nReason: ${GATEWAY_HEALTH_URL} did not respond within ${HEALTH_TIMEOUT_MS}ms.\n` +
        'Check the [api] log lines above for the actual error.\n',
    );
    shutdown(1);
    return;
  }
  console.log('>> Gateway healthy. Starting Vite...');

  const viteBin = isWin ? 'vite.cmd' : 'vite';
  const vite = spawn(viteBin, [], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin, // .cmd shims on Windows need shell:true to resolve via PATH
  });
  children.push(vite);
  vite.stdout.on('data', (d) => log('web', d.toString()));
  vite.stderr.on('data', (d) => log('web', d.toString()));
  vite.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`\n[web] Vite exited unexpectedly (code ${code}).\n`);
      shutdown(code ?? 1);
    }
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((err) => {
  console.error('>> Dev orchestrator failed:', err.message);
  shutdown(1);
});

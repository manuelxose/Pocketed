import { test, expect, type Page, type CDPSession } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { installTestWallet, TEST_WALLET_ADDRESS } from '../fixtures/test-wallet';

// Must match e2e/playwright.config.ts's sharedEnv.POCKETED_SESSION_SECRET —
// used ONLY to mint an already-expired token for the rejection test below,
// never to bypass verification (the gateway still runs its own real
// jwt.decode()/exp check against this exact secret).
const SESSION_SECRET = 'e2e-test-session-secret-not-for-production-use-only';
const SESSION_COOKIE_NAME = 'kpb_session';

async function login(page: Page): Promise<void> {
  await page.goto('/');
  const signInButton = page.getByRole('button', { name: /sign in/i });
  // A cold gateway/Vite start (first test in the run) plus the initial
  // burst of 401s from every session-scoped query can push first paint past
  // Playwright's 5s default — match the 15s budget used below for the SIWE
  // round trip itself.
  await expect(signInButton).toBeVisible({ timeout: 15_000 });

  // Wait for the real network signal (a 200 from /auth/verify), not for the
  // button to disappear: src/components/TopBar.tsx's SessionButton also
  // hides while `status === 'loggingIn'` (its accessible name changes from
  // "Sign in" to "Confirm in wallet…", so a name-based locator like
  // `signInButton` stops matching anything and Playwright reports that as
  // "hidden") — a `toBeHidden()` check here would pass the instant the
  // click registers, long before nonce -> personal_sign -> /auth/verify
  // actually finished, and every assertion after `login()` would then be
  // racing an incomplete sign-in.
  const verifyResponse = page.waitForResponse(
    (r) => r.url().includes('/auth/verify') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await signInButton.click();
  const resp = await verifyResponse;
  expect(resp.status(), 'POST /auth/verify must succeed for login() to be meaningful').toBe(200);

  // Now the real "signed in" signal: TopBar re-renders with status ===
  // 'loggedIn' and SessionButton unmounts for good (see TopBar.tsx).
  await expect(signInButton).toBeHidden({ timeout: 5_000 });
}

/** Attach Chrome DevTools Protocol Network domain listeners so we can
 * observe the actual WS HTTP-upgrade response code (101/403) — something
 * the page-level WebSocket API never exposes. */
async function watchWebSocketHandshakes(page: Page): Promise<{
  cdp: CDPSession;
  statuses: number[];
}> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const statuses: number[] = [];
  cdp.on('Network.webSocketHandshakeResponseReceived', (e) => {
    statuses.push(e.response.status);
  });
  return { cdp, statuses };
}

test.describe('SIWE wallet login -> authenticated WSS -> RPC', () => {
  test.beforeEach(async ({ page }) => {
    await installTestWallet(page);
  });

  test('wallet connect -> SIWE sign-in -> 101 upgrade -> ping RPC round trip', async ({ page }) => {
    const { statuses } = await watchWebSocketHandshakes(page);

    await login(page);

    // Confirm the app-session cookie really landed in the browser's cookie
    // jar with the flags production relies on (HttpOnly means we can't read
    // its value from page JS, which is itself part of what we're verifying).
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(sessionCookie, 'session cookie must be set after /auth/verify').toBeTruthy();
    expect(sessionCookie!.httpOnly).toBe(true);
    expect(sessionCookie!.sameSite).toBe('Lax');

    // Open the WS the exact way src/lib/ws-client.ts does: same-origin
    // `ws://<host>/ws`, no auth header — the cookie rides along automatically.
    const rpcResult = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://${window.location.host}/ws`);
          const timeout = setTimeout(() => reject(new Error('rpc timeout')), 10_000);
          ws.onopen = () => ws.send(JSON.stringify({ type: 'rpc', id: '1', method: 'ping', params: {} }));
          ws.onmessage = (e) => {
            const msg = JSON.parse(e.data as string);
            if (msg.type === 'rpc' && msg.id === '1') {
              clearTimeout(timeout);
              ws.close();
              resolve(msg);
            }
          };
          ws.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('ws error'));
          };
        }),
    );

    expect(rpcResult).toEqual({ type: 'rpc', id: '1', ok: true, result: { pong: true } });

    // The upgrade that just carried the ping/pong really was a 101, not a
    // silently-degraded fallback.
    expect(statuses).toContain(101);
  });

  test('reconnects automatically after a network drop while the session is still valid', async ({
    page,
    context,
  }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const created: string[] = [];
    const closed: string[] = [];
    cdp.on('Network.webSocketCreated', (e) => created.push(e.requestId));
    cdp.on('Network.webSocketClosed', (e) => closed.push(e.requestId));

    await login(page);

    // The app's own WsProvider auto-connects on login (src/state/WsProvider.tsx
    // wraps src/lib/ws-client.ts) — wait for that first socket rather than
    // opening our own, so the reconnect we observe below is the real
    // production client's state machine (exponential backoff + jitter,
    // 'reconnecting' -> 'open'), not a hand-rolled one.
    await expect.poll(() => created.length, { timeout: 10_000 }).toBeGreaterThan(0);

    await context.setOffline(true);
    await expect.poll(() => closed.length, { timeout: 10_000 }).toBeGreaterThan(0);

    await context.setOffline(false);
    // A fresh 101-upgraded socket after the drop is the real signal the
    // client reconnected — not just that it retried and got closed again.
    await expect.poll(() => created.length, { timeout: 20_000 }).toBeGreaterThan(1);

    const rpcResult = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://${window.location.host}/ws`);
          const timeout = setTimeout(() => reject(new Error('rpc timeout')), 10_000);
          ws.onopen = () => ws.send(JSON.stringify({ type: 'rpc', id: '2', method: 'ping', params: {} }));
          ws.onmessage = (e) => {
            const msg = JSON.parse(e.data as string);
            if (msg.type === 'rpc' && msg.id === '2') {
              clearTimeout(timeout);
              ws.close();
              resolve(msg);
            }
          };
          ws.onerror = () => reject(new Error('ws error'));
        }),
    );
    expect(rpcResult).toEqual({ type: 'rpc', id: '2', ok: true, result: { pong: true } });
  });

  test('rejects a WS connection with no session cookie', async ({ page }) => {
    await page.goto('/'); // no login — never authenticated
    const closeCode = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const ws = new WebSocket(`ws://${window.location.host}/ws`);
          ws.onclose = (e) => resolve(e.code);
        }),
    );
    // Origin is valid (this really is the app's own page), so
    // webserver/main.py's ws_endpoint accepts the handshake (101) same as
    // any other request from this origin, THEN decode_session_token fails
    // on the missing cookie and it closes with 4401 — the same signal as
    // an invalid/expired token (see the two tests below). A 403-at-handshake
    // rejection is reserved for a bad/missing Origin (see webserver/tests/
    // test_main_ws.py::test_ws_rejects_missing_origin /
    // test_ws_rejects_cross_site_origin for that path — not reproducible
    // from a real same-origin browser page, since the browser always sends
    // a correct Origin on its own page's own requests).
    expect(closeCode).toBe(4401);
  });

  test('rejects a WS connection with a corrupted session cookie', async ({ page, context }) => {
    await login(page);
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: 'not-a-valid-jwt',
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const closeCode = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const ws = new WebSocket(`ws://${window.location.host}/ws`);
          ws.onclose = (e) => resolve(e.code);
        }),
    );
    // Cookie present + Origin allowed => the handshake IS accepted (101),
    // then webserver/main.py's ws_endpoint decodes the token, fails, and
    // closes with the app-level 4401 "auth required" code — this is the
    // code src/lib/ws-client.ts's AUTH_REQUIRED_CLOSE_CODE matches on to
    // trigger re-auth instead of a blind reconnect loop.
    expect(closeCode).toBe(4401);
  });

  test('rejects a WS connection with an expired session token', async ({ page, context }) => {
    await login(page);
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = jwt.sign(
      { wallets: [TEST_WALLET_ADDRESS], active: TEST_WALLET_ADDRESS, iat: now - 120, exp: now - 60 },
      SESSION_SECRET,
      { algorithm: 'HS256' },
    );
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: expiredToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const closeCode = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const ws = new WebSocket(`ws://${window.location.host}/ws`);
          ws.onclose = (e) => resolve(e.code);
        }),
    );
    expect(closeCode).toBe(4401);
  });

  test('logout revokes the session: a captured token can no longer authenticate over HTTP or WS', async ({
    page,
    context,
  }) => {
    await login(page);
    const cookies = await page.context().cookies();
    const capturedToken = cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;

    const logoutStatus = await page.evaluate(() =>
      fetch('/auth/logout', { method: 'POST' }).then((r) => r.status),
    );
    expect(logoutStatus).toBe(200);

    // Re-attach the captured (now-revoked) token — simulating an attacker who
    // exfiltrated it before logout — and prove it no longer authenticates.
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: capturedToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    const sessionStatus = await page.evaluate(() => fetch('/auth/session').then((r) => r.status));
    expect(sessionStatus, 'a captured token must not authenticate over HTTP after logout').toBe(401);

    const closeCode = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const ws = new WebSocket(`ws://${window.location.host}/ws`);
          ws.onclose = (e) => resolve(e.code);
        }),
    );
    expect(closeCode, 'a captured token must not open a new WS after logout').toBe(4401);
  });

  test('logout closes an already-open WebSocket for that session', async ({ page }) => {
    await login(page);

    const closeCode = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const ws = new WebSocket(`ws://${window.location.host}/ws`);
          ws.onopen = () => {
            fetch('/auth/logout', { method: 'POST' });
          };
          ws.onclose = (e) => resolve(e.code);
        }),
    );
    expect(closeCode, 'an open socket must be closed once its session is revoked').toBe(4402);
  });
});

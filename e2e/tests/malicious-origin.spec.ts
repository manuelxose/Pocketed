import { test, expect, type Page } from '@playwright/test';
import { installTestWallet } from '../fixtures/test-wallet';

// Chromium never fires Network.webSocketHandshakeResponseReceived for a
// non-101 response — a rejected opening handshake surfaces only as
// Network.webSocketFrameError, whose message names the HTTP status the
// server actually sent (confirmed empirically: "Unexpected response code:
// 403"). That's the real, browser-level proof that the Origin check fired.
async function watchWebSocketHandshakeErrors(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const errors: string[] = [];
  cdp.on('Network.webSocketFrameError', (e) => errors.push(e.errorMessage));
  return errors;
}

// Set by playwright.config.ts (http://localhost:5902) and
// playwright.tls.config.ts (https://localhost:<MALICIOUS_PORT>) — the same
// spec runs, unmodified, against both the plain-HTTP and TLS/WSS projects.
const MALICIOUS_ORIGIN_URL = process.env.POCKETED_E2E_MALICIOUS_ORIGIN_URL || 'http://localhost:5902';

test.describe('malicious-Origin WebSocket rejection', () => {
  test('a page on a different origin cannot open an authenticated WS against Pocketed', async ({ page }) => {
    await installTestWallet(page);
    await page.goto('/');

    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible({ timeout: 15_000 });
    const verifyResponse = page.waitForResponse(
      (r) => r.url().includes('/auth/verify') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await signInButton.click();
    await verifyResponse;
    await expect(signInButton).toBeHidden({ timeout: 5_000 });

    // Watch for the raw handshake error CDP sees, before navigating away —
    // this is the only place the server's actual verdict (HTTP 403, from
    // webserver/main.py::_ws_origin_allowed rejecting *before* accept()) is
    // observable. See the note below on why the browser-visible close code
    // cannot carry that verdict directly.
    const handshakeErrors = await watchWebSocketHandshakeErrors(page);

    // Navigate to the malicious second origin, in the SAME browser context.
    // Its own page script opens the WebSocket — Chromium attaches whatever
    // cookies exist for the TARGET origin (Pocketed's), and sets Origin to
    // THIS page's own origin (the malicious one) — exactly the CSRF-shaped
    // risk _ws_origin_allowed defends against, reproduced for real.
    await page.goto(MALICIOUS_ORIGIN_URL + '/');

    const closeCode = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const check = () => {
            const el = document.getElementById('result');
            if (el && el.textContent !== 'pending') resolve(el.textContent!);
            else setTimeout(check, 100);
          };
          check();
        }),
    );

    // _ws_origin_allowed rejects with `await websocket.close(code=4403)`
    // called BEFORE `websocket.accept()` (webserver/main.py). Per the
    // WebSocket spec, an app-level close code can only be delivered inside
    // a real Close frame, which requires a completed (101) opening
    // handshake first. Closing before accept() means the handshake itself
    // never completes — uvicorn answers with a plain HTTP 403 instead of a
    // 101 Switching Protocols, so the browser's `WebSocket` never reaches
    // OPEN and its `onclose` fires with the generic "handshake failed"
    // code 1006, not 4403 (browsers never expose HTTP status or app close
    // codes from a failed opening handshake — confirmed empirically here,
    // and consistent with the spec). webserver/tests/test_main_ws.py
    // observes 4403 directly at the ASGI layer via Starlette's TestClient,
    // which has no such restriction. The CDP-observed HTTP 403 handshake
    // response below is the real, browser-level proof that the Origin
    // check actually fired and rejected this cross-origin page.
    expect(
      handshakeErrors.some((m) => m.includes('403')),
      `expected a WS handshake error citing HTTP 403; got: ${JSON.stringify(handshakeErrors)}`,
    ).toBe(true);
    expect(Number(closeCode), 'a pre-accept rejection surfaces to the browser as the generic 1006, never 4403').toBe(
      1006,
    );
  });
});

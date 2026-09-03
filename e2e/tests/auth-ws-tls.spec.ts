import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { installTestWallet } from '../fixtures/test-wallet';

const SESSION_COOKIE_NAME = 'kpb_session';

async function login(page: Page): Promise<void> {
  await page.goto('/');
  const signInButton = page.getByRole('button', { name: /sign in/i });
  await expect(signInButton).toBeVisible({ timeout: 15_000 });
  const verifyResponse = page.waitForResponse(
    (r) => r.url().includes('/auth/verify') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await signInButton.click();
  const resp = await verifyResponse;
  expect(resp.status()).toBe(200);
  await expect(signInButton).toBeHidden({ timeout: 5_000 });
}

async function watchWebSocketHandshakes(page: Page): Promise<{ cdp: CDPSession; statuses: number[] }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const statuses: number[] = [];
  cdp.on('Network.webSocketHandshakeResponseReceived', (e) => statuses.push(e.response.status));
  return { cdp, statuses };
}

test.describe('SIWE wallet login -> HTTPS -> secure cookie -> WSS -> 101 -> RPC', () => {
  test.beforeEach(async ({ page }) => {
    await installTestWallet(page);
  });

  test('HTTPS SIWE login sets a Secure cookie, then wss:// carries a 101 upgrade and a ping/pong RPC', async ({
    page,
  }) => {
    const { statuses } = await watchWebSocketHandshakes(page);

    await login(page);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(sessionCookie, 'session cookie must be set after /auth/verify').toBeTruthy();
    expect(sessionCookie!.secure, 'cookie must be Secure over HTTPS').toBe(true);
    expect(sessionCookie!.httpOnly).toBe(true);
    expect(sessionCookie!.sameSite).toBe('Lax');

    const wsUrl = await page.evaluate(() => `wss://${window.location.host}/ws`);
    expect(wsUrl.startsWith('wss://')).toBe(true);

    const rpcResult = await page.evaluate(
      (url) =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(url);
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
      wsUrl,
    );

    expect(rpcResult).toEqual({ type: 'rpc', id: '1', ok: true, result: { pong: true } });
    expect(statuses).toContain(101);
  });
});

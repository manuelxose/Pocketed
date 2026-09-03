import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Same env var scripts/dev.mjs already uses for the gateway's own listen
// port — reused here so the dev proxy below and the E2E harness
// (e2e/playwright.config.ts, which runs the gateway on a non-default port
// to avoid colliding with a developer's already-running `npm run dev`) stay
// pointed at the same process without duplicating the port number.
const GATEWAY_PORT = process.env.POCKETED_GATEWAY_PORT || '8000';
const GATEWAY_ORIGIN = `http://127.0.0.1:${GATEWAY_PORT}`;
const GATEWAY_WS_ORIGIN = `ws://127.0.0.1:${GATEWAY_PORT}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    // Dev-only: the webserver/ FastAPI gateway runs as a separate process
    // (uvicorn) on its own port during local development, so requests to
    // its API/WS routes must be proxied here — in production the same
    // FastAPI process serves this app's built dist/ as static files, so
    // everything is same-origin and no proxy is needed there.
    proxy: {
      '/auth': GATEWAY_ORIGIN,
      '/config': GATEWAY_ORIGIN,
      '/strategies': GATEWAY_ORIGIN,
      '/profiles': GATEWAY_ORIGIN,
      '/onboarding': GATEWAY_ORIGIN,
      '/session-key': GATEWAY_ORIGIN,
      '/aa': GATEWAY_ORIGIN,
      '/health': GATEWAY_ORIGIN,
      '/ready': GATEWAY_ORIGIN,
      '/ws': { target: GATEWAY_WS_ORIGIN, ws: true },
    },
  },
  clearScreen: false,
});

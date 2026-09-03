import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const GATEWAY_PORT = process.env.POCKETED_GATEWAY_PORT || '8000';

// Set by e2e/playwright.tls.config.ts and e2e/playwright.proxy.config.ts
// (via gen-certs.mjs's ensureCerts()) to run this dev server itself over
// HTTPS/WSS, matching how the production gateway is fronted by TLS.
const TLS_CERT_FILE = process.env.POCKETED_TLS_CERT_FILE;
const TLS_KEY_FILE = process.env.POCKETED_TLS_KEY_FILE;
const TLS_ENABLED = Boolean(TLS_CERT_FILE && TLS_KEY_FILE);

const GATEWAY_SCHEME = TLS_ENABLED ? 'https' : 'http';
const GATEWAY_WS_SCHEME = TLS_ENABLED ? 'wss' : 'ws';
const GATEWAY_ORIGIN = `${GATEWAY_SCHEME}://127.0.0.1:${GATEWAY_PORT}`;
const GATEWAY_WS_ORIGIN = `${GATEWAY_WS_SCHEME}://127.0.0.1:${GATEWAY_PORT}`;

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
    https: TLS_ENABLED
      ? { cert: readFileSync(TLS_CERT_FILE!), key: readFileSync(TLS_KEY_FILE!) }
      : undefined,
    // Dev-only: the webserver/ FastAPI gateway runs as a separate process
    // (uvicorn) on its own port during local development, so requests to
    // its API/WS routes must be proxied here — in production the same
    // FastAPI process serves this app's built dist/ as static files, so
    // everything is same-origin and no proxy is needed there.
    proxy: {
      // secure: false — these targets carry the same throwaway/self-signed
      // cert as this dev server itself when TLS_ENABLED; Vite's proxy
      // otherwise validates upstream certs against the system trust store.
      '/auth': { target: GATEWAY_ORIGIN, secure: false },
      '/config': { target: GATEWAY_ORIGIN, secure: false },
      '/strategies': { target: GATEWAY_ORIGIN, secure: false },
      '/profiles': { target: GATEWAY_ORIGIN, secure: false },
      '/onboarding': { target: GATEWAY_ORIGIN, secure: false },
      '/session-key': { target: GATEWAY_ORIGIN, secure: false },
      '/aa': { target: GATEWAY_ORIGIN, secure: false },
      '/health': { target: GATEWAY_ORIGIN, secure: false },
      '/ready': { target: GATEWAY_ORIGIN, secure: false },
      '/ws': { target: GATEWAY_WS_ORIGIN, ws: true, secure: false },
    },
  },
  clearScreen: false,
});

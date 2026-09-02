import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

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
      '/auth': 'http://127.0.0.1:8000',
      '/config': 'http://127.0.0.1:8000',
      '/strategies': 'http://127.0.0.1:8000',
      '/profiles': 'http://127.0.0.1:8000',
      '/onboarding': 'http://127.0.0.1:8000',
      '/session-key': 'http://127.0.0.1:8000',
      '/aa': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
  clearScreen: false,
});

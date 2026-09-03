# infra/reverse-proxy/README.md
# Local production-like reverse-proxy topology

Browser -> HTTPS/WSS nginx (TLS termination, `X-Forwarded-*`) -> FastAPI gateway (plain HTTP).

Proves: `X-Forwarded-Proto`/`Host` forwarding, SIWE domain validation, Secure
cookie, WS `Upgrade`/`Connection` headers, Origin validation, WSS, 101, RPC —
all through nginx, not the app talking TLS directly (see `../../e2e/playwright.tls.config.ts`
for that mode instead).

## Run standalone

```bash
node ../../e2e/certs/gen-certs.mjs   # generate the shared throwaway cert first
npm run build --prefix ../..          # produce dist/ for the gateway image
docker compose up --build --wait
```

Then open `https://localhost:8443` — your browser will warn about the
untrusted cert (it's a throwaway test CA, not installed in your OS trust
store); this is expected for manual use. The automated E2E project
(`../../e2e/playwright.proxy.config.ts`) instead has Chromium trust just this
run's leaf cert via its SPKI hash, so it sees no warning.

```bash
docker compose down -v
```

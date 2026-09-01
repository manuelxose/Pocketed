# aa-service

Node/TypeScript sidecar that owns the ERC-4337 smart-account logic for the
webapp: computing each wallet's Kernel (ZeroDev) smart-account address,
building UserOperations, and submitting them through the self-hosted bundler
(Alto, see `infra/bundler/`). See the repo root `README.md`'s "Webapp Fase 2a"
section for how this fits into the full local dev stack.

## Security: loopback-only, never expose this service

aa-service holds `PAYMASTER_PRIVATE_KEY` — the service's own operational
signing key — and has **no authentication of its own**. It must never be
reachable from outside the host it runs on. `src/index.ts` binds the HTTP
server to `127.0.0.1` explicitly for this reason; do not change that to bind
on all interfaces (`0.0.0.0`) or expose the port through a reverse proxy,
container port mapping, firewall rule, or tunnel. The only intended caller is
the gateway (`webserver/`), which is expected to run on the same host and
talk to aa-service over `127.0.0.1:<port>`.

## Required environment variables

`src/config.ts` calls `requireEnv()` for each of these — aa-service refuses
to start if any is missing:

| Variable | Purpose |
| --- | --- |
| `POLYGON_RPC_URL` | RPC endpoint used to read on-chain state (e.g. Amoy testnet: `https://rpc-amoy.polygon.technology`) |
| `BUNDLER_RPC_URL` | JSON-RPC endpoint of the self-hosted bundler (Alto), e.g. `http://localhost:4337` |
| `PAYMASTER_PRIVATE_KEY` | The service's own operational signing key — never a user's wallet key |
| `PAYMASTER_DAILY_GAS_CAP_WEI` | Daily gas-spend cap tracked by `src/paymaster.ts`'s `DailyGasCap` — pick a real cap for your environment, there is no default |

Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4001` | Port aa-service listens on (loopback only, see above) |
| `CHAIN_ID` | `137` | Expected chain id; must match what the bundler reports at startup or aa-service refuses to start |

## Status

Gas sponsorship (real paymaster signing) and real gas estimation are not yet
wired into UserOp submission — see the repo root `README.md`'s Fase 2a
section for the current status.

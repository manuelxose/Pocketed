# Production-readiness gaps: TLS E2E, malicious-Origin E2E, session revocation, nonce storage, reverse-proxy topology, CI layering

Status: approved for planning
Date: 2026-09-03
Builds on: `feat/siwe-ws-auth-hardening-e2e` (merged, `fd6e0d7`) — SIWE login, cookie-authenticated WS, HTTP E2E (`e2e/tests/auth-ws.spec.ts`), Origin checks (`webserver/main.py::_ws_origin_allowed`).

## Goals

Close six production-readiness gaps in the existing SIWE/WebSocket auth stack without redoing what already works:

1. HTTPS + WSS E2E coverage (current E2E is HTTP/ws only).
2. Browser-level malicious-Origin WebSocket E2E (real browser-generated Origin header, not forged).
3. Real server-side logout revocation (current JWT is stateless; a captured token outlives logout).
4. Production-ready nonce storage abstraction (current nonce store is an in-process dict).
5. Local production-like reverse-proxy topology (TLS termination, header forwarding, WS upgrade).
6. CI split into unit / backend-integration / frontend / e2e-http / e2e-tls / e2e-proxy layers.

## Non-goals

- Real external staging environment (out of scope; called out as a remaining blocker in the completion report).
- Multi-region / HA Redis topology — a single Redis instance is sufficient to prove the interface and the multi-instance-safety acceptance criterion.
- Changing SIWE verification logic, chain-id allowlisting, or the existing Origin-check logic itself (`_ws_origin_allowed` stays as-is; it's proven correct by the new browser-level test, not modified).
- Migrating existing per-user JSON config storage (`config_store.py`) to any new backend — out of scope, unrelated to auth.

## Decisions made during brainstorming

- **Session/nonce backend**: pluggable interface (`Protocol`/ABC), two implementations:
  - `SqliteStore` — default. File under `DATA_ROOT` (matches existing per-user JSON convention of file-based local persistence). Atomic via SQL transactions (`BEGIN IMMEDIATE`). Zero new infra; already proves same-host multi-process safety.
  - `RedisStore` — used when `POCKETED_SESSION_STORE=redis` / `POCKETED_NONCE_STORE=redis` and `POCKETED_REDIS_URL` is set. Redis is a **host-installed external dependency**, not docker-compose-managed in this repo. CI installs it via `apt-get install redis-server` (a real host install on the runner, not a `services:` container, not docker-compose) and runs it with `--daemonize yes` before the backend-integration job.
- **TLS certs**: openssl-generated throwaway CA + leaf cert (SAN `localhost`/`127.0.0.1`), regenerated per test run into a gitignored dir. Chromium is launched trusting that specific CA (`--ca-certificate=<path>` / Playwright's certificate-trust launch option) — never a blanket `--ignore-certificate-errors`. No mkcert dependency, no system trust-store mutation; deterministic and CI-reproducible.
- **Reverse proxy**: nginx (explicit `Upgrade`/`Connection` map for `/ws`, TLS termination with the generated cert, `X-Forwarded-Proto`/`Host` forwarding).
- **Reverse-proxy E2E depth**: full Playwright browser E2E driven through the dockerized nginx stack (own CI job), not just a curl/header check.

## Architecture

### 1. Session store (`webserver/session_store.py`)

```python
class SessionStore(Protocol):
    def create(self, wallets: list[str], active: str, *, ttl_seconds: int) -> tuple[str, str]:
        """Returns (sid, jti). Record starts active."""
    def is_active(self, sid: str) -> bool: ...
    def revoke(self, sid: str) -> None: ...
    def touch_active(self, sid: str, active: str) -> None:
        """Called by /auth/switch and /auth/verify (linking a wallet) — updates
        the store's record of the active wallet without minting a new sid."""
```

- `SqliteSessionStore(db_path)`: table `sessions(sid TEXT PRIMARY KEY, jti TEXT, wallets TEXT, active TEXT, expires_at REAL, revoked INTEGER DEFAULT 0)`. `is_active` checks `revoked = 0 AND expires_at > now`.
- `RedisSessionStore(client)`: key `session:{sid}` → JSON value with `EXPIRE ttl_seconds`; `revoke` does `DEL`; `is_active` is `EXISTS`.
- Selected once at import time in `webserver/main.py` via `POCKETED_SESSION_STORE` (`sqlite` default, `redis` opt-in), mirroring the existing `POCKETED_WORKER_SCRIPT`-style test-override pattern.

JWT payload gains `sid` (opaque session id) and `jti` (token id, for audit/logging — not itself checked, `sid` is the revocation key). `create_session_token` takes the store and creates the session record; `decode_session_token` stays pure (signature/expiry only) — the **caller** (`require_wallet_address`, the `/ws` handler, `/auth/session`) additionally checks `store.is_active(payload["sid"])` after decode. This keeps `auth.py`'s existing pure-function shape for the parts that don't need I/O, and makes the store dependency explicit at the two call sites that must enforce it.

`/auth/logout` becomes: decode the cookie's `sid` (best-effort — a missing/garbled cookie still succeeds, matching current behavior), `store.revoke(sid)`, then delete the cookie as today.

**Live WS revocation**: the WS handler's existing `pump_outbound` loop gains a sibling task that polls `store.is_active(sid)` every 2s; on `False` it closes the socket with a new code `4402` ("session revoked"), which `src/lib/ws-client.ts` will treat the same way as `4401` (trigger re-auth, not blind reconnect).

### 2. Nonce store (`webserver/nonce_store.py`)

```python
class NonceStore(Protocol):
    def issue(self) -> str: ...
    def consume(self, nonce: str) -> bool:
        """Atomic: true only if the nonce existed, wasn't expired, and wasn't
        already consumed. Second caller (same or different process) gets False."""
```

- `SqliteNonceStore`: table `nonces(nonce TEXT PRIMARY KEY, expires_at REAL)`. `consume` runs `DELETE FROM nonces WHERE nonce = ? AND expires_at > ? RETURNING nonce` inside `BEGIN IMMEDIATE` — the row lock makes a concurrent second `consume` from another process see zero rows deleted.
- `RedisNonceStore`: `SET nonce:{n} 1 EX ttl NX` on issue is wrong (issue must always succeed with a fresh nonce; NX would only matter for consume) — issue does `SET nonce:{n} "1" EX ttl`; consume does atomic `GETDEL` (Redis ≥6.2) and returns whether a value came back.
- `webserver/auth.py`'s module-level `_nonces` dict and `_prune_nonces`/`_consume_nonce` are removed; `generate_nonce()`/`verify_siwe()` take a `store: NonceStore` parameter (or a module-level store selected the same way as the session store — chosen for consistency: **module-level singleton selected via `POCKETED_NONCE_STORE` env**, matching the session store's selection pattern, since `webserver/main.py` already calls `auth.generate_nonce()`/`auth.verify_siwe()` with no store argument today and every call site is in-process gateway code, not something that benefits from DI in tests).

Existing tests that poke `auth._nonces` directly (if any) get updated to go through the store's public interface.

### 3. HTTPS + WSS E2E (`e2e/`)

- `e2e/certs/gen-certs.mjs`: Node script, shells out to `openssl req`/`openssl x509` to produce a throwaway CA (`ca.pem`/`ca.key`) and a leaf cert for `localhost`/`127.0.0.1` (SAN, correct `keyUsage`/`extendedKeyUsage`) signed by that CA, written to `e2e/certs/.gen/` (gitignored). Idempotent — skips regeneration if files exist and aren't expired, so local reruns are fast; CI always starts clean.
- `e2e/playwright.tls.config.ts`: new Playwright project. `webServer` array: (a) uvicorn with `--ssl-keyfile/--ssl-certfile` pointed at the generated leaf cert, on an HTTPS port; (b) Vite dev server configured with `server.https` using the same cert, proxying `/auth`, `/ws` etc. to the HTTPS gateway port (Vite's proxy supports `target: 'https://...'` with `secure: true` since it's the same generated CA). `use.baseURL` is `https://localhost:<tls-frontend-port>`; browser context/launch trusts the generated CA specifically.
- `e2e/tests/auth-ws-tls.spec.ts`: mirrors `auth-ws.spec.ts`'s primary flow (login → cookie → WS ping/pong → 101) plus explicit assertions: `sessionCookie.secure === true`, WS URL is `wss://`, CDP handshake status is 101 over the secure connection. Also covers SIWE domain/origin validation still passing through TLS (the existing domain-pinning logic in `_expected_siwe_domain` is exercised unchanged — this test proves it isn't accidentally bypassed under HTTPS).
- New root `package.json` script `test:e2e:tls` → `playwright test --config e2e/playwright.tls.config.ts`.
- Existing `test:e2e` (HTTP) is untouched and keeps running.

### 4. Malicious-Origin browser E2E

- `e2e/fixtures/malicious-origin-server.mjs`: a ~20-line Node http server serving one static HTML page (`new WebSocket('ws://localhost:5901/ws')`, reports the resulting close code back to the page via a DOM element Playwright can read) on port 5902.
- Added as a third entry in `e2e/playwright.config.ts`'s `webServer` array (HTTP mode) — and mirrored in the TLS config for the HTTPS/WSS variant (malicious server also TLS-fronted with the same generated cert, targets `wss://localhost:5901/ws`).
- `e2e/tests/malicious-origin.spec.ts`: `login()` against `http://localhost:5901` (real cookie, real origin) → `page.goto('http://localhost:5902')` → click a button that opens the WS from that page's own JS (so Chromium generates the real `Origin: http://localhost:5902` header — never set manually) → assert via CDP (`Network.webSocketHandshakeResponseReceived` / the socket's close event) that the handshake never reaches 101 and closes with `4403`.
- Existing pytest-level Origin tests (`test_main_ws.py::test_ws_rejects_missing_origin`, `test_ws_rejects_cross_site_origin`) are kept unchanged as defense-in-depth lower-level coverage — the spec explicitly says not to remove them.

### 5. Reverse-proxy topology (`infra/reverse-proxy/`)

- `infra/reverse-proxy/docker-compose.yml`: two services — `gateway` (builds/runs the existing Python webserver, plain HTTP, no cert needed at this layer) and `nginx` (terminates TLS with the `e2e/certs/.gen/` cert mounted read-only, proxies `/` to `gateway`, has an explicit `map $http_upgrade $connection_upgrade` block plus `proxy_set_header Upgrade`/`Connection` for `/ws`, and sets `X-Forwarded-Proto https`/`X-Forwarded-Host $host`).
- `infra/reverse-proxy/nginx.conf`: the explicit config described above.
- `infra/reverse-proxy/README.md`: what it proves, how to run it standalone (`docker compose up`), relationship to the TLS E2E mode (same generated cert, different topology).
- `e2e/playwright.proxy.config.ts`: new Playwright project. No `webServer` entries for uvicorn/Vite (docker-compose owns process lifecycle) — instead a `globalSetup`/`globalTeardown` pair that shells `docker compose up -d --wait` / `down` against `infra/reverse-proxy/docker-compose.yml`, using the same test-wallet + dummy-worker + `POCKETED_SESSION_SECRET` env the other configs use (passed through to the `gateway` service). `use.baseURL` = `https://localhost:<nginx-port>`.
- `e2e/tests/auth-ws-tls.spec.ts` is reused (not duplicated) as the test file for this project — it's topology-agnostic (it only cares that `baseURL` is `https://` and the WS is `wss://`), so the same assertions (secure cookie, 101, ping/pong) now additionally prove `X-Forwarded-Proto`/`Host` forwarding, SIWE domain validation, and Origin validation all work correctly through nginx.

### 6. CI layering (`.github/workflows/ci.yml`)

Split the current two jobs (`build`, `e2e`) into:

| job | contents |
|---|---|
| `unit` | TypeScript typecheck, `npm test` (vitest — frontend unit tests stay folded in here, matching today's `build` job), `python -m pytest` under `python/` |
| `backend-integration` | `apt-get install -y redis-server && redis-server --daemonize yes`; `pip install -r webserver/requirements.txt`; `pytest webserver/tests/ -q` (now includes session-store/nonce-store tests against both SQLite and Redis backends, selected via `POCKETED_SESSION_STORE`/`POCKETED_NONCE_STORE` env matrix) |
| `e2e-http` | existing `npm run test:e2e`, unchanged |
| `e2e-tls` | `npx playwright install --with-deps chromium`; generate certs; `npm run test:e2e:tls` |
| `e2e-proxy` | `docker compose -f infra/reverse-proxy/docker-compose.yml build`; `npx playwright test --config e2e/playwright.proxy.config.ts` |

All jobs run in parallel off `actions/checkout`; each uploads its own Playwright report artifact where relevant (mirroring the existing `e2e` job's upload step).

## Data flow (login → WS → logout, revocation-aware)

```
POST /auth/nonce        -> NonceStore.issue()
POST /auth/verify        (SIWE ok, NonceStore.consume() ok)
                         -> SessionStore.create(wallets, active, ttl) -> (sid, jti)
                         -> JWT{wallets, active, sid, jti, iat, exp} signed, set as httponly/secure/samesite=lax cookie
GET  /auth/session, /aa/*, /session-key/* (require_wallet_address)
                         -> jwt.decode (sig+exp) -> SessionStore.is_active(sid) must be True
WS   /ws connect         -> Origin check -> jwt.decode -> SessionStore.is_active(sid) must be True
                         -> background poll every 2s re-checks is_active(sid); False -> close(4402)
POST /auth/logout        -> SessionStore.revoke(sid) -> delete_cookie
  after logout: any request/connect with the captured JWT -> is_active(sid) is False -> 401 / close(4402)
```

## Error handling

- Store unavailable (Redis connection refused, SQLite file locked past a timeout): treated as **auth failure**, not silently-allow — a store you can't check is not a store you can trust. Logged at `error` level; surfaced as 503 on HTTP routes (distinct from the existing 401 "not authenticated" so operators can tell "no session" from "store is down") and WS close code `1011` (existing "internal error" code, already used elsewhere in `ws_endpoint`).
- Nonce/session SQLite files live under `DATA_ROOT` alongside existing per-user JSON — created with `mkdir(parents=True, exist_ok=True)` the same way `config_store.py` already does.
- `revoke()` and `is_active()` on an unknown `sid` are not errors — unknown/never-existed `sid` behaves identically to revoked (both return `False`/no-op), so a corrupted or forged `sid` fails closed the same way an expired one does.

## Testing

- `webserver/tests/test_session_store.py`, `test_nonce_store.py`: unit tests per backend (SQLite always; Redis skipped via `pytest.mark.skipif` when `POCKETED_REDIS_URL` unset — CI's backend-integration job sets it).
- `webserver/tests/test_auth.py`: extend for `sid`/`jti` in issued tokens, revoke-then-decode-still-structurally-valid-but-store-says-inactive.
- `webserver/tests/test_main_ws.py` / `test_main_session_key_routes.py` / new `test_main_aa_routes.py`-adjacent: extend `require_wallet_address`/WS auth tests for the revoked-session case (401 / 4402).
- New pytest for cross-instance nonce safety: two `NonceStore` instances (two `SqliteNonceStore(same_path)` objects, or two `RedisNonceStore` clients) racing `consume()` on the same nonce — exactly one succeeds. This is acceptance criterion F at the unit level; the E2E layer doesn't need to spin up two real gateway processes for this.
- `e2e/tests/auth-ws.spec.ts`: add a logout-revocation test — login, capture the `kpb_session` cookie value, POST `/auth/logout`, then manually re-add that captured cookie value and prove both a REST call (`/auth/session`) and a fresh `/ws` connect now fail; also prove an already-open WS gets closed (login, open WS, logout via the app UI, assert the open socket receives `close(4402)`).
- `e2e/tests/auth-ws-tls.spec.ts`, `malicious-origin.spec.ts` as described above.

## Acceptance criteria mapping

| # | criterion | proven by |
|---|---|---|
| A | wallet → SIWE → session → WS → 101 → RPC | existing `e2e/tests/auth-ws.spec.ts` (unchanged) |
| B | wallet → HTTPS SIWE → secure cookie → WSS → 101 → RPC | new `auth-ws-tls.spec.ts` under `playwright.tls.config.ts` |
| C | malicious origin → WS → Origin rejected | new `malicious-origin.spec.ts` |
| D | login → capture JWT → logout → reuse → rejected | new case in `auth-ws.spec.ts` + `test_auth.py` |
| E | login → WS open → logout/revoke → WS can't continue | same new E2E case (open-socket close assertion) |
| F | nonce on instance A can't be replayed via instance B | `test_nonce_store.py` cross-instance race test |

## Remaining blockers (to state explicitly in the completion report)

- No real external staging environment — everything above is locally verified or production-like verified (dockerized nginx + generated certs on localhost), never against a real DNS name, real CA-issued cert, or a real multi-host deployment.
- Redis is proven as a correct, working backend locally/in CI; true multi-**host** behavior (not just multi-process-on-one-host) is architecturally identical (same Redis client, same keys) but only actually exercised against a single Redis instance reachable from a single host in CI — a genuinely distributed deployment is not exercised here.

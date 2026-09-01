# Webapp Fase 2a: ERC-4337 Smart Account Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Kernel (ZeroDev) ERC-4337 smart-account infra for the webapp gateway — counterfactual account address computation, a self-hosted bundler, a self-hosted paymaster that sponsors gas, and a smoke-test UserOp round-trip — with no session-keys and no Polymarket trading integration yet (that's Fase 2b).

**Architecture:** Kernel/ERC-4337 tooling (`@zerodev/sdk`, `permissionless`, `viem`) is TypeScript-first with no mature Python equivalent. Reimplementing CREATE2/initcode/UserOp-hash math by hand in Python risks a subtle bug in the one place where a bug sends funds to the wrong address. So this plan adds a small **Node/TypeScript sidecar** (`aa-service/`) that wraps the official SDKs; `webserver/aa.py` (Python, FastAPI, from Fase 1's stack) is a thin HTTP client to it, and `webserver/main.py` exposes the browser-facing routes. This is a deliberate deviation from the spec's `infra/paymaster/` as a separate service — paymaster sponsorship logic lives inside `aa-service` (same "self-hosted, ours" requirement, one fewer process to run/deploy). The self-hosted bundler (`infra/bundler/`, Alto) stays a separate process per the spec, since it's an off-the-shelf binary, not code we own.

**Tech Stack:** Node.js 20+, TypeScript, Express, `@zerodev/sdk`, `@zerodev/ecdsa-validator`, `permissionless`, `viem`, Vitest + Supertest (aa-service). Python 3.11+, FastAPI, httpx, `respx` (mocking httpx in tests) — added to `webserver/`'s existing Fase 1 stack. Alto (Pimlico's open-source bundler) via Docker. Polygon Amoy testnet for integration testing (Polymarket's CLOB has no testnet, but the account/bundler/paymaster infra this phase builds has nothing to do with the CLOB yet, so Amoy is legitimate here).

**Spec:** [docs/superpowers/specs/2026-09-01-webapp-fase2a-aa-smart-account-infra-design.md](../specs/2026-09-01-webapp-fase2a-aa-smart-account-infra-design.md)

## Global Constraints

- No repo commits use `--no-verify` or skip hooks.
- No session-keys in this phase — every UserOp built here is signed by the owner EOA live. Session-key delegation is Fase 2b, out of scope.
- No Polymarket integration in this phase — the smoke-test UserOp is a trivial self-call (see Task 6), never an order.
- `aa-service` never receives or stores a user's private key — it only ever receives an already-signed UserOp (signature computed in the browser) or returns unsigned data to be signed.
- Chain is Polygon mainnet (`chainId=137`) for the real deploy target, per the spec; automated tests run against Polygon Amoy testnet (`chainId=80002`) — never against mainnet in CI.
- Every task that calls into `@zerodev/sdk`/`permissionless` must first confirm the function names/signatures it uses against the actually-installed package version (see Task 1, Step 1) — these SDKs move fast; do not trust a remembered API surface over what's on disk.

---

### Task 1: `aa-service` scaffolding, health check, and SDK surface verification

**Files:**
- Create: `aa-service/package.json`
- Create: `aa-service/tsconfig.json`
- Create: `aa-service/src/config.ts`
- Create: `aa-service/src/app.ts`
- Create: `aa-service/src/index.ts`
- Create: `aa-service/test/health.test.ts`
- Create: `.gitignore` additions (`aa-service/node_modules/`, `aa-service/dist/`)

**Interfaces:**
- Produces: `createApp(): express.Express` (exported from `app.ts`, used by every later task's Supertest tests and by `index.ts` to actually listen).

- [ ] **Step 1: Install dependencies and record the real SDK exports**

```bash
cd "C:\Users\Admin\Documents\workspace\Krypt-Polybot-main"
mkdir aa-service
cd aa-service
npm init -y
npm install express viem @zerodev/sdk @zerodev/ecdsa-validator permissionless
npm install -D typescript tsx vitest supertest @types/express @types/supertest @types/node
```

Then dump what the two account-abstraction packages actually export, and read the result before writing any code in Tasks 2, 5, 6, or 7 that calls into them:

```bash
node -e "console.log(Object.keys(require('@zerodev/sdk')))"
node -e "console.log(Object.keys(require('permissionless')))"
```

If a function name used later in this plan (`createKernelAccount`, `signerToEcdsaValidator`, `getEntryPoint`, `createSmartAccountClient`, `createPimlicoClient`-equivalents) doesn't match what these commands print, adapt the call site to the installed API — the test names and the `Interfaces` contracts in each task stay the same regardless of which exact SDK function produces them.

- [ ] **Step 2: `package.json` scripts**

Edit `aa-service/package.json`, add:
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc -p .",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: `tsconfig.json`**

`aa-service/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Config module**

`aa-service/src/config.ts`:
```typescript
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set — refusing to start aa-service without it`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4001),
  polygonRpcUrl: requireEnv("POLYGON_RPC_URL"),
  bundlerRpcUrl: requireEnv("BUNDLER_RPC_URL"),
  chainId: Number(process.env.CHAIN_ID ?? 137),
  paymasterPrivateKey: requireEnv("PAYMASTER_PRIVATE_KEY"),
  paymasterDailyGasCapWei: BigInt(process.env.PAYMASTER_DAILY_GAS_CAP_WEI ?? "0"),
};
```

- [ ] **Step 5: Write the failing health-check test**

`aa-service/test/health.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

process.env.POLYGON_RPC_URL ??= "http://localhost:0";
process.env.BUNDLER_RPC_URL ??= "http://localhost:0";
process.env.PAYMASTER_PRIVATE_KEY ??= "0x" + "11".repeat(32);
process.env.PAYMASTER_DAILY_GAS_CAP_WEI ??= "1000000000000000000";

let app: import("express").Express;

beforeAll(async () => {
  ({ createApp } = await import("../src/app.js"));
  app = createApp();
});

let createApp: typeof import("../src/app.js").createApp;

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd aa-service && npm test`
Expected: FAIL — `Cannot find module '../src/app.js'` (or similar).

- [ ] **Step 7: Implement `app.ts` and `index.ts`**

`aa-service/src/app.ts`:
```typescript
import express from "express";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
```

`aa-service/src/index.ts`:
```typescript
import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();
app.listen(config.port, () => {
  console.log(`aa-service listening on :${config.port}`);
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd aa-service && npm test`
Expected: PASS.

- [ ] **Step 9: `.gitignore` and commit**

```bash
cd "C:\Users\Admin\Documents\workspace\Krypt-Polybot-main"
grep -q "^aa-service/node_modules" .gitignore || printf '\naa-service/node_modules/\naa-service/dist/\n' >> .gitignore
git add aa-service .gitignore
git commit -m "chore(aa-service): scaffold Node/TS sidecar for ERC-4337 infra"
```

---

### Task 2: Counterfactual Kernel account address

**Files:**
- Create: `aa-service/src/kernelAccount.ts`
- Modify: `aa-service/src/app.ts`
- Test: `aa-service/test/kernelAccount.test.ts`

**Interfaces:**
- Consumes: `config` (Task 1).
- Produces: `computeAccountAddress(ownerAddress: \`0x${string}\`): Promise<\`0x${string}\`>` (used by Task 3's Python client and, later, Task 5's UserOp builder).
- Route: `GET /account/:owner` → `{ address: string }`.

- [ ] **Step 1: Write the failing tests**

`aa-service/test/kernelAccount.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { isAddress } from "viem";

process.env.POLYGON_RPC_URL ??= "https://rpc-amoy.polygon.technology";
process.env.BUNDLER_RPC_URL ??= "http://localhost:0";
process.env.PAYMASTER_PRIVATE_KEY ??= "0x" + "11".repeat(32);
process.env.PAYMASTER_DAILY_GAS_CAP_WEI ??= "1000000000000000000";
process.env.CHAIN_ID ??= "80002";

const { computeAccountAddress } = await import("../src/kernelAccount.js");

const OWNER_A = "0x1111111111111111111111111111111111111111" as const;
const OWNER_B = "0x2222222222222222222222222222222222222222" as const;

describe("computeAccountAddress", () => {
  it("returns a valid address", async () => {
    const addr = await computeAccountAddress(OWNER_A);
    expect(isAddress(addr)).toBe(true);
  });

  it("is deterministic for the same owner", async () => {
    const a = await computeAccountAddress(OWNER_A);
    const b = await computeAccountAddress(OWNER_A);
    expect(a).toBe(b);
  });

  it("differs for different owners", async () => {
    const a = await computeAccountAddress(OWNER_A);
    const b = await computeAccountAddress(OWNER_B);
    expect(a).not.toBe(b);
  });
});
```

Note: this deliberately asserts determinism and uniqueness (properties we can verify) rather than a hardcoded expected address (a value we cannot know is correct without a live SDK run against real bytecode) — see Task 1 Step 1's verification gate.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd aa-service && npm test`
Expected: FAIL — `Cannot find module '../src/kernelAccount.js'`.

- [ ] **Step 3: Implement `kernelAccount.ts`**

```typescript
import { createPublicClient, http, type Address } from "viem";
import { polygonAmoy, polygon } from "viem/chains";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { createKernelAccount } from "@zerodev/sdk";
import { config } from "./config.js";

// A throwaway local account is enough to derive the *address*: Kernel's
// counterfactual address is a function of the owner's public address and
// the validator/factory bytecode, not of anything secret. We never sign
// with this — computeAccountAddress only reads config.address off the
// resulting account object.
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const chain = config.chainId === 137 ? polygon : polygonAmoy;

const publicClient = createPublicClient({
  chain,
  transport: http(config.polygonRpcUrl),
});

export async function computeAccountAddress(owner: Address): Promise<Address> {
  // signerToEcdsaValidator needs a signer capable of .signMessage/.signTypedData
  // for its own internal setup, but computing the *address* never calls those —
  // it only reads deterministic factory/initcode data keyed by `owner`.
  const placeholderSigner: PrivateKeyAccount = privateKeyToAccount(
    ("0x" + "22".repeat(32)) as `0x${string}`
  );

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: placeholderSigner,
  });

  const account = await createKernelAccount(publicClient, {
    plugins: { sudo: ecdsaValidator },
    // The owner who will actually control this account on-chain is `owner`,
    // not the placeholder signer above — verify against the installed SDK
    // (Task 1 Step 1) whether this is passed here as `eip7702Auth`/an
    // explicit `owner` field or derived from the validator's signer, and
    // adjust so the resulting account address is keyed by `owner`.
  });

  return account.address;
}
```

- [ ] **Step 4: Wire the route**

Edit `aa-service/src/app.ts`, add above `return app;`:
```typescript
  app.get("/account/:owner", async (req, res) => {
    const owner = req.params.owner as `0x${string}`;
    try {
      const { computeAccountAddress } = await import("./kernelAccount.js");
      const address = await computeAccountAddress(owner);
      res.json({ address });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd aa-service && npm test`
Expected: all `kernelAccount.test.ts` tests PASS. If the SDK call in Step 3 needs adjusting per Task 1 Step 1's export dump, fix it here until the determinism/uniqueness assertions hold.

- [ ] **Step 6: Commit**

```bash
git add aa-service/src/kernelAccount.ts aa-service/src/app.ts aa-service/test/kernelAccount.test.ts
git commit -m "feat(aa-service): counterfactual Kernel account address"
```

---

### Task 3: `webserver/aa.py` client + `GET /aa/account` route

**Files:**
- Create: `webserver/aa.py`
- Modify: `webserver/main.py`
- Modify: `webserver/requirements.txt`
- Test: `webserver/tests/test_aa.py`
- Test: `webserver/tests/test_main_aa_routes.py`

**Interfaces:**
- Consumes: `aa-service`'s `GET /account/:owner` (Task 2).
- Produces: `async def compute_account_address(owner: str) -> str` (raises `AAServiceError` on failure) — used by Task 5/6/7's routes and, in Fase 2b, by the order-relay path.
- Produces: `AA_SERVICE_URL: str` (module-level, read from `KRYPT_POLYBOT_AA_SERVICE_URL` env var, same "refuse to start without it" pattern as Fase 1's `SESSION_SECRET`).

- [ ] **Step 1: Add `respx` to test deps**

Edit `webserver/requirements.txt`, add:
```
respx>=0.21.0
```

Run: `cd webserver && .venv/Scripts/pip install -r requirements.txt`

- [ ] **Step 2: Write the failing tests**

`webserver/tests/test_aa.py`:
```python
import httpx
import pytest
import respx

from webserver import aa


@respx.mock
async def test_compute_account_address_returns_address():
    respx.get("http://aa-service.test/account/0xABC").mock(
        return_value=httpx.Response(200, json={"address": "0xDEF"})
    )

    address = await aa.compute_account_address("0xABC", base_url="http://aa-service.test")

    assert address == "0xDEF"


@respx.mock
async def test_compute_account_address_raises_on_error():
    respx.get("http://aa-service.test/account/0xBAD").mock(
        return_value=httpx.Response(400, json={"error": "invalid owner"})
    )

    with pytest.raises(aa.AAServiceError, match="invalid owner"):
        await aa.compute_account_address("0xBAD", base_url="http://aa-service.test")
```

`webserver/tests/test_main_aa_routes.py`:
```python
from pathlib import Path

import httpx
import pytest
import respx

import webserver.main as main_module
from webserver.supervisor import Supervisor

FIXTURE_SCRIPT = Path(__file__).parent / "fixtures" / "dummy_worker.py"


@pytest.fixture(autouse=True)
def _test_session_secret(monkeypatch):
    monkeypatch.setattr(main_module, "SESSION_SECRET", "test-secret")


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    test_supervisor = Supervisor(tmp_path, script_path=FIXTURE_SCRIPT)
    monkeypatch.setattr(main_module, "supervisor", test_supervisor)
    with TestClient(main_module.app) as c:
        yield c


def _login(client) -> str:
    from datetime import datetime, timezone
    from eth_account import Account
    from eth_account.messages import encode_defunct
    from siwe import SiweMessage

    account = Account.create()
    nonce = client.post("/auth/nonce").json()["nonce"]
    msg = SiweMessage(
        domain="testserver", address=account.address, statement="Sign in to Krypt PolyBot",
        uri="http://testserver/auth", version="1", chain_id=137, nonce=nonce,
        issued_at=datetime.now(timezone.utc).isoformat(),
    )
    prepared = msg.prepare_message()
    signed = Account.sign_message(encode_defunct(text=prepared), private_key=account.key)
    resp = client.post("/auth/verify", json={"message": prepared, "signature": signed.signature.hex()})
    assert resp.status_code == 200
    return resp.json()["walletAddress"]


@respx.mock
def test_aa_account_route_requires_session(client):
    resp = client.get("/aa/account")
    assert resp.status_code == 401


@respx.mock
def test_aa_account_route_returns_address(client):
    wallet_address = _login(client)
    respx.get(f"{main_module.AA_SERVICE_URL}/account/{wallet_address}").mock(
        return_value=httpx.Response(200, json={"address": "0xDEADBEEF"})
    )

    resp = client.get("/aa/account")

    assert resp.status_code == 200
    assert resp.json() == {"address": "0xDEADBEEF"}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd webserver && KRYPT_POLYBOT_SESSION_SECRET=test .venv/Scripts/python -m pytest tests/test_aa.py tests/test_main_aa_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webserver.aa'` and `AttributeError: module 'webserver.main' has no attribute 'AA_SERVICE_URL'`.

- [ ] **Step 4: Implement `webserver/aa.py`**

```python
from __future__ import annotations

import os

import httpx

AA_SERVICE_URL_ENV = "KRYPT_POLYBOT_AA_SERVICE_URL"


class AAServiceError(Exception):
    """Raised when aa-service returns an error or is unreachable."""


def _resolve_base_url(base_url: str | None) -> str:
    if base_url:
        return base_url
    url = os.environ.get(AA_SERVICE_URL_ENV)
    if not url:
        raise AAServiceError(
            f"{AA_SERVICE_URL_ENV} must be set — refusing to call aa-service without it"
        )
    return url


async def compute_account_address(owner: str, *, base_url: str | None = None) -> str:
    url = _resolve_base_url(base_url)
    async with httpx.AsyncClient(base_url=url, timeout=10.0) as client:
        try:
            resp = await client.get(f"/account/{owner}")
        except httpx.HTTPError as e:
            raise AAServiceError(f"aa-service unreachable: {e}") from e
    if resp.status_code != 200:
        detail = resp.json().get("error", resp.text) if resp.content else resp.text
        raise AAServiceError(f"aa-service error ({resp.status_code}): {detail}")
    return resp.json()["address"]
```

- [ ] **Step 5: Wire `AA_SERVICE_URL` and the route in `webserver/main.py`**

Add near the top of `webserver/main.py`, after `DATA_ROOT`:
```python
from webserver import aa

AA_SERVICE_URL = os.environ.get(aa.AA_SERVICE_URL_ENV)
if not AA_SERVICE_URL:
    raise RuntimeError(
        f"{aa.AA_SERVICE_URL_ENV} must be set — refusing to start without the "
        "ERC-4337 sidecar configured"
    )
```

Add a shared session-auth dependency (reused by every `/aa/*` and, in later tasks, `/wallet/*` route) and the route itself:
```python
from fastapi import Depends


async def require_wallet_address(kpb_session: str | None = Cookie(default=None)) -> str:
    try:
        return auth.decode_session_token(kpb_session or "", secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e


@app.get("/aa/account")
async def get_aa_account(wallet_address: str = Depends(require_wallet_address)) -> JSONResponse:
    try:
        address = await aa.compute_account_address(wallet_address, base_url=AA_SERVICE_URL)
    except aa.AAServiceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return JSONResponse({"address": address})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd webserver && KRYPT_POLYBOT_SESSION_SECRET=test KRYPT_POLYBOT_AA_SERVICE_URL=http://aa-service.test .venv/Scripts/python -m pytest tests/test_aa.py tests/test_main_aa_routes.py -v`
Expected: all PASS.

- [ ] **Step 7: Run the full webserver suite (nothing from Fase 1 broke)**

Run: `cd webserver && KRYPT_POLYBOT_SESSION_SECRET=test KRYPT_POLYBOT_AA_SERVICE_URL=http://aa-service.test .venv/Scripts/python -m pytest -v`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add webserver/aa.py webserver/main.py webserver/requirements.txt webserver/tests/test_aa.py webserver/tests/test_main_aa_routes.py
git commit -m "feat(webserver): aa.py client + GET /aa/account route"
```

---

### Task 4: Self-hosted bundler (Alto) infra + connectivity check

**Files:**
- Create: `infra/bundler/docker-compose.yml`
- Create: `infra/bundler/.env.example`
- Create: `infra/bundler/README.md`
- Create: `aa-service/src/bundlerHealth.ts`
- Test: `aa-service/test/bundlerHealth.test.ts`

**Interfaces:**
- Produces: `async function checkBundlerHealth(rpcUrl: string): Promise<{ chainId: number }>` — used by Task 4's own smoke-test and reused as a startup check in Task 1's `index.ts` (wired in Step 6 below).

- [ ] **Step 1: `docker-compose.yml` for Alto**

`infra/bundler/docker-compose.yml`:
```yaml
services:
  alto:
    image: pimlico/alto:latest
    restart: unless-stopped
    ports:
      - "4337:4337"
    environment:
      - RPC_URL=${POLYGON_RPC_URL}
      - ENTRYPOINTS=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
      - EXECUTOR_PRIVATE_KEYS=${BUNDLER_EXECUTOR_PRIVATE_KEY}
      - UTILITY_PRIVATE_KEY=${BUNDLER_UTILITY_PRIVATE_KEY}
    command: ["--port", "4337"]
```

`infra/bundler/.env.example`:
```
POLYGON_RPC_URL=https://rpc-amoy.polygon.technology
BUNDLER_EXECUTOR_PRIVATE_KEY=0x...
BUNDLER_UTILITY_PRIVATE_KEY=0x...
```

`infra/bundler/README.md`:
```markdown
# Self-hosted bundler (Alto)

Runs Pimlico's open-source ERC-4337 bundler against Polygon (mainnet or
Amoy testnet, depending on `POLYGON_RPC_URL`).

## Run it

    cd infra/bundler
    cp .env.example .env   # fill in real values — see below
    docker compose up -d

`BUNDLER_EXECUTOR_PRIVATE_KEY` and `BUNDLER_UTILITY_PRIVATE_KEY` are
operational keys the bundler uses to actually submit UserOps as
transactions and to manage its own stake — they hold gas funds, not user
funds, and are separate from the paymaster's key (`aa-service`'s
`PAYMASTER_PRIVATE_KEY`). Fund them with a small amount of MATIC on
whichever network `POLYGON_RPC_URL` points at.

Verify the docker-compose image tag/flags against Alto's own README before
a real deploy — `pimlico/alto:latest` and the flags above are a starting
point, not guaranteed current as of whenever this is run.

## Verify it's up

    curl -s -X POST http://localhost:4337 \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

Expected: a JSON-RPC response with a `result` hex chain id matching
`POLYGON_RPC_URL`'s network (`0x13882` for Amoy testnet, `0x89` for
Polygon mainnet).
```

- [ ] **Step 2: Write the failing test**

`aa-service/test/bundlerHealth.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { checkBundlerHealth } from "../src/bundlerHealth.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkBundlerHealth", () => {
  it("returns the chain id the bundler reports", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x13882" }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const result = await checkBundlerHealth("http://localhost:4337");

    expect(result.chainId).toBe(0x13882);
  });

  it("throws when the bundler is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );

    await expect(checkBundlerHealth("http://localhost:4337")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd aa-service && npm test`
Expected: FAIL — `Cannot find module '../src/bundlerHealth.js'`.

- [ ] **Step 4: Implement `bundlerHealth.ts`**

```typescript
export async function checkBundlerHealth(rpcUrl: string): Promise<{ chainId: number }> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  if (!res.ok) {
    throw new Error(`bundler health check failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (body.error) {
    throw new Error(`bundler health check failed: ${body.error.message}`);
  }
  if (!body.result) {
    throw new Error("bundler health check failed: no result in response");
  }
  return { chainId: Number.parseInt(body.result, 16) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd aa-service && npm test`
Expected: all PASS.

- [ ] **Step 6: Wire a startup check into `index.ts`**

Edit `aa-service/src/index.ts`:
```typescript
import { createApp } from "./app.js";
import { config } from "./config.js";
import { checkBundlerHealth } from "./bundlerHealth.js";

const app = createApp();

checkBundlerHealth(config.bundlerRpcUrl)
  .then(({ chainId }) => {
    if (chainId !== config.chainId) {
      console.warn(
        `bundler reports chainId=${chainId}, aa-service configured for ${config.chainId}`
      );
    }
    app.listen(config.port, () => {
      console.log(`aa-service listening on :${config.port}`);
    });
  })
  .catch((e) => {
    console.error("bundler unreachable at startup:", e);
    process.exit(1);
  });
```

- [ ] **Step 7: Commit**

```bash
git add infra/bundler aa-service/src/bundlerHealth.ts aa-service/src/index.ts aa-service/test/bundlerHealth.test.ts
git commit -m "feat: self-hosted Alto bundler infra + aa-service health check"
```

---

### Task 5: Paymaster sponsorship — funded key + daily gas cap

**Files:**
- Create: `aa-service/src/paymaster.ts`
- Test: `aa-service/test/paymaster.test.ts`

**Interfaces:**
- Consumes: `config.paymasterPrivateKey`, `config.paymasterDailyGasCapWei` (Task 1).
- Produces: `class DailyGasCap` with `tryReserve(sender: string, estimatedGasWei: bigint): boolean` and `release(sender: string, actualGasWei: bigint): void` — used by Task 6's UserOp builder.
- Produces: `function paymasterSigner(): import("viem/accounts").PrivateKeyAccount` — the funded key `aa-service` uses to sign sponsorship; used by Task 6.

- [ ] **Step 1: Write the failing tests**

`aa-service/test/paymaster.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { DailyGasCap } from "../src/paymaster.js";

describe("DailyGasCap", () => {
  let cap: DailyGasCap;

  beforeEach(() => {
    cap = new DailyGasCap(1000n);
  });

  it("allows spend under the cap", () => {
    expect(cap.tryReserve("0xUser1", 400n)).toBe(true);
  });

  it("rejects spend that would exceed the cap", () => {
    cap.tryReserve("0xUser1", 700n);
    expect(cap.tryReserve("0xUser2", 400n)).toBe(false);
  });

  it("release lowers reserved-but-unused gas back into the pool", () => {
    cap.tryReserve("0xUser1", 700n);
    cap.release("0xUser1", 200n); // only 200 actually spent, not the reserved 700
    expect(cap.tryReserve("0xUser2", 750n)).toBe(true);
  });

  it("tracks spend per calendar day, independent of sender", () => {
    cap.tryReserve("0xUser1", 600n);
    expect(cap.tryReserve("0xUser1", 500n)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd aa-service && npm test`
Expected: FAIL — `Cannot find module '../src/paymaster.js'`.

- [ ] **Step 3: Implement `paymaster.ts`**

`spentWei` tracks cumulative gas reserved for the day; `release` is called
with the amount to give back (not the amount actually spent) — Task 6
computes that delta (reserved estimate minus actual) before calling it.
Per-sender/per-reservation bookkeeping is intentionally out of scope for
this MVP (aggregate day-cap only) — Fase 2b's session-key spend caps are
where per-delegation tracking gets built properly.

```typescript
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { config } from "./config.js";

export class DailyGasCap {
  private capWei: bigint;
  private spentWei = 0n;
  private day: string;

  constructor(capWei: bigint) {
    this.capWei = capWei;
    this.day = new Date().toISOString().slice(0, 10);
  }

  private rollIfNewDay(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.spentWei = 0n;
    }
  }

  tryReserve(_sender: string, estimatedGasWei: bigint): boolean {
    this.rollIfNewDay();
    if (this.spentWei + estimatedGasWei > this.capWei) {
      return false;
    }
    this.spentWei += estimatedGasWei;
    return true;
  }

  release(_sender: string, giveBackWei: bigint): void {
    this.rollIfNewDay();
    this.spentWei -= giveBackWei > this.spentWei ? this.spentWei : giveBackWei;
  }
}

let cachedCap: DailyGasCap | undefined;

export function dailyGasCap(): DailyGasCap {
  if (!cachedCap) {
    cachedCap = new DailyGasCap(config.paymasterDailyGasCapWei);
  }
  return cachedCap;
}

let cachedSigner: PrivateKeyAccount | undefined;

export function paymasterSigner(): PrivateKeyAccount {
  if (!cachedSigner) {
    cachedSigner = privateKeyToAccount(config.paymasterPrivateKey as `0x${string}`);
  }
  return cachedSigner;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd aa-service && npm test`
Expected: all PASS. If the `release` semantics above don't match the test's exact expectation, adjust the implementation (not the test) until `tryReserve`/`release` behave as the test names describe — the test is the spec here.

- [ ] **Step 5: Commit**

```bash
git add aa-service/src/paymaster.ts aa-service/test/paymaster.test.ts
git commit -m "feat(aa-service): paymaster signer + daily gas cap tracker"
```

---

### Task 6: Build sponsored UserOp endpoint

**Files:**
- Create: `aa-service/src/userOp.ts`
- Modify: `aa-service/src/app.ts`
- Test: `aa-service/test/userOp.test.ts`

**Interfaces:**
- Consumes: `computeAccountAddress` (Task 2), `dailyGasCap`/`paymasterSigner` (Task 5).
- Produces: `async function buildUserOp(owner: Address, calls: {to: Address, value: bigint, data: \`0x${string}\`}[]): Promise<{ userOp: object, userOpHash: \`0x${string}\` }>` — used by Task 7's submit endpoint and by Task 3-equivalent Python wiring in Task 8.
- Route: `POST /userop/build` `{ owner, calls }` → `{ userOp, userOpHash }` (400 if the daily gas cap rejects it).

- [ ] **Step 1: Write the failing test**

`aa-service/test/userOp.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { isHex } from "viem";

process.env.POLYGON_RPC_URL ??= "https://rpc-amoy.polygon.technology";
process.env.BUNDLER_RPC_URL ??= "http://localhost:0";
process.env.PAYMASTER_PRIVATE_KEY ??= "0x" + "11".repeat(32);
process.env.PAYMASTER_DAILY_GAS_CAP_WEI ??= "1000000000000000000";
process.env.CHAIN_ID ??= "80002";

const { buildUserOp } = await import("../src/userOp.js");

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const SELF_CALL = [{ to: OWNER, value: 0n, data: "0x" as const }];

describe("buildUserOp", () => {
  it("returns a UserOp and a hash to sign", async () => {
    const { userOp, userOpHash } = await buildUserOp(OWNER, SELF_CALL);

    expect(userOp).toBeTruthy();
    expect(isHex(userOpHash)).toBe(true);
  });

  it("rejects when the daily gas cap has no room", async () => {
    const { dailyGasCap } = await import("../src/paymaster.js");
    const cap = dailyGasCap();
    // Exhaust the cap directly rather than looping real UserOps — this
    // test only checks buildUserOp's error path, not gas estimation.
    cap.tryReserve(OWNER, 10n ** 18n);

    await expect(buildUserOp(OWNER, SELF_CALL)).rejects.toThrow(/gas cap/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aa-service && npm test`
Expected: FAIL — `Cannot find module '../src/userOp.js'`.

- [ ] **Step 3: Implement `userOp.ts`**

```typescript
import { createPublicClient, http, type Address } from "viem";
import { polygonAmoy, polygon } from "viem/chains";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { createKernelAccount } from "@zerodev/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { dailyGasCap, paymasterSigner } from "./paymaster.js";

const chain = config.chainId === 137 ? polygon : polygonAmoy;

const publicClient = createPublicClient({ chain, transport: http(config.polygonRpcUrl) });

interface Call {
  to: Address;
  value: bigint;
  data: `0x${string}`;
}

export async function buildUserOp(owner: Address, calls: Call[]) {
  // Same placeholder-signer-for-address-derivation approach as
  // kernelAccount.ts (Task 2) — verify against the installed SDK
  // (Task 1 Step 1) that `owner` is what actually ends up controlling
  // the resulting account, not the placeholder.
  const placeholderSigner = privateKeyToAccount(("0x" + "22".repeat(32)) as `0x${string}`);
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, { signer: placeholderSigner });
  const account = await createKernelAccount(publicClient, { plugins: { sudo: ecdsaValidator } });

  // Rough gas estimate for the cap check — refined against the bundler's
  // own eth_estimateUserOperationGas once Task 7 wires real submission;
  // this MVP reserves a fixed ceiling per call so the cap logic (Task 5)
  // has something real to check against before a signature exists.
  const ESTIMATED_GAS_PER_CALL_WEI = 200_000n * 30_000_000_000n; // 200k gas * 30 gwei
  const estimate = ESTIMATED_GAS_PER_CALL_WEI * BigInt(calls.length);

  if (!dailyGasCap().tryReserve(owner, estimate)) {
    throw new Error("aa-service daily gas cap exceeded — try again after the next UTC day rolls over");
  }

  const userOp = await account.encodeCalls(calls);
  const userOpHash = await account.getUserOpHash({
    callData: userOp,
    // paymaster fields attached here from paymasterSigner() — exact field
    // names (paymaster / paymasterData vs legacy paymasterAndData) depend
    // on the EntryPoint version the installed SDK targets; confirm against
    // Task 1 Step 1's export dump before finalizing this call.
  });

  void paymasterSigner(); // signs the paymaster fields above once wired per the note

  return { userOp, userOpHash };
}
```

- [ ] **Step 4: Wire the route**

Edit `aa-service/src/app.ts`:
```typescript
  app.post("/userop/build", async (req, res) => {
    const { owner, calls } = req.body as {
      owner: `0x${string}`;
      calls: { to: `0x${string}`; value: string; data: `0x${string}` }[];
    };
    try {
      const { buildUserOp } = await import("./userOp.js");
      const parsedCalls = calls.map((c) => ({ ...c, value: BigInt(c.value) }));
      const { userOp, userOpHash } = await buildUserOp(owner, parsedCalls);
      res.json({ userOp, userOpHash });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = /gas cap/i.test(message) ? 402 : 400;
      res.status(status).json({ error: message });
    }
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd aa-service && npm test`
Expected: PASS. Adjust the `getUserOpHash`/paymaster-field call in Step 3 per Task 1 Step 1's real export names until it does.

- [ ] **Step 6: Commit**

```bash
git add aa-service/src/userOp.ts aa-service/src/app.ts aa-service/test/userOp.test.ts
git commit -m "feat(aa-service): build sponsored UserOp endpoint"
```

---

### Task 7: Submit UserOp to the bundler + status polling

**Files:**
- Create: `aa-service/src/bundlerClient.ts`
- Modify: `aa-service/src/app.ts`
- Test: `aa-service/test/bundlerClient.test.ts`

**Interfaces:**
- Consumes: `config.bundlerRpcUrl` (Task 1).
- Produces: `async function submitUserOp(signedUserOp: object): Promise<{ userOpHash: string }>`, `async function getUserOpStatus(userOpHash: string): Promise<{ status: "pending" | "included" | "failed", receipt?: object }>` — used by Task 8's Python wiring.
- Routes: `POST /userop/submit` `{ userOp }` → `{ userOpHash }`; `GET /userop/:hash/status` → `{ status, receipt? }`.

- [ ] **Step 1: Write the failing tests**

`aa-service/test/bundlerClient.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

process.env.POLYGON_RPC_URL ??= "https://rpc-amoy.polygon.technology";
process.env.BUNDLER_RPC_URL ??= "http://localhost:4337";
process.env.PAYMASTER_PRIVATE_KEY ??= "0x" + "11".repeat(32);
process.env.PAYMASTER_DAILY_GAS_CAP_WEI ??= "1000000000000000000";
process.env.CHAIN_ID ??= "80002";

const { submitUserOp, getUserOpStatus } = await import("../src/bundlerClient.js");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitUserOp", () => {
  it("returns the userOpHash the bundler assigns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xabc123" }), { status: 200 })
      )
    );

    const result = await submitUserOp({ sender: "0x1111111111111111111111111111111111111111" });

    expect(result.userOpHash).toBe("0xabc123");
  });

  it("throws when the bundler rejects the UserOp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "AA21 didn't pay prefund" } }),
          { status: 200 }
        )
      )
    );

    await expect(submitUserOp({ sender: "0x1" })).rejects.toThrow(/AA21/);
  });
});

describe("getUserOpStatus", () => {
  it("reports pending when the bundler has no receipt yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }), { status: 200 })
      )
    );

    const result = await getUserOpStatus("0xabc123");

    expect(result.status).toBe("pending");
  });

  it("reports included with a receipt once the bundler has one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { success: true, receipt: { transactionHash: "0xdeadbeef" } } }),
          { status: 200 }
        )
      )
    );

    const result = await getUserOpStatus("0xabc123");

    expect(result.status).toBe("included");
    expect(result.receipt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd aa-service && npm test`
Expected: FAIL — `Cannot find module '../src/bundlerClient.js'`.

- [ ] **Step 3: Implement `bundlerClient.ts`**

```typescript
import { config } from "./config.js";

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(config.bundlerRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) {
    throw new Error(`bundler ${method} failed: ${body.error.message}`);
  }
  return body.result;
}

const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

export async function submitUserOp(signedUserOp: object): Promise<{ userOpHash: string }> {
  const result = await rpcCall("eth_sendUserOperation", [signedUserOp, ENTRY_POINT]);
  return { userOpHash: result as string };
}

export async function getUserOpStatus(
  userOpHash: string
): Promise<{ status: "pending" | "included" | "failed"; receipt?: object }> {
  const result = await rpcCall("eth_getUserOperationReceipt", [userOpHash]);
  if (!result) {
    return { status: "pending" };
  }
  const receipt = result as { success: boolean; receipt: object };
  return { status: receipt.success ? "included" : "failed", receipt: receipt.receipt };
}
```

- [ ] **Step 4: Wire the routes**

Edit `aa-service/src/app.ts`:
```typescript
  app.post("/userop/submit", async (req, res) => {
    try {
      const { submitUserOp } = await import("./bundlerClient.js");
      const result = await submitUserOp(req.body.userOp);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/userop/:hash/status", async (req, res) => {
    try {
      const { getUserOpStatus } = await import("./bundlerClient.js");
      const result = await getUserOpStatus(req.params.hash);
      res.json(result);
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd aa-service && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add aa-service/src/bundlerClient.ts aa-service/src/app.ts aa-service/test/bundlerClient.test.ts
git commit -m "feat(aa-service): submit UserOp to bundler + status polling"
```

---

### Task 8: Python wiring for build/submit/status + gateway routes

**Files:**
- Modify: `webserver/aa.py`
- Modify: `webserver/main.py`
- Test: `webserver/tests/test_aa.py`
- Test: `webserver/tests/test_main_aa_routes.py`

**Interfaces:**
- Consumes: `aa-service`'s `POST /userop/build`, `POST /userop/submit`, `GET /userop/:hash/status` (Tasks 6-7).
- Produces: `async def build_user_op(owner, calls, *, base_url=None) -> dict`, `async def submit_user_op(user_op, *, base_url=None) -> dict`, `async def get_user_op_status(user_op_hash, *, base_url=None) -> dict` in `webserver/aa.py`.
- Routes: `POST /aa/test-userop/build`, `POST /aa/test-userop/submit`, `GET /aa/test-userop/{hash}/status`.

- [ ] **Step 1: Write the failing tests**

Append to `webserver/tests/test_aa.py`:
```python
@respx.mock
async def test_build_user_op_returns_userop_and_hash():
    respx.post("http://aa-service.test/userop/build").mock(
        return_value=httpx.Response(200, json={"userOp": {"sender": "0xABC"}, "userOpHash": "0x1"})
    )

    result = await aa.build_user_op(
        "0xABC", [{"to": "0xDEF", "value": "0", "data": "0x"}], base_url="http://aa-service.test"
    )

    assert result == {"userOp": {"sender": "0xABC"}, "userOpHash": "0x1"}


@respx.mock
async def test_submit_user_op_returns_hash():
    respx.post("http://aa-service.test/userop/submit").mock(
        return_value=httpx.Response(200, json={"userOpHash": "0x1"})
    )

    result = await aa.submit_user_op({"sender": "0xABC"}, base_url="http://aa-service.test")

    assert result == {"userOpHash": "0x1"}


@respx.mock
async def test_get_user_op_status_returns_status():
    respx.get("http://aa-service.test/userop/0x1/status").mock(
        return_value=httpx.Response(200, json={"status": "pending"})
    )

    result = await aa.get_user_op_status("0x1", base_url="http://aa-service.test")

    assert result == {"status": "pending"}
```

Append to `webserver/tests/test_main_aa_routes.py`:
```python
@respx.mock
def test_build_submit_status_userop_flow(client):
    _login(client)
    respx.post(f"{main_module.AA_SERVICE_URL}/userop/build").mock(
        return_value=httpx.Response(200, json={"userOp": {"sender": "0x1"}, "userOpHash": "0x1"})
    )
    respx.post(f"{main_module.AA_SERVICE_URL}/userop/submit").mock(
        return_value=httpx.Response(200, json={"userOpHash": "0x1"})
    )
    respx.get(f"{main_module.AA_SERVICE_URL}/userop/0x1/status").mock(
        return_value=httpx.Response(200, json={"status": "pending"})
    )

    build_resp = client.post("/aa/test-userop/build", json={"calls": [{"to": "0x1", "value": "0", "data": "0x"}]})
    assert build_resp.status_code == 200
    assert build_resp.json()["userOpHash"] == "0x1"

    submit_resp = client.post("/aa/test-userop/submit", json={"userOp": {"sender": "0x1", "signature": "0xsig"}})
    assert submit_resp.status_code == 200
    assert submit_resp.json()["userOpHash"] == "0x1"

    status_resp = client.get("/aa/test-userop/0x1/status")
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "pending"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webserver && KRYPT_POLYBOT_SESSION_SECRET=test KRYPT_POLYBOT_AA_SERVICE_URL=http://aa-service.test .venv/Scripts/python -m pytest tests/test_aa.py tests/test_main_aa_routes.py -v`
Expected: FAIL — `AttributeError: module 'webserver.aa' has no attribute 'build_user_op'` (etc).

- [ ] **Step 3: Implement the client functions**

Append to `webserver/aa.py`:
```python
async def build_user_op(owner: str, calls: list[dict], *, base_url: str | None = None) -> dict:
    url = _resolve_base_url(base_url)
    async with httpx.AsyncClient(base_url=url, timeout=15.0) as client:
        try:
            resp = await client.post("/userop/build", json={"owner": owner, "calls": calls})
        except httpx.HTTPError as e:
            raise AAServiceError(f"aa-service unreachable: {e}") from e
    if resp.status_code != 200:
        raise AAServiceError(f"aa-service error ({resp.status_code}): {resp.json().get('error', resp.text)}")
    return resp.json()


async def submit_user_op(user_op: dict, *, base_url: str | None = None) -> dict:
    url = _resolve_base_url(base_url)
    async with httpx.AsyncClient(base_url=url, timeout=30.0) as client:
        try:
            resp = await client.post("/userop/submit", json={"userOp": user_op})
        except httpx.HTTPError as e:
            raise AAServiceError(f"aa-service unreachable: {e}") from e
    if resp.status_code != 200:
        raise AAServiceError(f"aa-service error ({resp.status_code}): {resp.json().get('error', resp.text)}")
    return resp.json()


async def get_user_op_status(user_op_hash: str, *, base_url: str | None = None) -> dict:
    url = _resolve_base_url(base_url)
    async with httpx.AsyncClient(base_url=url, timeout=10.0) as client:
        try:
            resp = await client.get(f"/userop/{user_op_hash}/status")
        except httpx.HTTPError as e:
            raise AAServiceError(f"aa-service unreachable: {e}") from e
    if resp.status_code != 200:
        raise AAServiceError(f"aa-service error ({resp.status_code}): {resp.json().get('error', resp.text)}")
    return resp.json()
```

- [ ] **Step 4: Wire the routes**

Append to `webserver/main.py`:
```python
class BuildUserOpRequest(BaseModel):
    calls: list[dict]


@app.post("/aa/test-userop/build")
async def post_test_userop_build(
    body: BuildUserOpRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    try:
        result = await aa.build_user_op(wallet_address, body.calls, base_url=AA_SERVICE_URL)
    except aa.AAServiceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return JSONResponse(result)


class SubmitUserOpRequest(BaseModel):
    userOp: dict


@app.post("/aa/test-userop/submit")
async def post_test_userop_submit(
    body: SubmitUserOpRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    try:
        result = await aa.submit_user_op(body.userOp, base_url=AA_SERVICE_URL)
    except aa.AAServiceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return JSONResponse(result)


@app.get("/aa/test-userop/{user_op_hash}/status")
async def get_test_userop_status(
    user_op_hash: str, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    try:
        result = await aa.get_user_op_status(user_op_hash, base_url=AA_SERVICE_URL)
    except aa.AAServiceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return JSONResponse(result)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webserver && KRYPT_POLYBOT_SESSION_SECRET=test KRYPT_POLYBOT_AA_SERVICE_URL=http://aa-service.test .venv/Scripts/python -m pytest -v`
Expected: all tests PASS (Fase 1 + Fase 2a).

- [ ] **Step 6: Commit**

```bash
git add webserver/aa.py webserver/main.py webserver/tests/test_aa.py webserver/tests/test_main_aa_routes.py
git commit -m "feat(webserver): build/submit/status UserOp routes"
```

---

### Task 9: Browser harness extension + documentation

**Files:**
- Modify: `webserver/static/signer.html` (create if Fase 2's harness wasn't kept — check first; if absent, create fresh per the structure below)
- Modify: `README.md`

**Interfaces:** none (UI + docs only, consumes the routes from Tasks 3 and 8).

- [ ] **Step 1: Check whether `webserver/static/signer.html` exists**

```bash
cd "C:\Users\Admin\Documents\workspace\Krypt-Polybot-main"
ls webserver/static/signer.html 2>/dev/null || echo "MISSING — create fresh"
```

If missing, create `webserver/static/signer.html` with a minimal shell (wallet connect via `window.ethereum`, SIWE login reusing Fase 1's `/auth/nonce`+`/auth/verify`, a `<pre id="log">` for output) before continuing — this task only adds the Fase 2a-specific section below to whatever shell exists.

- [ ] **Step 2: Add the Fase 2a section**

Add to `webserver/static/signer.html`, inside the existing page body (after the SIWE login section):
```html
<section id="aa-section">
  <h2>Fase 2a — Smart account infra smoke test</h2>
  <button id="btn-compute-address">1. Compute my smart account address</button>
  <p id="aa-address"></p>
  <p>Deposit a small amount of test USDC to that address on Polygon Amoy, then:</p>
  <button id="btn-build-userop">2. Build test UserOp (self-transfer)</button>
  <button id="btn-submit-userop">3. Sign + submit</button>
  <button id="btn-check-status">4. Check status</button>
  <pre id="aa-log"></pre>
</section>
<script type="module">
  const log = (msg) => {
    document.getElementById("aa-log").textContent += msg + "\n";
  };

  document.getElementById("btn-compute-address").onclick = async () => {
    const resp = await fetch("/aa/account", { credentials: "include" });
    const body = await resp.json();
    if (!resp.ok) return log("error: " + JSON.stringify(body));
    document.getElementById("aa-address").textContent = "Account: " + body.address;
    log("computed address: " + body.address);
  };

  let lastUserOp = null;
  let lastUserOpHash = null;

  document.getElementById("btn-build-userop").onclick = async () => {
    const resp = await fetch("/aa/test-userop/build", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calls: [{ to: window.ethereum.selectedAddress, value: "0", data: "0x" }] }),
    });
    const body = await resp.json();
    if (!resp.ok) return log("error: " + JSON.stringify(body));
    lastUserOp = body.userOp;
    lastUserOpHash = body.userOpHash;
    log("built UserOp, hash to sign: " + lastUserOpHash);
  };

  document.getElementById("btn-submit-userop").onclick = async () => {
    if (!lastUserOp || !lastUserOpHash) return log("build a UserOp first");
    const signature = await window.ethereum.request({
      method: "personal_sign",
      params: [lastUserOpHash, window.ethereum.selectedAddress],
      // NOTE: real UserOp signing is typically eth_signTypedData_v4 over
      // the EntryPoint's typed UserOp struct, not personal_sign over the
      // raw hash — confirm the exact signing method the installed
      // @zerodev/sdk expects (Task 1 Step 1) and adjust this call before
      // trusting a real submission.
    });
    const resp = await fetch("/aa/test-userop/submit", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userOp: { ...lastUserOp, signature } }),
    });
    const body = await resp.json();
    log(resp.ok ? "submitted: " + body.userOpHash : "error: " + JSON.stringify(body));
  };

  document.getElementById("btn-check-status").onclick = async () => {
    if (!lastUserOpHash) return log("submit a UserOp first");
    const resp = await fetch(`/aa/test-userop/${lastUserOpHash}/status`, { credentials: "include" });
    const body = await resp.json();
    log("status: " + JSON.stringify(body));
  };
</script>
```

- [ ] **Step 3: Serve the static directory from FastAPI**

Edit `webserver/main.py`, near the top after `app = FastAPI(...)`:
```python
from fastapi.staticfiles import StaticFiles

app.mount("/static", StaticFiles(directory=Path(__file__).resolve().parent / "static"), name="static")
```

- [ ] **Step 4: Manual smoke test (Amoy testnet, small funds, explicit confirmation before running)**

```bash
cd "C:\Users\Admin\Documents\workspace\Krypt-Polybot-main\webserver"
KRYPT_POLYBOT_SESSION_SECRET=dev-secret KRYPT_POLYBOT_AA_SERVICE_URL=http://localhost:4001 .venv/Scripts/python -m uvicorn webserver.main:app --reload
```

In another terminal:
```bash
cd "C:\Users\Admin\Documents\workspace\Krypt-Polybot-main\aa-service"
npm run dev
```

Open `http://127.0.0.1:8000/static/signer.html`, connect a testnet wallet (MetaMask on Amoy, with test MATIC + test USDC), and click through steps 1-4. Confirm the address is deterministic across a page reload, and that the smoke-test UserOp reaches `included` status.

- [ ] **Step 5: README section**

Add to `README.md`, after the existing "Webapp (Fase 1, in progress)" section:
```markdown
## Webapp Fase 2a (in progress) — smart account infra

Adds an ERC-4337 smart-account layer for the webapp: each logged-in
wallet gets a Kernel (ZeroDev) smart account, deployed counterfactually,
with gas sponsored by our own paymaster and submitted through our own
self-hosted bundler (Alto) — no session-keys or Polymarket trading yet
(that's Fase 2b). See
[docs/superpowers/specs/2026-09-01-webapp-fase2a-aa-smart-account-infra-design.md](docs/superpowers/specs/2026-09-01-webapp-fase2a-aa-smart-account-infra-design.md).

Run it locally (three processes):
\`\`\`bash
# 1. bundler
cd infra/bundler && docker compose up -d

# 2. aa-service
cd aa-service && npm install && npm run dev

# 3. gateway (Fase 1 + Fase 2a routes)
cd webserver && KRYPT_POLYBOT_SESSION_SECRET=dev-secret \
  KRYPT_POLYBOT_AA_SERVICE_URL=http://localhost:4001 \
  .venv/Scripts/python -m uvicorn webserver.main:app --reload
\`\`\`

Open `http://127.0.0.1:8000/static/signer.html` for the smoke-test harness.
```

- [ ] **Step 6: Commit**

```bash
git add webserver/static/signer.html webserver/main.py README.md
git commit -m "feat(webserver): Fase 2a smoke-test harness + docs"
```

---

## End-to-end verification (after all tasks)

1. `cd aa-service && npm test` — all PASS.
2. `cd webserver && KRYPT_POLYBOT_SESSION_SECRET=test KRYPT_POLYBOT_AA_SERVICE_URL=http://aa-service.test .venv/Scripts/python -m pytest -v` — all PASS (Fase 1 + Fase 2a).
3. `docker compose -f infra/bundler/docker-compose.yml up -d` against Amoy, confirm `eth_chainId` responds.
4. Run the manual harness (Task 9 Step 4) against Amoy testnet: compute address, deposit test USDC, build → sign → submit → poll status until `included`.
5. Confirm the same owner address reload-to-reload matches (counterfactual determinism holds in practice, not just in the unit test).
6. **Optional, separate from this plan's automated tasks:** a single mainnet smoke test with minimal real funds, per the spec's testing section — run only with the user's explicit go-ahead at the time, not as a scripted step here (mainnet config swaps `POLYGON_RPC_URL`/`BUNDLER_RPC_URL`/`CHAIN_ID=137` for their Polygon-mainnet equivalents).

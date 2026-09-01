# Webapp Fase 2b: Session Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `python/service.py` sign and submit Polymarket orders unattended, via a Kernel (ZeroDev) session key authorized once by the owner, instead of rejecting trading with "Fase 2".

**Architecture:** A session key is an ephemeral ECDSA keypair generated and held encrypted in the Python worker's per-user storage (same mechanism as the desktop wallet key). The owner authorizes it once via a single `eth_signTypedData_v4` signature over Kernel's permission-validator "enable" payload (contract-enforced: caller restricted to the Polymarket CTF Exchange, time-boxed by `validUntil`). `polymarket_auth.create_signed_order()` gets a new branch: when a session key is active, it signs the order with the session key (replicating Kernel's EIP-712 wrap + permission-validator signature encoding) instead of the desktop private key — so the entire existing trading engine (`polymarket_api.place_limit_order` and everything that calls it, including the unattended scanner/whale-tracker/trader loop) needs zero changes.

**Tech Stack:** Python (`eth_account`, existing `polymarket_auth.py` crypto helpers), FastAPI (`webserver/main.py`), TypeScript/vitest (`aa-service`, dev-only fixture script using `@zerodev/permissions`).

**Spec:** [docs/superpowers/specs/2026-09-02-webapp-fase2b-session-keys-design.md](../specs/2026-09-02-webapp-fase2b-session-keys-design.md)

## Global Constraints

- Chain: Polygon mainnet, `chainId=137` (`polymarket_auth.CHAIN_ID`).
- Smart account: Kernel v0.3.1, EntryPoint v0.7 (must match `aa-service/src/kernelAccount.ts` constants exactly — a mismatch changes the account address and every wrap hash).
- Session key material is never transmitted over HTTP in cleartext and never leaves `python/service.py`'s process memory except encrypted at rest.
- `create_signed_order()`'s existing EOA and `_create_signed_order_1271` (desktop deposit-wallet) code paths must not change behavior — new logic is additive, gated on "a session key is active."
- No new RPC for order submission — the hook point is `create_signed_order()`, called transparently by the existing `polymarket_api.place_limit_order()`.
- Manual E2E with real money requires explicit user confirmation before running — never automated in CI.

---

## Task 1: Golden signature fixture (aa-service, TypeScript)

**Files:**
- Modify: `aa-service/package.json` (add `@zerodev/permissions` dependency)
- Create: `aa-service/scripts/gen-session-key-fixture.ts`
- Create: `python/tests/fixtures/session_key_golden.json` (generated output, committed)

**Interfaces:**
- Produces: `session_key_golden.json` with shape
  `{"owner": "0x...", "sessionKeyPrivateKey": "0x...", "sessionKeyAddress": "0x...", "policy": {"allowedCaller": "0x...", "validUntil": 1234567890}, "orderDigest": "0x...", "signature": "0x..."}`
  — this is the contract every later Python task (Task 4) must reproduce exactly.

- [ ] **Step 1: Add the dependency**

```bash
cd aa-service
npm install @zerodev/permissions
```

- [ ] **Step 2: Write the fixture-generation script**

```typescript
// aa-service/scripts/gen-session-key-fixture.ts
//
// Dev-only script (not part of the running service). Generates a
// deterministic "golden" session-key signature using ZeroDev's real SDK,
// so Python (Task 4) has a byte-exact target to match instead of a
// hand-derived guess at Kernel's wrap + permission-validator encoding.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, type Hex } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createKernelAccount } from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  toPermissionValidator,
  toECDSASigner,
} from "@zerodev/permissions";
import { toSignatureCallerPolicy } from "@zerodev/permissions/policies";
import { entryPoint07Address } from "viem/account-abstraction";

// Fixed, deterministic inputs — never regenerate these unless the Kernel
// version or EntryPoint version changes (see Global Constraints).
const OWNER_PRIVATE_KEY: Hex =
  "0x1111111111111111111111111111111111111111111111111111111111111111".slice(0, 66) as Hex;
const SESSION_KEY_PRIVATE_KEY: Hex = generatePrivateKey();
// Polymarket CTF Exchange v2 (python/polymarket_auth.py EXCHANGE_ADDRESS) —
// the only address allowed to call isValidSignature on this session key.
const CTF_EXCHANGE_V2 = "0xE111180000d2663C0091e4f400237545B87B996B" as const;
const VALID_UNTIL = 1893456000; // fixed far-future UTC timestamp, deterministic
// A fixed, arbitrary 32-byte "order digest" standing in for a real
// Polymarket Order struct hash — Task 4's cross-check only needs the
// signature scheme to match, not a real order.
const ORDER_DIGEST_MESSAGE = "0x" + "ab".repeat(32);

async function main() {
  const publicClient = createPublicClient({ chain: polygon, transport: http() });
  const ownerAccount = privateKeyToAccount(OWNER_PRIVATE_KEY);
  const sessionKeyAccount = privateKeyToAccount(SESSION_KEY_PRIVATE_KEY);

  const sudoValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerAccount,
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    kernelVersion: "0.3.1",
  });

  const ecdsaSigner = await toECDSASigner({ signer: sessionKeyAccount });
  const callerPolicy = toSignatureCallerPolicy({ allowedCallers: [CTF_EXCHANGE_V2] });

  const permissionValidator = await toPermissionValidator(publicClient, {
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    kernelVersion: "0.3.1",
    signer: ecdsaSigner,
    policies: [callerPolicy],
    validUntil: VALID_UNTIL,
  });

  const kernelAccount = await createKernelAccount(publicClient, {
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    kernelVersion: "0.3.1",
    plugins: { sudo: sudoValidator, regular: permissionValidator },
  });

  const signature = await kernelAccount.signMessage({
    message: { raw: ORDER_DIGEST_MESSAGE as Hex },
  });

  writeFileSync(
    new URL("../../python/tests/fixtures/session_key_golden.json", import.meta.url),
    JSON.stringify(
      {
        owner: ownerAccount.address,
        kernelAccountAddress: await kernelAccount.getAddress(),
        sessionKeyPrivateKey: SESSION_KEY_PRIVATE_KEY,
        sessionKeyAddress: sessionKeyAccount.address,
        policy: { allowedCaller: CTF_EXCHANGE_V2, validUntil: VALID_UNTIL },
        orderDigest: ORDER_DIGEST_MESSAGE,
        signature,
      },
      null,
      2
    )
  );
  console.log("wrote python/tests/fixtures/session_key_golden.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run it and inspect the output**

```bash
cd aa-service
npx tsx scripts/gen-session-key-fixture.ts
cat ../python/tests/fixtures/session_key_golden.json
```

Expected: a JSON file with a `signature` field starting `0x` and at least 130 hex chars. If the script throws (e.g. `toPermissionValidator` API differs from what's assumed above), fix the script against the installed `@zerodev/permissions` version's actual exports (`node_modules/@zerodev/permissions/_types/index.d.ts`) before moving on — this fixture is the ground truth for Task 4, so it must come from real, running SDK code, not a guess.

- [ ] **Step 4: Commit**

```bash
git add aa-service/package.json aa-service/package-lock.json aa-service/scripts/gen-session-key-fixture.ts python/tests/fixtures/session_key_golden.json
git commit -m "feat(aa-service): golden session-key signature fixture for Python cross-check"
```

---

## Task 2: `python/session_key.py` — key generation and encrypted storage

**Files:**
- Create: `python/session_key.py`
- Test: `python/tests/test_session_key.py`

**Interfaces:**
- Consumes: `polymarket_auth._credentials_dir()`, `polymarket_auth._atomic_write_600()`, `polymarket_auth._write_secret_bytes()`, `polymarket_auth._read_secret_bytes()`, `polymarket_auth._validate_env()`, `polymarket_auth.NETWORK` (all already defined in `python/polymarket_auth.py`).
- Produces: `generate_session_key() -> tuple[str, bytes]` (address, raw private key bytes — not yet encrypted), `session_key_file(env: str = NETWORK) -> Path`, `store_session_key(address: str, private_key_hex: str, policy: dict, enable_signature: str, env: str = NETWORK) -> None`, `load_session_key_record(env: str = NETWORK) -> Optional[dict]` (raw stored record, regardless of active/expired), used by Task 3's `load_active_session_key`.

- [ ] **Step 1: Write the failing tests**

```python
# python/tests/test_session_key.py
import json
import time
from pathlib import Path

import pytest

import polymarket_auth
import session_key


@pytest.fixture(autouse=True)
def _isolated_userdata(tmp_path, monkeypatch):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    polymarket_auth.reset_credential_cache()
    yield


def test_generate_session_key_returns_valid_address_and_key():
    address, priv_hex = session_key.generate_session_key()
    from eth_account import Account
    assert Account.from_key(priv_hex).address == address
    assert address.startswith("0x") and len(address) == 42


def test_store_and_load_session_key_roundtrip():
    address, priv_hex = session_key.generate_session_key()
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": int(time.time()) + 3600, "dailyUsdCap": 50.0}
    session_key.store_session_key(address, priv_hex, policy, "0xdeadsignature", env="mainnet")

    record = session_key.load_session_key_record(env="mainnet")
    assert record is not None
    assert record["address"] == address
    assert record["privateKey"] == priv_hex
    assert record["policy"] == policy
    assert record["enableSignature"] == "0xdeadsignature"
    assert record["active"] is True


def test_load_session_key_record_returns_none_when_absent():
    assert session_key.load_session_key_record(env="mainnet") is None


def test_session_key_file_is_encrypted_at_rest_or_flagged(tmp_path):
    address, priv_hex = session_key.generate_session_key()
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": int(time.time()) + 3600, "dailyUsdCap": 50.0}
    session_key.store_session_key(address, priv_hex, policy, "0xdeadsignature", env="mainnet")
    raw = session_key.session_key_file(env="mainnet").read_bytes()
    # The private key must never appear as a plain substring of the file on
    # disk when an OS-level encryption backend is available on this
    # platform — same guarantee polymarket_auth.py already gives the
    # desktop wallet key.
    if polymarket_auth._dpapi_available() or polymarket_auth._keyring_available():
        assert priv_hex.encode() not in raw
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_session_key.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'session_key'`

- [ ] **Step 3: Implement `python/session_key.py`**

```python
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

import polymarket_auth as _auth


def generate_session_key() -> tuple[str, str]:
    """Generates a fresh ephemeral ECDSA keypair for use as a Kernel
    session key. Returns (address, private_key_hex) — the private key is
    never persisted in plaintext by this function; callers must pass it
    straight to store_session_key()."""
    from eth_account import Account
    acct = Account.create()
    priv = acct.key.hex()
    if not priv.startswith("0x"):
        priv = "0x" + priv
    return acct.address, priv


def session_key_file(env: str = _auth.NETWORK) -> Path:
    return _auth._credentials_dir() / f"sessionkey.{_auth._validate_env(env)}.json"


def store_session_key(
    address: str, private_key_hex: str, policy: dict, enable_signature: str,
    env: str = _auth.NETWORK,
) -> None:
    record = {
        "address": address,
        "privateKey": private_key_hex,
        "policy": policy,
        "enableSignature": enable_signature,
        "active": True,
        "createdAt": int(time.time()),
    }
    _auth._write_secret_bytes(session_key_file(env), json.dumps(record).encode("utf-8"))


def load_session_key_record(env: str = _auth.NETWORK) -> Optional[dict]:
    f = session_key_file(env)
    if not f.exists():
        return None
    try:
        data = json.loads(_auth._read_secret_bytes(f).decode("utf-8", "replace"))
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get("address") or not data.get("privateKey"):
        return None
    return data
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_session_key.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/session_key.py python/tests/test_session_key.py
git commit -m "feat(session-key): generation and encrypted storage"
```

---

## Task 3: `python/session_key.py` — enable typed-data, active/expiry check, soft revoke

**Files:**
- Modify: `python/session_key.py`
- Test: `python/tests/test_session_key.py` (extend)

**Interfaces:**
- Consumes: `store_session_key`, `load_session_key_record` (Task 2), `polymarket_auth.CHAIN_ID`, `polymarket_auth.now_ts()`.
- Produces: `build_enable_typed_data(kernel_address: str, session_key_address: str, policy: dict) -> dict`, `load_active_session_key(env: str = NETWORK) -> Optional[dict]` (same shape as `load_session_key_record`, but `None` if inactive or `policy.validUntil` has passed), `revoke_session_key_soft(env: str = NETWORK) -> None`.

- [ ] **Step 1: Write the failing tests**

```python
def test_build_enable_typed_data_shape():
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": 1893456000, "dailyUsdCap": 50.0}
    typed = session_key.build_enable_typed_data(
        "0xKernelAddr00000000000000000000000000000", "0xSessionKeyAddr0000000000000000000000000", policy,
    )
    assert typed["domain"]["chainId"] == polymarket_auth.CHAIN_ID
    assert typed["message"]["sessionKeyAddress"] == "0xSessionKeyAddr0000000000000000000000000"
    assert typed["message"]["allowedCaller"] == policy["allowedCaller"]
    assert typed["message"]["validUntil"] == policy["validUntil"]


def test_load_active_session_key_none_before_activation():
    assert session_key.load_active_session_key(env="mainnet") is None


def test_load_active_session_key_none_when_expired():
    address, priv_hex = session_key.generate_session_key()
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": 1, "dailyUsdCap": 50.0}
    session_key.store_session_key(address, priv_hex, policy, "0xsig", env="mainnet")
    assert session_key.load_active_session_key(env="mainnet") is None


def test_load_active_session_key_returns_record_when_valid():
    address, priv_hex = session_key.generate_session_key()
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": int(time.time()) + 3600, "dailyUsdCap": 50.0}
    session_key.store_session_key(address, priv_hex, policy, "0xsig", env="mainnet")
    record = session_key.load_active_session_key(env="mainnet")
    assert record is not None
    assert record["address"] == address


def test_revoke_session_key_soft_deactivates():
    address, priv_hex = session_key.generate_session_key()
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": int(time.time()) + 3600, "dailyUsdCap": 50.0}
    session_key.store_session_key(address, priv_hex, policy, "0xsig", env="mainnet")
    session_key.revoke_session_key_soft(env="mainnet")
    assert session_key.load_active_session_key(env="mainnet") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_session_key.py -v`
Expected: FAIL (`AttributeError: module 'session_key' has no attribute 'build_enable_typed_data'`, etc.)

- [ ] **Step 3: Implement**

```python
def build_enable_typed_data(kernel_address: str, session_key_address: str, policy: dict) -> dict:
    """EIP-712 payload the owner signs once via eth_signTypedData_v4 to
    authorize `session_key_address` as a Kernel permission-validator
    signer restricted to `policy['allowedCaller']`
    (the Polymarket CTF Exchange), expiring at `policy['validUntil']`."""
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "EnableSessionKey": [
                {"name": "sessionKeyAddress", "type": "address"},
                {"name": "allowedCaller", "type": "address"},
                {"name": "validUntil", "type": "uint256"},
            ],
        },
        "primaryType": "EnableSessionKey",
        "domain": {
            "name": "Krypt PolyBot Session Key",
            "version": "1",
            "chainId": _auth.CHAIN_ID,
            "verifyingContract": kernel_address,
        },
        "message": {
            "sessionKeyAddress": session_key_address,
            "allowedCaller": policy["allowedCaller"],
            "validUntil": int(policy["validUntil"]),
        },
    }


def load_active_session_key(env: str = _auth.NETWORK) -> Optional[dict]:
    record = load_session_key_record(env)
    if record is None or not record.get("active"):
        return None
    valid_until = int(record.get("policy", {}).get("validUntil") or 0)
    if valid_until and _auth.now_ts() >= valid_until:
        return None
    return record


def revoke_session_key_soft(env: str = _auth.NETWORK) -> None:
    record = load_session_key_record(env)
    if record is None:
        return
    record["active"] = False
    _auth._write_secret_bytes(session_key_file(env), json.dumps(record).encode("utf-8"))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_session_key.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/session_key.py python/tests/test_session_key.py
git commit -m "feat(session-key): enable typed-data, expiry check, soft revoke"
```

---

## Task 4: `sign_order_as_session_key` — the Kernel wrap (cross-check against the golden fixture)

**Files:**
- Modify: `python/session_key.py`
- Test: `python/tests/test_session_key_signing.py`

**Interfaces:**
- Consumes: `python/tests/fixtures/session_key_golden.json` (Task 1).
- Produces: `sign_order_as_session_key(digest: bytes, session_key_private_key_hex: str) -> str` — takes a raw 32-byte digest (the already-hashed EIP-712 message, matching what `kernelAccount.signMessage({message: {raw: digest}})` in Task 1's fixture script signs) and the session key's private key, returns the final `0x`-prefixed signature Kernel's `isValidSignature` will accept.

- [ ] **Step 1: Write the failing cross-check test**

```python
# python/tests/test_session_key_signing.py
import json
from pathlib import Path

import session_key

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "session_key_golden.json").read_text()
)


def test_sign_order_as_session_key_matches_golden_fixture():
    digest = bytes.fromhex(FIXTURE["orderDigest"][2:])
    signature = session_key.sign_order_as_session_key(
        digest, FIXTURE["sessionKeyPrivateKey"]
    )
    assert signature.lower() == FIXTURE["signature"].lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_session_key_signing.py -v`
Expected: FAIL (`AttributeError: module 'session_key' has no attribute 'sign_order_as_session_key'`)

- [ ] **Step 3: Implement a first pass**

Kernel v0.3.1's `signMessage` (see
`aa-service/node_modules/@zerodev/sdk/_cjs/accounts/kernel/createKernelAccount.js:383-420`,
already read during spec brainstorming) for EntryPoint v0.7 delegates to
`kernelPluginManager.signTypedData` with `primaryType: "Kernel"`,
domain `{name, version, chainId, verifyingContract: accountAddress}` —
i.e. the raw digest gets wrapped one more time in a `Kernel` EIP-712
struct before the active validator (the permission-validator here) signs
it. The permission-validator itself prefixes its raw ECDSA signature with
a `permissionId` selector so Kernel's dispatcher routes verification to
the right installed permission. Implement this as the starting point,
then use Step 4 to correct any byte-layout details this description
gets wrong — the golden fixture, not this description, is the source of
truth:

```python
def sign_order_as_session_key(digest: bytes, session_key_private_key_hex: str) -> str:
    from eth_account import Account
    from eth_account.messages import encode_typed_data

    acct = Account.from_key(session_key_private_key_hex)
    wrapped = encode_typed_data(full_message={
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "Kernel": [{"name": "hash", "type": "bytes32"}],
        },
        "primaryType": "Kernel",
        "domain": {
            "name": "Kernel",
            "version": "0.3.1",
            "chainId": _auth.CHAIN_ID,
            "verifyingContract": "0x0000000000000000000000000000000000000000",
        },
        "message": {"hash": "0x" + digest.hex()},
    })
    signed = acct.sign_message(wrapped)
    sig = signed.signature.hex()
    return sig if sig.startswith("0x") else "0x" + sig
```

- [ ] **Step 4: Run the cross-check test and iterate until it passes**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_session_key_signing.py -v -s`

This is expected to fail on the first pass — the exact domain
`verifyingContract` (must be the real Kernel account address, not the
zero address — thread it through as a new parameter once this is
discovered), the `permissionId` prefix bytes, and whether Kernel wraps
via `signTypedData` or `signMessage` for a permission-validator
specifically, are all things Step 3's placeholder values get wrong on
the first attempt. Debug by comparing the failing test's actual output
against `FIXTURE["signature"]` byte-by-byte, and by re-reading the
relevant `@zerodev/sdk`/`@zerodev/permissions` source installed under
`aa-service/node_modules/` (in particular
`@zerodev/permissions/_cjs/signerToPermissionValidator.js` and
`@zerodev/sdk/_cjs/accounts/kernel/createKernelAccount.js`) to find the
exact encoding. Do not consider this task done until the test passes
with no changes to the test file itself — only to
`sign_order_as_session_key`'s implementation (adding a
`kernel_account_address` parameter is expected and fine).

Expected once fixed: PASS

- [ ] **Step 5: Commit**

```bash
git add python/session_key.py python/tests/test_session_key_signing.py
git commit -m "feat(session-key): Kernel EIP-712 wrap + permission-validator signature, verified against golden fixture"
```

---

## Task 5: `polymarket_auth.create_signed_order()` — session-key branch

**Files:**
- Modify: `python/polymarket_auth.py:737-838` (`create_signed_order`)
- Test: `python/tests/test_polymarket_auth_session_key.py`

**Interfaces:**
- Consumes: `session_key.load_active_session_key()`, `session_key.sign_order_as_session_key()` (Tasks 3-4).
- Produces: no new public function — `create_signed_order()`'s existing signature and return shape are unchanged; behavior only changes when a session key is active.

- [ ] **Step 1: Write the failing test**

```python
# python/tests/test_polymarket_auth_session_key.py
import time

import polymarket_auth
import session_key


def test_create_signed_order_uses_session_key_when_active(tmp_path, monkeypatch):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    polymarket_auth.reset_credential_cache()
    polymarket_auth.save_credentials(
        "0x" + "11" * 32, funder="0x000000000000000000000000000000000000aa",
        signature_type=polymarket_auth.SIGNATURE_TYPE_POLY_1271,
    )

    kernel_address = "0x000000000000000000000000000000000000Bb"
    address, priv_hex = session_key.generate_session_key()
    policy = {
        "allowedCaller": polymarket_auth.EXCHANGE_ADDRESS,
        "validUntil": int(time.time()) + 3600,
        "dailyUsdCap": 1000.0,
        "kernelAddress": kernel_address,
    }
    session_key.store_session_key(address, priv_hex, policy, "0xsig")

    order = polymarket_auth.create_signed_order(
        token_id="123", side="BUY", price=0.5, size=10, neg_risk=False,
        salt=42, ts_ms=1_700_000_000_000,
    )

    assert order["maker"].lower() == kernel_address.lower()
    assert order["signer"].lower() == kernel_address.lower()
    assert order["signatureType"] == polymarket_auth.SIGNATURE_TYPE_POLY_1271
    assert order["signature"].startswith("0x")


def test_create_signed_order_falls_back_to_desktop_flow_without_session_key(tmp_path, monkeypatch):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    polymarket_auth.reset_credential_cache()
    polymarket_auth.save_credentials(
        "0x" + "22" * 32, funder="0x000000000000000000000000000000000000cc",
        signature_type=polymarket_auth.SIGNATURE_TYPE_POLY_1271,
    )
    order = polymarket_auth.create_signed_order(
        token_id="123", side="BUY", price=0.5, size=10, neg_risk=False,
    )
    assert order["maker"].lower() == "0x000000000000000000000000000000000000cc"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_polymarket_auth_session_key.py -v`
Expected: first test FAILs — `order["maker"]` is the deposit-wallet `funder` (`0x...aa`), not `kernel_address`, because `create_signed_order` doesn't know about session keys yet.

- [ ] **Step 3: Add the session-key branch**

In `python/polymarket_auth.py`, add `import session_key` near the top (module-level, same style as the existing imports), and change `create_signed_order` (currently starting at line 737):

```python
def create_signed_order(
    *,
    token_id: str,
    side: str,
    price: float,
    size: float,
    neg_risk: bool = False,
    expiration: int = 0,
    salt: Optional[int] = None,
    ts_ms: Optional[int] = None,
) -> dict:
    active_session_key = None
    if get_signature_type() == SIGNATURE_TYPE_POLY_1271:
        active_session_key = session_key.load_active_session_key()
    if active_session_key is not None:
        return _create_signed_order_via_session_key(
            token_id=token_id, side=side, price=price, size=size,
            neg_risk=neg_risk, expiration=expiration, salt=salt, ts_ms=ts_ms,
            session_key_record=active_session_key,
        )
    if get_signature_type() == SIGNATURE_TYPE_POLY_1271:
        return _create_signed_order_1271(
            token_id=token_id, side=side, price=price, size=size,
            neg_risk=neg_risk, expiration=expiration,
        )
    # ... existing EOA path below, unchanged ...
```

Add the new helper just above `create_signed_order`, reusing the exact
`Order` struct/typed-data shape already built in the EOA path (lines
790-820 today) but with `maker`/`signer` set to the Kernel address from
the session key's policy:

```python
def _create_signed_order_via_session_key(
    *, token_id: str, side: str, price: float, size: float, neg_risk: bool,
    expiration: int, salt: Optional[int], ts_ms: Optional[int], session_key_record: dict,
) -> dict:
    import session_key as _session_key_mod  # local import avoids a hard
    # circular-import requirement at module load time, matching how the
    # rest of this file lazily imports py_clob_client_v2 submodules

    kernel_address = session_key_record["policy"]["kernelAddress"]
    side_u = side.upper()
    side_int = 0 if side_u == "BUY" else 1
    if side_u == "BUY":
        maker_amount = _round_amt(price * size * _DECIMALS)
        taker_amount = _round_amt(size * _DECIMALS)
    else:
        maker_amount = _round_amt(size * _DECIMALS)
        taker_amount = _round_amt(price * size * _DECIMALS)
    if salt is None:
        salt = int(hashlib.sha256(
            f"{kernel_address}{token_id}{time.time_ns()}".encode()
        ).hexdigest()[:16], 16) & ((1 << 48) - 1)
    if ts_ms is None:
        ts_ms = time.time_ns() // 1_000_000
    verifying = NEG_RISK_EXCHANGE_ADDRESS if neg_risk else EXCHANGE_ADDRESS

    order_msg = {
        "salt": int(salt), "maker": kernel_address, "signer": kernel_address,
        "tokenId": int(token_id), "makerAmount": int(maker_amount),
        "takerAmount": int(taker_amount), "side": int(side_int),
        "signatureType": int(SIGNATURE_TYPE_POLY_1271), "timestamp": int(ts_ms),
        "metadata": ZERO_BYTES32, "builder": ZERO_BYTES32,
    }
    typed = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"}, {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"},
            ],
            "Order": [
                {"name": "salt", "type": "uint256"}, {"name": "maker", "type": "address"},
                {"name": "signer", "type": "address"}, {"name": "tokenId", "type": "uint256"},
                {"name": "makerAmount", "type": "uint256"}, {"name": "takerAmount", "type": "uint256"},
                {"name": "side", "type": "uint8"}, {"name": "signatureType", "type": "uint8"},
                {"name": "timestamp", "type": "uint256"}, {"name": "metadata", "type": "bytes32"},
                {"name": "builder", "type": "bytes32"},
            ],
        },
        "primaryType": "Order",
        "domain": {"name": "Polymarket CTF Exchange", "version": EXCHANGE_VERSION,
                    "chainId": CHAIN_ID, "verifyingContract": verifying},
        "message": order_msg,
    }
    from eth_account.messages import encode_typed_data
    digest = encode_typed_data(full_message=typed).body  # 32-byte struct hash eth_account computes internally
    signature = _session_key_mod.sign_order_as_session_key(
        digest, session_key_record["privateKey"],
    )
    return {
        "salt": int(salt), "maker": kernel_address, "signer": kernel_address,
        "taker": ZERO_ADDRESS, "tokenId": str(int(token_id)),
        "makerAmount": str(int(maker_amount)), "takerAmount": str(int(taker_amount)),
        "expiration": str(int(expiration)), "side": side_u,
        "signatureType": int(SIGNATURE_TYPE_POLY_1271), "signature": signature,
        "timestamp": str(int(ts_ms)), "metadata": ZERO_BYTES32, "builder": ZERO_BYTES32,
    }
```

Note: `encode_typed_data(...).body` is a placeholder access pattern —
confirm the exact attribute/property `eth_account`'s
`SignableMessage` exposes for the raw digest bytes in this repo's
installed `eth-account` version (`python/.venv/Lib/site-packages/eth_account/messages.py`)
during Step 3, and adjust `sign_order_as_session_key`'s parameter
(`digest: bytes`) to match whatever that attribute actually returns.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_polymarket_auth_session_key.py tests/test_session_key.py tests/test_session_key_signing.py -v`
Expected: PASS. Also run the full existing suite to confirm no regression:
`cd python && .venv/Scripts/python -m pytest -x -q`
Expected: PASS (same pass count as before this task, plus the new tests).

- [ ] **Step 5: Commit**

```bash
git add python/polymarket_auth.py python/tests/test_polymarket_auth_session_key.py
git commit -m "feat(polymarket-auth): sign orders via active session key, transparent to place_limit_order"
```

---

## Task 6: Daily USD spend cap enforcement

**Files:**
- Modify: `python/session_key.py` (cap bookkeeping), `python/polymarket_auth.py` (`_create_signed_order_via_session_key`, from Task 5)
- Test: `python/tests/test_session_key_cap.py`

**Interfaces:**
- Produces: `session_key.reserve_daily_usd(amount_usd: float, env: str = NETWORK) -> bool` (returns `False` and reserves nothing if `dailyUsdCap` would be exceeded; `True` and records the spend otherwise — counter keyed by UTC day, stored alongside the session key record).
- Consumes (Task 5's helper, modified): calls `reserve_daily_usd` before signing; raises `RuntimeError("daily USD cap exceeded for session key")` if it returns `False`.

- [ ] **Step 1: Write the failing tests**

```python
# python/tests/test_session_key_cap.py
import time

import session_key


def _seed_active_key(tmp_path, monkeypatch, daily_cap):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    address, priv_hex = session_key.generate_session_key()
    policy = {
        "allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B",
        "validUntil": int(time.time()) + 3600, "dailyUsdCap": daily_cap,
        "kernelAddress": "0x000000000000000000000000000000000000Bb",
    }
    session_key.store_session_key(address, priv_hex, policy, "0xsig")


def test_reserve_daily_usd_allows_spend_under_cap(tmp_path, monkeypatch):
    _seed_active_key(tmp_path, monkeypatch, daily_cap=100.0)
    assert session_key.reserve_daily_usd(30.0) is True
    assert session_key.reserve_daily_usd(60.0) is True


def test_reserve_daily_usd_rejects_spend_over_cap(tmp_path, monkeypatch):
    _seed_active_key(tmp_path, monkeypatch, daily_cap=100.0)
    assert session_key.reserve_daily_usd(90.0) is True
    assert session_key.reserve_daily_usd(20.0) is False


def test_reserve_daily_usd_resets_on_new_utc_day(tmp_path, monkeypatch):
    _seed_active_key(tmp_path, monkeypatch, daily_cap=100.0)
    assert session_key.reserve_daily_usd(90.0) is True
    import polymarket_auth
    monkeypatch.setattr(polymarket_auth, "now_ts", lambda: int(time.time()) + 86400 + 60)
    assert session_key.reserve_daily_usd(90.0) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_session_key_cap.py -v`
Expected: FAIL (`AttributeError: module 'session_key' has no attribute 'reserve_daily_usd'`)

- [ ] **Step 3: Implement**

```python
def reserve_daily_usd(amount_usd: float, env: str = _auth.NETWORK) -> bool:
    record = load_session_key_record(env)
    if record is None:
        return False
    today = time.strftime("%Y-%m-%d", time.gmtime(_auth.now_ts()))
    spend = record.get("dailySpend") or {}
    if spend.get("day") != today:
        spend = {"day": today, "usedUsd": 0.0}
    cap = float(record.get("policy", {}).get("dailyUsdCap") or 0.0)
    if cap and spend["usedUsd"] + amount_usd > cap:
        return False
    spend["usedUsd"] = spend["usedUsd"] + amount_usd
    record["dailySpend"] = spend
    _auth._write_secret_bytes(session_key_file(env), json.dumps(record).encode("utf-8"))
    return True
```

Then in `python/polymarket_auth.py`'s `_create_signed_order_via_session_key` (Task 5), before building `order_msg`, add:

```python
    notional_usd = price * size
    if not _session_key_mod.reserve_daily_usd(notional_usd):
        raise RuntimeError("daily USD cap exceeded for session key")
```

(move the `import session_key as _session_key_mod` line to the top of the function, before this check, if not already there from Task 5).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_session_key_cap.py tests/test_polymarket_auth_session_key.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/session_key.py python/polymarket_auth.py python/tests/test_session_key_cap.py
git commit -m "feat(session-key): software-enforced daily USD spend cap"
```

---

## Task 7: `python/service.py` RPC handlers (mint / activate / revoke)

**Files:**
- Modify: `python/service.py` (add handlers + registry entries near line 2161, `_h_setCredentials`/`_h_clearCredentials` neighborhood)
- Test: `python/tests/test_service_session_key_rpc.py` (or extend the existing service RPC test file if `python/tests/` already has one covering `_dispatch_request` directly — check `python/tests/` for the closest existing pattern before creating a new file)

**Interfaces:**
- Consumes: `session_key.generate_session_key`, `session_key.build_enable_typed_data`, `session_key.store_session_key`, `session_key.revoke_session_key_soft` (Tasks 2-3), `polymarket_auth.get_address()`.
- Produces RPC methods (registered in `_HANDLERS`):
  - `mintSessionKey(params: {kernelAddress: str, allowedCaller: str, validUntil: int, dailyUsdCap: float}) -> {sessionKeyAddress: str, enableTypedData: dict}`
  - `activateSessionKey(params: {signature: str}) -> {ok: True}`
  - `revokeSessionKey(params: {}) -> {ok: True}`

- [ ] **Step 1: Write the failing test**

```python
# python/tests/test_service_session_key_rpc.py
import asyncio

import service


def test_mint_then_activate_session_key(tmp_path, monkeypatch):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    kernel_address = "0x000000000000000000000000000000000000Bb"
    allowed_caller = "0xE111180000d2663C0091e4f400237545B87B996B"

    mint_result = asyncio.run(service._h_mintSessionKey({
        "kernelAddress": kernel_address, "allowedCaller": allowed_caller,
        "validUntil": 1893456000, "dailyUsdCap": 50.0,
    }))
    assert mint_result["sessionKeyAddress"].startswith("0x")
    assert mint_result["enableTypedData"]["message"]["sessionKeyAddress"] == mint_result["sessionKeyAddress"]

    activate_result = asyncio.run(service._h_activateSessionKey({"signature": "0xdeadsignature"}))
    assert activate_result == {"ok": True}

    import session_key
    record = session_key.load_active_session_key()
    assert record is not None
    assert record["address"] == mint_result["sessionKeyAddress"]

    revoke_result = asyncio.run(service._h_revokeSessionKey({}))
    assert revoke_result == {"ok": True}
    assert session_key.load_active_session_key() is None
```

Before writing this test, check `python/tests/` for whether calling
`service._h_*` handlers directly (rather than through the stdio RPC
loop) is already an established pattern elsewhere in that test
directory — reuse that convention (fixtures, `conftest.py` setup for
`STATE`/DB) rather than introducing a second one.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_service_session_key_rpc.py -v`
Expected: FAIL (`AttributeError: module 'service' has no attribute '_h_mintSessionKey'`)

- [ ] **Step 3: Implement the handlers**

In `python/service.py`, near `_h_setCredentials`/`_h_clearCredentials`:

```python
_pending_session_key: dict | None = None


async def _h_mintSessionKey(p: dict) -> dict:
    p = p or {}
    kernel_address = p["kernelAddress"]
    policy = {
        "allowedCaller": p["allowedCaller"],
        "validUntil": int(p["validUntil"]),
        "dailyUsdCap": float(p.get("dailyUsdCap") or 0.0),
        "kernelAddress": kernel_address,
    }
    address, priv_hex = session_key.generate_session_key()
    global _pending_session_key
    _pending_session_key = {"address": address, "privateKey": priv_hex, "policy": policy}
    typed_data = session_key.build_enable_typed_data(kernel_address, address, policy)
    return {"sessionKeyAddress": address, "enableTypedData": typed_data}


async def _h_activateSessionKey(p: dict) -> dict:
    p = p or {}
    signature = p.get("signature")
    if not signature:
        raise ValueError("signature is required")
    global _pending_session_key
    if _pending_session_key is None:
        raise RuntimeError("no pending session key — call mintSessionKey first")
    pending = _pending_session_key
    session_key.store_session_key(
        pending["address"], pending["privateKey"], pending["policy"], signature,
    )
    _pending_session_key = None
    return {"ok": True}


async def _h_revokeSessionKey(_p: dict) -> dict:
    session_key.revoke_session_key_soft()
    return {"ok": True}
```

Add `import session_key` to `python/service.py`'s import block (same
place as the existing `import polymarket_auth`, line 80), and add the
three entries to `_HANDLERS` near `"clearCredentials": _h_clearCredentials,`:

```python
    "mintSessionKey": _h_mintSessionKey,
    "activateSessionKey": _h_activateSessionKey,
    "revokeSessionKey": _h_revokeSessionKey,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd python && .venv/Scripts/python -m pytest tests/test_service_session_key_rpc.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/service.py python/tests/test_service_session_key_rpc.py
git commit -m "feat(service): mintSessionKey/activateSessionKey/revokeSessionKey RPC handlers"
```

---

## Task 8: `webserver/main.py` REST routes + `dummy_worker.py` extension

**Files:**
- Modify: `webserver/main.py`, `webserver/tests/fixtures/dummy_worker.py`
- Test: `webserver/tests/test_main_session_key_routes.py`

**Interfaces:**
- Consumes: `supervisor.get_or_create(wallet_address)` → `worker.request(method, params)` (existing `Supervisor`/`Worker` API, same as `ws_endpoint`), `aa.compute_account_address` (existing, to resolve the Kernel address server-side rather than trusting the client).
- Produces routes: `POST /session-key/init`, `POST /session-key/activate`, `POST /session-key/revoke` — all behind `Depends(require_wallet_address)`, same auth pattern as `/aa/*`.

- [ ] **Step 1: Extend `dummy_worker.py`**

```python
# webserver/tests/fixtures/dummy_worker.py — add before the final "unknown method" fallback:
        if method == "mintSessionKey":
            _send({"type": "rpc", "id": req["id"], "ok": True, "result": {
                "sessionKeyAddress": "0xSessionKeyDummy00000000000000000000000",
                "enableTypedData": {"domain": {}, "message": {"sessionKeyAddress": "0xSessionKeyDummy00000000000000000000000"}},
            }})
            continue
        if method == "activateSessionKey":
            _send({"type": "rpc", "id": req["id"], "ok": True, "result": {"ok": True}})
            continue
        if method == "revokeSessionKey":
            _send({"type": "rpc", "id": req["id"], "ok": True, "result": {"ok": True}})
            continue
```

- [ ] **Step 2: Write the failing route tests**

```python
# webserver/tests/test_main_session_key_routes.py
import httpx
import respx

import webserver.main as main_module
from webserver.tests.test_main_aa_routes import client, _login, _test_session_secret  # reuse fixtures


@respx.mock
def test_session_key_init_requires_session(client):
    resp = client.post("/session-key/init", json={"validUntil": 1893456000, "dailyUsdCap": 50.0})
    assert resp.status_code == 401


@respx.mock
def test_session_key_init_returns_enable_typed_data(client):
    wallet_address, session_cookie = _login(client)
    respx.get(f"{main_module.AA_SERVICE_URL}/account/{wallet_address}").mock(
        return_value=httpx.Response(200, json={"address": "0xKernelDeadBeef00000000000000000000000000"})
    )
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    resp = client.post("/session-key/init", json={"validUntil": 1893456000, "dailyUsdCap": 50.0})

    assert resp.status_code == 200
    body = resp.json()
    assert body["sessionKeyAddress"] == "0xSessionKeyDummy00000000000000000000000"
    assert "enableTypedData" in body


@respx.mock
def test_session_key_activate_relays_signature(client):
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    resp = client.post("/session-key/activate", json={"signature": "0xdeadsignature"})

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


@respx.mock
def test_session_key_revoke(client):
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    resp = client.post("/session-key/revoke")

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd webserver && .venv/Scripts/python -m pytest tests/test_main_session_key_routes.py -v`
Expected: FAIL with 404 (routes don't exist yet)

- [ ] **Step 4: Add the routes**

In `webserver/main.py`, after the existing `/aa/*` routes (after `get_test_userop_status`, before the `/ws` endpoint):

```python
CTF_EXCHANGE_V2_ADDRESS = "0xE111180000d2663C0091e4f400237545B87B996B"


class SessionKeyInitRequest(BaseModel):
    validUntil: int
    dailyUsdCap: float


@app.post("/session-key/init")
async def post_session_key_init(
    body: SessionKeyInitRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    try:
        kernel_address = await aa.compute_account_address(wallet_address, base_url=AA_SERVICE_URL)
    except aa.AAServiceError as e:
        raise HTTPException(status_code=_gateway_status_for_aa_error(e), detail=str(e)) from e
    worker = await supervisor.get_or_create(wallet_address)
    result = await worker.request("mintSessionKey", {
        "kernelAddress": kernel_address,
        "allowedCaller": CTF_EXCHANGE_V2_ADDRESS,
        "validUntil": body.validUntil,
        "dailyUsdCap": body.dailyUsdCap,
    })
    return JSONResponse(result)


class SessionKeyActivateRequest(BaseModel):
    signature: str


@app.post("/session-key/activate")
async def post_session_key_activate(
    body: SessionKeyActivateRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    worker = await supervisor.get_or_create(wallet_address)
    result = await worker.request("activateSessionKey", {"signature": body.signature})
    return JSONResponse(result)


@app.post("/session-key/revoke")
async def post_session_key_revoke(
    wallet_address: str = Depends(require_wallet_address),
) -> JSONResponse:
    worker = await supervisor.get_or_create(wallet_address)
    result = await worker.request("revokeSessionKey", {})
    return JSONResponse(result)
```

Verify `worker.request(method, params)` is the correct existing method
name on whatever `supervisor.get_or_create()` returns (check
`webserver/supervisor.py` — `ws_endpoint` already calls
`worker.request(method, req.get("params") or {})` at line ~231, so reuse
that exact call signature).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webserver && .venv/Scripts/python -m pytest tests/test_main_session_key_routes.py -v`
Expected: PASS. Then run the full webserver suite: `cd webserver && .venv/Scripts/python -m pytest -q` — expect no regressions.

- [ ] **Step 6: Commit**

```bash
git add webserver/main.py webserver/tests/fixtures/dummy_worker.py webserver/tests/test_main_session_key_routes.py
git commit -m "feat(webserver): /session-key/init|activate|revoke routes"
```

---

## Task 9: `signer.html` — activate auto-trading UI

**Files:**
- Modify: `webserver/static/signer.html`

**Interfaces:**
- Consumes: `POST /session-key/init`, `POST /session-key/activate`, `POST /session-key/revoke` (Task 8), the browser wallet's `eth_signTypedData_v4` (same pattern already used in `signer.html` for the Fase 2a UserOp smoke test — read the existing file first to match its exact style/structure before adding to it, since this plan does not have its current content in front of it).

- [ ] **Step 1: Read the current file**

Run: open `webserver/static/signer.html` and locate the existing UserOp
smoke-test section (Fase 2a) — the JS pattern it uses to call
`window.ethereum.request({method: "eth_signTypedData_v4", params: [...]})`
and to POST JSON to the gateway is the pattern to copy for this task.

- [ ] **Step 2: Add the "Activate auto-trading" section**

Add a new section below the existing Fase 2a UserOp smoke-test block,
following its exact style (same fetch/error-handling conventions found
in Step 1), with:
- A "Daily USD cap" number input (default `50`).
- An "Activate auto-trading" button that: calls `POST /session-key/init`
  with a `validUntil` computed as `now + 30 days` (Unix seconds) and the
  cap from the input; signs the returned `enableTypedData` with
  `eth_signTypedData_v4`; POSTs the signature to
  `POST /session-key/activate`; on success, shows "Session key active"
  plus the `sessionKeyAddress` and the configured cap.
- A "Revoke" button that calls `POST /session-key/revoke` and updates
  the displayed status to "Session key revoked (local)".

- [ ] **Step 3: Manual smoke test**

Run the three local processes per the README's Fase 2a instructions
(bundler, `aa-service`, gateway), open
`http://127.0.0.1:8000/static/signer.html`, connect a wallet, click
"Activate auto-trading", confirm the signature prompt shows a readable
`sessionKeyAddress`/`allowedCaller`/`validUntil`, and confirm the page
shows "Session key active" afterward.

- [ ] **Step 4: Commit**

```bash
git add webserver/static/signer.html
git commit -m "feat(webserver): signer.html session-key activation UI"
```

---

## Task 10: README section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the section**

After the existing "Webapp Fase 2a (in progress) — smart account infra"
section, add:

```markdown
## Webapp Fase 2b (in progress) — session keys, unattended trading

Closes the gap Fase 2a left open: the scanner/whale-tracker/15-min-crypto
auto-trader can now place and cancel real Polymarket orders without the
user's browser open. The user authorizes a Kernel permission-validator
session key once (a single `eth_signTypedData_v4` signature, restricted
on-chain to the Polymarket CTF Exchange as caller and to a fixed
expiration); `python/service.py` then signs orders with that session key
locally — no dependency on `aa-service`/the bundler being up to trade.
See
[docs/superpowers/specs/2026-09-02-webapp-fase2b-session-keys-design.md](docs/superpowers/specs/2026-09-02-webapp-fase2b-session-keys-design.md).

The daily USD spend cap is software-enforced (not contract-enforced —
see the spec's spike findings); expiration and the allowed-caller
restriction are contract-enforced by the Kernel permission-validator.

Open `http://127.0.0.1:8000/static/signer.html`, click "Activate
auto-trading" after depositing USDC (Fase 2a), and the existing
scanner/whale-tracker will start placing real orders on your behalf.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: Fase 2b — session keys, unattended trading"
```

---

## End-to-end verification (after all tasks)

1. `cd python && .venv/Scripts/python -m pytest -q` — all PASS (including every new `test_session_key*.py` and `test_polymarket_auth_session_key.py`).
2. `cd webserver && .venv/Scripts/python -m pytest -q` — all PASS.
3. `cd aa-service && npm test` — all PASS (no regression from the new dev dependency).
4. Re-run `npx tsx aa-service/scripts/gen-session-key-fixture.ts` and confirm `git diff python/tests/fixtures/session_key_golden.json` is empty — the fixture must stay deterministic.
5. Manual E2E (Amoy testnet first, per Fase 2a's testnet-before-mainnet precedent, then mainnet only with the user's explicit go-ahead and minimal real funds): deposit USDC into the Kernel account, activate a session key with a small `dailyUsdCap`, let the scanner/whale-tracker place one real order unattended, confirm it appears on Polymarket, confirm a second order past the cap is rejected without a signature prompt, then revoke and confirm no further orders are placed.

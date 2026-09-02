# Webapp Fase 3: React Standalone Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `src/` (React) from an Electron renderer talking to `window.krypt.*` (IPC) into a standalone webapp talking to `webserver/` over WebSocket (RPC) + REST, then delete Electron entirely.

**Architecture:** A single `ws-client.ts` opens one authenticated WebSocket per browser session to `webserver/`'s existing `/ws` JSON-RPC proxy (unchanged, from Fase 1). `@tanstack/react-query` wraps every RPC/REST call as a query or mutation; push-events from the worker route into the React Query cache via a central `useWsEvent` dispatcher instead of a hand-rolled Context. Config/profiles/strategies and multi-wallet session logic — previously Node-local Electron main-process code with no server equivalent — move into new `webserver/` modules. Electron (`electron/`, `electron-builder`, tray/autostart/Discord-RPC-native/frameless title bar) is deleted once every consumer has been rewired.

**Tech Stack:** React 18, TypeScript, Vite, `@tanstack/react-query` (new dep), Vitest + React Testing Library (new dev deps, no frontend test runner exists yet), FastAPI (`webserver/`), pytest (existing `webserver/tests/`).

**Spec:** [docs/superpowers/specs/2026-09-02-webapp-fase3-react-standalone-design.md](../specs/2026-09-02-webapp-fase3-react-standalone-design.md)

## Global Constraints

- No new global mutable bridge (`window.krypt` reimplemented as a shim) — every backend access goes through a typed import (`ws-client`, REST fetch wrappers, or a React Query hook). This was explicitly rejected in brainstorming (Approach C) in favor of typed calls.
- Electron-only features with no web equivalent (tray, autostart, Discord RPC native, frameless title bar) are dropped without replacement this phase — do not invent web substitutes for them.
- `python/service.py` and its JSON-RPC method names/handlers are **unchanged** — the frontend calls the exact method names in `_HANDLERS` (verified below), never new ones.
- `webserver/main.py`'s existing `/aa/*`, `/session-key/*` routes and `Supervisor` are unchanged in shape — new work adds routes/columns beside them, following the same `require_wallet_address` auth pattern.
- Every rewritten call site must stop importing `window.krypt` — the final task greps for zero remaining references before Electron is deleted.
- Session TTL / SIWE signature mechanism unchanged (`SESSION_TTL_SECONDS`, `NONCE_TTL_SECONDS`, `verify_siwe`) — only the JWT payload shape and which claim `require_wallet_address` reads changes.

## Verified backend RPC surface (do not deviate)

`python/service.py` `_HANDLERS` dict (exact method names the WS `{"type":"rpc","method":...}` frame must use):
`ping, crypto15m, crypto15mStatus, tradingStatus, c15History, c15Backtest, c15ParlayGenerate, c15ParlayStatus, c15ParlayArm, mainBacktest, collectionStats, exportResearch, scriptsList, scriptSave, scriptDelete, scriptSetEnabled, scriptSetAssets, scriptSetDryRun, scriptShadowOrders, scriptValidate, scriptBacktest, scriptContextPack, scriptApiDocs, copyStatus, polymarketUrl, setConfig, setCredentials, clearCredentials, mintSessionKey, activateSessionKey, revokeSessionKey, credentialStatus, testCredentials, account, pnlSeries, positions, signals, scannerStats, cancelAllOpen, flatten, runOnce, pause, shutdown, botRuns, factoryReset, clearHistory`.

Push-events the worker emits (`emit_event(name, data)` in `python/service.py`), which arrive on the same WS as `{"type":"event","event":name,"data":...}`:
`crypto15m:autoOff, account:update, backend:authChanged, signal:new, position:new, position:update, backend:reconciled, backend:loopStalled, credentials:changed, data:reset`.

`setCredentials`, `clearCredentials`, `cancelAllOpen`, `flatten`, `testCredentials` are rejected server-side today (`_TRADING_METHODS_DISABLED_PHASE1` in `webserver/main.py:45-48`) — hooks must still be built (UI needs to show the rejection), but expect `{ok:false, error:"... is not available yet — trading/credentials ..."}` from these until a later phase re-enables them.

---

## Stage A — Backend foundations

### Task 1: Multi-wallet session (webserver/auth.py + main.py)

**Files:**
- Modify: `webserver/auth.py`
- Modify: `webserver/main.py` (`require_wallet_address`, `/auth/verify`, new `/auth/switch`)
- Test: `webserver/tests/test_auth.py`, `webserver/tests/test_main_aa_routes.py` (auth dependency is shared — confirm it still passes)

**Interfaces:**
- Produces: `create_session_token(wallets: list[str], active: str, *, secret: str) -> str`, `decode_session_token(token: str, *, secret: str) -> dict` returning `{"wallets": [...], "active": "..."}`, `add_wallet_to_session(token: str, new_wallet: str, *, secret: str) -> str` (returns a new token with `new_wallet` appended and made active; no-ops to "already active" if it's already the active wallet), `switch_active_wallet(token: str, wallet: str, *, secret: str) -> str` (raises `AuthError` if `wallet` not in the token's `wallets`).

- [ ] **Step 1: Write failing tests for the new session payload shape**

```python
# webserver/tests/test_auth.py (append)
def test_create_session_token_carries_wallets_and_active():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    payload = auth.decode_session_token(token, secret="s")
    assert payload == {"wallets": ["0xAAA"], "active": "0xAAA"}


def test_add_wallet_to_session_appends_and_activates():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    token2 = auth.add_wallet_to_session(token, "0xBBB", secret="s")
    payload = auth.decode_session_token(token2, secret="s")
    assert payload["wallets"] == ["0xAAA", "0xBBB"]
    assert payload["active"] == "0xBBB"


def test_add_wallet_to_session_dedupes():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    token2 = auth.add_wallet_to_session(token, "0xAAA", secret="s")
    payload = auth.decode_session_token(token2, secret="s")
    assert payload["wallets"] == ["0xAAA"]
    assert payload["active"] == "0xAAA"


def test_switch_active_wallet_requires_membership():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    with pytest.raises(auth.AuthError):
        auth.switch_active_wallet(token, "0xCCC", secret="s")


def test_switch_active_wallet_ok():
    token = auth.create_session_token(["0xAAA", "0xBBB"], active="0xAAA", secret="s")
    token2 = auth.switch_active_wallet(token, "0xBBB", secret="s")
    payload = auth.decode_session_token(token2, secret="s")
    assert payload["active"] == "0xBBB"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webserver && python -m pytest tests/test_auth.py -v -k "session_token or switch"`
Expected: FAIL — `create_session_token`, `add_wallet_to_session`, `switch_active_wallet` don't exist yet / old signature takes one `wallet_address` positional arg.

- [ ] **Step 3: Rewrite the session functions in `webserver/auth.py`**

Replace the existing `create_session_token`/`decode_session_token` with:

```python
def create_session_token(wallets: list[str], *, active: str, secret: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "wallets": wallets,
        "active": active,
        "iat": now,
        "exp": now + timedelta(seconds=SESSION_TTL_SECONDS),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_session_token(token: str, *, secret: str) -> dict:
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise AuthError(f"invalid session token: {e}") from e
    wallets = payload.get("wallets")
    active = payload.get("active")
    if not wallets or not active:
        raise AuthError("session token missing wallets/active")
    return {"wallets": wallets, "active": active}


def add_wallet_to_session(token: str, new_wallet: str, *, secret: str) -> str:
    payload = decode_session_token(token, secret=secret)
    wallets = payload["wallets"]
    if new_wallet not in wallets:
        wallets = [*wallets, new_wallet]
    return create_session_token(wallets, active=new_wallet, secret=secret)


def switch_active_wallet(token: str, wallet: str, *, secret: str) -> str:
    payload = decode_session_token(token, secret=secret)
    if wallet not in payload["wallets"]:
        raise AuthError(f"wallet {wallet} is not linked to this session")
    return create_session_token(payload["wallets"], active=wallet, secret=secret)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webserver && python -m pytest tests/test_auth.py -v`
Expected: PASS

- [ ] **Step 5: Update `webserver/main.py` call sites and add `/auth/switch`**

Verified current code (do not re-derive — this is exact, from `webserver/main.py`):

```python
class VerifyRequest(BaseModel):
    message: str
    signature: str


@app.post("/auth/verify")
async def verify(body: VerifyRequest) -> JSONResponse:
    try:
        wallet_address = auth.verify_siwe(body.message, body.signature)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e

    token = auth.create_session_token(wallet_address, secret=SESSION_SECRET)
    response = JSONResponse({"walletAddress": wallet_address})
    response.set_cookie(
        SESSION_COOKIE_NAME, token,
        httponly=True, secure=True, samesite="lax",
        max_age=auth.SESSION_TTL_SECONDS,
    )
    return response


async def require_wallet_address(kpb_session: str | None = Cookie(default=None)) -> str:
    try:
        return auth.decode_session_token(kpb_session or "", secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
```

Note `decode_session_token` today returns the wallet address **string directly** (not a dict, no `["sub"]` indexing anywhere) — Task 1 Step 3 changes its return type to a `dict`, so every current caller of `decode_session_token` must change from using the return value as a string to indexing `["active"]`. `SESSION_COOKIE_NAME` is an existing module-level constant — reuse it, don't hardcode `"kpb_session"`. Keep `secure=True` in every `set_cookie` call this task adds or touches. Replace the three functions above with:

```python
@app.post("/auth/verify")
async def verify(body: VerifyRequest, kpb_session: str | None = Cookie(default=None)) -> JSONResponse:
    try:
        address = auth.verify_siwe(body.message, body.signature)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e

    if kpb_session:
        try:
            token = auth.add_wallet_to_session(kpb_session, address, secret=SESSION_SECRET)
        except auth.AuthError:
            token = auth.create_session_token([address], active=address, secret=SESSION_SECRET)
    else:
        token = auth.create_session_token([address], active=address, secret=SESSION_SECRET)

    resp = JSONResponse({"walletAddress": address})
    resp.set_cookie(
        SESSION_COOKIE_NAME, token,
        httponly=True, secure=True, samesite="lax",
        max_age=auth.SESSION_TTL_SECONDS,
    )
    return resp


class SwitchWalletRequest(BaseModel):
    address: str


@app.post("/auth/switch")
async def switch_wallet(
    body: SwitchWalletRequest, kpb_session: str | None = Cookie(default=None)
) -> JSONResponse:
    if not kpb_session:
        raise HTTPException(status_code=401, detail="no active session")
    try:
        token = auth.switch_active_wallet(kpb_session, body.address, secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    resp = JSONResponse({"walletAddress": body.address})
    resp.set_cookie(
        SESSION_COOKIE_NAME, token,
        httponly=True, secure=True, samesite="lax",
        max_age=auth.SESSION_TTL_SECONDS,
    )
    return resp


async def require_wallet_address(kpb_session: str | None = Cookie(default=None)) -> str:
    if not kpb_session:
        raise HTTPException(status_code=401, detail="not authenticated")
    try:
        payload = auth.decode_session_token(kpb_session, secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    return payload["active"]
```

(These three functions — `verify`, the new `switch_wallet`, and `require_wallet_address` — fully replace the current `verify`/`require_wallet_address` shown at the top of this step. `SESSION_SECRET` and `SESSION_COOKIE_NAME` are unchanged module-level constants; `VerifyRequest` is unchanged.)

Add a `GET /auth/session` route returning `{"wallets": [...], "active": "..."}` for the frontend's account-switcher (reads `kpb_session` the same way, 401 if absent/invalid):

```python
@app.get("/auth/session")
async def get_session(kpb_session: str | None = Cookie(default=None)) -> JSONResponse:
    if not kpb_session:
        raise HTTPException(status_code=401, detail="not authenticated")
    try:
        payload = auth.decode_session_token(kpb_session, secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    return JSONResponse(payload)
```

- [ ] **Step 6: Update the `/ws` endpoint's direct `decode_session_token` call**

The `/ws` endpoint decodes the cookie itself rather than using the `require_wallet_address` dependency (it needs to close the socket with a custom code on failure, not raise an `HTTPException`). Current code:

```python
    try:
        wallet_address = auth.decode_session_token(kpb_session or "", secret=SESSION_SECRET)
    except auth.AuthError:
        await websocket.close(code=4401)
        return
```

Change to read the new dict shape:

```python
    try:
        wallet_address = auth.decode_session_token(kpb_session or "", secret=SESSION_SECRET)["active"]
    except auth.AuthError:
        await websocket.close(code=4401)
        return
```

Run `grep -n "decode_session_token" webserver/main.py` afterward — it must show exactly two call sites (`require_wallet_address` and this `/ws` one), both updated. Any additional hit is a call site this step missed.

- [ ] **Step 7: Run full webserver test suite**

`test_main_aa_routes.py`, `test_main_session_key_routes.py`, and `test_main_ws.py` each have a `_login(client)` helper that logs in through the real `/auth/nonce` → `/auth/verify` HTTP flow (see `test_main_aa_routes.py:28-53`) and reads `resp.json()["walletAddress"]` — they never call `create_session_token`/`decode_session_token` directly, so they need no changes for the new payload shape. If any of them fail, the cause is elsewhere (e.g. `SESSION_COOKIE_NAME` not reused correctly in Step 5's new code) — do not "fix" these tests by changing their assertions to match broken behavior.

Run: `cd webserver && python -m pytest tests/ -v`
Expected: PASS, 38 tests (the pre-existing baseline count — confirm this matches; a different count means something outside this task's scope broke or a test was accidentally skipped).

- [ ] **Step 8: Commit**

```bash
git add webserver/auth.py webserver/main.py webserver/tests/
git commit -m "feat(webserver): multi-wallet session (wallets[]/active JWT, /auth/switch)"
```

---

### Task 2: Config/strategies/profiles persistence (webserver/config_store.py)

**Files:**
- Create: `webserver/config_store.py`
- Modify: `webserver/main.py` (new routes)
- Test: `webserver/tests/test_config_store.py`, `webserver/tests/test_main_config_routes.py`

**Interfaces:**
- Consumes: `require_wallet_address` from Task 1 (routes use it as a dependency exactly like `/aa/*`).
- Produces: `get_config(user_id: str) -> dict`, `patch_config(user_id: str, patch: dict) -> dict`, `replace_config(user_id: str, cfg: dict) -> dict`, `reset_config(user_id: str) -> dict`, `list_strategies() -> list[dict]`, `apply_strategy(user_id: str, strategy_id: str) -> dict`, `list_profiles(user_id: str) -> list[dict]`, `save_profile(user_id, name, description, scope) -> dict`, `apply_profile(user_id, profile_id) -> dict`, `rename_profile(user_id, profile_id, name) -> dict`, `delete_profile(user_id, profile_id) -> None`, `duplicate_profile(user_id, profile_id) -> dict`, `export_profile(user_id, profile_id) -> str`, `import_profile(user_id, json_str) -> dict`, `get_onboarding(user_id) -> dict` (`{"acceptedDisclaimer": bool}`), `set_onboarding(user_id, patch: dict) -> dict`.

- [ ] **Step 1: Read the source being ported, to carry over exact defaults/behavior**

`electron/system/settings-store.ts` and `electron/system/strategies.ts` are the ports-of-truth for default `TraderConfig`, the strategy preset list, and profile-scoping rules (`scopeOfKey`/`normScope`/`activeKeyFor`/`scopedApplyPatch` in `electron/ipc.ts:38-70`). Read both files fully before writing `config_store.py` — do not guess field names, copy them.

- [ ] **Step 2: Write failing tests for config get/patch/replace/reset**

```python
# webserver/tests/test_config_store.py
import pytest
from pathlib import Path
from webserver import config_store


@pytest.fixture
def user_dir(tmp_path: Path) -> Path:
    return tmp_path / "user1"


def test_get_config_returns_defaults_when_no_file(user_dir):
    cfg = config_store.get_config(str(user_dir))
    assert isinstance(cfg, dict)
    assert "enableTrading" in cfg


def test_patch_config_persists(user_dir):
    config_store.patch_config(str(user_dir), {"enableTrading": True})
    cfg = config_store.get_config(str(user_dir))
    assert cfg["enableTrading"] is True


def test_replace_config_overwrites_fully(user_dir):
    config_store.patch_config(str(user_dir), {"enableTrading": True})
    defaults = config_store.get_config(str(user_dir))
    replaced = config_store.replace_config(str(user_dir), {**defaults, "enableTrading": False})
    assert replaced["enableTrading"] is False


def test_reset_config_restores_defaults(user_dir):
    config_store.patch_config(str(user_dir), {"enableTrading": True})
    reset = config_store.reset_config(str(user_dir))
    assert reset["enableTrading"] is False


def test_list_strategies_nonempty():
    assert len(config_store.list_strategies()) > 0


def test_profile_crud_roundtrip(user_dir):
    p = config_store.save_profile(str(user_dir), "My Profile", "desc", "main")
    assert p["name"] == "My Profile"
    listed = config_store.list_profiles(str(user_dir))
    assert any(x["id"] == p["id"] for x in listed)
    renamed = config_store.rename_profile(str(user_dir), p["id"], "Renamed")
    assert renamed["name"] == "Renamed"
    dup = config_store.duplicate_profile(str(user_dir), p["id"])
    assert dup["id"] != p["id"]
    exported = config_store.export_profile(str(user_dir), p["id"])
    assert "kryptTraderProfile" in exported
    config_store.delete_profile(str(user_dir), p["id"])
    assert not any(x["id"] == p["id"] for x in config_store.list_profiles(str(user_dir)))


def test_onboarding_roundtrip(user_dir):
    assert config_store.get_onboarding(str(user_dir))["acceptedDisclaimer"] is False
    config_store.set_onboarding(str(user_dir), {"acceptedDisclaimer": True})
    assert config_store.get_onboarding(str(user_dir))["acceptedDisclaimer"] is True
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd webserver && python -m pytest tests/test_config_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webserver.config_store'`

- [ ] **Step 4: Implement `webserver/config_store.py`**

Port the logic from `electron/system/settings-store.ts` (defaults + read/write JSON file) and `electron/system/strategies.ts` (static preset list) into Python, keyed by `user_id` (the wallet address), writing to `Path(user_id) / "config.json"` and `Path(user_id) / "profiles.json"` (the fixture in the tests above already passes a per-user directory as `user_id` — in production this is the same directory `Supervisor` already uses for that user's DB, so the caller in `main.py` passes that path, not the raw wallet string). Field names, default values, and the strategy preset list **must match** the TypeScript source exactly (copy every key) — this is a port, not a redesign. Include `_scope_of_key`/`_norm_scope`/`_active_key_for`/`_scoped_apply_patch` as private helpers mirroring `electron/ipc.ts:38-70` for `apply_strategy`/`apply_profile`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webserver && python -m pytest tests/test_config_store.py -v`
Expected: PASS

- [ ] **Step 6: Write failing tests for the REST routes**

```python
# webserver/tests/test_main_config_routes.py
# Follow the auth-cookie setup pattern already used in
# webserver/tests/test_main_aa_routes.py (grep that file for how it logs
# in a test client before hitting a protected route — reuse the same
# fixture/helper here instead of re-deriving SIWE signing in this file).

def test_get_config_requires_auth(client):
    resp = client.get("/config")
    assert resp.status_code == 401


def test_get_and_patch_config_roundtrip(authed_client):
    resp = authed_client.get("/config")
    assert resp.status_code == 200
    resp2 = authed_client.patch("/config", json={"enableTrading": True})
    assert resp2.status_code == 200
    assert resp2.json()["enableTrading"] is True


def test_list_strategies(authed_client):
    resp = authed_client.get("/strategies")
    assert resp.status_code == 200
    assert len(resp.json()) > 0


def test_profiles_crud(authed_client):
    resp = authed_client.post("/profiles", json={"name": "P1", "scope": "main"})
    assert resp.status_code == 200
    pid = resp.json()["id"]
    resp2 = authed_client.get("/profiles")
    assert any(p["id"] == pid for p in resp2.json())
    resp3 = authed_client.delete(f"/profiles/{pid}")
    assert resp3.status_code == 200
```

`authed_client` doesn't exist yet — add it to `webserver/tests/conftest.py`, built on the exact `_login(client)` helper already in `test_main_aa_routes.py:28-53` (SIWE-signs with a freshly generated `eth_account.Account`, posts to `/auth/nonce` then `/auth/verify`, reads the cookie via `resp.cookies.get(main_module.SESSION_COOKIE_NAME)`). Do not invent a second auth path — port that helper's body into a fixture that returns a `client` with the cookie already attached (`client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)`, same as every other test file does after calling `_login`).

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd webserver && python -m pytest tests/test_main_config_routes.py -v`
Expected: FAIL — 404 (routes don't exist)

- [ ] **Step 8: Add the routes to `webserver/main.py`**

```python
from . import config_store


def _user_data_dir(wallet_address: str) -> str:
    # Verified: Supervisor.get_or_create builds each worker's data dir as
    # `self.data_root / "users" / user_id` (webserver/supervisor.py:280,
    # where user_id is the wallet address). Reuse that exact path here so
    # config_store.py reads/writes into the same per-user directory the
    # worker's own DB lives in — do not duplicate or diverge from it.
    return str(supervisor.data_root / "users" / wallet_address)


@app.get("/config")
async def get_config(wallet_address: str = Depends(require_wallet_address)) -> JSONResponse:
    return JSONResponse(config_store.get_config(_user_data_dir(wallet_address)))


@app.patch("/config")
async def patch_config(
    patch: dict, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    cfg = config_store.patch_config(_user_data_dir(wallet_address), patch)
    await _push_config_to_worker(wallet_address, cfg)
    return JSONResponse(cfg)


@app.put("/config")
async def replace_config(
    cfg: dict, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    new_cfg = config_store.replace_config(_user_data_dir(wallet_address), cfg)
    await _push_config_to_worker(wallet_address, new_cfg)
    return JSONResponse(new_cfg)


@app.post("/config/reset")
async def reset_config_route(wallet_address: str = Depends(require_wallet_address)) -> JSONResponse:
    cfg = config_store.reset_config(_user_data_dir(wallet_address))
    await _push_config_to_worker(wallet_address, cfg)
    return JSONResponse(cfg)


@app.get("/strategies")
async def get_strategies() -> JSONResponse:
    return JSONResponse(config_store.list_strategies())


@app.post("/strategies/{strategy_id}/apply")
async def apply_strategy_route(
    strategy_id: str, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    cfg = config_store.apply_strategy(_user_data_dir(wallet_address), strategy_id)
    await _push_config_to_worker(wallet_address, cfg)
    return JSONResponse(cfg)


@app.get("/profiles")
async def list_profiles_route(wallet_address: str = Depends(require_wallet_address)) -> JSONResponse:
    return JSONResponse(config_store.list_profiles(_user_data_dir(wallet_address)))


class SaveProfileRequest(BaseModel):
    name: str
    description: str | None = None
    scope: str = "main"


@app.post("/profiles")
async def save_profile_route(
    body: SaveProfileRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    p = config_store.save_profile(_user_data_dir(wallet_address), body.name, body.description, body.scope)
    return JSONResponse(p)


@app.post("/profiles/{profile_id}/apply")
async def apply_profile_route(
    profile_id: str, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    cfg = config_store.apply_profile(_user_data_dir(wallet_address), profile_id)
    await _push_config_to_worker(wallet_address, cfg)
    return JSONResponse(cfg)


class RenameProfileRequest(BaseModel):
    name: str


@app.patch("/profiles/{profile_id}")
async def rename_profile_route(
    profile_id: str, body: RenameProfileRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    return JSONResponse(config_store.rename_profile(_user_data_dir(wallet_address), profile_id, body.name))


@app.delete("/profiles/{profile_id}")
async def delete_profile_route(
    profile_id: str, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    config_store.delete_profile(_user_data_dir(wallet_address), profile_id)
    return JSONResponse({"ok": True})


@app.post("/profiles/{profile_id}/duplicate")
async def duplicate_profile_route(
    profile_id: str, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    return JSONResponse(config_store.duplicate_profile(_user_data_dir(wallet_address), profile_id))


@app.get("/profiles/{profile_id}/export")
async def export_profile_route(
    profile_id: str, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    return JSONResponse({"json": config_store.export_profile(_user_data_dir(wallet_address), profile_id)})


class ImportProfileRequest(BaseModel):
    json: str


@app.post("/profiles/import")
async def import_profile_route(
    body: ImportProfileRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    return JSONResponse(config_store.import_profile(_user_data_dir(wallet_address), body.json))


async def _push_config_to_worker(wallet_address: str, cfg: dict) -> None:
    # Verified: Supervisor keeps its live workers in a plain dict,
    # `self.workers: dict[str, WorkerProcess]` (webserver/supervisor.py:~264),
    # with no dedicated read-only accessor. Read it directly rather than
    # calling `get_or_create` — unlike `_session_key_worker_request` (which
    # deliberately spawns a worker on demand for a user action), a config
    # edit with no worker running has nothing to push to, so this must NOT
    # spawn one.
    worker = supervisor.workers.get(wallet_address)
    if worker is not None:
        try:
            await worker.request("setConfig", {"config": cfg})
        except Exception:
            pass
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd webserver && python -m pytest tests/test_main_config_routes.py tests/test_config_store.py -v`
Expected: PASS

- [ ] **Step 10: Run full webserver suite**

Run: `cd webserver && python -m pytest tests/ -v`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add webserver/config_store.py webserver/main.py webserver/tests/
git commit -m "feat(webserver): config/strategies/profiles persistence + REST routes"
```

---

## Stage B — Frontend transport foundation

### Task 3: Frontend test runner (Vitest + RTL)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (devDependencies, `"test"` script)
- Create: `src/test/setup.ts`

**Interfaces:**
- Produces: `npm test` runs Vitest once; `src/test/setup.ts` registers `@testing-library/jest-dom` matchers, imported via `vitest.config.ts`'s `setupFiles`.

- [ ] **Step 1: Add dependencies**

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 3: Write `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Add `"test": "vitest run"` to `package.json` scripts**

- [ ] **Step 5: Write a smoke test to confirm the runner works**

```ts
// src/test/smoke.test.ts
import { describe, expect, it } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run it**

Run: `npm test`
Expected: PASS (1 test)

- [ ] **Step 7: Delete the smoke test and commit the runner**

```bash
rm src/test/smoke.test.ts
git add package.json package-lock.json vitest.config.ts src/test/setup.ts
git commit -m "chore(frontend): add Vitest + React Testing Library"
```

---

### Task 4: `ws-client.ts`

**Files:**
- Create: `src/lib/ws-client.ts`
- Test: `src/lib/ws-client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WsEventHandler = (data: unknown) => void;
  export class WsDisconnected extends Error {}
  export class WsClient {
    constructor(url: string);
    connect(): void;
    close(): void;
    request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
    on(event: string, handler: WsEventHandler): () => void; // returns unsubscribe
    get connected(): boolean;
  }
  ```
- Consumes: nothing (this is the foundation layer).

- [ ] **Step 1: Write failing tests using a mock WebSocket**

```ts
// src/lib/ws-client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient, WsDisconnected } from './ws-client';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  readyState = 0;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  triggerMessage(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WsClient', () => {
  it('resolves request() when a matching rpc response arrives', async () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const promise = client.request('ping', {});
    const sent = JSON.parse(sock.sent[0]);
    expect(sent.type).toBe('rpc');
    expect(sent.method).toBe('ping');

    sock.triggerMessage({ type: 'rpc', id: sent.id, ok: true, result: 'pong' });
    await expect(promise).resolves.toBe('pong');
  });

  it('rejects request() when the rpc response has ok:false', async () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const promise = client.request('setCredentials', {});
    const sent = JSON.parse(sock.sent[0]);
    sock.triggerMessage({ type: 'rpc', id: sent.id, ok: false, error: 'not available yet' });
    await expect(promise).rejects.toThrow('not available yet');
  });

  it('dispatches push events to subscribers', () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const handler = vi.fn();
    client.on('account:update', handler);
    sock.triggerMessage({ type: 'event', event: 'account:update', data: { equity: 100 } });
    expect(handler).toHaveBeenCalledWith({ equity: 100 });
  });

  it('unsubscribe stops delivering events', () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const handler = vi.fn();
    const off = client.on('account:update', handler);
    off();
    sock.triggerMessage({ type: 'event', event: 'account:update', data: {} });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects in-flight requests with WsDisconnected on close', async () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const promise = client.request('ping', {});
    sock.close();
    await expect(promise).rejects.toBeInstanceOf(WsDisconnected);
  });

  it('reconnects after close and reports connected state', () => {
    vi.useFakeTimers();
    const client = new WsClient('ws://test');
    client.connect();
    const first = MockWebSocket.instances[0];
    first.triggerOpen();
    expect(client.connected).toBe(true);

    first.close();
    expect(client.connected).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances.length).toBe(2);
    MockWebSocket.instances[1].triggerOpen();
    expect(client.connected).toBe(true);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ws-client`
Expected: FAIL — `Cannot find module './ws-client'`

- [ ] **Step 3: Implement `src/lib/ws-client.ts`**

```ts
export type WsEventHandler = (data: unknown) => void;

export class WsDisconnected extends Error {
  constructor(message = 'WebSocket disconnected') {
    super(message);
    this.name = 'WsDisconnected';
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export class WsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private listeners = new Map<string, Set<WsEventHandler>>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  constructor(private url: string) {}

  get connected(): boolean {
    return this.ws?.readyState === 1;
  }

  connect(): void {
    this.closedByUser = false;
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
    };
    this.ws.onmessage = (e: MessageEvent) => this.handleMessage(e.data as string);
    this.ws.onclose = () => {
      this.rejectAllPending(new WsDisconnected());
      if (!this.closedByUser) this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || this.ws.readyState !== 1) {
      return Promise.reject(new WsDisconnected());
    }
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify({ type: 'rpc', id, method, params }));
    });
  }

  on(event: string, handler: WsEventHandler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'rpc') {
      const id = msg.id as string;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(String(msg.error ?? 'rpc error')));
    } else if (msg.type === 'event') {
      const name = msg.event as string;
      for (const handler of this.listeners.get(name) ?? []) handler(msg.data);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- ws-client`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ws-client.ts src/lib/ws-client.test.ts
git commit -m "feat(frontend): WsClient — WS RPC + push-event transport"
```

---

### Task 5: `queryClient` + `WsProvider` + `useWsEvent`

**Files:**
- Create: `src/lib/queryClient.ts`
- Create: `src/state/WsProvider.tsx`
- Test: `src/state/WsProvider.test.tsx`
- Modify: `src/main.tsx` (wrap app in `QueryClientProvider` + `WsProvider`)

**Interfaces:**
- Consumes: `WsClient` from Task 4 (`src/lib/ws-client.ts`).
- Produces: `useWsClient(): WsClient` (throws if used outside `WsProvider`), `EVENT_QUERY_KEYS: Record<string, unknown[] | ((data: unknown) => unknown[])>` mapping table, `<WsProvider url={string}>` component.

- [ ] **Step 1: Add `@tanstack/react-query`**

```bash
npm install @tanstack/react-query
```

- [ ] **Step 2: Write `src/lib/queryClient.ts`**

```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
});
```

- [ ] **Step 3: Write failing test for `WsProvider`'s event routing**

```tsx
// src/state/WsProvider.test.tsx
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsProvider, useWsClient } from './WsProvider';

vi.mock('../lib/ws-client', () => {
  const handlers = new Map<string, Set<(d: unknown) => void>>();
  class FakeWsClient {
    connect() {}
    close() {}
    request() {
      return Promise.resolve({});
    }
    on(event: string, handler: (d: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return () => handlers.get(event)?.delete(handler);
    }
    __emit(event: string, data: unknown) {
      for (const h of handlers.get(event) ?? []) h(data);
    }
  }
  return { WsClient: FakeWsClient };
});

function Probe() {
  const client = useWsClient();
  return <div data-testid="probe">{client ? 'ready' : 'missing'}</div>;
}

beforeEach(() => queryClient.clear());

describe('WsProvider', () => {
  it('exposes the client via context', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <WsProvider url="ws://test">
          <Probe />
        </WsProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('ready');
  });

  it('routes account:update push events into the ["account"] query cache', () => {
    let capturedClient: any;
    function Capture() {
      capturedClient = useWsClient();
      return null;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <WsProvider url="ws://test">
          <Capture />
        </WsProvider>
      </QueryClientProvider>,
    );
    capturedClient.__emit('account:update', { equity: 42 });
    expect(queryClient.getQueryData(['account'])).toEqual({ equity: 42 });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- WsProvider`
Expected: FAIL — `Cannot find module './WsProvider'`

- [ ] **Step 5: Implement `src/state/WsProvider.tsx`**

```tsx
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WsClient } from '../lib/ws-client';

const WsContext = createContext<WsClient | null>(null);

export function useWsClient(): WsClient {
  const client = useContext(WsContext);
  if (!client) throw new Error('useWsClient must be used inside WsProvider');
  return client;
}

// Maps a worker push-event name to the React Query cache key it updates.
// `positions`/`signals` are lists keyed by id — new/update events merge
// into the existing array instead of replacing it wholesale.
const EVENT_QUERY_KEYS: Record<string, unknown[]> = {
  'account:update': ['account'],
  'credentials:changed': ['credentialsStatus'],
  'backend:authChanged': ['authStatus'],
  'backend:reconciled': ['backendReconciled'],
  'backend:loopStalled': ['backendLoopStalled'],
  'crypto15m:autoOff': ['crypto15mAutoOff'],
  'data:reset': ['dataReset'],
};

export function WsProvider({ url, children }: { url: string; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const clientRef = useRef<WsClient | null>(null);
  if (!clientRef.current) clientRef.current = new WsClient(url);
  const client = clientRef.current;

  useEffect(() => {
    client.connect();

    const unsubs = Object.entries(EVENT_QUERY_KEYS).map(([event, key]) =>
      client.on(event, (data) => queryClient.setQueryData(key, data)),
    );

    const unsubPosition = client.on('position:new', (data) => {
      queryClient.setQueryData(['positions'], (old: unknown[] = []) => [data, ...old]);
    });
    const unsubPositionUpdate = client.on('position:update', (data: any) => {
      queryClient.setQueryData(['positions'], (old: any[] = []) =>
        old.map((p) => (p.id === data.id ? data : p)),
      );
    });
    const unsubSignal = client.on('signal:new', (data) => {
      queryClient.setQueryData(['signals'], (old: unknown[] = []) => [data, ...old]);
    });

    return () => {
      unsubs.forEach((u) => u());
      unsubPosition();
      unsubPositionUpdate();
      unsubSignal();
      client.close();
    };
  }, [client, queryClient]);

  const value = useMemo(() => client, [client]);
  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- WsProvider`
Expected: PASS (2 tests)

- [ ] **Step 7: Wire into `src/main.tsx`**

Read `src/main.tsx` first (`grep -n "ReactDOM\|createRoot\|AppStateProvider" src/main.tsx`) and wrap the existing render tree:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { WsProvider } from './state/WsProvider';

// inside the render call, outermost to innermost:
// <QueryClientProvider client={queryClient}>
//   <WsProvider url={wsUrl()}>
//     ...existing tree...
//   </WsProvider>
// </QueryClientProvider>
```

Add a small `wsUrl()` helper in `src/lib/ws-client.ts` (or a new `src/lib/env.ts`) that builds `ws(s)://<host>/ws` from `window.location`, matching the scheme (`ws:`/`wss:`) to the page's own (`http:`/`https:`).

- [ ] **Step 8: Manual check**

Run: `npm run dev`, open the app, confirm no console error about missing `WsProvider`/`QueryClientProvider` context (the app will still be non-functional — no consumer has been rewired yet — this step only confirms the providers mount).

- [ ] **Step 9: Commit**

```bash
git add src/lib/queryClient.ts src/state/WsProvider.tsx src/state/WsProvider.test.tsx src/main.tsx package.json package-lock.json
git commit -m "feat(frontend): React Query + WsProvider event routing"
```

---

### Task 6: Wallet + SIWE auth (`wallet.ts`, `AuthGate`)

**Files:**
- Create: `src/lib/wallet.ts`
- Create: `src/state/AuthGate.tsx`
- Test: `src/lib/wallet.test.ts`, `src/state/AuthGate.test.tsx`
- Modify: `src/main.tsx` (mount `AuthGate` above `WsProvider`)

**Interfaces:**
- Produces: `connectWallet(): Promise<string>` (returns address, throws if no injected provider), `signSiwe(nonce: string, address: string): Promise<{message: string; signature: string}>`, `<AuthGate>` component that renders a login screen until `GET /auth/session` succeeds, then renders `children`.
- Consumes: `/auth/nonce`, `/auth/verify`, `/auth/session`, `/auth/switch` from Task 1.

- [ ] **Step 1: Write failing tests for `wallet.ts`, porting the logic already proven in `webserver/static/signer.html`**

```ts
// src/lib/wallet.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { connectWallet, signSiwe } from './wallet';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('connectWallet', () => {
  it('throws when window.ethereum is missing', async () => {
    vi.stubGlobal('ethereum', undefined);
    await expect(connectWallet()).rejects.toThrow(/ethereum/i);
  });

  it('returns the first requested account', async () => {
    const request = vi.fn().mockResolvedValue(['0xAAA']);
    vi.stubGlobal('ethereum', { request, selectedAddress: '0xAAA' });
    await expect(connectWallet()).resolves.toBe('0xAAA');
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
  });
});

describe('signSiwe', () => {
  it('builds a SIWE message and signs it via personal_sign', async () => {
    const request = vi.fn().mockResolvedValue('0xsig');
    vi.stubGlobal('ethereum', { request, selectedAddress: '0xAAA' });
    const { message, signature } = await signSiwe('nonce123', '0xAAA');
    expect(message).toContain('0xAAA');
    expect(message).toContain('nonce123');
    expect(signature).toBe('0xsig');
    expect(request).toHaveBeenCalledWith({
      method: 'personal_sign',
      params: [message, '0xAAA'],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- wallet.test`
Expected: FAIL — `Cannot find module './wallet'`

- [ ] **Step 3: Implement `src/lib/wallet.ts`, porting `webserver/static/signer.html`'s connect/sign logic**

Read `webserver/static/signer.html` lines ~75-115 first (already grepped earlier: `window.ethereum.request({method:'eth_requestAccounts'})`, then a SIWE message template signed via `personal_sign`) and port it verbatim into TypeScript, parameterizing origin/URI instead of hardcoding `127.0.0.1`:

```ts
export async function connectWallet(): Promise<string> {
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!eth) throw new Error('window.ethereum not found — install MetaMask or similar');
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  return accounts[0];
}

interface EthereumProvider {
  selectedAddress?: string;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export async function signSiwe(
  nonce: string,
  address: string,
): Promise<{ message: string; signature: string }> {
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!eth) throw new Error('window.ethereum not found');
  const message =
    `${window.location.host} wants you to sign in with your Ethereum account:\n${address}\n\n` +
    `Click to sign in and accept the Terms of Service.\n\n` +
    `URI: ${window.location.origin}\nVersion: 1\nChain ID: 80002\n` +
    `Nonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  const signature = (await eth.request({
    method: 'personal_sign',
    params: [message, address],
  })) as string;
  return { message, signature };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- wallet.test`
Expected: PASS

- [ ] **Step 5: Write failing test for `AuthGate`**

```tsx
// src/state/AuthGate.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthGate } from './AuthGate';

vi.mock('../lib/wallet', () => ({
  connectWallet: vi.fn().mockResolvedValue('0xAAA'),
  signSiwe: vi.fn().mockResolvedValue({ message: 'msg', signature: '0xsig' }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AuthGate', () => {
  it('shows children immediately when a session already exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ wallets: ['0xAAA'], active: '0xAAA' }) }),
    );
    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>,
    );
    await waitFor(() => expect(screen.getByText('protected content')).toBeInTheDocument());
  });

  it('shows a connect button and completes login when no session exists', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 }) // GET /auth/session
      .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: 'n1' }) }) // POST /auth/nonce
      .mockResolvedValueOnce({ ok: true, json: async () => ({ address: '0xAAA' }) }); // POST /auth/verify
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => expect(screen.getByText('protected content')).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- AuthGate`
Expected: FAIL — `Cannot find module './AuthGate'`

- [ ] **Step 7: Implement `src/state/AuthGate.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { connectWallet, signSiwe } from '../lib/wallet';

type Status = 'checking' | 'loggedOut' | 'loggingIn' | 'loggedIn' | 'error';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/auth/session', { credentials: 'include' })
      .then((r) => setStatus(r.ok ? 'loggedIn' : 'loggedOut'))
      .catch(() => setStatus('loggedOut'));
  }, []);

  async function login() {
    setStatus('loggingIn');
    setError(null);
    try {
      const address = await connectWallet();
      const nonceResp = await fetch('/auth/nonce', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const { nonce } = await nonceResp.json();
      const { message, signature } = await signSiwe(nonce, address);
      const verifyResp = await fetch('/auth/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      if (!verifyResp.ok) throw new Error(`login failed: ${verifyResp.status}`);
      setStatus('loggedIn');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  if (status === 'checking') return null;
  if (status === 'loggedIn') return <>{children}</>;

  return (
    <div>
      <button onClick={login} disabled={status === 'loggingIn'}>
        {status === 'loggingIn' ? 'Connecting…' : 'Connect wallet'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- AuthGate`
Expected: PASS

- [ ] **Step 9: Mount in `src/main.tsx`**

Final provider order, outermost to innermost: `QueryClientProvider` (Task 5) → `AuthGate` → `WsProvider` (Task 5) → the existing app tree. `AuthGate` sits inside `QueryClientProvider` (it doesn't use React Query itself, but nesting it there costs nothing and keeps a single provider stack) and outside `WsProvider` — the WS connection must not open until a session cookie exists, since `/ws` authenticates via that cookie the same way `require_wallet_address` does.

- [ ] **Step 10: Commit**

```bash
git add src/lib/wallet.ts src/lib/wallet.test.ts src/state/AuthGate.tsx src/state/AuthGate.test.tsx src/main.tsx
git commit -m "feat(frontend): SIWE wallet connect + AuthGate"
```

---

## Stage C — Domain rewrites

Each task below: (1) greps the exact current call sites for that domain (do not trust a memorized list — the codebase is the source of truth), (2) writes one hooks file with tests, (3) rewires every found call site, (4) removes the now-dead code path. Commit after each task — the app must build after every one (verify with `npm run build` as the last step of each task).

### Task 7: `state`/onboarding domain

**Files:**
- Create: `src/hooks/useOnboarding.ts`
- Test: `src/hooks/useOnboarding.test.ts`
- Modify: files found in Step 1

**Interfaces:**
- Consumes: `GET /config` response's onboarding fields are separate from `TraderConfig` — Task 2 added dedicated `get_onboarding`/`set_onboarding`; this task adds `GET /onboarding`, `PATCH /onboarding` REST routes the same way Task 2 added `/config` (same file, same auth dependency — add them in this task, not Task 2, since Task 2 was scoped to config/profiles/strategies only).
- Produces: `useOnboardingQuery(): UseQueryResult<{acceptedDisclaimer: boolean}>`, `useAcceptDisclaimerMutation(): UseMutationResult`, `useResetOnboardingMutation(): UseMutationResult`.

- [ ] **Step 1: Find every current call site**

Run: `grep -rn "window\.krypt\.state\." src`
Expected output includes `src/state/AppStateProvider.tsx` (`state.get`, `state.onChange`) and `src/pages/Onboarding.tsx` (`state.acceptDisclaimer`, `state.resetOnboarding`) — confirm the actual list, it drives which files Step 5 touches. `state.setStartMinimized`/`setStartWithWindows`/`setEnableDiscordRpc` calls are Electron-only (no web equivalent, per spec decision) — note their call sites for removal, not migration.

- [ ] **Step 2: Add `GET /onboarding` / `PATCH /onboarding` to `webserver/main.py`**

```python
@app.get("/onboarding")
async def get_onboarding_route(wallet_address: str = Depends(require_wallet_address)) -> JSONResponse:
    return JSONResponse(config_store.get_onboarding(_user_data_dir(wallet_address)))


@app.patch("/onboarding")
async def patch_onboarding_route(
    patch: dict, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    return JSONResponse(config_store.set_onboarding(_user_data_dir(wallet_address), patch))
```

Add a matching pytest to `webserver/tests/test_main_config_routes.py` (same `authed_client` fixture) before writing these routes, run it red, then green — same TDD cycle as Task 2 Step 6-9.

- [ ] **Step 3: Write failing frontend tests**

```ts
// src/hooks/useOnboarding.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { useOnboardingQuery, useAcceptDisclaimerMutation } from './useOnboarding';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => queryClient.clear());

describe('useOnboardingQuery', () => {
  it('fetches /onboarding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ acceptedDisclaimer: false }) }),
    );
    const { result } = renderHook(() => useOnboardingQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ acceptedDisclaimer: false }));
  });
});

describe('useAcceptDisclaimerMutation', () => {
  it('PATCHes /onboarding with acceptedDisclaimer: true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ acceptedDisclaimer: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useAcceptDisclaimerMutation(), { wrapper });
    await result.current.mutateAsync();
    expect(fetchMock).toHaveBeenCalledWith(
      '/onboarding',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ acceptedDisclaimer: true }) }),
    );
  });
});
```

- [ ] **Step 4: Run tests to verify they fail, then implement**

Run: `npm test -- useOnboarding` → FAIL, then:

```ts
// src/hooks/useOnboarding.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { credentials: 'include', ...init });
  if (!resp.ok) throw new Error(`${url} failed: ${resp.status}`);
  return resp.json();
}

export function useOnboardingQuery() {
  return useQuery({
    queryKey: ['onboarding'],
    queryFn: () => fetchJson<{ acceptedDisclaimer: boolean }>('/onboarding'),
  });
}

function usePatchOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { acceptedDisclaimer: boolean }) =>
      fetchJson('/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['onboarding'] }),
  });
}

export function useAcceptDisclaimerMutation() {
  const patch = usePatchOnboarding();
  return { ...patch, mutateAsync: () => patch.mutateAsync({ acceptedDisclaimer: true }) };
}

export function useResetOnboardingMutation() {
  const patch = usePatchOnboarding();
  return { ...patch, mutateAsync: () => patch.mutateAsync({ acceptedDisclaimer: false }) };
}
```

Run: `npm test -- useOnboarding` → PASS

- [ ] **Step 5: Rewire consuming files found in Step 1**

For `src/state/AppStateProvider.tsx`: remove its `window.krypt.state.get()`/`onChange` usage — `acceptedDisclaimer` now comes from `useOnboardingQuery()` directly in `src/pages/Onboarding.tsx`, not from the shared app-state blob (this provider is being dismantled piece by piece across this Stage; leave a `// TODO(Task N): remove once all domains migrated` only on fields *other* tasks still own — do not leave one on `acceptedDisclaimer`/onboarding, since this task fully owns and finishes that field).

For `src/pages/Onboarding.tsx`: replace `window.krypt.state.acceptDisclaimer()` → `useAcceptDisclaimerMutation().mutateAsync()`, `window.krypt.state.resetOnboarding()` → `useResetOnboardingMutation().mutateAsync()`.

Remove any UI referencing `setStartMinimized`/`setStartWithWindows`/`setEnableDiscordRpc` (Electron-only, dropped per spec) — delete the toggle, not just the handler, so there's no dead control in `Settings.tsx`/`Onboarding.tsx`.

- [ ] **Step 6: Verify the app still builds**

Run: `npm run build`
Expected: success (TypeScript will fail loudly if `window.krypt.state.*` calls remain in an editable file but the type is later removed — that removal is Stage D's job, so for now this build check just confirms no syntax/type errors from today's edits).

- [ ] **Step 7: Commit**

```bash
git add webserver/main.py webserver/tests/ src/hooks/useOnboarding.ts src/hooks/useOnboarding.test.ts src/state/AppStateProvider.tsx src/pages/Onboarding.tsx src/pages/Settings.tsx
git commit -m "feat(frontend): onboarding domain over REST, drop Electron-only toggles"
```

---

### Task 8: `config`/`strategies`/`profiles` domain

**Files:**
- Create: `src/hooks/useConfig.ts`, `src/hooks/useStrategies.ts`, `src/hooks/useProfiles.ts`
- Test: matching `.test.ts` files
- Modify: files found in Step 1

**Interfaces:**
- Consumes: `/config`, `/strategies`, `/profiles/*` REST routes from Task 2.
- Produces: `useConfigQuery()`, `usePatchConfigMutation()`, `useReplaceConfigMutation()`, `useResetConfigMutation()`, `useStrategiesQuery()`, `useApplyStrategyMutation()`, `useProfilesQuery()`, `useSaveProfileMutation()`, `useApplyProfileMutation()`, `useRenameProfileMutation()`, `useDeleteProfileMutation()`, `useDuplicateProfileMutation()`, `useExportProfileMutation()`, `useImportProfileMutation()`.

- [ ] **Step 1: Find every current call site**

Run: `grep -rln "window\.krypt\.config\.\|window\.krypt\.profiles\." src` — expect at least `src/pages/Settings.tsx`, `src/pages/Profiles.tsx`, `src/pages/MainEngine.tsx`, `src/pages/CopyTrading.tsx`, `src/pages/Crypto15m.tsx`, `src/state/AppStateProvider.tsx`. Confirm the real list before Step 5.

- [ ] **Step 2: Write failing tests for `useConfig.ts` (pattern below applies identically to `useStrategies.ts`/`useProfiles.ts` — write all three test files before implementing any)**

```ts
// src/hooks/useConfig.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { useConfigQuery, usePatchConfigMutation } from './useConfig';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => queryClient.clear());

describe('useConfigQuery', () => {
  it('fetches /config', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enableTrading: false }) }));
    const { result } = renderHook(() => useConfigQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ enableTrading: false }));
  });
});

describe('usePatchConfigMutation', () => {
  it('PATCHes /config and invalidates the config query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enableTrading: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePatchConfigMutation(), { wrapper });
    await result.current.mutateAsync({ enableTrading: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/config',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enableTrading: true }) }),
    );
  });
});
```

Write the analogous pair for `useReplaceConfigMutation`/`PUT /config` and `useResetConfigMutation`/`POST /config/reset` in the same file, and for `useStrategiesQuery`/`GET /strategies` + `useApplyStrategyMutation`/`POST /strategies/{id}/apply` in `src/hooks/useStrategies.test.ts`, and for all eight profile operations in `src/hooks/useProfiles.test.ts` (list/save/apply/rename/delete/duplicate/export/import against their Task 2 routes).

- [ ] **Step 3: Run all three test files to verify they fail**

Run: `npm test -- useConfig useStrategies useProfiles`
Expected: FAIL — modules don't exist

- [ ] **Step 4: Implement the three hook files, following the `fetchJson` pattern from Task 7's `useOnboarding.ts` (reuse that helper — move it to `src/lib/api.ts` if it isn't there already, don't redefine it a third time)**

```ts
// src/lib/api.ts (extracted from Task 7 if not already done)
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { credentials: 'include', ...init });
  if (!resp.ok) throw new Error(`${url} failed: ${resp.status}`);
  return resp.json();
}
```

```ts
// src/hooks/useConfig.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../lib/api';
import type { TraderConfig } from '../../shared/types';

export function useConfigQuery() {
  return useQuery({ queryKey: ['config'], queryFn: () => fetchJson<TraderConfig>('/config') });
}

export function usePatchConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<TraderConfig>) =>
      fetchJson<TraderConfig>('/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => qc.setQueryData(['config'], data),
  });
}

export function useReplaceConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: TraderConfig) =>
      fetchJson<TraderConfig>('/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      }),
    onSuccess: (data) => qc.setQueryData(['config'], data),
  });
}

export function useResetConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<TraderConfig>('/config/reset', { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(['config'], data),
  });
}
```

```ts
// src/hooks/useStrategies.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../lib/api';
import type { StrategyPreset, TraderConfig } from '../../shared/types';

export function useStrategiesQuery() {
  return useQuery({ queryKey: ['strategies'], queryFn: () => fetchJson<StrategyPreset[]>('/strategies') });
}

export function useApplyStrategyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchJson<TraderConfig>(`/strategies/${id}/apply`, { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(['config'], data),
  });
}
```

```ts
// src/hooks/useProfiles.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../lib/api';
import type { Profile, ProfileScope, TraderConfig } from '../../shared/types';

export function useProfilesQuery() {
  return useQuery({ queryKey: ['profiles'], queryFn: () => fetchJson<Profile[]>('/profiles') });
}

function useInvalidateProfiles() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['profiles'] });
}

export function useSaveProfileMutation() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; scope: ProfileScope }) =>
      fetchJson<Profile>('/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useApplyProfileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchJson<TraderConfig>(`/profiles/${id}/apply`, { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(['config'], data),
  });
}

export function useRenameProfileMutation() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      fetchJson<Profile>(`/profiles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteProfileMutation() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (id: string) => fetchJson(`/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useDuplicateProfileMutation() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (id: string) => fetchJson<Profile>(`/profiles/${id}/duplicate`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useExportProfileMutation() {
  return useMutation({
    mutationFn: (id: string) => fetchJson<{ json: string }>(`/profiles/${id}/export`),
  });
}

export function useImportProfileMutation() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (json: string) =>
      fetchJson<Profile>('/profiles/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json }),
      }),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- useConfig useStrategies useProfiles`
Expected: PASS

- [ ] **Step 6: Rewire every file found in Step 1**

For each call site: `window.krypt.config.get()` reads → `useConfigQuery().data`; `window.krypt.config.update(patch)` → `usePatchConfigMutation().mutateAsync(patch)`; `window.krypt.config.replace(cfg)` → `useReplaceConfigMutation()`; `window.krypt.config.reset()` → `useResetConfigMutation()`; `window.krypt.config.listStrategies()` → `useStrategiesQuery().data`; `window.krypt.config.applyStrategy(id)` → `useApplyStrategyMutation()`; each `window.krypt.profiles.X(...)` → the matching hook above. Since these pages currently read config via the shared `AppStateProvider` context, also remove `config`/`customProfiles` from that provider's state once every reader has switched to the new hooks (grep again after editing: `grep -rn "window\.krypt\.config\.\|window\.krypt\.profiles\." src` must return nothing).

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: success

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useConfig.ts src/hooks/useStrategies.ts src/hooks/useProfiles.ts src/hooks/*.test.ts src/lib/api.ts src/pages/Settings.tsx src/pages/Profiles.tsx src/pages/MainEngine.tsx src/pages/CopyTrading.tsx src/pages/Crypto15m.tsx src/state/AppStateProvider.tsx
git commit -m "feat(frontend): config/strategies/profiles domain over REST"
```

---

### Task 9: `credentials` domain

**Files:**
- Create: `src/hooks/useCredentials.ts`
- Test: `src/hooks/useCredentials.test.ts`
- Modify: files found in Step 1 (expect `src/pages/ApiKeys.tsx` at minimum)

**Interfaces:**
- Consumes: `useWsClient()` from Task 5 (these go over WS RPC, not REST — `credentialStatus`, `setCredentials`, `testCredentials`, `clearCredentials` are worker methods, not webserver routes).
- Produces: `useCredentialsStatusQuery()`, `useCredentialsStatusAllQuery()`, `useSaveCredentialsMutation()`, `useTestCredentialsMutation()`, `useClearCredentialsMutation()`.

- [ ] **Step 1: Find every current call site**

Run: `grep -rln "window\.krypt\.credentials\." src`

- [ ] **Step 2: Write failing tests**

```ts
// src/hooks/useCredentials.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest } from './testUtils'; // see Step 3
import { useCredentialsStatusQuery, useSaveCredentialsMutation } from './useCredentials';

beforeEach(() => queryClient.clear());

describe('useCredentialsStatusQuery', () => {
  it('calls credentialStatus over the WS client', async () => {
    const request = vi.fn().mockResolvedValue({ mainnet: { hasWalletKey: true } });
    const { result } = renderHook(() => useCredentialsStatusQuery(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <WsContextForTest request={request}>{children}</WsContextForTest>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.data).toEqual({ mainnet: { hasWalletKey: true } }));
    expect(request).toHaveBeenCalledWith('credentialStatus', {});
  });
});

describe('useSaveCredentialsMutation', () => {
  it('surfaces the Phase-1-disabled rejection as a mutation error', async () => {
    const request = vi.fn().mockRejectedValue(new Error('setCredentials is not available yet'));
    const { result } = renderHook(() => useSaveCredentialsMutation(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <WsContextForTest request={request}>{children}</WsContextForTest>
        </QueryClientProvider>
      ),
    });
    await expect(
      result.current.mutateAsync({ env: 'mainnet', walletKey: 'x' } as any),
    ).rejects.toThrow('not available yet');
  });
});
```

- [ ] **Step 3: Create the shared test helper `src/hooks/testUtils.tsx`**

Every WS-backed hook test in this and later tasks needs a fake `WsClient` in context — write this helper once, reuse it everywhere (do not redefine an inline WS context mock per test file from here on):

```tsx
// src/hooks/testUtils.tsx
import { createContext, useContext } from 'react';

const FakeWsContext = createContext<{ request: (m: string, p?: unknown) => Promise<unknown> } | null>(
  null,
);

export function WsContextForTest({
  request,
  children,
}: {
  request: (method: string, params?: unknown) => Promise<unknown>;
  children: React.ReactNode;
}) {
  return <FakeWsContext.Provider value={{ request }}>{children}</FakeWsContext.Provider>;
}

export function useFakeWsClient() {
  const ctx = useContext(FakeWsContext);
  if (!ctx) throw new Error('wrap with WsContextForTest');
  return ctx;
}
```

Then update `src/state/WsProvider.tsx`'s `useWsClient` export so it's the single source every hook imports — in test files, mock the module: `vi.mock('../state/WsProvider', () => ({ useWsClient: () => useFakeWsClient() }))` at the top of each hook test file that needs it (add this mock line to `useCredentials.test.ts` above, and to every later WS-hook test file in this Stage).

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- useCredentials`
Expected: FAIL — module doesn't exist

- [ ] **Step 5: Implement `src/hooks/useCredentials.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWsClient } from '../state/WsProvider';
import type { CredentialsInput, CredentialsState } from '../../shared/types';

export function useCredentialsStatusQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['credentialsStatus'],
    queryFn: () => client.request<CredentialsState>('credentialStatus', {}),
  });
}

export function useCredentialsStatusAllQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['credentialsStatusAll'],
    queryFn: () => client.request('credentialStatus', {}),
  });
}

export function useSaveCredentialsMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CredentialsInput) => client.request('setCredentials', input as unknown as Record<string, unknown>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentialsStatus'] });
      qc.invalidateQueries({ queryKey: ['credentialsStatusAll'] });
    },
  });
}

export function useTestCredentialsMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (env?: string) => client.request('testCredentials', env ? { env } : {}),
  });
}

export function useClearCredentialsMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (env?: string) => client.request('clearCredentials', env ? { env } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentialsStatus'] });
      qc.invalidateQueries({ queryKey: ['credentialsStatusAll'] });
    },
  });
}
```

Also route the `credentials:changed` push-event (already mapped in `WsProvider`'s `EVENT_QUERY_KEYS` from Task 5) so it invalidates `['credentialsStatus']`/`['credentialsStatusAll']` rather than just overwriting `['credentialsStatus']` with raw event data — update `EVENT_QUERY_KEYS`'s handling for that one event to call `queryClient.invalidateQueries` instead of `setQueryData` (edit `src/state/WsProvider.tsx`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- useCredentials`
Expected: PASS

- [ ] **Step 7: Rewire `src/pages/ApiKeys.tsx` (and any other file from Step 1)**

Replace each `window.krypt.credentials.*` call with the matching hook. The UI must surface the Phase-1-disabled error text verbatim from the mutation's `error.message` (already what the worker/gateway sends) rather than a generic "failed" message — this is how users learn credentials aren't live yet.

- [ ] **Step 8: Verify build**

Run: `npm run build`

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useCredentials.ts src/hooks/useCredentials.test.ts src/hooks/testUtils.tsx src/state/WsProvider.tsx src/pages/ApiKeys.tsx
git commit -m "feat(frontend): credentials domain over WS RPC"
```

---

### Task 10: `trading`/`backend` domain

**Files:**
- Create: `src/hooks/useTrading.ts`
- Test: `src/hooks/useTrading.test.ts`
- Modify: files found in Step 1

**Interfaces:**
- Consumes: `useWsClient()`, `usePatchConfigMutation()` (Task 8 — `trading.setEnabled` is a config patch, not a worker RPC method, per `electron/ipc.ts`'s `trading:setEnabled` handler).
- Produces: `useTradingStatusQuery()`, `useCancelAllOpenMutation()`, `useFlattenMutation()`, `useSetTradingEnabledMutation()`, `useRunOnceMutation()`, `useBackendConnectionStatus()` (derived from `useWsClient().connected`, replacing `backend.info`/`onInfo` — Supervisor manages worker lifecycle automatically now, there is no user-facing start/stop/restart).

- [ ] **Step 1: Find every current call site**

Run: `grep -rln "window\.krypt\.trading\.\|window\.krypt\.backend\." src`

- [ ] **Step 2: Write failing tests**

```ts
// src/hooks/useTrading.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest } from './testUtils';
import { useTradingStatusQuery, useCancelAllOpenMutation, useFlattenMutation, useRunOnceMutation } from './useTrading';

vi.mock('../state/WsProvider', async () => {
  const { useFakeWsClient } = await import('./testUtils');
  return { useWsClient: () => useFakeWsClient() };
});

beforeEach(() => queryClient.clear());

function wrap(request: (m: string, p?: unknown) => Promise<unknown>) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WsContextForTest request={request}>{children}</WsContextForTest>
    </QueryClientProvider>
  );
}

describe('useTradingStatusQuery', () => {
  it('calls tradingStatus', async () => {
    const request = vi.fn().mockResolvedValue({ open: 2 });
    const { result } = renderHook(() => useTradingStatusQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ open: 2 }));
    expect(request).toHaveBeenCalledWith('tradingStatus', {});
  });
});

describe('useCancelAllOpenMutation', () => {
  it('calls cancelAllOpen', async () => {
    const request = vi.fn().mockResolvedValue({ canceled: 3 });
    const { result } = renderHook(() => useCancelAllOpenMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync();
    expect(request).toHaveBeenCalledWith('cancelAllOpen', {});
  });
});

describe('useFlattenMutation', () => {
  it('calls flatten', async () => {
    const request = vi.fn().mockResolvedValue({ closed: 1 });
    const { result } = renderHook(() => useFlattenMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync();
    expect(request).toHaveBeenCalledWith('flatten', {});
  });
});

describe('useRunOnceMutation', () => {
  it('calls runOnce with the action', async () => {
    const request = vi.fn().mockResolvedValue({ summary: 'done' });
    const { result } = renderHook(() => useRunOnceMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync('scan');
    expect(request).toHaveBeenCalledWith('runOnce', { action: 'scan' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- useTrading`
Expected: FAIL

- [ ] **Step 4: Implement `src/hooks/useTrading.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWsClient } from '../state/WsProvider';
import { usePatchConfigMutation } from './useConfig';

export function useTradingStatusQuery() {
  const client = useWsClient();
  return useQuery({ queryKey: ['tradingStatus'], queryFn: () => client.request('tradingStatus', {}) });
}

export function useCancelAllOpenMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request('cancelAllOpen', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['positions'] }),
  });
}

export function useFlattenMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request('flatten', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['positions'] }),
  });
}

export function useSetTradingEnabledMutation() {
  const patch = usePatchConfigMutation();
  return { ...patch, mutateAsync: (enabled: boolean) => patch.mutateAsync({ enableTrading: enabled }) };
}

export function useRunOnceMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (action: string) => client.request('runOnce', { action }),
  });
}

export function useBackendConnectionStatus(): boolean {
  const client = useWsClient();
  return client.connected;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- useTrading`
Expected: PASS

- [ ] **Step 6: Rewire call sites found in Step 1**

`window.krypt.trading.setEnabled(v)` → `useSetTradingEnabledMutation()`; `.cancelAllOpen()`/`.flatten()`/`.status()` → matching hooks above. `window.krypt.backend.info()`/`.onInfo()` → `useBackendConnectionStatus()` (a boolean is enough — there is no separate PID/uptime to show once Supervisor owns the process; if a page displayed PID/uptime, drop that specific UI element, don't fake data for it). `window.krypt.backend.start()/.stop()/.restart()` → remove the buttons entirely (Supervisor auto-manages worker lifecycle; there is nothing left for a user action to do). `window.krypt.backend.runOnce(action)` → `useRunOnceMutation()`.

- [ ] **Step 7: Verify build**

Run: `npm run build`

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useTrading.ts src/hooks/useTrading.test.ts src/pages/Dashboard.tsx src/components/WhyNotTrading.tsx src/components/common.tsx
git commit -m "feat(frontend): trading/backend domain over WS RPC + config"
```

(Adjust the `git add` file list to whatever Step 1's grep actually found — don't add files that turned out not to reference these namespaces.)

---

### Task 11: `data` domain (account/positions/signals/pnl/botRuns) + `AppStateProvider` retirement

**Files:**
- Create: `src/hooks/useAccountData.ts`
- Test: `src/hooks/useAccountData.test.ts`
- Modify: `src/state/AppStateProvider.tsx` (final removal), every file found in Step 1, `webserver/config_store.py`, `webserver/main.py`, `src/hooks/useProfiles.ts`, `src/pages/Profiles.tsx` (Task 8 gap fix — see below)
- Test: `webserver/tests/test_config_store.py`, `webserver/tests/test_main_config_routes.py`, `src/hooks/useProfiles.test.ts` (Task 8 gap fix)

**Interfaces:**
- Consumes: `useWsClient()`; push-events `account:update`, `position:new`, `position:update`, `signal:new` already routed by `WsProvider` (Task 5) into `['account']`/`['positions']`/`['signals']` cache keys.
- Produces: `useAccountQuery()`, `usePnlSeriesQuery(sinceHours?)`, `usePositionsQuery(filter?)`, `useSignalsQuery(filter?)`, `useScannerStatsQuery()`, `useBotRunsQuery(env?, limit?)`.

**Carried-forward gap from Task 8 (ruled and parked, fix due here):** `webserver/config_store.py` tracks `activeProfileId`/`activeCryptoProfileId`/`activeCopyProfileId` per user (set by `apply_strategy`/`apply_profile`), but no REST route ever returns them — `GET /config` returns only the config dict. Task 8 rewired `src/pages/Profiles.tsx`'s profile mutations onto the REST hooks, but its "Active" badge (`activeFor()`) still reads `activeProfileId`/etc. off `AppStateProvider`'s Electron-IPC-backed `state`, which nothing updates anymore — the badge is now permanently frozen (display-only staleness, confirmed no data loss: the actual applied config is correct, only the profile-page's checkmark is wrong). Fix as part of this task's `AppStateProvider` retirement:
1. Add `active_profile_ids(user_id) -> dict` to `webserver/config_store.py` returning `{"main": ..., "crypto": ..., "copy": ...}` from the same state file `get_config`/`apply_profile` already read/write (`activeProfileId`/`activeCryptoProfileId`/`activeCopyProfileId` — reuse those exact keys internally, just expose them).
2. Add `GET /profiles/active` to `webserver/main.py` (same `require_wallet_address` pattern as every other route in this domain) returning that dict.
3. Add `useActiveProfilesQuery()` to `src/hooks/useProfiles.ts` (`{queryKey: ['activeProfiles'], queryFn: () => fetchJson('/profiles/active')}`), and invalidate `['activeProfiles']` alongside `['config']` in `useApplyProfileMutation`'s `onSuccess` (`src/hooks/useProfiles.ts`, Task 8).
4. Update `Profiles.tsx`'s `activeFor()` to read from `useActiveProfilesQuery().data` instead of `AppStateProvider`'s `state.active*ProfileId`.
Write backend tests for `active_profile_ids`/`GET /profiles/active` and a frontend test for `useActiveProfilesQuery()` following this plan's established TDD pattern for each layer.

- [ ] **Step 1: Find every current call site**

Run: `grep -rln "window\.krypt\.data\.\|AppStateProvider" src` — this is the biggest domain; expect `src/state/AppStateProvider.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Positions.tsx`, `src/pages/History.tsx`, and possibly `src/components/Sidebar.tsx`.

- [ ] **Step 2: Write failing tests**

```ts
// src/hooks/useAccountData.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest } from './testUtils';
import { useAccountQuery, usePositionsQuery, useSignalsQuery, usePnlSeriesQuery, useBotRunsQuery } from './useAccountData';

vi.mock('../state/WsProvider', async () => {
  const { useFakeWsClient } = await import('./testUtils');
  return { useWsClient: () => useFakeWsClient() };
});

beforeEach(() => queryClient.clear());

function wrap(request: (m: string, p?: unknown) => Promise<unknown>) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WsContextForTest request={request}>{children}</WsContextForTest>
    </QueryClientProvider>
  );
}

describe('useAccountQuery', () => {
  it('calls account', async () => {
    const request = vi.fn().mockResolvedValue({ equity: 100 });
    const { result } = renderHook(() => useAccountQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ equity: 100 }));
    expect(request).toHaveBeenCalledWith('account', {});
  });
});

describe('usePositionsQuery', () => {
  it('calls positions with the given filter', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => usePositionsQuery({ limit: 500 }), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('positions', { limit: 500 });
  });
});

describe('useSignalsQuery', () => {
  it('calls signals with the given filter', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useSignalsQuery({ limit: 300 }), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('signals', { limit: 300 });
  });
});

describe('usePnlSeriesQuery', () => {
  it('calls pnlSeries with sinceHours', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => usePnlSeriesQuery(24), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('pnlSeries', { sinceHours: 24 });
  });
});

describe('useBotRunsQuery', () => {
  it('calls botRuns with env and limit', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useBotRunsQuery('mainnet', 50), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('botRuns', { env: 'mainnet', limit: 50 });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- useAccountData`
Expected: FAIL

- [ ] **Step 4: Implement `src/hooks/useAccountData.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { useWsClient } from '../state/WsProvider';
import type { AccountSnapshot, BotPosition, PnlPoint, PositionFilter, ScannerStats, SignalFilter, SignalRow } from '../../shared/types';

export function useAccountQuery() {
  const client = useWsClient();
  return useQuery({ queryKey: ['account'], queryFn: () => client.request<AccountSnapshot>('account', {}) });
}

export function usePnlSeriesQuery(sinceHours?: number) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['pnlSeries', sinceHours ?? null],
    queryFn: () => client.request<PnlPoint[]>('pnlSeries', sinceHours != null ? { sinceHours } : {}),
  });
}

export function usePositionsQuery(filter?: PositionFilter) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['positions', filter ?? null],
    queryFn: () => client.request<BotPosition[]>('positions', (filter as Record<string, unknown>) ?? {}),
  });
}

export function useSignalsQuery(filter?: SignalFilter) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['signals', filter ?? null],
    queryFn: () => client.request<SignalRow[]>('signals', (filter as Record<string, unknown>) ?? {}),
  });
}

export function useScannerStatsQuery() {
  const client = useWsClient();
  return useQuery({ queryKey: ['scannerStats'], queryFn: () => client.request<ScannerStats>('scannerStats', {}) });
}

export function useBotRunsQuery(env?: string, limit?: number) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['botRuns', env ?? null, limit ?? null],
    queryFn: () => client.request('botRuns', { env: env ?? null, limit }),
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- useAccountData`
Expected: PASS

- [ ] **Step 6: Rewire every call site, then delete `src/state/AppStateProvider.tsx`**

By this task, every field `AppStateProvider` used to own (`state`, `config`, `customProfiles`, `account`, `positions`, `signals`, `scannerStats`, `credentials`, `backend info`) has a replacement hook from Tasks 7-11. Grep for any remaining consumer of the provider's context (`grep -rn "useAppState\|AppStateProvider" src` — use whatever hook name the provider actually exports, confirm via reading the file) and switch each to the domain hook that now owns that data. Once nothing imports it, delete `src/state/AppStateProvider.tsx` and remove its `<AppStateProvider>` wrapper from `src/main.tsx`/`App.tsx`.

- [ ] **Step 7: Verify build**

Run: `npm run build`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(frontend): data domain over WS RPC, retire AppStateProvider"
```

---

### Task 12: `crypto15m` domain

**Files:**
- Create: `src/hooks/useCrypto15m.ts`
- Test: `src/hooks/useCrypto15m.test.ts`
- Modify: files found in Step 1 (expect `src/pages/Crypto15m.tsx`, `src/pages/Backtest.tsx`, `src/components/BacktestPanel.tsx`)

**Interfaces:**
- Consumes: `useWsClient()`.
- Produces: `useCrypto15mSnapshotQuery()` (RPC `crypto15m`), `useCrypto15mStatusQuery()` (RPC `crypto15mStatus`), `useCrypto15mHistoryQuery(opts?)` (RPC `c15History`), `useCrypto15mBacktestMutation()` (RPC `c15Backtest`), `useMainBacktestMutation()` (RPC `mainBacktest`), `useCrypto15mParlayGenerateMutation()` (RPC `c15ParlayGenerate`), `useCrypto15mParlayStatusQuery()` (RPC `c15ParlayStatus`), `useCrypto15mParlayArmMutation()` (RPC `c15ParlayArm`).

- [ ] **Step 1: Find every current call site**

Run: `grep -rln "window\.krypt\.crypto15m\." src`

- [ ] **Step 2: Write failing tests** (same shape as Task 10/11 — one `describe` block per hook, asserting `request` was called with the exact RPC method name from the Interfaces list above; write all eight before implementing, following the `wrap()`/`WsContextForTest` pattern already established)

Run: `npm test -- useCrypto15m`
Expected: FAIL

- [ ] **Step 3: Implement `src/hooks/useCrypto15m.ts`** using the same `useQuery`/`useMutation` + `client.request(METHOD, params)` pattern as `useAccountData.ts` (Task 11) and `useTrading.ts` (Task 10) — one function per RPC method listed in Interfaces, params passed through as given by the caller, no transformation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- useCrypto15m`
Expected: PASS

- [ ] **Step 5: Rewire call sites found in Step 1.** Also route the `crypto15m:autoOff` push-event (Task 5 already put it at `['crypto15mAutoOff']`) into whichever component previously used `window.krypt.crypto15m.onAutoOff(cb)` — replace the callback subscription with `useQuery({queryKey: ['crypto15mAutoOff'], enabled: false})`'s `data` (read-only cache subscription; `enabled: false` because this key is only ever written by the push-event, never fetched) or a plain `useQueryClient().getQueryData` + a `useEffect` subscription via `queryClient.getQueryCache().subscribe(...)` if the component needs a one-shot toast on change rather than persistent state — pick whichever this specific component's current `onAutoOff` callback body needs (read it before choosing).

- [ ] **Step 6: Verify build**

Run: `npm run build`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(frontend): crypto15m domain over WS RPC"
```

---

### Task 13: `scripts` domain

**Files:**
- Create: `src/hooks/useScripts.ts`
- Test: `src/hooks/useScripts.test.ts`
- Modify: `src/pages/Scripts.tsx` (confirm via Step 1)

**Interfaces:**
- Consumes: `useWsClient()`.
- Produces one hook per RPC method: `useScriptsListQuery()` (`scriptsList`), `useSaveScriptMutation()` (`scriptSave`), `useDeleteScriptMutation()` (`scriptDelete`), `useSetScriptEnabledMutation()` (`scriptSetEnabled`), `useSetScriptAssetsMutation()` (`scriptSetAssets`), `useSetScriptDryRunMutation()` (`scriptSetDryRun`), `useScriptShadowOrdersQuery(id, limit?)` (`scriptShadowOrders`), `useValidateScriptMutation()` (`scriptValidate`), `useScriptBacktestMutation()` (`scriptBacktest`), `useScriptContextPackQuery()` (`scriptContextPack`), `useScriptApiDocsQuery()` (`scriptApiDocs`).

- [ ] **Step 1: Find every current call site**

Run: `grep -rln "window\.krypt\.scripts\." src`

Note: `scripts.exportFile`/`scripts.importFile` are Electron file-dialog calls (`dialog.showSaveDialog`/`showOpenDialog` under the hood) with no RPC backing — in the browser these become a plain `<a download>`/`Blob` URL for export and an `<input type="file">` for import, client-side only, no hook needed. `scripts.exportPack` — grep `electron/ipc.ts` for its handler body before assuming it maps to an RPC method; if it doesn't exist in the verified `_HANDLERS` list at the top of this plan, treat it the same as exportFile (client-side blob download of whatever `scriptContextPack`/`scriptApiDocs` already returns).

- [ ] **Step 2: Write failing tests** for each RPC-backed hook (same pattern as Task 12) plus one for the client-side export helper:

```ts
// (within src/hooks/useScripts.test.ts)
import { downloadScriptFile } from './useScripts';

describe('downloadScriptFile', () => {
  it('creates and clicks a download link with the given filename and code', () => {
    const clickSpy = vi.fn();
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      click: clickSpy,
      set href(v: string) {},
      set download(v: string) {},
    } as unknown as HTMLAnchorElement);
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:x'), revokeObjectURL: vi.fn() });
    downloadScriptFile('my-script.py', 'print(1)');
    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(clickSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- useScripts`
Expected: FAIL

- [ ] **Step 4: Implement `src/hooks/useScripts.ts`** — RPC-backed hooks follow the established `client.request(METHOD, params)` pattern; add:

```ts
export function downloadScriptFile(filename: string, code: string): void {
  const blob = new Blob([code], { type: 'text/x-python' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readScriptFile(): Promise<{ name: string; code: string }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.py';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('no file selected'));
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, code: String(reader.result) });
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    };
    input.click();
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- useScripts`
Expected: PASS

- [ ] **Step 6: Rewire `src/pages/Scripts.tsx`.** `window.krypt.scripts.onStatus(cb)`/`.onLog(cb)` are push-events not yet in `WsProvider`'s `EVENT_QUERY_KEYS` — add `'scripts:status'` → `['scriptsStatus']` and `'scripts:log'` → append-to-array-at-`['scriptsLog']` handling to `src/state/WsProvider.tsx` (grep `python/service.py` for `emit_event\("scripts:` to confirm these are the actual event names the worker emits — the plan's verified event list above didn't include them because the earlier grep search targeted a different line range; confirm before wiring).

- [ ] **Step 7: Verify build**

Run: `npm run build`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(frontend): scripts domain over WS RPC + client-side file I/O"
```

---

### Task 14: `copy`, `polymarket`, `logs` domains

**Files:**
- Create: `src/hooks/useCopyTrading.ts`, `src/hooks/usePolymarket.ts`, `src/hooks/useLogs.ts`
- Test: matching `.test.ts` files
- Modify: files found in Step 1

**Interfaces:**
- `useCopyStatusQuery()` — RPC `copyStatus`.
- `useMarketUrlMutation()` — RPC `polymarketUrl`.
- No `logs` hook is produced this task — see the ruling below.

**Ruling (pre-flight, recorded in the SDD ledger before this task was dispatched):** `logs.tail`/`logs.onAppend`/`logs.clear`/`logs.openFolder` have **no backing RPC method** in the verified `_HANDLERS` list — they were Electron main-process reads of a local log file (`electron/ipc.ts`'s `logs:*` handlers), and the worker's stdout/stderr aren't captured anywhere the gateway can read today. Building that capture path is new backend scope (a `Supervisor` ring-buffer + log-streaming surface) beyond this plan. **Decision: drop the in-app Logs page this phase, same as tray/autostart/Discord-RPC-native** (spec's already-accepted category of Electron-only regressions). Do not write a `useLogs.ts` file and do not add a logs backend. If `src/pages/Logs.tsx` exists as a route, delete the route and the page file in Step 4 below; if `Terminal.tsx` renders log tail as a secondary feature (not its main purpose), remove only that section, not the whole page — check its content before deciding.

- [ ] **Step 1: Find every current call site**

Run: `grep -rln "window\.krypt\.copy\.\|window\.krypt\.polymarket\.\|window\.krypt\.logs\." src`

- [ ] **Step 2: Write failing tests for `copy` and `polymarket`** (same `client.request` pattern as prior tasks):

```ts
// src/hooks/useCopyTrading.test.ts — asserts request called with ('copyStatus', {})
// src/hooks/usePolymarket.test.ts — asserts request called with ('polymarketUrl', {eventTicker, ticker, env})
```

- [ ] **Step 3: Run tests to verify they fail, then implement, following the established pattern**

```ts
// src/hooks/useCopyTrading.ts
import { useQuery } from '@tanstack/react-query';
import { useWsClient } from '../state/WsProvider';

export function useCopyStatusQuery() {
  const client = useWsClient();
  return useQuery({ queryKey: ['copyStatus'], queryFn: () => client.request('copyStatus', {}) });
}
```

```ts
// src/hooks/usePolymarket.ts
import { useMutation } from '@tanstack/react-query';
import { useWsClient } from '../state/WsProvider';

export function useMarketUrlMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (args: { eventTicker: string; ticker: string; env?: string }) =>
      client.request<{ url: string }>('polymarketUrl', args),
  });
}
```

Run: `npm test -- useCopyTrading usePolymarket`
Expected: PASS after implementation

- [ ] **Step 4: Rewire `src/pages/CopyTrading.tsx`, `src/utils/polymarket.ts`, `src/utils/share.ts`** (whichever Step 1 found for `copy`/`polymarket`). Separately, per the ruling above: find and remove every `window.krypt.logs.*` call site — read the file it's in first (likely `src/pages/Logs.tsx` and/or `src/pages/Terminal.tsx`) and delete the page/route if logs were its sole purpose, or just the log-tail section if it was secondary to something else that stays.

- [ ] **Step 5: Verify build**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCopyTrading.ts src/hooks/usePolymarket.ts src/hooks/*.test.ts src/pages/CopyTrading.tsx src/utils/polymarket.ts src/utils/share.ts
git commit -m "feat(frontend): copy-trading + polymarket-url domains over WS RPC"
```

---

### Task 15: Session-key React pages (replace `signer.html`)

**Files:**
- Create: `src/pages/SessionKey.tsx`, `src/hooks/useSessionKey.ts`
- Test: `src/hooks/useSessionKey.test.ts`
- Modify: `src/App.tsx` (add route), delete `webserver/static/signer.html`

**Interfaces:**
- Consumes: `connectWallet()`/EIP-712 signing pattern from Task 6's `src/lib/wallet.ts` (extend it with a `signTypedData` export mirroring `signer.html`'s `eth_signTypedData_v4` calls); REST routes `/session-key/init`, `/session-key/activate`, `/session-key/revoke` (Fase 2b, unchanged).
- Produces: `useMintSessionKeyMutation()`, `useActivateSessionKeyMutation()`, `useRevokeSessionKeyMutation()`.

- [ ] **Step 1: Read `webserver/static/signer.html` fully** (the session-key section, roughly lines 150-260 per the earlier grep) to port its exact request/response shapes for `/session-key/init` and `/session-key/activate` — field names must match exactly, this is a port not a redesign.

- [ ] **Step 2: Add `signTypedData` to `src/lib/wallet.ts`, with a failing test first**

```ts
// appended to src/lib/wallet.test.ts
describe('signTypedData', () => {
  it('calls eth_signTypedData_v4 with the address and JSON-stringified data', async () => {
    const request = vi.fn().mockResolvedValue('0xsig');
    vi.stubGlobal('ethereum', { request, selectedAddress: '0xAAA' });
    const sig = await signTypedData('0xAAA', { domain: {}, types: {}, message: {} });
    expect(sig).toBe('0xsig');
    expect(request).toHaveBeenCalledWith({
      method: 'eth_signTypedData_v4',
      params: ['0xAAA', JSON.stringify({ domain: {}, types: {}, message: {} })],
    });
  });
});
```

Run: `npm test -- wallet.test` → FAIL, then add to `src/lib/wallet.ts`:

```ts
export async function signTypedData(address: string, typedData: unknown): Promise<string> {
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!eth) throw new Error('window.ethereum not found');
  return (await eth.request({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify(typedData)],
  })) as string;
}
```

Run: `npm test -- wallet.test` → PASS

- [ ] **Step 3: Write failing tests for `useSessionKey.ts`**

```ts
// src/hooks/useSessionKey.test.ts
import { renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { useMintSessionKeyMutation, useRevokeSessionKeyMutation } from './useSessionKey';

beforeEach(() => queryClient.clear());

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useMintSessionKeyMutation', () => {
  it('POSTs /session-key/init', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enableTypedData: {} }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useMintSessionKeyMutation(), { wrapper });
    await result.current.mutateAsync({ dailyUsdCap: 100 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/session-key/init',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ dailyUsdCap: 100 }) }),
    );
  });
});

describe('useRevokeSessionKeyMutation', () => {
  it('POSTs /session-key/revoke', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRevokeSessionKeyMutation(), { wrapper });
    await result.current.mutateAsync();
    expect(fetchMock).toHaveBeenCalledWith('/session-key/revoke', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- useSessionKey`
Expected: FAIL

- [ ] **Step 5: Implement `src/hooks/useSessionKey.ts`**, matching the exact request/response field names read in Step 1 (`dailyUsdCap`, `enableTypedData`, whatever `/session-key/activate` expects as its signature field, etc. — do not guess, use what Step 1 found):

```ts
import { useMutation } from '@tanstack/react-query';
import { fetchJson } from '../lib/api';

export function useMintSessionKeyMutation() {
  return useMutation({
    mutationFn: (input: { dailyUsdCap: number }) =>
      fetchJson('/session-key/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  });
}

export function useActivateSessionKeyMutation() {
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      fetchJson('/session-key/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  });
}

export function useRevokeSessionKeyMutation() {
  return useMutation({
    mutationFn: () => fetchJson('/session-key/revoke', { method: 'POST' }),
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- useSessionKey`
Expected: PASS

- [ ] **Step 7: Build `src/pages/SessionKey.tsx`**, porting `signer.html`'s UI flow (mint → sign with `signTypedData` → activate → show status; revoke button) into a React page using the hooks above plus `connectWallet`/`signTypedData` from `src/lib/wallet.ts`. Add a route for it in `src/App.tsx` (read the file first to match its existing routing pattern — react-router or a hand-rolled switch, follow what's there).

- [ ] **Step 8: Delete `webserver/static/signer.html`** and any route in `webserver/main.py` that serves it as a static test harness (grep: `grep -n "signer.html\|StaticFiles" webserver/main.py`).

- [ ] **Step 9: Verify build**

Run: `npm run build`

- [ ] **Step 10: Commit**

```bash
git add src/pages/SessionKey.tsx src/hooks/useSessionKey.ts src/hooks/useSessionKey.test.ts src/lib/wallet.ts src/lib/wallet.test.ts src/App.tsx
git rm webserver/static/signer.html
git commit -m "feat(frontend): session-key mint/activate/revoke page, retire signer.html"
```

---

### Task 16: `app.*` utilities + `accounts.*` (multi-wallet UI) + window chrome removal

**Files:**
- Create: `src/hooks/useAccounts.ts`
- Test: `src/hooks/useAccounts.test.ts`
- Modify: `src/pages/About.tsx`, `src/pages/Guide.tsx`, `src/pages/Accounts.tsx`, `src/components/Sidebar.tsx`, `src/components/TitleBar.tsx`

**Interfaces:**
- Produces: `useSessionQuery()` (`GET /auth/session` from Task 1), `useSwitchWalletMutation()` (`POST /auth/switch`), `useAddWalletMutation()` (triggers the Task 6 `connectWallet`+`signSiwe` flow again, which Task 1's `/auth/verify` now treats as "add to session" when a cookie already exists).

- [ ] **Step 1: Find every current call site**

Run: `grep -rln "window\.krypt\.app\.\|window\.krypt\.accounts\.\|window\.krypt\.window\." src`

- [ ] **Step 2: Write failing tests for `useAccounts.ts`**

```ts
// src/hooks/useAccounts.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { useSessionQuery, useSwitchWalletMutation } from './useAccounts';

beforeEach(() => queryClient.clear());

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSessionQuery', () => {
  it('fetches /auth/session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ wallets: ['0xAAA'], active: '0xAAA' }) }),
    );
    const { result } = renderHook(() => useSessionQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ wallets: ['0xAAA'], active: '0xAAA' }));
  });
});

describe('useSwitchWalletMutation', () => {
  it('POSTs /auth/switch with the address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ address: '0xBBB' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSwitchWalletMutation(), { wrapper });
    await result.current.mutateAsync('0xBBB');
    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/switch',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ address: '0xBBB' }) }),
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail, then implement**

Run: `npm test -- useAccounts` → FAIL, then:

```ts
// src/hooks/useAccounts.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../lib/api';
import { connectWallet, signSiwe } from '../lib/wallet';

export function useSessionQuery() {
  return useQuery({ queryKey: ['session'], queryFn: () => fetchJson<{ wallets: string[]; active: string }>('/auth/session') });
}

export function useSwitchWalletMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (address: string) =>
      fetchJson('/auth/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session'] }),
  });
}

export function useAddWalletMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const address = await connectWallet();
      const { nonce } = await fetchJson<{ nonce: string }>('/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const { message, signature } = await signSiwe(nonce, address);
      return fetchJson('/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session'] }),
  });
}
```

Run: `npm test -- useAccounts` → PASS

- [ ] **Step 4: Rewire `src/pages/Accounts.tsx`**: `window.krypt.accounts.current()` → `useSessionQuery().data?.active`; `.list()` → `.data?.wallets`; `.create(name)` → `useAddWalletMutation()` (the `name` parameter from the old local-profile model has no equivalent — a wallet is identified by its address now, drop the naming UI); `.launch(name)` → `useSwitchWalletMutation()`.

- [ ] **Step 5: Rewire `src/pages/About.tsx`/`src/pages/Guide.tsx`**: `window.krypt.app.version()` → hardcode or read from `import.meta.env.VITE_APP_VERSION` (set via Vite's `define`, sourced from `package.json`'s `version` field at build time — add this to `vite.config.ts` if not already present); `.openExternal(url)` → plain `window.open(url, '_blank', 'noopener,noreferrer')`; `.showItemInFolder`/`.getUserDataPath` → remove (no browser equivalent, desktop-only); `.factoryReset()`/`.clearHistory()` — these delete local Electron-stored data; if any page exposes them, drop the button (no equivalent "local data" exists in the browser now that everything is server-side) rather than silently no-op it.

- [ ] **Step 6: Remove window-chrome from `src/components/TitleBar.tsx`**: delete the minimize/maximize/close buttons and the `window.krypt.window.*` calls entirely — this component either becomes a plain header (title/logo only, if `Sidebar.tsx`/`App.tsx` still render something here) or is deleted outright if nothing else lives in it once the buttons are gone (check its JSX after removing the buttons before deciding).

- [ ] **Step 7: Verify build**

Run: `npm run build`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(frontend): multi-wallet accounts UI, drop Electron-only app/window chrome"
```

---

## Stage D — Electron removal

### Task 17: Delete Electron, clean up build config

**Files:**
- Delete: `electron/` (entire directory)
- Modify: `package.json`, `vite.config.ts`, `tsconfig.node.json` (if it references `electron/`)

**Interfaces:** none — this is pure deletion/config cleanup, gated on Stage C being complete.

- [ ] **Step 1: Confirm zero remaining `window.krypt` references**

Run: `grep -rn "window\.krypt" src`
Expected: no output. If anything remains, stop and go back to the Stage C task that owns that namespace — do not delete Electron while a call site still depends on it.

- [ ] **Step 2: Confirm zero remaining `shared/types.ts` `KryptApi`/global `Window` augmentation usage**

Run: `grep -rln "KryptApi\|declare global" src shared`
Remove the `KryptApi` interface and the `declare global { interface Window { krypt: KryptApi } }` block from `shared/types.ts` once nothing imports `KryptApi` (the domain hooks import concrete types like `TraderConfig`/`BotPosition` directly, not `KryptApi`).

- [ ] **Step 3: Delete `electron/`**

```bash
git rm -r electron
```

- [ ] **Step 4: Clean `package.json`**

Remove: `"main": "dist-electron/main.js"`, the `"dist"` script (`electron-builder`), the entire `"build"` key (electron-builder config), and these deps: `electron`, `electron-builder`, `vite-plugin-electron`, `vite-plugin-electron-renderer`, `discord-rpc`, `@types/discord-rpc`. Keep `"dev"`/`"build"`/`"typecheck"`/`"test"` scripts (they're Vite/tsc/vitest, not Electron-specific) but simplify `"predev"` if `scripts/setup-python.mjs` did anything Electron-specific (read it first: `grep -n "electron" scripts/setup-python.mjs`).

- [ ] **Step 5: Clean `vite.config.ts`**

Remove the `vite-plugin-electron`/`vite-plugin-electron-renderer` plugin entries and any `build.rollupOptions` targeting `electron/main.ts`/`electron/preload.ts` as entry points.

- [ ] **Step 6: Run `npm install` to prune removed deps from the lockfile**

```bash
npm install
```

- [ ] **Step 7: Full verification**

```bash
npm run typecheck
npm run build
npm test
```
Expected: all three succeed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove Electron entirely — webapp standalone"
```

---

### Task 18: `npm run dev` manual E2E smoke test

**Files:** none created — verification only.

- [ ] **Step 1: Start both servers**

```bash
cd webserver && python -m uvicorn main:app --reload &
npm run dev
```

- [ ] **Step 2: Open two browser profiles (or one normal + one incognito) pointed at the dev server**

In each: connect a different test wallet (MetaMask test accounts), complete SIWE login, confirm the dashboard loads live account/position/signal data over the WS connection (watch the Network tab's WS frames to confirm `{"type":"rpc",...}`/`{"type":"event",...}` traffic).

- [ ] **Step 3: Confirm isolation**

Verify wallet A's positions/config never appear in wallet B's session and vice versa (per-user `Supervisor` worker + per-user `config_store`/DB files).

- [ ] **Step 4: Confirm the multi-wallet flow**

In one session, use "Add wallet" (`useAddWalletMutation`) to link a second wallet without logging out; confirm `useSessionQuery()` now lists both and switching (`useSwitchWalletMutation`) changes which one's data loads.

- [ ] **Step 5: Confirm session-key flow**

Walk through mint → sign → activate → revoke on the new `SessionKey.tsx` page end-to-end (same manual E2E already proven for `signer.html` in Fase 2b, now through React).

- [ ] **Step 6: Record results in the plan's tracking issue/PR description** (no code change — this step is a manual gate before calling Fase 3 done, not a commit).

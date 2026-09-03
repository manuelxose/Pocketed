from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from webserver import aa, auth, config_store
from webserver.supervisor import Supervisor, WorkerStartError

logger = logging.getLogger("webserver.main")

SESSION_COOKIE_NAME = "kpb_session"

# APP_ENV gates how strict startup is. Production must always supply a real
# secret; anything else (unset, "development", "test", ...) gets a clearly
# labeled dev-only fallback so `npm run dev` works out of the box without
# ever weakening the production check below.
APP_ENV = os.environ.get("APP_ENV", "development")
_DEV_INSECURE_SESSION_SECRET = "dev-insecure-session-secret-do-not-use-in-prod"

SESSION_SECRET = os.environ.get("POCKETED_SESSION_SECRET")
if not SESSION_SECRET:
    if APP_ENV == "production":
        raise RuntimeError(
            "POCKETED_SESSION_SECRET must be set — refusing to sign "
            "sessions with a default secret."
        )
    logger.warning(
        "POCKETED_SESSION_SECRET not set — using an insecure development "
        "default. Set POCKETED_SESSION_SECRET (and APP_ENV=production) "
        "before deploying."
    )
    SESSION_SECRET = _DEV_INSECURE_SESSION_SECRET

DATA_ROOT = Path(
    os.environ.get(
        "POCKETED_WEBAPP_DATA",
        str(Path(__file__).resolve().parent.parent / "python" / "data" / "webapp"),
    )
)

# ERC-4337 (aa-service/bundler/paymaster) is optional infrastructure. The
# gateway, /ws, worker RPCs, config/profiles/onboarding and everything else
# must work without it. AA-specific routes below already call into
# `webserver.aa`, whose `_resolve_base_url` raises `AAServiceError` when this
# is unset — the routes map that to a 503, which is the correct behavior for
# "capability unavailable", not a reason to refuse to start the gateway.
AA_SERVICE_URL = os.environ.get(aa.AA_SERVICE_URL_ENV)
if not AA_SERVICE_URL:
    logger.warning(
        "%s not set — ERC-4337 routes (/aa/*, /session-key/*) will return "
        "503 until the aa-service sidecar is configured.",
        aa.AA_SERVICE_URL_ENV,
    )

# Fase 1 explicitly excludes order signing/execution (see spec). Any RPC
# method that touches credentials or live trading is refused at the
# gateway, before it ever reaches a worker.
_TRADING_METHODS_DISABLED_PHASE1 = {
    "setCredentials", "clearCredentials", "testCredentials",
    "cancelAllOpen", "flatten",
}

# --- Origin / CORS configuration ----------------------------------------
#
# In the normal deployment shape (dev: Vite proxies /auth,/ws,... to this
# process — see vite.config.ts; prod: this same FastAPI process serves the
# built dist/ — see the static-serving block at the bottom of this file)
# every request is same-origin, so no cross-origin allowance is needed and
# the default here is deliberately empty (CORSMiddleware below then denies
# cross-origin requests, matching the app's actual architecture). Set
# POCKETED_ALLOWED_ORIGINS (comma-separated, e.g.
# "https://app.pocketed.online") only for a deployment that genuinely serves
# the frontend from a different origin than this gateway.
_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("POCKETED_ALLOWED_ORIGINS", "").split(",") if o.strip()
]

# SIWE `domain` pinning (see webserver/auth.py's verify_siwe docstring).
# Defaults to "derive from this request's own Host header" — correct for
# the same-origin shapes above. Set POCKETED_SIWE_DOMAINS (comma-separated
# host[:port] values, no scheme) when a reverse proxy rewrites Host, or to
# accept sign-ins addressed to more than one public hostname.
_SIWE_DOMAINS_OVERRIDE = {
    d.strip() for d in os.environ.get("POCKETED_SIWE_DOMAINS", "").split(",") if d.strip()
}


def _expected_siwe_domain(request: Request) -> str:
    """The `domain` a SIWE message signed for *this* request must carry.

    Prefers the browser's own `Origin` header over `Host`: in local dev,
    Vite's proxy (vite.config.ts) forwards `/auth/*` to this gateway on a
    different port and — like most dev proxies — rewrites `Host` to the
    proxy target rather than preserving the page's real origin, so pinning
    against `Host` here would reject every real browser login in dev even
    though nothing suspicious happened. `Origin` isn't rewritten by the
    proxy and is exactly "the page that made this request", which is what
    SIWE's `domain` field is meant to pin against in the first place (see
    verify_siwe's docstring). Falls back to `Host` only when no Origin was
    sent (e.g. a same-site GET, or a non-browser caller).
    """
    origin = request.headers.get("origin")
    host = urlsplit(origin).netloc if origin else request.headers.get("host", "")
    if _SIWE_DOMAINS_OVERRIDE and host not in _SIWE_DOMAINS_OVERRIDE:
        # Host didn't match an explicit allowlist: keep the check meaningful
        # (fail closed) rather than silently falling back to trusting it.
        return next(iter(_SIWE_DOMAINS_OVERRIDE))
    return host


def _is_request_secure(request: Request) -> bool:
    """True if this request arrived over TLS, honoring a reverse proxy's
    X-Forwarded-Proto (Starlette's own `request.url.scheme` only reflects
    the proxy-to-gateway hop, which is typically plain HTTP behind a TLS
    terminator)."""
    forwarded = request.headers.get("x-forwarded-proto")
    if forwarded:
        return forwarded.split(",")[0].strip().lower() == "https"
    return request.url.scheme == "https"


def _set_session_cookie(resp: JSONResponse, token: str, *, secure: bool) -> None:
    resp.set_cookie(
        SESSION_COOKIE_NAME, token,
        httponly=True, secure=secure, samesite="lax", path="/",
        max_age=auth.SESSION_TTL_SECONDS,
    )


# Test-only override so E2E/integration runs can point every new worker at a
# deterministic fixture (e.g. webserver/tests/fixtures/dummy_worker.py)
# instead of spawning the real python/service.py trading engine. Unset in
# every real deployment, where this is a no-op and Supervisor uses its own
# default (python/service.py) exactly as before.
_WORKER_SCRIPT_OVERRIDE = os.environ.get("POCKETED_WORKER_SCRIPT")

supervisor = Supervisor(
    DATA_ROOT,
    script_path=Path(_WORKER_SCRIPT_OVERRIDE) if _WORKER_SCRIPT_OVERRIDE else None,
)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    supervisor.start_reaper()
    yield


app = FastAPI(title="Pocketed webapp gateway", lifespan=_lifespan)

if _ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )


@app.get("/health")
async def health() -> JSONResponse:
    """Process-alive liveness check. Never depends on optional
    infrastructure (AA/bundler/paymaster) — a dev launcher or deployment
    orchestrator polls this to know the gateway itself is up."""
    return JSONResponse({"status": "ok"})


@app.get("/ready")
async def ready() -> JSONResponse:
    """Readiness check that also reports optional-subsystem status.
    `aa_configured: false` is a normal, healthy value — it must never make
    this endpoint fail, since the web app works without ERC-4337."""
    return JSONResponse({
        "status": "ok",
        "aa_configured": bool(AA_SERVICE_URL),
        "workers": len(supervisor.workers),
    })


class NonceResponse(BaseModel):
    nonce: str


@app.post("/auth/nonce", response_model=NonceResponse)
async def issue_nonce() -> NonceResponse:
    return NonceResponse(nonce=auth.generate_nonce())


class VerifyRequest(BaseModel):
    message: str
    signature: str


@app.post("/auth/verify")
async def verify(
    body: VerifyRequest, request: Request, kpb_session: str | None = Cookie(default=None)
) -> JSONResponse:
    try:
        address = auth.verify_siwe(
            body.message, body.signature, expected_domain=_expected_siwe_domain(request)
        )
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
    _set_session_cookie(resp, token, secure=_is_request_secure(request))
    return resp


@app.post("/auth/logout")
async def logout(request: Request, kpb_session: str | None = Cookie(default=None)) -> JSONResponse:
    """Revokes the session server-side (any copy of this JWT — including one
    already exfiltrated — stops authenticating immediately) and clears the
    browser cookie. See webserver/session_store.py for the revocation store."""
    if kpb_session:
        auth.revoke_session(kpb_session, secret=SESSION_SECRET)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE_NAME, path="/", samesite="lax", secure=_is_request_secure(request))
    return resp


class SwitchWalletRequest(BaseModel):
    address: str


@app.post("/auth/switch")
async def switch_wallet(
    body: SwitchWalletRequest, request: Request, kpb_session: str | None = Cookie(default=None)
) -> JSONResponse:
    if not kpb_session:
        raise HTTPException(status_code=401, detail="no active session")
    try:
        token = auth.switch_active_wallet(kpb_session, body.address, secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    resp = JSONResponse({"walletAddress": body.address})
    _set_session_cookie(resp, token, secure=_is_request_secure(request))
    return resp


async def require_wallet_address(kpb_session: str | None = Cookie(default=None)) -> str:
    if not kpb_session:
        raise HTTPException(status_code=401, detail="not authenticated")
    try:
        payload = auth.decode_session_token(kpb_session, secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    if not auth.session_is_active(payload["sid"]):
        raise HTTPException(status_code=401, detail="session revoked")
    return payload["active"]


@app.get("/auth/session")
async def get_session(kpb_session: str | None = Cookie(default=None)) -> JSONResponse:
    if not kpb_session:
        raise HTTPException(status_code=401, detail="not authenticated")
    try:
        payload = auth.decode_session_token(kpb_session, secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    if not auth.session_is_active(payload["sid"]):
        raise HTTPException(status_code=401, detail="session revoked")
    return JSONResponse({"wallets": payload["wallets"], "active": payload["active"]})


def _gateway_status_for_aa_error(e: aa.AAServiceError) -> int:
    """Map an AAServiceError onto the gateway's own HTTP response status.

    - aa-service unreachable (status_code is None, a connection/timeout
      failure) -> 503: the gateway couldn't reach its own backend.
    - aa-service itself returned 402 or 403 (e.g. the paymaster declined the
      request) -> mirror that status verbatim so the client sees the real
      reason, not a generic gateway error.
    - anything else aa-service returned -> 502, a generic upstream error.
    """
    if e.status_code is None:
        return 503
    if e.status_code in (402, 403):
        return e.status_code
    return 502


@app.get("/aa/account")
async def get_aa_account(wallet_address: str = Depends(require_wallet_address)) -> JSONResponse:
    try:
        address = await aa.compute_account_address(wallet_address, base_url=AA_SERVICE_URL)
    except aa.AAServiceError as e:
        raise HTTPException(status_code=_gateway_status_for_aa_error(e), detail=str(e)) from e
    return JSONResponse({"address": address})


class BuildUserOpRequest(BaseModel):
    calls: list[dict]


@app.post("/aa/test-userop/build")
async def post_test_userop_build(
    body: BuildUserOpRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    try:
        result = await aa.build_user_op(wallet_address, body.calls, base_url=AA_SERVICE_URL)
    except aa.AAServiceError as e:
        raise HTTPException(status_code=_gateway_status_for_aa_error(e), detail=str(e)) from e
    return JSONResponse(result)


class SubmitUserOpRequest(BaseModel):
    userOp: dict


@app.post("/aa/test-userop/submit")
async def post_test_userop_submit(
    body: SubmitUserOpRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    try:
        expected_sender = await aa.compute_account_address(wallet_address, base_url=AA_SERVICE_URL)
    except aa.AAServiceError as e:
        raise HTTPException(status_code=_gateway_status_for_aa_error(e), detail=str(e)) from e

    submitted_sender = body.userOp.get("sender")
    if not submitted_sender or submitted_sender.lower() != expected_sender.lower():
        raise HTTPException(
            status_code=403,
            detail="userOp.sender does not match the smart account for this session",
        )

    try:
        result = await aa.submit_user_op(body.userOp, base_url=AA_SERVICE_URL)
    except aa.AAServiceError as e:
        raise HTTPException(status_code=_gateway_status_for_aa_error(e), detail=str(e)) from e
    return JSONResponse(result)


@app.get("/aa/test-userop/{user_op_hash}/status")
async def get_test_userop_status(
    user_op_hash: str, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    try:
        result = await aa.get_user_op_status(user_op_hash, base_url=AA_SERVICE_URL)
    except aa.AAServiceError as e:
        raise HTTPException(status_code=_gateway_status_for_aa_error(e), detail=str(e)) from e
    return JSONResponse(result)


CTF_EXCHANGE_V2_ADDRESS = "0xE111180000d2663C0091e4f400237545B87B996B"
# Polymarket routes neg-risk markets through a second exchange contract.
# Both must be in the session key's SignatureCallerPolicy or every neg-risk
# order the bot signs would be rejected by the policy (silently, on-chain).
NEG_RISK_CTF_EXCHANGE_V2_ADDRESS = "0xe2222d279d744050d28e00520010520000310F59"


async def _session_key_worker_request(wallet_address: str, method: str, params: dict) -> dict:
    """Run one session-key RPC against the user's worker, mapping failures
    onto real HTTP statuses instead of letting them surface as a raw 500.

    Mirrors the handling the older routes already have: `/ws` turns a
    `WorkerStartError` into a client-visible backend-start failure, and
    `/aa/*` maps upstream errors via `_gateway_status_for_aa_error`.

    `service._dispatch_request` reports handler exceptions back over the
    stdio protocol as `"{ExceptionClassName}: {message}"`, and the worker
    re-raises them here as `RuntimeError` with that string. The session-key
    handlers raise `ValueError` for everything that is a bad request
    (missing signature, no pending key, non-positive cap, signature not from
    the session owner), so that prefix is the client-error signal; anything
    else is an upstream failure.
    """
    try:
        worker = await supervisor.get_or_create(wallet_address)
    except WorkerStartError as e:
        raise HTTPException(
            status_code=503, detail=f"backend worker unavailable: {e}"
        ) from e
    try:
        return await worker.request(method, params)
    except HTTPException:
        raise
    except asyncio.TimeoutError as e:
        raise HTTPException(status_code=504, detail=f"{method} timed out") from e
    except Exception as e:
        detail = str(e)
        status = 400 if detail.startswith("ValueError: ") else 502
        raise HTTPException(status_code=status, detail=detail) from e


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
    result = await _session_key_worker_request(wallet_address, "mintSessionKey", {
        "ownerAddress": wallet_address,
        "kernelAddress": kernel_address,
        "allowedCallers": [CTF_EXCHANGE_V2_ADDRESS, NEG_RISK_CTF_EXCHANGE_V2_ADDRESS],
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
    result = await _session_key_worker_request(
        wallet_address, "activateSessionKey", {"signature": body.signature}
    )
    return JSONResponse(result)


@app.post("/session-key/revoke")
async def post_session_key_revoke(
    wallet_address: str = Depends(require_wallet_address),
) -> JSONResponse:
    result = await _session_key_worker_request(wallet_address, "revokeSessionKey", {})
    return JSONResponse(result)


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
    try:
        cfg = config_store.apply_strategy(_user_data_dir(wallet_address), strategy_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await _push_config_to_worker(wallet_address, cfg)
    return JSONResponse(cfg)


@app.get("/profiles")
async def list_profiles_route(wallet_address: str = Depends(require_wallet_address)) -> JSONResponse:
    return JSONResponse(config_store.list_profiles(_user_data_dir(wallet_address)))


@app.get("/profiles/active")
async def get_active_profiles_route(wallet_address: str = Depends(require_wallet_address)) -> JSONResponse:
    return JSONResponse(config_store.active_profile_ids(_user_data_dir(wallet_address)))


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
    try:
        cfg = config_store.apply_profile(_user_data_dir(wallet_address), profile_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await _push_config_to_worker(wallet_address, cfg)
    return JSONResponse(cfg)


class RenameProfileRequest(BaseModel):
    name: str


@app.patch("/profiles/{profile_id}")
async def rename_profile_route(
    profile_id: str, body: RenameProfileRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    try:
        profile = config_store.rename_profile(_user_data_dir(wallet_address), profile_id, body.name)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return JSONResponse(profile)


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
    try:
        dup = config_store.duplicate_profile(_user_data_dir(wallet_address), profile_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return JSONResponse(dup)


@app.get("/profiles/{profile_id}/export")
async def export_profile_route(
    profile_id: str, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    try:
        exported = config_store.export_profile(_user_data_dir(wallet_address), profile_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return JSONResponse({"json": exported})


class ImportProfileRequest(BaseModel):
    # Field named `json_` (not `json`) to avoid shadowing BaseModel.json();
    # the wire/JSON key stays "json" via the alias.
    json_: str = Field(alias="json")

    model_config = {"populate_by_name": True}


@app.post("/profiles/import")
async def import_profile_route(
    body: ImportProfileRequest, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    # json.JSONDecodeError (malformed json_str) is itself a ValueError subclass,
    # so this one except also covers it in addition to config_store's own
    # "Not a valid Pocketed profile" ValueError.
    try:
        profile = config_store.import_profile(_user_data_dir(wallet_address), body.json_)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return JSONResponse(profile)


@app.get("/onboarding")
async def get_onboarding_route(wallet_address: str = Depends(require_wallet_address)) -> JSONResponse:
    return JSONResponse(config_store.get_onboarding(_user_data_dir(wallet_address)))


@app.patch("/onboarding")
async def patch_onboarding_route(
    patch: dict, wallet_address: str = Depends(require_wallet_address)
) -> JSONResponse:
    return JSONResponse(config_store.set_onboarding(_user_data_dir(wallet_address), patch))


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


def _ws_origin_allowed(websocket: WebSocket) -> bool:
    """Reject a WS upgrade whose Origin header doesn't match this gateway's
    own same-origin default or an explicitly configured cross-origin
    frontend (POCKETED_ALLOWED_ORIGINS). A cookie-authenticated WebSocket is
    exactly the kind of request CSRF-style cross-site abuse targets — the
    browser attaches the session cookie automatically regardless of which
    page opened the connection, so Origin is the only thing standing between
    a same-site session and a page on an unrelated site silently riding it.
    Browsers always send Origin on a WS handshake; a request with no Origin
    header at all is not a browser page load and is rejected too.
    """
    origin = websocket.headers.get("origin")
    if not origin:
        return False
    if origin in _ALLOWED_ORIGINS:
        return True
    host = websocket.headers.get("host", "")
    forwarded = websocket.headers.get("x-forwarded-proto")
    secure = (
        forwarded.split(",")[0].strip().lower() == "https"
        if forwarded
        else websocket.url.scheme == "wss"
    )
    same_origin = f"{'https' if secure else 'http'}://{host}"
    return origin == same_origin


SESSION_REVOKED_CLOSE_CODE = 4402
# How often the /ws handler polls the session store for a revocation that
# happened *after* the socket was accepted (e.g. the user logged out on
# another tab). Read at each poll iteration (not captured once) so tests can
# monkeypatch it to shrink the wait instead of exercising the production
# default.
SESSION_REVOCATION_POLL_SECONDS = float(
    os.environ.get("POCKETED_SESSION_REVOCATION_POLL_SECONDS", "2")
)


@app.websocket("/ws")
async def ws_endpoint(
    websocket: WebSocket,
    kpb_session: str | None = Cookie(default=None),
) -> None:
    if not _ws_origin_allowed(websocket):
        # Reject before accept() so the handshake itself fails (the browser
        # never sees a usable socket) rather than accepting and then closing.
        await websocket.close(code=4403)
        return

    await websocket.accept()

    try:
        payload = auth.decode_session_token(kpb_session or "", secret=SESSION_SECRET)
        if not auth.session_is_active(payload["sid"]):
            raise auth.AuthError("session revoked")
    except auth.AuthError:
        await websocket.close(code=4401)
        return
    wallet_address = payload["active"]
    sid = payload["sid"]

    try:
        worker = await supervisor.get_or_create(wallet_address)
    except WorkerStartError as e:
        await websocket.send_json(
            {"type": "event", "event": "backend:startError", "data": {"error": str(e)}}
        )
        await websocket.close(code=1011)
        return

    outbound = worker.subscribe()

    async def pump_outbound() -> None:
        while True:
            msg = await outbound.get()
            await websocket.send_json(msg)

    async def watch_revocation() -> None:
        # Polls (rather than pushes) because the session store has no
        # subscribe/notify mechanism — this is deliberately simple and
        # bounded by SESSION_REVOCATION_POLL_SECONDS, matching the
        # already-bounded blast radius of a revoked-but-still-open socket.
        while True:
            await asyncio.sleep(SESSION_REVOCATION_POLL_SECONDS)
            if not auth.session_is_active(sid):
                await websocket.close(code=SESSION_REVOKED_CLOSE_CODE)
                return

    outbound_task = asyncio.create_task(pump_outbound())
    revocation_task = asyncio.create_task(watch_revocation())
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                req = json.loads(raw)
            except Exception:
                continue
            if req.get("type") != "rpc":
                continue
            method = req.get("method", "")
            if method in _TRADING_METHODS_DISABLED_PHASE1:
                await websocket.send_json({
                    "type": "rpc", "id": req.get("id"), "ok": False,
                    "error": (
                        f"{method} is not available yet — trading/credentials "
                        "ship in Fase 2 of the webapp migration"
                    ),
                })
                continue
            try:
                result = await worker.request(method, req.get("params") or {})
                await websocket.send_json(
                    {"type": "rpc", "id": req.get("id"), "ok": True, "result": result}
                )
            except Exception as e:
                await websocket.send_json(
                    {"type": "rpc", "id": req.get("id"), "ok": False, "error": str(e)}
                )
    except WebSocketDisconnect:
        pass
    finally:
        outbound_task.cancel()
        revocation_task.cancel()
        worker.unsubscribe(outbound)


# --- Frontend static serving -------------------------------------------
#
# The built React app (produced by `npm run build`) lands in the repo
# root's `dist/`, not `webserver/static/` (removed in Task 15 along with
# the retired signer.html). In production this same FastAPI process is
# meant to serve that `dist/` as static files so the app is same-origin
# with the API/WS routes (see vite.config.ts's dev-proxy comment) — until
# now nothing here actually did that, so a deployed backend had no way to
# serve the app at all.
#
# `DIST_DIR` is read from an env var (mirroring the `DATA_ROOT`/
# `AA_SERVICE_URL` pattern above) so tests can point it at a temp
# directory via monkeypatch without touching the real build output.
DIST_DIR = Path(
    os.environ.get(
        "POCKETED_WEBAPP_DIST",
        str(Path(__file__).resolve().parent.parent / "dist"),
    )
)

if DIST_DIR.is_dir():
    _assets_dir = DIST_DIR / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="frontend-assets")
else:
    # Don't crash `import webserver.main` (the test suite imports this
    # module directly) just because the frontend hasn't been built yet —
    # log and skip mounting instead.
    logger.warning(
        "frontend dist/ not found at %s — static file serving is disabled "
        "(run `npm run build` to produce it)", DIST_DIR,
    )


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str) -> FileResponse:
    """Catch-all SPA fallback.

    Registered LAST (after every API/WS route above), so FastAPI/Starlette
    tries all the specific routes first and this only ever fires for a path
    none of them matched — it can never shadow `/auth/*`, `/config`,
    `/strategies`, `/profiles`, `/onboarding`, `/session-key/*`, `/aa/*`,
    or `/ws`.

    `src/App.tsx` navigates via in-memory `PageId` state rather than a URL
    router, so there is no per-route matching to do here: any unmatched GET
    path just gets `dist/index.html` and the client takes it from there.
    Reads the module-level `DIST_DIR` at call time (not a value captured at
    import/mount time) so it honors a test's monkeypatch of `DIST_DIR`.
    """
    dist_dir = DIST_DIR
    if full_path:
        candidate = (dist_dir / full_path).resolve()
        try:
            candidate.relative_to(dist_dir.resolve())
        except (ValueError, OSError):
            candidate = None
        if candidate is not None and candidate.is_file():
            return FileResponse(candidate)

    index_file = dist_dir / "index.html"
    if not index_file.is_file():
        raise HTTPException(
            status_code=404,
            detail="frontend not built — run `npm run build` to produce dist/",
        )
    return FileResponse(index_file)

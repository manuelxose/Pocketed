from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from webserver import aa, auth, config_store
from webserver.supervisor import Supervisor, WorkerStartError

logger = logging.getLogger("webserver.main")

SESSION_COOKIE_NAME = "kpb_session"
SESSION_SECRET = os.environ.get("KRYPT_POLYBOT_SESSION_SECRET")
if not SESSION_SECRET:
    raise RuntimeError(
        "KRYPT_POLYBOT_SESSION_SECRET must be set — refusing to sign "
        "sessions with a default secret."
    )

DATA_ROOT = Path(
    os.environ.get(
        "KRYPT_POLYBOT_WEBAPP_DATA",
        str(Path(__file__).resolve().parent.parent / "python" / "data" / "webapp"),
    )
)

AA_SERVICE_URL = os.environ.get(aa.AA_SERVICE_URL_ENV)
if not AA_SERVICE_URL:
    raise RuntimeError(
        f"{aa.AA_SERVICE_URL_ENV} must be set — refusing to start without the "
        "ERC-4337 sidecar configured"
    )

# Fase 1 explicitly excludes order signing/execution (see spec). Any RPC
# method that touches credentials or live trading is refused at the
# gateway, before it ever reaches a worker.
_TRADING_METHODS_DISABLED_PHASE1 = {
    "setCredentials", "clearCredentials", "testCredentials",
    "cancelAllOpen", "flatten",
}

supervisor = Supervisor(DATA_ROOT)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    supervisor.start_reaper()
    yield


app = FastAPI(title="Krypt PolyBot webapp gateway", lifespan=_lifespan)

app.mount("/static", StaticFiles(directory=Path(__file__).resolve().parent / "static"), name="static")


class NonceResponse(BaseModel):
    nonce: str


@app.post("/auth/nonce", response_model=NonceResponse)
async def issue_nonce() -> NonceResponse:
    return NonceResponse(nonce=auth.generate_nonce())


class VerifyRequest(BaseModel):
    message: str
    signature: str


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


@app.get("/auth/session")
async def get_session(kpb_session: str | None = Cookie(default=None)) -> JSONResponse:
    if not kpb_session:
        raise HTTPException(status_code=401, detail="not authenticated")
    try:
        payload = auth.decode_session_token(kpb_session, secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    return JSONResponse(payload)


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
    # "Not a valid Krypt PolyBot profile" ValueError.
    try:
        profile = config_store.import_profile(_user_data_dir(wallet_address), body.json_)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return JSONResponse(profile)


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


@app.websocket("/ws")
async def ws_endpoint(
    websocket: WebSocket,
    kpb_session: str | None = Cookie(default=None),
) -> None:
    await websocket.accept()

    try:
        wallet_address = auth.decode_session_token(kpb_session or "", secret=SESSION_SECRET)["active"]
    except auth.AuthError:
        await websocket.close(code=4401)
        return

    try:
        worker = await supervisor.get_or_create(wallet_address)
    except WorkerStartError as e:
        await websocket.send_json(
            {"type": "event", "name": "backend:startError", "data": {"error": str(e)}}
        )
        await websocket.close(code=1011)
        return

    outbound = worker.subscribe()

    async def pump_outbound() -> None:
        while True:
            msg = await outbound.get()
            await websocket.send_json(msg)

    outbound_task = asyncio.create_task(pump_outbound())
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
        worker.unsubscribe(outbound)

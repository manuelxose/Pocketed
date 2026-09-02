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
from pydantic import BaseModel

from webserver import aa, auth
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
        "ownerAddress": wallet_address,
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


@app.websocket("/ws")
async def ws_endpoint(
    websocket: WebSocket,
    kpb_session: str | None = Cookie(default=None),
) -> None:
    await websocket.accept()

    try:
        wallet_address = auth.decode_session_token(kpb_session or "", secret=SESSION_SECRET)
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

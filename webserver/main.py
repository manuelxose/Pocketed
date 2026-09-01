from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Cookie, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from webserver import auth
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

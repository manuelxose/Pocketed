"""Manual end-to-end check for the Fase 1 webapp gateway. Not run by pytest.

Usage (with the gateway already running — see Task 5 verification steps
in docs/superpowers/plans/2026-09-01-webapp-phase1-backend-auth.md):
    python webserver/tests/manual_client.py
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import httpx
import websockets
from eth_account import Account
from eth_account.messages import encode_defunct
from siwe import SiweMessage

BASE_URL = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000/ws"


async def main() -> None:
    account = Account.create()
    print(f"using throwaway test wallet: {account.address}")

    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        nonce = (await client.post("/auth/nonce")).json()["nonce"]
        msg = SiweMessage(
            domain="127.0.0.1", address=account.address,
            statement="Sign in to Krypt PolyBot (manual test)",
            uri=f"{BASE_URL}/auth", version="1", chain_id=137, nonce=nonce,
            issued_at=datetime.now(timezone.utc).isoformat(),
        )
        prepared = msg.prepare_message()
        signed = Account.sign_message(encode_defunct(text=prepared), private_key=account.key)
        resp = await client.post(
            "/auth/verify",
            json={"message": prepared, "signature": signed.signature.hex()},
        )
        resp.raise_for_status()
        print("login ok:", resp.json())
        cookie = resp.cookies.get("kpb_session")

    async with websockets.connect(
        WS_URL, extra_headers={"Cookie": f"kpb_session={cookie}"}
    ) as ws:
        await ws.send(json.dumps({"type": "rpc", "id": "1", "method": "ping", "params": {}}))
        # backend:ready (and other worker events) can arrive before our rpc
        # reply — skip anything that isn't the reply we're waiting for.
        for _ in range(10):
            reply = json.loads(await ws.recv())
            if reply.get("type") == "rpc" and reply.get("id") == "1":
                break
        else:
            raise RuntimeError("no rpc reply received for ping")
        print("ping reply:", reply)
        assert reply.get("ok") is True, "ping did not succeed"
        print("OK — worker responded through the gateway")


if __name__ == "__main__":
    asyncio.run(main())

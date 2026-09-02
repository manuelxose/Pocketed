from datetime import datetime, timezone
from pathlib import Path

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient
from siwe import SiweMessage

import webserver.main as main_module
from webserver.supervisor import Supervisor

FIXTURE_SCRIPT = Path(__file__).parent / "fixtures" / "dummy_worker.py"


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_supervisor = Supervisor(tmp_path, script_path=FIXTURE_SCRIPT)
    monkeypatch.setattr(main_module, "supervisor", test_supervisor)
    with TestClient(main_module.app) as c:
        yield c
        # Stop any worker subprocesses spawned during the test while the
        # TestClient's event loop (reachable via its portal) is still
        # alive — tearing down after the `with` block closes that loop
        # leaves asyncio.subprocess transports to warn on GC instead.
        c.portal.call(test_supervisor.stop_all)


def _login(client) -> tuple[str, str]:
    """Log in and return (walletAddress, sessionCookieValue).

    The session cookie is read straight off the /auth/verify response
    rather than relied on to auto-attach to later requests: Starlette's
    TestClient.websocket_connect always builds a `ws://testserver/...` URL
    regardless of the client's base_url, and our Secure cookie is (rightly)
    withheld by the cookie jar on a plain `ws://` request. Real browsers
    don't have this quirk — a `wss://` page attaches Secure cookies fine.
    """
    account = Account.create()
    nonce = client.post("/auth/nonce").json()["nonce"]
    msg = SiweMessage(
        domain="testserver",
        address=account.address,
        statement="Sign in to Pocketed",
        uri="http://testserver/auth",
        version="1",
        chain_id=137,
        nonce=nonce,
        issued_at=datetime.now(timezone.utc).isoformat(),
    )
    prepared = msg.prepare_message()
    signed = Account.sign_message(encode_defunct(text=prepared), private_key=account.key)
    resp = client.post(
        "/auth/verify",
        json={"message": prepared, "signature": signed.signature.hex()},
    )
    assert resp.status_code == 200
    session_cookie = resp.cookies.get(main_module.SESSION_COOKIE_NAME)
    assert session_cookie
    return resp.json()["walletAddress"], session_cookie


def test_nonce_endpoint_returns_a_nonce(client):
    resp = client.post("/auth/nonce")

    assert resp.status_code == 200
    assert len(resp.json()["nonce"]) > 0


def test_verify_endpoint_sets_session_cookie(client):
    wallet_address, session_cookie = _login(client)

    assert wallet_address
    assert session_cookie


def test_verify_endpoint_rejects_bad_signature(client):
    account = Account.create()
    nonce = client.post("/auth/nonce").json()["nonce"]
    msg = SiweMessage(
        domain="testserver", address=account.address, statement="Sign in",
        uri="http://testserver/auth", version="1", chain_id=137, nonce=nonce,
        issued_at=datetime.now(timezone.utc).isoformat(),
    )
    prepared = msg.prepare_message()

    resp = client.post("/auth/verify", json={"message": prepared, "signature": "0x" + "00" * 65})

    assert resp.status_code == 401


def test_ws_requires_session_cookie(client):
    with client.websocket_connect("/ws") as ws:
        with pytest.raises(Exception):
            ws.receive_json()


def _ws_cookie_header(session_cookie: str) -> dict:
    return {"cookie": f"{main_module.SESSION_COOKIE_NAME}={session_cookie}"}


def _receive_rpc_reply(ws, expected_id: str) -> dict:
    """Worker events (e.g. the dummy worker's startup backend:ready) can
    arrive interleaved with rpc replies — a real client dispatches by
    type/id and ignores what it doesn't recognize; do the same here."""
    for _ in range(10):
        msg = ws.receive_json()
        if msg.get("type") == "rpc" and msg.get("id") == expected_id:
            return msg
    raise AssertionError(f"no rpc reply with id={expected_id!r} received")


def test_ws_ping_roundtrip_after_login(client):
    _, session_cookie = _login(client)
    with client.websocket_connect("/ws", headers=_ws_cookie_header(session_cookie)) as ws:
        ws.send_json({"type": "rpc", "id": "1", "method": "ping", "params": {}})
        reply = _receive_rpc_reply(ws, "1")
        assert reply == {"type": "rpc", "id": "1", "ok": True, "result": {"pong": True}}


def test_ws_blocks_phase1_disabled_trading_methods(client):
    _, session_cookie = _login(client)
    with client.websocket_connect("/ws", headers=_ws_cookie_header(session_cookie)) as ws:
        ws.send_json({"type": "rpc", "id": "2", "method": "setCredentials", "params": {}})
        reply = _receive_rpc_reply(ws, "2")
        assert reply["ok"] is False
        assert "Fase 2" in reply["error"]

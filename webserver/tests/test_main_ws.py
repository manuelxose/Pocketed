import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient
from siwe import SiweMessage
from starlette.websockets import WebSocketDisconnect

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
    with client.websocket_connect("/ws", headers={"origin": "http://testserver"}) as ws:
        with pytest.raises(Exception):
            ws.receive_json()


def test_ws_rejects_missing_origin(client):
    _, session_cookie = _login(client)
    with pytest.raises(Exception):
        with client.websocket_connect(
            "/ws", headers={"cookie": f"{main_module.SESSION_COOKIE_NAME}={session_cookie}"}
        ):
            pass


def test_ws_rejects_cross_site_origin(client):
    """A cookie-authenticated WS is exactly what a malicious third-party
    page could try to ride on (the browser attaches cookies regardless of
    which page opened the connection) — Origin pinning is what stops it."""
    _, session_cookie = _login(client)
    with pytest.raises(Exception):
        with client.websocket_connect(
            "/ws",
            headers={
                "cookie": f"{main_module.SESSION_COOKIE_NAME}={session_cookie}",
                "origin": "http://evil.example",
            },
        ):
            pass


def _ws_cookie_header(session_cookie: str) -> dict:
    # Origin must match the gateway's own same-origin default (see
    # webserver/main.py::_ws_origin_allowed) — TestClient.websocket_connect
    # builds a ws://testserver/... URL regardless of base_url, so that's the
    # Origin a real browser page served from this same gateway would send.
    return {
        "cookie": f"{main_module.SESSION_COOKIE_NAME}={session_cookie}",
        "origin": "http://testserver",
    }


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


def test_logout_revokes_the_session_for_future_http_requests(client):
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    logout_resp = client.post("/auth/logout")
    assert logout_resp.status_code == 200

    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)  # re-attach the captured token
    session_resp = client.get("/auth/session")
    assert session_resp.status_code == 401


def test_ws_rejects_a_revoked_session(client):
    """The handshake itself succeeds (auth is checked after accept() — same
    as the missing-cookie case in test_ws_requires_session_cookie above, and
    for the same reason: FastAPI/Starlette only reports a close code to the
    client once the accept has happened), but the server closes immediately
    with 4401 and sends nothing else, so the first receive observes it."""
    from webserver import auth

    _, session_cookie = _login(client)
    auth.revoke_session(session_cookie, secret=main_module.SESSION_SECRET)

    with client.websocket_connect("/ws", headers=_ws_cookie_header(session_cookie)) as ws:
        with pytest.raises(WebSocketDisconnect) as excinfo:
            ws.receive_json()
        assert excinfo.value.code == 4401


def test_open_ws_is_closed_when_its_session_is_revoked(client, monkeypatch):
    """Exercises the live revocation poll: shrink the poll interval so the
    test doesn't wait on the production default."""
    from webserver import auth

    monkeypatch.setattr(main_module, "SESSION_REVOCATION_POLL_SECONDS", 0.05)
    _, session_cookie = _login(client)

    with client.websocket_connect("/ws", headers=_ws_cookie_header(session_cookie)) as ws:
        auth.revoke_session(session_cookie, secret=main_module.SESSION_SECRET)
        # Other traffic (e.g. the dummy worker's startup event) can arrive
        # interleaved before the poll task notices the revocation — keep
        # draining until the close actually surfaces, but assert the real
        # close code rather than accepting any disconnect.
        with pytest.raises(WebSocketDisconnect) as excinfo:
            for _ in range(50):
                ws.receive_json()
        assert excinfo.value.code == main_module.SESSION_REVOKED_CLOSE_CODE


def _raise_sqlite_locked(*_args, **_kwargs):
    """Stand-in for `auth.session_is_active`/`switch_active_wallet` that
    raises the kind of connectivity error a real store backend can raise
    (sqlite3.OperationalError past busy_timeout, redis ConnectionError) —
    see webserver/main.py's `STORE_CONNECTIVITY_ERRORS`."""
    raise sqlite3.OperationalError("database is locked")


def test_require_wallet_address_maps_store_failure_to_503(client, monkeypatch):
    """A store-connectivity failure inside require_wallet_address's
    session_is_active check must surface as 503 (spec's "session store
    unavailable" contract), not propagate as an uncaught 500."""
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    monkeypatch.setattr(main_module.auth, "session_is_active", _raise_sqlite_locked)

    resp = client.get("/config")

    assert resp.status_code == 503
    assert resp.json()["detail"] == "session store unavailable"


def test_auth_session_route_maps_store_failure_to_503(client, monkeypatch):
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    monkeypatch.setattr(main_module.auth, "session_is_active", _raise_sqlite_locked)

    resp = client.get("/auth/session")

    assert resp.status_code == 503
    assert resp.json()["detail"] == "session store unavailable"


def test_auth_switch_route_maps_store_failure_to_503(client, monkeypatch):
    wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    monkeypatch.setattr(main_module.auth, "switch_active_wallet", _raise_sqlite_locked)

    resp = client.post("/auth/switch", json={"address": wallet_address})

    assert resp.status_code == 503
    assert resp.json()["detail"] == "session store unavailable"


def test_ws_connect_time_store_failure_closes_with_1011(client, monkeypatch):
    """A store failure discovered at connect time (right after decode, once
    the socket is already accept()ed) must close with 1011, distinct from
    the 4401 used for "no session"/revoked — matching the spec's WS-1011
    contract for store-down, not conflating it with an auth failure."""
    _, session_cookie = _login(client)
    monkeypatch.setattr(main_module.auth, "session_is_active", _raise_sqlite_locked)

    with client.websocket_connect("/ws", headers=_ws_cookie_header(session_cookie)) as ws:
        with pytest.raises(WebSocketDisconnect) as excinfo:
            ws.receive_json()
        assert excinfo.value.code == 1011


def test_open_ws_is_closed_with_1011_when_store_fails_during_revocation_poll(client, monkeypatch):
    """A store failure discovered later, inside watch_revocation's polling
    loop, must close the already-open socket with 1011 (matching the
    WorkerStartError pattern) instead of leaving the background task to die
    silently and the socket open but permanently unmonitored."""
    monkeypatch.setattr(main_module, "SESSION_REVOCATION_POLL_SECONDS", 0.05)
    _, session_cookie = _login(client)

    with client.websocket_connect("/ws", headers=_ws_cookie_header(session_cookie)) as ws:
        monkeypatch.setattr(main_module.auth, "session_is_active", _raise_sqlite_locked)
        with pytest.raises(WebSocketDisconnect) as excinfo:
            for _ in range(50):
                ws.receive_json()
        assert excinfo.value.code == 1011


def test_ws_worker_start_error_uses_event_field_not_name(client, monkeypatch):
    """Regression guard for the name/event wire-format mismatch: the
    frontend (src/lib/ws-client.ts) reads msg.event, not msg.name. Every
    gateway- and worker-generated push event must use the "event" key."""
    from webserver.supervisor import WorkerStartError

    _, session_cookie = _login(client)

    async def _boom(user_id):
        raise WorkerStartError("backend script not found")

    monkeypatch.setattr(main_module.supervisor, "get_or_create", _boom)

    with client.websocket_connect("/ws", headers=_ws_cookie_header(session_cookie)) as ws:
        msg = ws.receive_json()
        assert msg["type"] == "event"
        assert msg["event"] == "backend:startError"
        assert "name" not in msg
        assert "backend script not found" in msg["data"]["error"]

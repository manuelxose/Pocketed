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


def _login(client) -> tuple[str, str]:
    """Log in and return (walletAddress, sessionCookieValue).

    The session cookie is read straight off the /auth/verify response and
    re-attached explicitly to subsequent requests rather than relied on to
    auto-attach: it is set with `secure=True`, and Starlette's TestClient
    talks to the app over a plain `http://testserver` URL, so a real cookie
    jar rightly withholds a Secure cookie there. See the same workaround in
    test_main_ws.py's `_login`.
    """
    from datetime import datetime, timezone
    from eth_account import Account
    from eth_account.messages import encode_defunct
    from siwe import SiweMessage

    account = Account.create()
    nonce = client.post("/auth/nonce").json()["nonce"]
    msg = SiweMessage(
        domain="testserver", address=account.address, statement="Sign in to Pocketed",
        uri="http://testserver/auth", version="1", chain_id=137, nonce=nonce,
        issued_at=datetime.now(timezone.utc).isoformat(),
    )
    prepared = msg.prepare_message()
    signed = Account.sign_message(encode_defunct(text=prepared), private_key=account.key)
    resp = client.post("/auth/verify", json={"message": prepared, "signature": signed.signature.hex()})
    assert resp.status_code == 200
    session_cookie = resp.cookies.get(main_module.SESSION_COOKIE_NAME)
    assert session_cookie
    return resp.json()["walletAddress"], session_cookie


@respx.mock
def test_aa_account_route_requires_session(client):
    resp = client.get("/aa/account")
    assert resp.status_code == 401


@respx.mock
def test_aa_account_route_returns_address(client):
    wallet_address, session_cookie = _login(client)
    respx.get(f"{main_module.AA_SERVICE_URL}/account/{wallet_address}").mock(
        return_value=httpx.Response(200, json={"address": "0xDEADBEEF"})
    )

    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    resp = client.get("/aa/account")

    assert resp.status_code == 200
    assert resp.json() == {"address": "0xDEADBEEF"}


@respx.mock
def test_build_submit_status_userop_flow(client):
    wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    respx.get(f"{main_module.AA_SERVICE_URL}/account/{wallet_address}").mock(
        return_value=httpx.Response(200, json={"address": "0x1"})
    )
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

    # sender "0x1" matches the /account/{wallet_address} mock above
    # (case-insensitively) — submit is only forwarded to aa-service when the
    # ownership check in main.py passes.
    submit_resp = client.post("/aa/test-userop/submit", json={"userOp": {"sender": "0x1", "signature": "0xsig"}})
    assert submit_resp.status_code == 200
    assert submit_resp.json()["userOpHash"] == "0x1"

    status_resp = client.get("/aa/test-userop/0x1/status")
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "pending"


@respx.mock
def test_submit_userop_rejects_sender_mismatch(client):
    """A userOp whose sender isn't this session's smart account gets 403,
    and is never forwarded to aa-service's /userop/submit."""
    wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    respx.get(f"{main_module.AA_SERVICE_URL}/account/{wallet_address}").mock(
        return_value=httpx.Response(200, json={"address": "0xAAAA000000000000000000000000000000AAAA"})
    )
    submit_route = respx.post(f"{main_module.AA_SERVICE_URL}/userop/submit").mock(
        return_value=httpx.Response(200, json={"userOpHash": "0x1"})
    )

    resp = client.post(
        "/aa/test-userop/submit",
        json={"userOp": {"sender": "0xBBBB000000000000000000000000000000BBBB", "signature": "0xsig"}},
    )

    assert resp.status_code == 403
    assert not submit_route.called


@respx.mock
def test_aa_account_route_maps_paymaster_declined_to_402(client):
    """aa-service's own 402 (paymaster declined) propagates as 402, not the
    generic 502."""
    wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    respx.get(f"{main_module.AA_SERVICE_URL}/account/{wallet_address}").mock(
        return_value=httpx.Response(402, json={"error": "daily gas cap exceeded"})
    )

    resp = client.get("/aa/account")

    assert resp.status_code == 402


@respx.mock
def test_aa_account_route_rejects_a_revoked_session(client, monkeypatch):
    from webserver import auth

    wallet_address, session_cookie = _login(client)
    auth.revoke_session(session_cookie, secret=main_module.SESSION_SECRET)

    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    resp = client.get("/aa/account")

    assert resp.status_code == 401


@respx.mock
def test_aa_account_route_maps_unreachable_aa_service_to_503(client):
    """A connection failure talking to aa-service propagates as 503, not the
    generic 502."""
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    respx.get(f"{main_module.AA_SERVICE_URL}/account/{_wallet_address}").mock(
        side_effect=httpx.ConnectError("connection refused")
    )

    resp = client.get("/aa/account")

    assert resp.status_code == 503

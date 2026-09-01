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
        domain="testserver", address=account.address, statement="Sign in to Krypt PolyBot",
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

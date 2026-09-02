import httpx
import respx

import webserver.main as main_module
from webserver.tests.test_main_aa_routes import client, _login, _test_session_secret  # reuse fixtures


@respx.mock
def test_session_key_init_requires_session(client):
    resp = client.post("/session-key/init", json={"validUntil": 1893456000, "dailyUsdCap": 50.0})
    assert resp.status_code == 401


@respx.mock
def test_session_key_init_returns_enable_typed_data(client):
    wallet_address, session_cookie = _login(client)
    respx.get(f"{main_module.AA_SERVICE_URL}/account/{wallet_address}").mock(
        return_value=httpx.Response(200, json={"address": "0xKernelDeadBeef00000000000000000000000000"})
    )
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    resp = client.post("/session-key/init", json={"validUntil": 1893456000, "dailyUsdCap": 50.0})

    assert resp.status_code == 200
    body = resp.json()
    assert body["sessionKeyAddress"] == "0xSessionKeyDummy00000000000000000000000"
    assert "enableTypedData" in body


@respx.mock
def test_session_key_activate_relays_signature(client):
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    resp = client.post("/session-key/activate", json={"signature": "0xdeadsignature"})

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


@respx.mock
def test_session_key_revoke(client):
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    resp = client.post("/session-key/revoke")

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

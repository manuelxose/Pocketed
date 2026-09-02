import httpx
import pytest
import respx

import webserver.main as main_module
from webserver.supervisor import WorkerStartError
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
def test_session_key_init_passes_both_exchange_contracts(client):
    """Neg-risk markets route through a second exchange contract; if only
    the regular one were allowed, every neg-risk order would violate the
    session key's caller policy."""
    wallet_address, session_cookie = _login(client)
    respx.get(f"{main_module.AA_SERVICE_URL}/account/{wallet_address}").mock(
        return_value=httpx.Response(200, json={"address": "0xKernelDeadBeef00000000000000000000000000"})
    )
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    seen = {}
    real_request = main_module._session_key_worker_request

    async def spy(addr, method, params):
        seen[method] = params
        return await real_request(addr, method, params)

    main_module._session_key_worker_request = spy
    try:
        resp = client.post("/session-key/init", json={"validUntil": 1893456000, "dailyUsdCap": 50.0})
    finally:
        main_module._session_key_worker_request = real_request

    assert resp.status_code == 200
    assert seen["mintSessionKey"]["allowedCallers"] == [
        main_module.CTF_EXCHANGE_V2_ADDRESS,
        main_module.NEG_RISK_CTF_EXCHANGE_V2_ADDRESS,
    ]


@respx.mock
def test_session_key_init_maps_worker_validation_error_to_400(client):
    wallet_address, session_cookie = _login(client)
    respx.get(f"{main_module.AA_SERVICE_URL}/account/{wallet_address}").mock(
        return_value=httpx.Response(200, json={"address": "0xKernelDeadBeef00000000000000000000000000"})
    )
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    resp = client.post("/session-key/init", json={"validUntil": 1893456000, "dailyUsdCap": 0})

    assert resp.status_code == 400
    assert "dailyUsdCap" in resp.json()["detail"]


@respx.mock
def test_session_key_activate_maps_bad_signature_to_400(client):
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    resp = client.post("/session-key/activate", json={"signature": "0xbadsignature"})

    assert resp.status_code == 400
    assert "session owner" in resp.json()["detail"]


@respx.mock
def test_session_key_activate_maps_worker_failure_to_502(client):
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    resp = client.post("/session-key/activate", json={"signature": "0xboom"})

    assert resp.status_code == 502


@respx.mock
def test_session_key_routes_map_worker_start_failure_to_503(client, monkeypatch):
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    async def boom(_user_id):
        raise WorkerStartError("crashed recently; retry in 4.0s")

    monkeypatch.setattr(main_module.supervisor, "get_or_create", boom)

    resp = client.post("/session-key/revoke")

    assert resp.status_code == 503
    assert "backend worker unavailable" in resp.json()["detail"]


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

from __future__ import annotations

import asyncio

import httpx
import pytest

import polymarket_api as pa


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _stub_api(monkeypatch):
    async def _anoop(*a, **k):
        return None
    monkeypatch.setattr(pa, "ensure_api_creds", _anoop)
    monkeypatch.setattr(pa, "_note_net_fail", _anoop)
    monkeypatch.setattr(pa, "_note_net_ok", lambda *a, **k: None)
    monkeypatch.setattr(pa.auth, "l2_headers", lambda *a, **k: {})
    monkeypatch.setattr(pa.asyncio, "sleep", _anoop)


class _TimeoutClient:
    def __init__(self):
        self.calls = 0

    async def request(self, *a, **k):
        self.calls += 1
        raise httpx.TimeoutException("simulated network timeout")


class _Resp:
    def __init__(self, status):
        self.status_code = status
        self.headers = {}
        self._payload = {"errorMsg": "server error"}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class _StatusClient:
    def __init__(self, status):
        self.calls = 0
        self.status = status

    async def request(self, *a, **k):
        self.calls += 1
        return _Resp(self.status)


def _use_client(monkeypatch, client):
    async def _gc():
        return client
    monkeypatch.setattr(pa, "_get_client", _gc)


def test_post_order_not_retried_on_timeout(monkeypatch):
    client = _TimeoutClient()
    _use_client(monkeypatch, client)
    with pytest.raises(httpx.TimeoutException):
        _run(pa._authed_request("POST", "/order", json_body={"x": 1}, idempotent=False))
    assert client.calls == 1


def test_post_order_not_retried_on_5xx(monkeypatch):
    client = _StatusClient(500)
    _use_client(monkeypatch, client)
    with pytest.raises(pa.PolymarketAPIError):
        _run(pa._authed_request("POST", "/order", json_body={"x": 1}, idempotent=False))
    assert client.calls == 1


def test_idempotent_get_still_retries_on_timeout(monkeypatch):
    client = _TimeoutClient()
    _use_client(monkeypatch, client)
    with pytest.raises(httpx.TimeoutException):
        _run(pa._authed_request("GET", "/markets"))
    assert client.calls == pa.MAX_RETRIES


def test_idempotent_get_still_retries_on_5xx(monkeypatch):
    client = _StatusClient(503)
    _use_client(monkeypatch, client)
    with pytest.raises(pa.PolymarketAPIError):
        _run(pa._authed_request("GET", "/markets"))
    assert client.calls == pa.MAX_RETRIES

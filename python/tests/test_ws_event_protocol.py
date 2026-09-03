"""Regression guard for the WS wire-format contract: every push event the
worker emits must use the "event" key, not "name" — the frontend
(src/lib/ws-client.ts) reads msg.event, and the gateway's own synthetic
events (webserver/main.py, webserver/supervisor.py) use the same key."""
import asyncio

import service


def test_emit_event_uses_event_key_not_name(monkeypatch):
    sent = []

    async def fake_send(obj):
        sent.append(obj)

    monkeypatch.setattr(service, "_send", fake_send)

    asyncio.run(service.emit_event("account:update", {"equity": 100}))

    assert len(sent) == 1
    assert sent[0]["type"] == "event"
    assert sent[0]["event"] == "account:update"
    assert sent[0]["data"] == {"equity": 100}
    assert "name" not in sent[0]

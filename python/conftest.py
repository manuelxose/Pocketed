from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

_SCRATCH = tempfile.mkdtemp(prefix="krypt-test-")
os.environ.setdefault("POCKETED_USERDATA", _SCRATCH)

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _hermetic_market_meta(monkeypatch):
    try:
        import trader

        async def _no_meta(_ticker):
            return None

        monkeypatch.setattr(trader, "get_market_meta", _no_meta, raising=False)
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _hermetic_quote(request, monkeypatch):
    if getattr(request.module, "__name__", "").endswith("test_polymarket_api"):
        return
    try:
        import polymarket_api

        async def _no_quote(_ticker, _side):
            return {"bid_cents": None, "ask_cents": None}

        monkeypatch.setattr(polymarket_api, "get_quote", _no_quote, raising=False)
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _hermetic_balance(request, monkeypatch):
    if getattr(request.module, "__name__", "").endswith("test_polymarket_api"):
        return
    try:
        import polymarket_api
        import trader

        async def _no_balance():
            raise RuntimeError("hermetic test env: no balance endpoint")

        monkeypatch.setattr(polymarket_api, "get_balance", _no_balance, raising=False)
        monkeypatch.setattr(trader, "get_balance", _no_balance, raising=False)
        monkeypatch.setattr(trader, "_balance_cache", {}, raising=False)
    except Exception:
        pass

import time

import session_key


def _seed_active_key(tmp_path, monkeypatch, daily_cap):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    address, priv_hex = session_key.generate_session_key()
    policy = {
        "allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B",
        "validUntil": int(time.time()) + 3600, "dailyUsdCap": daily_cap,
        "kernelAddress": "0x000000000000000000000000000000000000Bb",
    }
    session_key.store_session_key(address, priv_hex, policy, "0xsig")


def test_reserve_daily_usd_allows_spend_under_cap(tmp_path, monkeypatch):
    _seed_active_key(tmp_path, monkeypatch, daily_cap=100.0)
    assert session_key.reserve_daily_usd(30.0) is True
    assert session_key.reserve_daily_usd(60.0) is True


def test_reserve_daily_usd_rejects_spend_over_cap(tmp_path, monkeypatch):
    _seed_active_key(tmp_path, monkeypatch, daily_cap=100.0)
    assert session_key.reserve_daily_usd(90.0) is True
    assert session_key.reserve_daily_usd(20.0) is False


def test_reserve_daily_usd_resets_on_new_utc_day(tmp_path, monkeypatch):
    _seed_active_key(tmp_path, monkeypatch, daily_cap=100.0)
    assert session_key.reserve_daily_usd(90.0) is True
    import polymarket_auth
    monkeypatch.setattr(polymarket_auth, "now_ts", lambda: int(time.time()) + 86400 + 60)
    assert session_key.reserve_daily_usd(90.0) is True

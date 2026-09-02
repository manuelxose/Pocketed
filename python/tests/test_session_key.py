import json
import time
from pathlib import Path

import pytest

import polymarket_auth
import session_key


@pytest.fixture(autouse=True)
def _isolated_userdata(tmp_path, monkeypatch):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    polymarket_auth.reset_credential_cache()
    yield


def test_generate_session_key_returns_valid_address_and_key():
    address, priv_hex = session_key.generate_session_key()
    from eth_account import Account
    assert Account.from_key(priv_hex).address == address
    assert address.startswith("0x") and len(address) == 42


def test_store_and_load_session_key_roundtrip():
    address, priv_hex = session_key.generate_session_key()
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": int(time.time()) + 3600, "dailyUsdCap": 50.0}
    session_key.store_session_key(address, priv_hex, policy, "0xdeadsignature", env="mainnet")

    record = session_key.load_session_key_record(env="mainnet")
    assert record is not None
    assert record["address"] == address
    assert record["privateKey"] == priv_hex
    assert record["policy"] == policy
    assert record["enableSignature"] == "0xdeadsignature"
    assert record["active"] is True


def test_load_session_key_record_returns_none_when_absent():
    assert session_key.load_session_key_record(env="mainnet") is None


def test_session_key_file_is_encrypted_at_rest_or_flagged(tmp_path):
    address, priv_hex = session_key.generate_session_key()
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": int(time.time()) + 3600, "dailyUsdCap": 50.0}
    session_key.store_session_key(address, priv_hex, policy, "0xdeadsignature", env="mainnet")
    raw = session_key.session_key_file(env="mainnet").read_bytes()
    # The private key must never appear as a plain substring of the file on
    # disk when an OS-level encryption backend is available on this
    # platform — same guarantee polymarket_auth.py already gives the
    # desktop wallet key.
    if polymarket_auth._dpapi_available() or polymarket_auth._keyring_available():
        assert priv_hex.encode() not in raw

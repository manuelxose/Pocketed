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


def test_build_enable_typed_data_shape():
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": 1893456000, "dailyUsdCap": 50.0}
    typed = session_key.build_enable_typed_data(
        "0xKernelAddr00000000000000000000000000000", "0xSessionKeyAddr0000000000000000000000000", policy,
    )
    assert typed["domain"]["chainId"] == polymarket_auth.CHAIN_ID
    assert typed["message"]["sessionKeyAddress"] == "0xSessionKeyAddr0000000000000000000000000"
    assert typed["message"]["allowedCallers"] == [policy["allowedCaller"]]
    assert typed["message"]["validUntil"] == policy["validUntil"]


def test_build_enable_typed_data_carries_every_allowed_caller():
    """A neg-risk order goes through a second exchange contract; if the
    consent payload (and the permission id built from the same policy) only
    named one, every neg-risk order would violate the policy."""
    policy = {
        "allowedCallers": [
            "0xE111180000d2663C0091e4f400237545B87B996B",
            "0xe2222d279d744050d28e00520010520000310F59",
        ],
        "validUntil": 1893456000, "dailyUsdCap": 50.0,
    }
    typed = session_key.build_enable_typed_data(
        "0x000000000000000000000000000000000000dEaD",
        "0x000000000000000000000000000000000000bEEF", policy,
    )
    assert typed["message"]["allowedCallers"] == policy["allowedCallers"]
    assert session_key.allowed_callers(policy) == policy["allowedCallers"]
    # And the permission id must actually differ from the single-caller one,
    # i.e. the second caller reaches the SignatureCallerPolicy blob.
    single = {"allowedCaller": policy["allowedCallers"][0], "validUntil": 1893456000}
    signer_addr = "0x000000000000000000000000000000000000bEEF"
    assert session_key.compute_permission_id(signer_addr, policy) != \
        session_key.compute_permission_id(signer_addr, single)


def test_recover_enable_signer_roundtrip_and_rejection():
    from eth_account import Account
    from eth_account.messages import encode_typed_data

    owner = Account.create()
    other = Account.create()
    policy = {
        "allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B",
        "validUntil": 1893456000, "dailyUsdCap": 50.0,
    }
    typed = session_key.build_enable_typed_data(
        "0x000000000000000000000000000000000000dEaD",
        "0x000000000000000000000000000000000000bEEF", policy,
    )
    signable = encode_typed_data(full_message=typed)

    good = owner.sign_message(signable).signature.hex()
    assert session_key.recover_enable_signer(typed, good).lower() == owner.address.lower()

    wrong = other.sign_message(signable).signature.hex()
    assert session_key.recover_enable_signer(typed, wrong).lower() != owner.address.lower()

    with pytest.raises(ValueError):
        session_key.recover_enable_signer(typed, "0xnot-a-signature")
    with pytest.raises(ValueError):
        session_key.recover_enable_signer(typed, "")


def test_load_active_session_key_none_before_activation():
    assert session_key.load_active_session_key(env="mainnet") is None


def test_load_active_session_key_none_when_expired():
    address, priv_hex = session_key.generate_session_key()
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": 1, "dailyUsdCap": 50.0}
    session_key.store_session_key(address, priv_hex, policy, "0xsig", env="mainnet")
    assert session_key.load_active_session_key(env="mainnet") is None


def test_load_active_session_key_returns_record_when_valid():
    address, priv_hex = session_key.generate_session_key()
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": int(time.time()) + 3600, "dailyUsdCap": 50.0}
    session_key.store_session_key(address, priv_hex, policy, "0xsig", env="mainnet")
    record = session_key.load_active_session_key(env="mainnet")
    assert record is not None
    assert record["address"] == address


def test_revoke_session_key_soft_deactivates():
    address, priv_hex = session_key.generate_session_key()
    policy = {"allowedCaller": "0xE111180000d2663C0091e4f400237545B87B996B", "validUntil": int(time.time()) + 3600, "dailyUsdCap": 50.0}
    session_key.store_session_key(address, priv_hex, policy, "0xsig", env="mainnet")
    session_key.revoke_session_key_soft(env="mainnet")
    assert session_key.load_active_session_key(env="mainnet") is None

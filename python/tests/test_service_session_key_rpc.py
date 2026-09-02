import asyncio

import pytest

import service


KERNEL_ADDRESS = "0x000000000000000000000000000000000000dEaD"
ALLOWED_CALLER = "0xE111180000d2663C0091e4f400237545B87B996B"
NEG_RISK_CALLER = "0xe2222d279d744050d28e00520010520000310F59"


def _owner():
    from eth_account import Account
    return Account.create()


def _sign_enable(owner, typed_data) -> str:
    from eth_account.messages import encode_typed_data
    return owner.sign_message(encode_typed_data(full_message=typed_data)).signature.hex()


def _mint(owner_address, **overrides):
    params = {
        "kernelAddress": KERNEL_ADDRESS,
        "allowedCallers": [ALLOWED_CALLER, NEG_RISK_CALLER],
        "validUntil": 1893456000,
        "dailyUsdCap": 50.0,
        "ownerAddress": owner_address,
    }
    params.update(overrides)
    return asyncio.run(service._h_mintSessionKey(params))


@pytest.fixture(autouse=True)
def _isolated_userdata(tmp_path, monkeypatch):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    import polymarket_auth
    polymarket_auth.reset_credential_cache()
    service._pending_session_key = None
    yield
    service._pending_session_key = None


def test_mint_then_activate_session_key():
    import polymarket_auth
    import session_key

    owner = _owner()
    mint_result = _mint(owner.address)
    assert mint_result["sessionKeyAddress"].startswith("0x")
    typed = mint_result["enableTypedData"]
    assert typed["message"]["sessionKeyAddress"] == mint_result["sessionKeyAddress"]
    assert typed["message"]["allowedCallers"] == [ALLOWED_CALLER, NEG_RISK_CALLER]

    activate_result = asyncio.run(
        service._h_activateSessionKey({"signature": _sign_enable(owner, typed)})
    )
    assert activate_result == {"ok": True}

    record = session_key.load_active_session_key()
    assert record is not None
    assert record["address"] == mint_result["sessionKeyAddress"]
    assert record["policy"]["ownerAddress"] == owner.address
    assert record["policy"]["allowedCallers"] == [ALLOWED_CALLER, NEG_RISK_CALLER]

    # Activation must also open create_signed_order's session-key gate —
    # nothing else in the webapp flow can set the signature type.
    assert polymarket_auth.get_signature_type() == polymarket_auth.SIGNATURE_TYPE_POLY_1271
    assert polymarket_auth.get_funder().lower() == KERNEL_ADDRESS.lower()

    revoke_result = asyncio.run(service._h_revokeSessionKey({}))
    assert revoke_result == {"ok": True}
    assert session_key.load_active_session_key() is None


def test_activate_rejects_signature_from_a_different_address():
    """The consent signature is the only thing gating an unattended trading
    key, so a signature from anyone but the session's owner must not
    activate it."""
    import session_key

    owner = _owner()
    attacker = _owner()
    typed = _mint(owner.address)["enableTypedData"]

    with pytest.raises(ValueError, match="not produced by the session owner"):
        asyncio.run(
            service._h_activateSessionKey({"signature": _sign_enable(attacker, typed)})
        )
    assert session_key.load_active_session_key() is None
    # The pending key survives so the owner can still sign the same payload.
    assert service._pending_session_key is not None


def test_activate_rejects_signature_over_different_typed_data():
    """A signature over a tampered payload (e.g. a longer expiry or a
    different session key) recovers to some other address, not the owner."""
    import session_key

    owner = _owner()
    typed = _mint(owner.address)["enableTypedData"]
    tampered = {**typed, "message": {**typed["message"], "validUntil": 4102444800}}

    with pytest.raises(ValueError, match="not produced by the session owner"):
        asyncio.run(
            service._h_activateSessionKey({"signature": _sign_enable(owner, tampered)})
        )
    assert session_key.load_active_session_key() is None


def test_activate_rejects_garbage_signature():
    owner = _owner()
    _mint(owner.address)
    with pytest.raises(ValueError):
        asyncio.run(service._h_activateSessionKey({"signature": "0xdeadsignature"}))


def test_activate_requires_a_signature():
    owner = _owner()
    _mint(owner.address)
    with pytest.raises(ValueError, match="signature is required"):
        asyncio.run(service._h_activateSessionKey({}))


def test_activate_without_pending_key_is_a_value_error():
    # ValueError (not RuntimeError) so the gateway maps it to 400, not 502.
    with pytest.raises(ValueError, match="no pending session key"):
        asyncio.run(service._h_activateSessionKey({"signature": "0xabc"}))


@pytest.mark.parametrize("cap", [0, 0.0, -1.0, None])
def test_mint_rejects_non_positive_daily_cap(cap):
    with pytest.raises(ValueError, match="dailyUsdCap must be greater than 0"):
        _mint(_owner().address, dailyUsdCap=cap)


def test_mint_accepts_legacy_single_allowed_caller():
    owner = _owner()
    result = _mint(owner.address, allowedCallers=None, allowedCaller=ALLOWED_CALLER)
    assert result["enableTypedData"]["message"]["allowedCallers"] == [ALLOWED_CALLER]

from datetime import datetime, timezone

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from siwe import SiweMessage

from webserver import auth


def _build_signed_message(account, nonce: str) -> tuple[str, str]:
    msg = SiweMessage(
        domain="localhost",
        address=account.address,
        statement="Sign in to Krypt PolyBot",
        uri="http://localhost/auth",
        version="1",
        chain_id=137,
        nonce=nonce,
        issued_at=datetime.now(timezone.utc).isoformat(),
    )
    prepared = msg.prepare_message()
    signed = Account.sign_message(encode_defunct(text=prepared), private_key=account.key)
    return prepared, signed.signature.hex()


def test_verify_siwe_accepts_valid_signature():
    account = Account.create()
    nonce = auth.generate_nonce()
    message, signature = _build_signed_message(account, nonce)

    address = auth.verify_siwe(message, signature)

    assert address.lower() == account.address.lower()


def test_verify_siwe_rejects_reused_nonce():
    account = Account.create()
    nonce = auth.generate_nonce()
    message, signature = _build_signed_message(account, nonce)
    auth.verify_siwe(message, signature)

    with pytest.raises(auth.AuthError):
        auth.verify_siwe(message, signature)


def test_verify_siwe_rejects_unknown_nonce():
    account = Account.create()
    message, signature = _build_signed_message(account, "0" * 32)

    with pytest.raises(auth.AuthError):
        auth.verify_siwe(message, signature)


def test_verify_siwe_rejects_wrong_signer():
    account = Account.create()
    other = Account.create()
    nonce = auth.generate_nonce()
    message, _ = _build_signed_message(account, nonce)
    _, wrong_signature = _build_signed_message(other, nonce)

    with pytest.raises(auth.AuthError):
        auth.verify_siwe(message, wrong_signature)


_TEST_SECRET = "test-secret-at-least-32-bytes-long-for-hs256"
_OTHER_SECRET = "other-secret-at-least-32-bytes-long-too"


def test_session_token_round_trip():
    token = auth.create_session_token("0xABC", secret=_TEST_SECRET)

    address = auth.decode_session_token(token, secret=_TEST_SECRET)

    assert address == "0xABC"


def test_session_token_rejects_wrong_secret():
    token = auth.create_session_token("0xABC", secret=_TEST_SECRET)

    with pytest.raises(auth.AuthError):
        auth.decode_session_token(token, secret=_OTHER_SECRET)

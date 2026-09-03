from datetime import datetime, timezone

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from siwe import SiweMessage

from webserver import auth


_DOMAIN = "localhost"


def _build_signed_message(account, nonce: str, *, domain: str = _DOMAIN, chain_id: int = 137,
                           uri: str | None = None) -> tuple[str, str]:
    msg = SiweMessage(
        domain=domain,
        address=account.address,
        statement="Sign in to Pocketed",
        uri=uri or f"http://{domain}/auth",
        version="1",
        chain_id=chain_id,
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

    address = auth.verify_siwe(message, signature, expected_domain=_DOMAIN)

    assert address.lower() == account.address.lower()


def test_verify_siwe_rejects_reused_nonce():
    account = Account.create()
    nonce = auth.generate_nonce()
    message, signature = _build_signed_message(account, nonce)
    auth.verify_siwe(message, signature, expected_domain=_DOMAIN)

    with pytest.raises(auth.AuthError):
        auth.verify_siwe(message, signature, expected_domain=_DOMAIN)


def test_verify_siwe_rejects_unknown_nonce():
    account = Account.create()
    message, signature = _build_signed_message(account, "0" * 32)

    with pytest.raises(auth.AuthError):
        auth.verify_siwe(message, signature, expected_domain=_DOMAIN)


def test_verify_siwe_rejects_garbage_signature():
    account = Account.create()
    nonce = auth.generate_nonce()
    message, _ = _build_signed_message(account, nonce)

    with pytest.raises(auth.AuthError):
        auth.verify_siwe(message, "0x" + "00" * 65, expected_domain=_DOMAIN)


def test_verify_siwe_rejects_wrong_signer():
    account = Account.create()
    other = Account.create()
    nonce = auth.generate_nonce()
    message, _ = _build_signed_message(account, nonce)
    _, wrong_signature = _build_signed_message(other, nonce)

    with pytest.raises(auth.AuthError):
        auth.verify_siwe(message, wrong_signature, expected_domain=_DOMAIN)


def test_verify_siwe_rejects_domain_mismatch():
    """A message validly signed for a *different* site must not authenticate
    here — this is what stops a relayed/phished SIWE signature from another
    origin being replayed against Pocketed's gateway."""
    account = Account.create()
    nonce = auth.generate_nonce()
    message, signature = _build_signed_message(account, nonce, domain="evil.example",
                                                 uri="http://evil.example/auth")

    with pytest.raises(auth.AuthError):
        auth.verify_siwe(message, signature, expected_domain=_DOMAIN)


def test_verify_siwe_rejects_uri_host_not_matching_domain():
    account = Account.create()
    nonce = auth.generate_nonce()
    message, signature = _build_signed_message(account, nonce, uri="http://attacker.example/auth")

    with pytest.raises(auth.AuthError):
        auth.verify_siwe(message, signature, expected_domain=_DOMAIN)


def test_verify_siwe_rejects_unsupported_chain_id():
    account = Account.create()
    nonce = auth.generate_nonce()
    message, signature = _build_signed_message(account, nonce, chain_id=1)  # Ethereum mainnet, not Polygon

    with pytest.raises(auth.AuthError):
        auth.verify_siwe(message, signature, expected_domain=_DOMAIN)


_TEST_SECRET = "test-secret-at-least-32-bytes-long-for-hs256"
_OTHER_SECRET = "other-secret-at-least-32-bytes-long-too"


def test_session_token_round_trip():
    token = auth.create_session_token(["0xABC"], active="0xABC", secret=_TEST_SECRET)

    payload = auth.decode_session_token(token, secret=_TEST_SECRET)

    assert payload["wallets"] == ["0xABC"]
    assert payload["active"] == "0xABC"
    assert payload["sid"] and payload["jti"]


def test_session_token_rejects_wrong_secret():
    token = auth.create_session_token(["0xABC"], active="0xABC", secret=_TEST_SECRET)

    with pytest.raises(auth.AuthError):
        auth.decode_session_token(token, secret=_OTHER_SECRET)


def test_create_session_token_carries_wallets_and_active():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    payload = auth.decode_session_token(token, secret="s")
    assert payload["wallets"] == ["0xAAA"]
    assert payload["active"] == "0xAAA"


def test_add_wallet_to_session_appends_and_activates():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    token2 = auth.add_wallet_to_session(token, "0xBBB", secret="s")
    payload = auth.decode_session_token(token2, secret="s")
    assert payload["wallets"] == ["0xAAA", "0xBBB"]
    assert payload["active"] == "0xBBB"


def test_add_wallet_to_session_keeps_the_same_sid():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    sid1 = auth.decode_session_token(token, secret="s")["sid"]
    token2 = auth.add_wallet_to_session(token, "0xBBB", secret="s")
    sid2 = auth.decode_session_token(token2, secret="s")["sid"]
    assert sid1 == sid2


def test_add_wallet_to_session_dedupes():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    token2 = auth.add_wallet_to_session(token, "0xAAA", secret="s")
    payload = auth.decode_session_token(token2, secret="s")
    assert payload["wallets"] == ["0xAAA"]
    assert payload["active"] == "0xAAA"


def test_switch_active_wallet_requires_membership():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    with pytest.raises(auth.AuthError):
        auth.switch_active_wallet(token, "0xCCC", secret="s")


def test_switch_active_wallet_ok():
    token = auth.create_session_token(["0xAAA", "0xBBB"], active="0xAAA", secret="s")
    token2 = auth.switch_active_wallet(token, "0xBBB", secret="s")
    payload = auth.decode_session_token(token2, secret="s")
    assert payload["active"] == "0xBBB"


def test_session_is_active_true_for_a_fresh_session():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    sid = auth.decode_session_token(token, secret="s")["sid"]
    assert auth.session_is_active(sid) is True


def test_revoke_session_deactivates_it():
    token = auth.create_session_token(["0xAAA"], active="0xAAA", secret="s")
    sid = auth.decode_session_token(token, secret="s")["sid"]

    auth.revoke_session(token, secret="s")

    assert auth.session_is_active(sid) is False


def test_revoke_session_on_a_garbled_token_does_not_raise():
    auth.revoke_session("not-a-valid-jwt", secret="s")  # best-effort, no exception


def test_switch_active_wallet_fails_after_revoke():
    token = auth.create_session_token(["0xAAA", "0xBBB"], active="0xAAA", secret="s")
    auth.revoke_session(token, secret="s")

    with pytest.raises(auth.AuthError):
        auth.switch_active_wallet(token, "0xBBB", secret="s")

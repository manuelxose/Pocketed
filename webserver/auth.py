from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import jwt
from siwe import SiweMessage, VerificationError

from webserver.nonce_store import NonceStore, create_nonce_store
from webserver.session_store import SessionNotFound, SessionStore, create_session_store

# Overridable only for deterministic E2E/integration testing (e.g. exercising
# session-expiry rejection without a real 24h wait). Never set in production —
# nothing here weakens the check itself, only how long a valid token lasts.
SESSION_TTL_SECONDS = int(os.environ.get("POCKETED_SESSION_TTL_SECONDS", 24 * 60 * 60))

# EIP-155 chain IDs this deployment accepts SIWE sign-ins for. Polygon
# mainnet (137) is Pocketed's only supported chain today (see CTF_EXCHANGE_V2
# constants in webserver/main.py); override via env for staging/testnets
# (e.g. "80002" for Polygon Amoy) — never left open ("any chain accepted")
# since that would let a message signed for an unrelated chain authenticate.
_ALLOWED_CHAIN_IDS = {
    int(c) for c in os.environ.get("POCKETED_SIWE_CHAIN_IDS", "137").split(",") if c.strip()
}

_nonce_store: NonceStore = create_nonce_store()
_session_store: SessionStore = create_session_store()


class AuthError(Exception):
    """Raised when SIWE nonce issuance/verification or session decoding fails."""


def generate_nonce() -> str:
    return _nonce_store.issue()


def _consume_nonce(nonce: str) -> bool:
    return _nonce_store.consume(nonce)


def verify_siwe(message: str, signature: str, *, expected_domain: str) -> str:
    """Verify a signed SIWE (EIP-4361) message. Returns the wallet address on
    success. Raises AuthError on any failure — bad signature, malformed
    message, wrong domain/URI/chain, or a nonce we didn't issue / already used.

    `expected_domain` is the Host this request actually arrived on (or an
    operator-configured public domain — see POCKETED_SIWE_DOMAINS in
    webserver/main.py). Without pinning `domain` (and `uri`'s host, which
    EIP-4361 requires to match `domain`) an attacker could relay a SIWE
    message the user signed for a *different* site — siwe's own `.verify()`
    only checks domain/nonce/expiry when explicitly told to, so every check
    below is deliberate, not redundant with the library.
    """
    try:
        siwe_message = SiweMessage.from_message(message)
    except Exception as e:
        raise AuthError(f"malformed SIWE message: {e}") from e

    if not _consume_nonce(siwe_message.nonce):
        raise AuthError("nonce missing, expired, or already used")

    if siwe_message.chain_id not in _ALLOWED_CHAIN_IDS:
        raise AuthError(
            f"chain_id {siwe_message.chain_id} is not accepted "
            f"(allowed: {sorted(_ALLOWED_CHAIN_IDS)})"
        )

    uri_host = urlsplit(siwe_message.uri).netloc
    if uri_host != siwe_message.domain:
        raise AuthError("SIWE uri does not match SIWE domain")

    try:
        siwe_message.verify(signature, domain=expected_domain)
    except VerificationError as e:
        raise AuthError(f"signature verification failed: {e}") from e
    except Exception as e:
        # siwe/eth_account can raise other exception types (e.g.
        # eth_keys.exceptions.BadSignature) for a malformed-but-not-quite
        # VerificationError signature — treat all of them as auth failure.
        raise AuthError(f"signature verification failed: {e}") from e

    return siwe_message.address


def _sign(wallets: list[str], active: str, *, sid: str, jti: str, secret: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "wallets": wallets,
        "active": active,
        "sid": sid,
        "jti": jti,
        "iat": now,
        "exp": now + timedelta(seconds=SESSION_TTL_SECONDS),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def create_session_token(
    wallets: list[str], *, active: str, secret: str, store: SessionStore | None = None
) -> str:
    store = store or _session_store
    sid, jti = store.create(wallets, active, ttl_seconds=SESSION_TTL_SECONDS)
    return _sign(wallets, active, sid=sid, jti=jti, secret=secret)


def decode_session_token(token: str, *, secret: str) -> dict:
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise AuthError(f"invalid session token: {e}") from e
    wallets = payload.get("wallets")
    active = payload.get("active")
    sid = payload.get("sid")
    if not wallets or not active or not sid:
        raise AuthError("session token missing wallets/active/sid")
    return {"wallets": wallets, "active": active, "sid": sid, "jti": payload.get("jti")}


def session_is_active(sid: str, *, store: SessionStore | None = None) -> bool:
    store = store or _session_store
    return store.is_active(sid)


def add_wallet_to_session(
    token: str, new_wallet: str, *, secret: str, store: SessionStore | None = None
) -> str:
    store = store or _session_store
    payload = decode_session_token(token, secret=secret)
    wallets = payload["wallets"]
    if new_wallet not in wallets:
        wallets = [*wallets, new_wallet]
    try:
        jti = store.touch(payload["sid"], wallets=wallets, active=new_wallet, ttl_seconds=SESSION_TTL_SECONDS)
    except SessionNotFound as e:
        raise AuthError("session no longer active") from e
    return _sign(wallets, new_wallet, sid=payload["sid"], jti=jti, secret=secret)


def switch_active_wallet(
    token: str, wallet: str, *, secret: str, store: SessionStore | None = None
) -> str:
    store = store or _session_store
    payload = decode_session_token(token, secret=secret)
    if wallet not in payload["wallets"]:
        raise AuthError(f"wallet {wallet} is not linked to this session")
    try:
        jti = store.touch(
            payload["sid"], wallets=payload["wallets"], active=wallet, ttl_seconds=SESSION_TTL_SECONDS
        )
    except SessionNotFound as e:
        raise AuthError("session no longer active") from e
    return _sign(payload["wallets"], wallet, sid=payload["sid"], jti=jti, secret=secret)


def revoke_session(token: str, *, secret: str, store: SessionStore | None = None) -> None:
    """Best-effort: a missing/garbled cookie is not an error (matches the
    pre-existing /auth/logout behavior of always succeeding)."""
    store = store or _session_store
    try:
        payload = decode_session_token(token, secret=secret)
    except AuthError:
        return
    store.revoke(payload["sid"])

from __future__ import annotations

import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import jwt
from siwe import SiweMessage, VerificationError

NONCE_TTL_SECONDS = 5 * 60
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

# MVP: in-process nonce store. A restart or a multi-instance deployment
# invalidates outstanding nonces — acceptable for a single-process Fase 1
# foundation; move to a shared store (e.g. Redis) before Fase 4 scales past
# one gateway process.
_nonces: dict[str, float] = {}


class AuthError(Exception):
    """Raised when SIWE nonce issuance/verification or session decoding fails."""


def generate_nonce() -> str:
    nonce = secrets.token_hex(16)
    _nonces[nonce] = time.monotonic() + NONCE_TTL_SECONDS
    _prune_nonces()
    return nonce


def _prune_nonces() -> None:
    now = time.monotonic()
    for n in [n for n, exp in _nonces.items() if exp < now]:
        _nonces.pop(n, None)


def _consume_nonce(nonce: str) -> bool:
    exp = _nonces.pop(nonce, None)
    return exp is not None and exp >= time.monotonic()


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


def create_session_token(wallets: list[str], *, active: str, secret: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "wallets": wallets,
        "active": active,
        "iat": now,
        "exp": now + timedelta(seconds=SESSION_TTL_SECONDS),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_session_token(token: str, *, secret: str) -> dict:
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise AuthError(f"invalid session token: {e}") from e
    wallets = payload.get("wallets")
    active = payload.get("active")
    if not wallets or not active:
        raise AuthError("session token missing wallets/active")
    return {"wallets": wallets, "active": active}


def add_wallet_to_session(token: str, new_wallet: str, *, secret: str) -> str:
    payload = decode_session_token(token, secret=secret)
    wallets = payload["wallets"]
    if new_wallet not in wallets:
        wallets = [*wallets, new_wallet]
    return create_session_token(wallets, active=new_wallet, secret=secret)


def switch_active_wallet(token: str, wallet: str, *, secret: str) -> str:
    payload = decode_session_token(token, secret=secret)
    if wallet not in payload["wallets"]:
        raise AuthError(f"wallet {wallet} is not linked to this session")
    return create_session_token(payload["wallets"], active=wallet, secret=secret)

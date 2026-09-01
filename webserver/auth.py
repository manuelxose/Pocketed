from __future__ import annotations

import secrets
import time
from datetime import datetime, timedelta, timezone

import jwt
from siwe import SiweMessage, VerificationError

NONCE_TTL_SECONDS = 5 * 60
SESSION_TTL_SECONDS = 24 * 60 * 60

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


def verify_siwe(message: str, signature: str) -> str:
    """Verify a signed SIWE (EIP-4361) message. Returns the wallet address on
    success. Raises AuthError on any failure — bad signature, malformed
    message, or a nonce we didn't issue / already consumed."""
    try:
        siwe_message = SiweMessage.from_message(message)
    except Exception as e:
        raise AuthError(f"malformed SIWE message: {e}") from e

    if not _consume_nonce(siwe_message.nonce):
        raise AuthError("nonce missing, expired, or already used")

    try:
        siwe_message.verify(signature)
    except VerificationError as e:
        raise AuthError(f"signature verification failed: {e}") from e
    except Exception as e:
        # siwe/eth_account can raise other exception types (e.g.
        # eth_keys.exceptions.BadSignature) for a malformed-but-not-quite
        # VerificationError signature — treat all of them as auth failure.
        raise AuthError(f"signature verification failed: {e}") from e

    return siwe_message.address


def create_session_token(wallet_address: str, *, secret: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": wallet_address,
        "iat": now,
        "exp": now + timedelta(seconds=SESSION_TTL_SECONDS),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_session_token(token: str, *, secret: str) -> str:
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise AuthError(f"invalid session token: {e}") from e
    sub = payload.get("sub")
    if not sub:
        raise AuthError("session token missing subject")
    return sub

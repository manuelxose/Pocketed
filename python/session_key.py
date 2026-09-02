from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

import polymarket_auth as _auth


def generate_session_key() -> tuple[str, str]:
    """Generates a fresh ephemeral ECDSA keypair for use as a Kernel
    session key. Returns (address, private_key_hex) — the private key is
    never persisted in plaintext by this function; callers must pass it
    straight to store_session_key()."""
    from eth_account import Account
    acct = Account.create()
    priv = acct.key.hex()
    if not priv.startswith("0x"):
        priv = "0x" + priv
    return acct.address, priv


def session_key_file(env: str = _auth.NETWORK) -> Path:
    return _auth._credentials_dir() / f"sessionkey.{_auth._validate_env(env)}.json"


def store_session_key(
    address: str, private_key_hex: str, policy: dict, enable_signature: str,
    env: str = _auth.NETWORK,
) -> None:
    record = {
        "address": address,
        "privateKey": private_key_hex,
        "policy": policy,
        "enableSignature": enable_signature,
        "active": True,
        "createdAt": int(time.time()),
    }
    _auth._write_secret_bytes(session_key_file(env), json.dumps(record).encode("utf-8"))


def load_session_key_record(env: str = _auth.NETWORK) -> Optional[dict]:
    f = session_key_file(env)
    if not f.exists():
        return None
    try:
        data = json.loads(_auth._read_secret_bytes(f).decode("utf-8", "replace"))
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get("address") or not data.get("privateKey"):
        return None
    return data

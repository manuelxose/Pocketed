# webserver/nonce_store.py
from __future__ import annotations

import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Protocol

from webserver._store_common import redis_client_from_env

NONCE_TTL_SECONDS = 5 * 60


class NonceStore(Protocol):
    def issue(self) -> str: ...
    def consume(self, nonce: str) -> bool: ...


class SqliteNonceStore:
    """File-backed, atomic-consume nonce store. Safe across multiple
    `SqliteNonceStore` instances (processes) pointed at the same db file:
    `consume` takes a RESERVED lock via BEGIN IMMEDIATE, so a concurrent
    second consumer either sees the row already gone or blocks (via
    PRAGMA busy_timeout) until the first transaction commits."""

    def __init__(self, db_path: Path, *, ttl_seconds: int = NONCE_TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA busy_timeout = 5000")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at REAL NOT NULL)"
        )

    def issue(self) -> str:
        nonce = secrets.token_hex(16)
        now = time.time()
        self._conn.execute("DELETE FROM nonces WHERE expires_at < ?", (now,))
        self._conn.execute(
            "INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)", (nonce, now + self._ttl)
        )
        return nonce

    def consume(self, nonce: str) -> bool:
        now = time.time()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            cur = self._conn.execute(
                "DELETE FROM nonces WHERE nonce = ? AND expires_at >= ?", (nonce, now)
            )
            ok = cur.rowcount > 0
            self._conn.execute("COMMIT")
            return ok
        except Exception:
            self._conn.execute("ROLLBACK")
            raise


class RedisNonceStore:
    """Multi-host-safe nonce store. `consume` uses GETDEL (Redis >= 6.2),
    atomic on the server side: a concurrent second GETDEL for the same key
    returns None because the first call already deleted it."""

    def __init__(self, client, *, ttl_seconds: int = NONCE_TTL_SECONDS) -> None:
        self._client = client
        self._ttl = ttl_seconds

    def issue(self) -> str:
        nonce = secrets.token_hex(16)
        self._client.set(f"nonce:{nonce}", "1", ex=self._ttl)
        return nonce

    def consume(self, nonce: str) -> bool:
        return self._client.getdel(f"nonce:{nonce}") is not None


def _default_nonce_db_path() -> Path:
    auth_data_dir = Path(
        os.environ.get(
            "POCKETED_AUTH_DATA_DIR",
            str(Path(__file__).resolve().parent.parent / "python" / "data" / "webapp" / "auth"),
        )
    )
    return auth_data_dir / "nonces.db"


def create_nonce_store() -> NonceStore:
    kind = os.environ.get("POCKETED_NONCE_STORE", "sqlite")
    if kind == "redis":
        return RedisNonceStore(redis_client_from_env())
    return SqliteNonceStore(_default_nonce_db_path())

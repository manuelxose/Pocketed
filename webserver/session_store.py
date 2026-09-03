# webserver/session_store.py
from __future__ import annotations

import json
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Protocol

from webserver._store_common import redis_client_from_env


class SessionNotFound(Exception):
    """Raised by `touch()` when `sid` doesn't exist, is revoked, or expired."""


class SessionStore(Protocol):
    def create(self, wallets: list[str], active: str, *, ttl_seconds: int) -> tuple[str, str]: ...
    def touch(self, sid: str, *, wallets: list[str], active: str, ttl_seconds: int) -> str: ...
    def is_active(self, sid: str) -> bool: ...
    def revoke(self, sid: str) -> None: ...


class SqliteSessionStore:
    """File-backed session store. Safe across multiple `SqliteSessionStore`
    instances (processes) pointed at the same db file: `touch` and `revoke`
    are single UPDATE statements, so SQLite's own locking (backed by
    PRAGMA busy_timeout) serializes concurrent writers on the same row."""

    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA busy_timeout = 5000")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions ("
            "sid TEXT PRIMARY KEY, jti TEXT NOT NULL, wallets TEXT NOT NULL, "
            "active TEXT NOT NULL, expires_at REAL NOT NULL, "
            "revoked INTEGER NOT NULL DEFAULT 0)"
        )

    def create(self, wallets: list[str], active: str, *, ttl_seconds: int) -> tuple[str, str]:
        sid = secrets.token_hex(16)
        jti = secrets.token_hex(16)
        self._conn.execute(
            "INSERT INTO sessions (sid, jti, wallets, active, expires_at, revoked) "
            "VALUES (?, ?, ?, ?, ?, 0)",
            (sid, jti, json.dumps(wallets), active, time.time() + ttl_seconds),
        )
        return sid, jti

    def touch(self, sid: str, *, wallets: list[str], active: str, ttl_seconds: int) -> str:
        jti = secrets.token_hex(16)
        now = time.time()
        cur = self._conn.execute(
            "UPDATE sessions SET jti = ?, wallets = ?, active = ?, expires_at = ? "
            "WHERE sid = ? AND revoked = 0 AND expires_at > ?",
            (jti, json.dumps(wallets), active, now + ttl_seconds, sid, now),
        )
        if cur.rowcount == 0:
            raise SessionNotFound(sid)
        return jti

    def is_active(self, sid: str) -> bool:
        row = self._conn.execute(
            "SELECT revoked, expires_at FROM sessions WHERE sid = ?", (sid,)
        ).fetchone()
        if row is None:
            return False
        revoked, expires_at = row
        return revoked == 0 and expires_at > time.time()

    def revoke(self, sid: str) -> None:
        self._conn.execute("UPDATE sessions SET revoked = 1 WHERE sid = ?", (sid,))


class RedisSessionStore:
    """Multi-host-safe session store. `touch` uses SET ... XX so a
    revoked/expired/unknown sid is never silently resurrected — the key
    must already exist for the overwrite to take effect."""

    def __init__(self, client) -> None:
        self._client = client

    @staticmethod
    def _key(sid: str) -> str:
        return f"session:{sid}"

    def create(self, wallets: list[str], active: str, *, ttl_seconds: int) -> tuple[str, str]:
        sid = secrets.token_hex(16)
        jti = secrets.token_hex(16)
        value = json.dumps({"jti": jti, "wallets": wallets, "active": active})
        self._client.set(self._key(sid), value, ex=ttl_seconds)
        return sid, jti

    def touch(self, sid: str, *, wallets: list[str], active: str, ttl_seconds: int) -> str:
        jti = secrets.token_hex(16)
        value = json.dumps({"jti": jti, "wallets": wallets, "active": active})
        # XX: only overwrite a key that already exists — a revoked/expired/
        # unknown sid must not be silently resurrected by touch().
        ok = self._client.set(self._key(sid), value, ex=ttl_seconds, xx=True)
        if not ok:
            raise SessionNotFound(sid)
        return jti

    def is_active(self, sid: str) -> bool:
        return bool(self._client.exists(self._key(sid)))

    def revoke(self, sid: str) -> None:
        self._client.delete(self._key(sid))


def _default_session_db_path() -> Path:
    auth_data_dir = Path(
        os.environ.get(
            "POCKETED_AUTH_DATA_DIR",
            str(Path(__file__).resolve().parent.parent / "python" / "data" / "webapp" / "auth"),
        )
    )
    return auth_data_dir / "sessions.db"


def create_session_store() -> SessionStore:
    kind = os.environ.get("POCKETED_SESSION_STORE", "sqlite")
    if kind == "redis":
        return RedisSessionStore(redis_client_from_env())
    return SqliteSessionStore(_default_session_db_path())

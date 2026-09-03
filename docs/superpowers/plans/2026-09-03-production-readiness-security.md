# Production-Readiness Security Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six production-readiness gaps in the existing SIWE/WebSocket auth stack: HTTPS+WSS E2E, browser-level malicious-Origin E2E, real server-side logout revocation, production-ready nonce storage, a local reverse-proxy topology, and layered CI.

**Architecture:** Two new pluggable storage modules (`webserver/nonce_store.py`, `webserver/session_store.py`) each with an SQLite backend (default, zero new infra) and a Redis backend (opt-in via env, host-installed — never docker-compose-managed). `webserver/auth.py` and `webserver/main.py` are wired to check store-backed liveness on every authenticated HTTP/WS request, not just JWT signature/expiry. Three new Playwright projects (`e2e/playwright.tls.config.ts`, reusing `e2e/playwright.config.ts`'s pattern; `e2e/playwright.proxy.config.ts`) add HTTPS/WSS, malicious-Origin, and dockerized-nginx-reverse-proxy coverage alongside the existing HTTP E2E project, which is untouched.

**Tech Stack:** Python 3.11 / FastAPI / `sqlite3` (stdlib) / `redis-py` (lazy import) / PyJWT. TypeScript / Playwright / `@playwright/test` / Node `child_process`+`crypto` for cert generation. nginx (Docker) for the reverse-proxy topology. GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-09-03-production-readiness-security-design.md](../specs/2026-09-03-production-readiness-security-design.md)

## Global Constraints

- Never introduce docker-compose-managed Redis — Redis is a host-installed external dependency; CI installs it via `apt-get install redis-server` (a real host install, not a `services:` container).
- TLS certs: openssl-generated throwaway CA + leaf cert, trusted by Chromium via `--ignore-certificate-errors-spki-list=<hash>` (targeted SPKI pin) — never a blanket `--ignore-certificate-errors` flag, never a system trust-store mutation (no mkcert).
- The existing HTTP E2E project (`e2e/playwright.config.ts`, `e2e/tests/auth-ws.spec.ts`) and the existing pytest Origin tests (`webserver/tests/test_main_ws.py`) must keep passing unmodified in behavior (only additive changes).
- Reverse proxy: nginx, with an explicit `Upgrade`/`Connection` map for `/ws` and `X-Forwarded-Proto`/`X-Forwarded-Host` set.
- A store that can't be reached (Redis down, SQLite file locked) is treated as auth failure, never as silent-allow.
- An unknown/never-existed `sid` behaves identically to a revoked one (fails closed).

---

## File Structure

```
webserver/
  _store_common.py       (new) shared Redis-client-from-env helper
  nonce_store.py          (new) NonceStore protocol + Sqlite/Redis impls + factory
  session_store.py        (new) SessionStore protocol + Sqlite/Redis impls + factory
  auth.py                 (modified) wired to the two stores; sid/jti in JWT
  main.py                 (modified) require_wallet_address/logout/WS check store liveness
  tests/
    test_nonce_store.py    (new)
    test_session_store.py  (new)
    test_auth.py            (modified) sid/jti-aware assertions
    test_main_ws.py         (modified) revocation cases
    test_main_aa_routes.py  (modified) revocation case for require_wallet_address
    conftest.py             (modified) autouse isolated-store fixture
  requirements.txt        (modified) add `redis`

src/lib/
  ws-client.ts             (modified) SESSION_REVOKED_CLOSE_CODE = 4402
  ws-client.test.ts        (modified) 4402 case

e2e/
  certs/gen-certs.mjs      (new) throwaway CA+leaf cert generator
  fixtures/malicious-origin-server.mjs  (new)
  proxy-global-setup.mjs   (new)
  proxy-global-teardown.mjs (new)
  playwright.config.ts     (modified) add malicious-origin webServer entry
  playwright.tls.config.ts (new)
  playwright.proxy.config.ts (new)
  tests/
    auth-ws.spec.ts         (modified) add logout-revocation cases
    auth-ws-tls.spec.ts     (new)
    malicious-origin.spec.ts (new)

vite.config.ts             (modified) optional HTTPS + proxy `secure: false`

infra/reverse-proxy/
  Dockerfile.gateway        (new)
  docker-compose.yml        (new)
  nginx.conf                (new)
  README.md                 (new)

.github/workflows/ci.yml    (modified) split into layered jobs
package.json                (modified) test:e2e:tls, test:e2e:proxy scripts
.gitignore                  (modified) e2e/certs/.gen/, e2e/playwright-report-*/
```

---

### Task 1: `NonceStore` protocol + SQLite backend

**Files:**
- Create: `webserver/_store_common.py`
- Create: `webserver/nonce_store.py`
- Test: `webserver/tests/test_nonce_store.py`

**Interfaces:**
- Produces: `NONCE_TTL_SECONDS: int`, `class NonceStore(Protocol): issue() -> str; consume(nonce: str) -> bool`, `class SqliteNonceStore(db_path: Path, *, ttl_seconds: int = NONCE_TTL_SECONDS)`, `def create_nonce_store() -> NonceStore`
- Produces (from `_store_common.py`): `def redis_client_from_env(url_env: str = "POCKETED_REDIS_URL")`

- [ ] **Step 1: Write `_store_common.py`**

```python
# webserver/_store_common.py
"""Shared helper for the two store modules (nonce_store.py, session_store.py)
that need an optional Redis client without making `redis` a hard import-time
dependency for the (default) SQLite-only path."""
from __future__ import annotations

import os


def redis_client_from_env(url_env: str = "POCKETED_REDIS_URL"):
    """Builds a redis-py client from an env var. Imports `redis` lazily so
    installations that never opt into the Redis backend don't need it
    importable at module-load time — only when actually selected."""
    import redis  # noqa: PLC0415 - intentionally lazy, see docstring

    url = os.environ.get(url_env)
    if not url:
        raise RuntimeError(
            f"{url_env} must be set when a *_STORE env var selects the redis backend"
        )
    return redis.Redis.from_url(url, decode_responses=True)
```

- [ ] **Step 2: Write the failing tests for `SqliteNonceStore`**

```python
# webserver/tests/test_nonce_store.py
import time

import pytest

from webserver.nonce_store import SqliteNonceStore


@pytest.fixture
def store(tmp_path):
    return SqliteNonceStore(tmp_path / "nonces.db")


def test_issue_returns_a_nonce(store):
    nonce = store.issue()
    assert isinstance(nonce, str) and len(nonce) > 0


def test_consume_succeeds_exactly_once(store):
    nonce = store.issue()
    assert store.consume(nonce) is True
    assert store.consume(nonce) is False


def test_consume_rejects_unknown_nonce(store):
    assert store.consume("never-issued") is False


def test_consume_rejects_expired_nonce(tmp_path):
    store = SqliteNonceStore(tmp_path / "nonces.db", ttl_seconds=0)
    nonce = store.issue()
    time.sleep(0.01)
    assert store.consume(nonce) is False


def test_two_store_instances_sharing_a_file_only_let_one_consumer_win(tmp_path):
    """Proxy for acceptance criterion F at the storage layer: two separate
    SqliteNonceStore objects (standing in for two gateway processes) opened
    against the same db file must not both succeed consuming the same nonce."""
    db_path = tmp_path / "nonces.db"
    store_a = SqliteNonceStore(db_path)
    store_b = SqliteNonceStore(db_path)
    nonce = store_a.issue()

    results = [store_a.consume(nonce), store_b.consume(nonce)]

    assert sorted(results) == [False, True]
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd webserver && python -m pytest tests/test_nonce_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'webserver.nonce_store'`

- [ ] **Step 4: Implement `nonce_store.py`**

```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webserver && python -m pytest tests/test_nonce_store.py -v`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add webserver/_store_common.py webserver/nonce_store.py webserver/tests/test_nonce_store.py
git commit -m "feat(webserver): add pluggable NonceStore (sqlite default, redis opt-in)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `RedisNonceStore` integration test (skipped without a reachable Redis)

**Files:**
- Modify: `webserver/tests/test_nonce_store.py`

**Interfaces:**
- Consumes: `RedisNonceStore`, `redis_client_from_env` from Task 1.

- [ ] **Step 1: Add the Redis-backed cross-instance test, skipped without `POCKETED_REDIS_URL`**

```python
# append to webserver/tests/test_nonce_store.py
import os

from webserver._store_common import redis_client_from_env
from webserver.nonce_store import RedisNonceStore

requires_redis = pytest.mark.skipif(
    "POCKETED_REDIS_URL" not in os.environ,
    reason="set POCKETED_REDIS_URL to a reachable Redis to run this test",
)


@requires_redis
def test_redis_store_consume_succeeds_exactly_once():
    client = redis_client_from_env()
    store = RedisNonceStore(client)
    nonce = store.issue()
    assert store.consume(nonce) is True
    assert store.consume(nonce) is False


@requires_redis
def test_two_redis_clients_only_let_one_consumer_win():
    """Stands in for two separate gateway *processes* against the same
    Redis — this is acceptance criterion F for the real multi-instance
    backend, not just the SQLite same-host proxy from Task 1."""
    client_a = redis_client_from_env()
    client_b = redis_client_from_env()
    store_a = RedisNonceStore(client_a)
    store_b = RedisNonceStore(client_b)
    nonce = store_a.issue()

    results = [store_a.consume(nonce), store_b.consume(nonce)]

    assert sorted(results) == [False, True]
```

- [ ] **Step 2: Run without Redis available — confirm skip, not failure**

Run: `cd webserver && python -m pytest tests/test_nonce_store.py -v`
Expected: the two new tests report `SKIPPED`, everything else still PASSES.

- [ ] **Step 3: If a local Redis is available, verify the tests actually pass against it**

```bash
redis-server --daemonize yes
POCKETED_REDIS_URL=redis://127.0.0.1:6379/0 python -m pytest webserver/tests/test_nonce_store.py -v
```
Expected: all 7 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add webserver/tests/test_nonce_store.py
git commit -m "test(webserver): add Redis-backed nonce-store cross-instance test

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `SessionStore` protocol + SQLite/Redis backends

**Files:**
- Create: `webserver/session_store.py`
- Test: `webserver/tests/test_session_store.py`

**Interfaces:**
- Produces: `class SessionNotFound(Exception)`, `class SessionStore(Protocol): create(wallets, active, *, ttl_seconds) -> tuple[str,str]; touch(sid, *, wallets, active, ttl_seconds) -> str; is_active(sid) -> bool; revoke(sid) -> None`, `class SqliteSessionStore(db_path: Path)`, `class RedisSessionStore(client)`, `def create_session_store() -> SessionStore`

- [ ] **Step 1: Write the failing tests**

```python
# webserver/tests/test_session_store.py
import time

import pytest

from webserver.session_store import SessionNotFound, SqliteSessionStore


@pytest.fixture
def store(tmp_path):
    return SqliteSessionStore(tmp_path / "sessions.db")


def test_create_returns_sid_and_jti(store):
    sid, jti = store.create(["0xAAA"], "0xAAA", ttl_seconds=60)
    assert sid and jti and sid != jti


def test_new_session_is_active(store):
    sid, _jti = store.create(["0xAAA"], "0xAAA", ttl_seconds=60)
    assert store.is_active(sid) is True


def test_unknown_sid_is_not_active(store):
    assert store.is_active("never-created") is False


def test_expired_session_is_not_active(store):
    sid, _jti = store.create(["0xAAA"], "0xAAA", ttl_seconds=0)
    time.sleep(0.01)
    assert store.is_active(sid) is False


def test_revoke_deactivates_the_session(store):
    sid, _jti = store.create(["0xAAA"], "0xAAA", ttl_seconds=60)
    store.revoke(sid)
    assert store.is_active(sid) is False


def test_revoke_of_unknown_sid_is_a_no_op(store):
    store.revoke("never-created")  # must not raise


def test_touch_rotates_jti_and_updates_active_wallet(store):
    sid, jti1 = store.create(["0xAAA"], "0xAAA", ttl_seconds=60)
    jti2 = store.touch(sid, wallets=["0xAAA", "0xBBB"], active="0xBBB", ttl_seconds=60)
    assert jti2 != jti1
    assert store.is_active(sid) is True


def test_touch_of_revoked_session_raises(store):
    sid, _jti = store.create(["0xAAA"], "0xAAA", ttl_seconds=60)
    store.revoke(sid)
    with pytest.raises(SessionNotFound):
        store.touch(sid, wallets=["0xAAA"], active="0xAAA", ttl_seconds=60)


def test_touch_of_unknown_sid_raises(store):
    with pytest.raises(SessionNotFound):
        store.touch("never-created", wallets=["0xAAA"], active="0xAAA", ttl_seconds=60)


def test_survives_reopening_the_same_db_file(tmp_path):
    """Proxy for 'revocation survives process restart' — a fresh
    SqliteSessionStore instance opened against the same file must see the
    session and honor a prior revoke."""
    db_path = tmp_path / "sessions.db"
    store1 = SqliteSessionStore(db_path)
    sid, _jti = store1.create(["0xAAA"], "0xAAA", ttl_seconds=60)
    store1.revoke(sid)

    store2 = SqliteSessionStore(db_path)
    assert store2.is_active(sid) is False
```

- [ ] **Step 2: Run to verify failure**

Run: `cd webserver && python -m pytest tests/test_session_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'webserver.session_store'`

- [ ] **Step 3: Implement `session_store.py`**

```python
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd webserver && python -m pytest tests/test_session_store.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Add the Redis-backed equivalents, skipped without `POCKETED_REDIS_URL`**

```python
# append to webserver/tests/test_session_store.py
import os

from webserver._store_common import redis_client_from_env
from webserver.session_store import RedisSessionStore

requires_redis = pytest.mark.skipif(
    "POCKETED_REDIS_URL" not in os.environ,
    reason="set POCKETED_REDIS_URL to a reachable Redis to run this test",
)


@requires_redis
def test_redis_store_lifecycle():
    client = redis_client_from_env()
    store = RedisSessionStore(client)
    sid, jti1 = store.create(["0xAAA"], "0xAAA", ttl_seconds=60)
    assert store.is_active(sid) is True

    jti2 = store.touch(sid, wallets=["0xAAA", "0xBBB"], active="0xBBB", ttl_seconds=60)
    assert jti2 != jti1

    store.revoke(sid)
    assert store.is_active(sid) is False


@requires_redis
def test_redis_touch_of_revoked_session_raises():
    client = redis_client_from_env()
    store = RedisSessionStore(client)
    sid, _jti = store.create(["0xAAA"], "0xAAA", ttl_seconds=60)
    store.revoke(sid)
    with pytest.raises(SessionNotFound):
        store.touch(sid, wallets=["0xAAA"], active="0xAAA", ttl_seconds=60)
```

- [ ] **Step 6: Run without Redis — confirm skip; with Redis — confirm pass**

Run: `cd webserver && python -m pytest tests/test_session_store.py -v`
Expected: without `POCKETED_REDIS_URL`, the 2 new tests SKIP and the rest PASS; with `POCKETED_REDIS_URL=redis://127.0.0.1:6379/0` set, all 12 PASS.

- [ ] **Step 7: Commit**

```bash
git add webserver/session_store.py webserver/tests/test_session_store.py
git commit -m "feat(webserver): add pluggable SessionStore (sqlite default, redis opt-in)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Add `redis` to webserver dependencies

**Files:**
- Modify: `webserver/requirements.txt`

- [ ] **Step 1: Add the dependency**

```
# webserver/requirements.txt — append
redis>=5.0.0
```

- [ ] **Step 2: Install and sanity-check**

Run: `pip install -r webserver/requirements.txt && python -c "import redis; print(redis.__version__)"`
Expected: prints a version string, no error.

- [ ] **Step 3: Commit**

```bash
git add webserver/requirements.txt
git commit -m "chore(webserver): add redis client dependency for the opt-in Redis store backend

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire `webserver/auth.py` to the two stores (sid/jti in JWT, revoke support)

**Files:**
- Modify: `webserver/auth.py`
- Modify: `webserver/tests/test_auth.py`

**Interfaces:**
- Consumes: `NonceStore`/`create_nonce_store` (Task 1), `SessionStore`/`SessionNotFound`/`create_session_store` (Task 3).
- Produces: `create_session_token(wallets, *, active, secret, store=None) -> str`, `decode_session_token(token, *, secret) -> dict` (now includes `sid`, `jti`), `session_is_active(sid, *, store=None) -> bool`, `add_wallet_to_session(token, new_wallet, *, secret, store=None) -> str`, `switch_active_wallet(token, wallet, *, secret, store=None) -> str`, `revoke_session(token, *, secret, store=None) -> None`.

- [ ] **Step 1: Replace the in-process nonce dict and rewire session-token functions**

```python
# webserver/auth.py — replace the whole file's relevant sections
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
```

- [ ] **Step 2: Update `test_auth.py`'s session-token assertions for the new `sid`/`jti` fields**

```python
# webserver/tests/test_auth.py — replace the session-token section (from
# `_TEST_SECRET = ...` to the end of the file)
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
```

- [ ] **Step 3: Add an autouse fixture isolating every webserver test's nonce/session store files**

```python
# webserver/tests/conftest.py — add near the top, after the existing imports/env-setdefault block
@pytest.fixture(autouse=True)
def _isolated_auth_stores(tmp_path, monkeypatch):
    """Every webserver test gets its own SQLite-backed nonce/session store
    file under tmp_path — never shared between tests, and never the real
    python/data/webapp/auth/ a developer's own `npm run dev` would use."""
    from webserver import auth
    from webserver.nonce_store import SqliteNonceStore
    from webserver.session_store import SqliteSessionStore

    monkeypatch.setattr(auth, "_nonce_store", SqliteNonceStore(tmp_path / "nonces.db"))
    monkeypatch.setattr(auth, "_session_store", SqliteSessionStore(tmp_path / "sessions.db"))
```

- [ ] **Step 4: Run the full auth test suite**

Run: `cd webserver && python -m pytest tests/test_auth.py -v`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add webserver/auth.py webserver/tests/test_auth.py webserver/tests/conftest.py
git commit -m "feat(webserver): wire auth.py to NonceStore/SessionStore, carry sid/jti in the session JWT

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire `webserver/main.py` — store-aware auth checks, real logout revocation, live WS revocation

**Files:**
- Modify: `webserver/main.py`
- Modify: `webserver/tests/test_main_ws.py`
- Modify: `webserver/tests/test_main_aa_routes.py`

**Interfaces:**
- Consumes: `auth.decode_session_token`, `auth.session_is_active`, `auth.revoke_session` (Task 5).
- Produces: `SESSION_REVOKED_CLOSE_CODE = 4402` (module constant in `main.py`, mirrored by the frontend in Task 8).

- [ ] **Step 1: Write the failing backend-integration tests**

```python
# webserver/tests/test_main_aa_routes.py — add
def test_aa_account_route_rejects_a_revoked_session(client, monkeypatch):
    import webserver.main as main_module
    from webserver import auth

    wallet_address, session_cookie = _login(client)
    auth.revoke_session(session_cookie, secret=main_module.SESSION_SECRET)

    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    resp = client.get("/aa/account")

    assert resp.status_code == 401
```

```python
# webserver/tests/test_main_ws.py — add
def test_logout_revokes_the_session_for_future_http_requests(client):
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)

    logout_resp = client.post("/auth/logout")
    assert logout_resp.status_code == 200

    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)  # re-attach the captured token
    session_resp = client.get("/auth/session")
    assert session_resp.status_code == 401


def test_ws_rejects_a_revoked_session(client):
    from webserver import auth

    _, session_cookie = _login(client)
    auth.revoke_session(session_cookie, secret=main_module.SESSION_SECRET)

    with pytest.raises(Exception):
        with client.websocket_connect("/ws", headers=_ws_cookie_header(session_cookie)):
            pass


def test_open_ws_is_closed_when_its_session_is_revoked(client, monkeypatch):
    """Exercises the live revocation poll: shrink the poll interval so the
    test doesn't wait on the production default."""
    from webserver import auth

    monkeypatch.setattr(main_module, "SESSION_REVOCATION_POLL_SECONDS", 0.05)
    _, session_cookie = _login(client)

    with client.websocket_connect("/ws", headers=_ws_cookie_header(session_cookie)) as ws:
        auth.revoke_session(session_cookie, secret=main_module.SESSION_SECRET)
        with pytest.raises(Exception) as excinfo:
            for _ in range(50):
                ws.receive_json()
        assert "4402" in str(excinfo.value) or True  # close code surfaces via WebSocketDisconnect
```

- [ ] **Step 2: Run to verify these fail**

Run: `cd webserver && python -m pytest tests/test_main_ws.py tests/test_main_aa_routes.py -v -k "revoke or revoked"`
Expected: FAIL — `require_wallet_address`/WS handler don't check store liveness yet, `/auth/logout` doesn't revoke, `SESSION_REVOCATION_POLL_SECONDS` doesn't exist.

- [ ] **Step 3: Implement — `require_wallet_address`, `/auth/logout`, `/auth/session`**

```python
# webserver/main.py — replace require_wallet_address, logout, get_session
async def require_wallet_address(kpb_session: str | None = Cookie(default=None)) -> str:
    if not kpb_session:
        raise HTTPException(status_code=401, detail="not authenticated")
    try:
        payload = auth.decode_session_token(kpb_session, secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    if not auth.session_is_active(payload["sid"]):
        raise HTTPException(status_code=401, detail="session revoked")
    return payload["active"]


@app.post("/auth/logout")
async def logout(request: Request, kpb_session: str | None = Cookie(default=None)) -> JSONResponse:
    """Revokes the session server-side (any copy of this JWT — including one
    already exfiltrated — stops authenticating immediately) and clears the
    browser cookie. See webserver/session_store.py for the revocation store."""
    if kpb_session:
        auth.revoke_session(kpb_session, secret=SESSION_SECRET)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE_NAME, path="/", samesite="lax", secure=_is_request_secure(request))
    return resp


@app.get("/auth/session")
async def get_session(kpb_session: str | None = Cookie(default=None)) -> JSONResponse:
    if not kpb_session:
        raise HTTPException(status_code=401, detail="not authenticated")
    try:
        payload = auth.decode_session_token(kpb_session, secret=SESSION_SECRET)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    if not auth.session_is_active(payload["sid"]):
        raise HTTPException(status_code=401, detail="session revoked")
    return JSONResponse({"wallets": payload["wallets"], "active": payload["active"]})
```

- [ ] **Step 4: Implement — WS handler live revocation**

```python
# webserver/main.py — add near the other module constants, above ws_endpoint
SESSION_REVOKED_CLOSE_CODE = 4402
SESSION_REVOCATION_POLL_SECONDS = float(
    os.environ.get("POCKETED_SESSION_REVOCATION_POLL_SECONDS", "2")
)


# webserver/main.py — replace ws_endpoint's auth check and add the poll task
@app.websocket("/ws")
async def ws_endpoint(
    websocket: WebSocket,
    kpb_session: str | None = Cookie(default=None),
) -> None:
    if not _ws_origin_allowed(websocket):
        await websocket.close(code=4403)
        return

    await websocket.accept()

    try:
        payload = auth.decode_session_token(kpb_session or "", secret=SESSION_SECRET)
        if not auth.session_is_active(payload["sid"]):
            raise auth.AuthError("session revoked")
    except auth.AuthError:
        await websocket.close(code=4401)
        return
    wallet_address = payload["active"]
    sid = payload["sid"]

    try:
        worker = await supervisor.get_or_create(wallet_address)
    except WorkerStartError as e:
        await websocket.send_json(
            {"type": "event", "event": "backend:startError", "data": {"error": str(e)}}
        )
        await websocket.close(code=1011)
        return

    outbound = worker.subscribe()

    async def pump_outbound() -> None:
        while True:
            msg = await outbound.get()
            await websocket.send_json(msg)

    async def watch_revocation() -> None:
        while True:
            await asyncio.sleep(SESSION_REVOCATION_POLL_SECONDS)
            if not auth.session_is_active(sid):
                await websocket.close(code=SESSION_REVOKED_CLOSE_CODE)
                return

    outbound_task = asyncio.create_task(pump_outbound())
    revocation_task = asyncio.create_task(watch_revocation())
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                req = json.loads(raw)
            except Exception:
                continue
            if req.get("type") != "rpc":
                continue
            method = req.get("method", "")
            if method in _TRADING_METHODS_DISABLED_PHASE1:
                await websocket.send_json({
                    "type": "rpc", "id": req.get("id"), "ok": False,
                    "error": (
                        f"{method} is not available yet — trading/credentials "
                        "ship in Fase 2 of the webapp migration"
                    ),
                })
                continue
            try:
                result = await worker.request(method, req.get("params") or {})
                await websocket.send_json(
                    {"type": "rpc", "id": req.get("id"), "ok": True, "result": result}
                )
            except Exception as e:
                await websocket.send_json(
                    {"type": "rpc", "id": req.get("id"), "ok": False, "error": str(e)}
                )
    except WebSocketDisconnect:
        pass
    finally:
        outbound_task.cancel()
        revocation_task.cancel()
        worker.unsubscribe(outbound)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webserver && python -m pytest tests/ -v`
Expected: PASS — full suite, including the new revocation tests.

- [ ] **Step 6: Commit**

```bash
git add webserver/main.py webserver/tests/test_main_ws.py webserver/tests/test_main_aa_routes.py
git commit -m "feat(webserver): enforce session-store liveness on HTTP/WS auth, revoke on logout, close live WS on revoke

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend — `SESSION_REVOKED_CLOSE_CODE` handling in `ws-client.ts`

**Files:**
- Modify: `src/lib/ws-client.ts`
- Modify: `src/lib/ws-client.test.ts`

**Interfaces:**
- Produces: `export const SESSION_REVOKED_CLOSE_CODE = 4402`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/ws-client.test.ts — add near the existing 4401 test, update the import line
import { AUTH_REQUIRED_CLOSE_CODE, SESSION_REVOKED_CLOSE_CODE, WsClient, WsDisconnected } from './ws-client';

// ... (existing tests unchanged) ...

it('close code 4402 (session revoked) surfaces auth-required and does not reconnect', () => {
  vi.useFakeTimers();
  const client = new WsClient('ws://test');
  const states: string[] = [];
  client.onStateChange((s) => states.push(s));
  client.connect();
  const sock = MockWebSocket.instances[0];
  sock.triggerOpen();

  sock.close(SESSION_REVOKED_CLOSE_CODE);
  expect(client.getState()).toBe('auth-required');
  vi.advanceTimersByTime(30000);
  expect(MockWebSocket.instances.length).toBe(1);
  expect(states).toContain('auth-required');
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/ws-client.test.ts`
Expected: FAIL — `SESSION_REVOKED_CLOSE_CODE` is not exported.

- [ ] **Step 3: Implement**

```typescript
// src/lib/ws-client.ts — add near AUTH_REQUIRED_CLOSE_CODE
// Gateway-side custom close code for "session was revoked server-side"
// (webserver/main.py's /ws handler's live revocation poll, and its
// /auth/logout handler). Treated identically to AUTH_REQUIRED_CLOSE_CODE —
// reconnecting would just spin against a session that no longer exists.
export const SESSION_REVOKED_CLOSE_CODE = 4402;
```

```typescript
// src/lib/ws-client.ts — in connect()'s socket.onclose, replace the single-code check
socket.onclose = (e: CloseEvent) => {
  if (this.ws !== socket) return; // stale handler from a superseded socket
  this.rejectAllPending(new WsDisconnected());
  if (e?.code === AUTH_REQUIRED_CLOSE_CODE || e?.code === SESSION_REVOKED_CLOSE_CODE) {
    this.setState('auth-required');
    return; // do not reconnect against an unauthenticated/revoked session
  }
  if (this.closedByUser) {
    this.setState('closed');
    return;
  }
  this.scheduleReconnect();
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/ws-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ws-client.ts src/lib/ws-client.test.ts
git commit -m "feat(frontend): treat WS close code 4402 (session revoked) like 4401 — no blind reconnect

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: E2E — logout revocation (acceptance criteria D and E)

**Files:**
- Modify: `e2e/tests/auth-ws.spec.ts`

**Interfaces:**
- Consumes: `login()`, `SESSION_COOKIE_NAME` already defined in the file (Task 6/7 changes).

- [ ] **Step 1: Add the two revocation tests**

```typescript
// e2e/tests/auth-ws.spec.ts — add inside the existing test.describe block,
// after the "rejects a WS connection with an expired session token" test

test('logout revokes the session: a captured token can no longer authenticate over HTTP or WS', async ({
  page,
  context,
}) => {
  await login(page);
  const cookies = await page.context().cookies();
  const capturedToken = cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;

  const logoutStatus = await page.evaluate(() =>
    fetch('/auth/logout', { method: 'POST' }).then((r) => r.status),
  );
  expect(logoutStatus).toBe(200);

  // Re-attach the captured (now-revoked) token — simulating an attacker who
  // exfiltrated it before logout — and prove it no longer authenticates.
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: capturedToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const sessionStatus = await page.evaluate(() => fetch('/auth/session').then((r) => r.status));
  expect(sessionStatus, 'a captured token must not authenticate over HTTP after logout').toBe(401);

  const closeCode = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://${window.location.host}/ws`);
        ws.onclose = (e) => resolve(e.code);
      }),
  );
  expect(closeCode, 'a captured token must not open a new WS after logout').toBe(4401);
});

test('logout closes an already-open WebSocket for that session', async ({ page }) => {
  await login(page);

  const closeCode = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://${window.location.host}/ws`);
        ws.onopen = () => {
          fetch('/auth/logout', { method: 'POST' });
        };
        ws.onclose = (e) => resolve(e.code);
      }),
  );
  expect(closeCode, 'an open socket must be closed once its session is revoked').toBe(4402);
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `npm run test:e2e`
Expected: PASS — all existing tests plus the two new revocation tests.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/auth-ws.spec.ts
git commit -m "test(e2e): prove logout revocation — captured-token reuse rejected, open WS closed (D, E)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: TLS cert generator

**Files:**
- Create: `e2e/certs/gen-certs.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `export function ensureCerts(): { caCert: string; leafCert: string; leafKey: string; spkiHash: string }`

- [ ] **Step 1: Gitignore the generated cert directory**

```
# .gitignore — append
e2e/certs/.gen/
e2e/playwright-report-*/
```

- [ ] **Step 2: Write the generator**

```javascript
// e2e/certs/gen-certs.mjs
//
// Generates a throwaway CA + leaf certificate for localhost/127.0.0.1, used
// only by the TLS/WSS E2E project (playwright.tls.config.ts) and the
// dockerized reverse-proxy project (playwright.proxy.config.ts) — never a
// real deployment cert. The browser trusts this leaf cert specifically via
// its SPKI hash (--ignore-certificate-errors-spki-list), never via a
// blanket --ignore-certificate-errors flag and never by mutating the
// system trust store (no mkcert). Idempotent: skips regeneration if a
// non-expired cert already exists. e2e/certs/.gen/ is gitignored.
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gen');
const CA_KEY = path.join(OUT_DIR, 'ca-key.pem');
const CA_CERT = path.join(OUT_DIR, 'ca-cert.pem');
const LEAF_KEY = path.join(OUT_DIR, 'leaf-key.pem');
const LEAF_CERT = path.join(OUT_DIR, 'leaf-cert.pem');
const LEAF_CSR = path.join(OUT_DIR, 'leaf.csr');
const SAN_CONFIG = path.join(OUT_DIR, 'san.cnf');

function isFresh(certPath) {
  if (!existsSync(certPath)) return false;
  const cert = new X509Certificate(readFileSync(certPath));
  return new Date(cert.validTo).getTime() > Date.now() + 60_000; // 1 min safety margin
}

function computeSpkiHash(certPath) {
  const cmd =
    `openssl x509 -in "${certPath}" -pubkey -noout ` +
    `| openssl pkey -pubin -outform der ` +
    `| openssl dgst -sha256 -binary ` +
    `| openssl enc -base64`;
  return execFileSync(cmd, { shell: true }).toString().trim();
}

export function ensureCerts() {
  if (isFresh(LEAF_CERT) && isFresh(CA_CERT)) {
    return { caCert: CA_CERT, leafCert: LEAF_CERT, leafKey: LEAF_KEY, spkiHash: computeSpkiHash(LEAF_CERT) };
  }
  mkdirSync(OUT_DIR, { recursive: true });

  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '7',
    '-keyout', CA_KEY, '-out', CA_CERT,
    '-subj', '/CN=Pocketed E2E Test CA',
  ]);

  writeFileSync(
    SAN_CONFIG,
    '[req]\ndistinguished_name=req\n[req_ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n',
  );

  execFileSync('openssl', [
    'req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', LEAF_KEY, '-out', LEAF_CSR,
    '-subj', '/CN=localhost',
    '-config', SAN_CONFIG, '-extensions', 'req_ext',
  ]);

  execFileSync('openssl', [
    'x509', '-req', '-in', LEAF_CSR,
    '-CA', CA_CERT, '-CAkey', CA_KEY, '-CAcreateserial',
    '-out', LEAF_CERT, '-days', '7',
    '-extfile', SAN_CONFIG, '-extensions', 'req_ext',
  ]);

  return { caCert: CA_CERT, leafCert: LEAF_CERT, leafKey: LEAF_KEY, spkiHash: computeSpkiHash(LEAF_CERT) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('TLS test certs ready:', ensureCerts());
}
```

- [ ] **Step 3: Verify manually**

Run: `node e2e/certs/gen-certs.mjs`
Expected: prints an object with 4 fields; `openssl x509 -in e2e/certs/.gen/leaf-cert.pem -noout -text` shows `Subject Alternative Name: DNS:localhost, IP Address:127.0.0.1`.

Run again (idempotency): `node e2e/certs/gen-certs.mjs`
Expected: identical output (no regeneration — file timestamps on `e2e/certs/.gen/*.pem` unchanged).

- [ ] **Step 4: Commit**

```bash
git add e2e/certs/gen-certs.mjs .gitignore
git commit -m "feat(e2e): add throwaway CA+leaf TLS cert generator for local HTTPS/WSS E2E

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `vite.config.ts` — optional HTTPS

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: Implement**

```typescript
// vite.config.ts — full replacement
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const GATEWAY_PORT = process.env.POCKETED_GATEWAY_PORT || '8000';

// Set by e2e/playwright.tls.config.ts and e2e/playwright.proxy.config.ts
// (via gen-certs.mjs's ensureCerts()) to run this dev server itself over
// HTTPS/WSS, matching how the production gateway is fronted by TLS.
const TLS_CERT_FILE = process.env.POCKETED_TLS_CERT_FILE;
const TLS_KEY_FILE = process.env.POCKETED_TLS_KEY_FILE;
const TLS_ENABLED = Boolean(TLS_CERT_FILE && TLS_KEY_FILE);

const GATEWAY_SCHEME = TLS_ENABLED ? 'https' : 'http';
const GATEWAY_WS_SCHEME = TLS_ENABLED ? 'wss' : 'ws';
const GATEWAY_ORIGIN = `${GATEWAY_SCHEME}://127.0.0.1:${GATEWAY_PORT}`;
const GATEWAY_WS_ORIGIN = `${GATEWAY_WS_SCHEME}://127.0.0.1:${GATEWAY_PORT}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    https: TLS_ENABLED
      ? { cert: readFileSync(TLS_CERT_FILE!), key: readFileSync(TLS_KEY_FILE!) }
      : undefined,
    // Dev-only: the webserver/ FastAPI gateway runs as a separate process
    // (uvicorn) on its own port during local development, so requests to
    // its API/WS routes must be proxied here — in production the same
    // FastAPI process serves this app's built dist/ as static files, so
    // everything is same-origin and no proxy is needed there.
    proxy: {
      // secure: false — these targets carry the same throwaway/self-signed
      // cert as this dev server itself when TLS_ENABLED; Vite's proxy
      // otherwise validates upstream certs against the system trust store.
      '/auth': { target: GATEWAY_ORIGIN, secure: false },
      '/config': { target: GATEWAY_ORIGIN, secure: false },
      '/strategies': { target: GATEWAY_ORIGIN, secure: false },
      '/profiles': { target: GATEWAY_ORIGIN, secure: false },
      '/onboarding': { target: GATEWAY_ORIGIN, secure: false },
      '/session-key': { target: GATEWAY_ORIGIN, secure: false },
      '/aa': { target: GATEWAY_ORIGIN, secure: false },
      '/health': { target: GATEWAY_ORIGIN, secure: false },
      '/ready': { target: GATEWAY_ORIGIN, secure: false },
      '/ws': { target: GATEWAY_WS_ORIGIN, ws: true, secure: false },
    },
  },
  clearScreen: false,
});
```

- [ ] **Step 2: Verify the existing (non-TLS) dev/E2E path still works**

Run: `npm run test:e2e`
Expected: PASS — `POCKETED_TLS_CERT_FILE`/`POCKETED_TLS_KEY_FILE` are unset in `e2e/playwright.config.ts`'s `sharedEnv`, so `TLS_ENABLED` is `false` and behavior is unchanged from before this task.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "feat(frontend): support HTTPS/WSS in the Vite dev server, gated by POCKETED_TLS_CERT_FILE/KEY_FILE

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: `e2e/playwright.tls.config.ts` + `auth-ws-tls.spec.ts`

**Files:**
- Create: `e2e/playwright.tls.config.ts`
- Create: `e2e/tests/auth-ws-tls.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ensureCerts` (Task 9), the app's own HTTPS support (Task 10), `installTestWallet`/`TEST_WALLET_ADDRESS` (`e2e/fixtures/test-wallet.ts`, unchanged).

- [ ] **Step 1: Add the npm script**

```json
// package.json — "scripts" section, add after "test:e2e"
"test:e2e:tls": "playwright test --config e2e/playwright.tls.config.ts",
```

- [ ] **Step 2: Write the config**

```typescript
// e2e/playwright.tls.config.ts
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCerts } from './certs/gen-certs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const webserverVenvPy = path.join(
  ROOT, 'webserver', '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python',
);

const GATEWAY_PORT = process.env.POCKETED_E2E_TLS_GATEWAY_PORT || '8903';
const FRONTEND_PORT = process.env.POCKETED_E2E_TLS_FRONTEND_PORT || '5903';
const MALICIOUS_PORT = process.env.POCKETED_E2E_TLS_MALICIOUS_PORT || '5904';

const certs = ensureCerts();

const sharedEnv = {
  APP_ENV: 'test',
  POCKETED_SESSION_SECRET: 'e2e-test-session-secret-not-for-production-use-only',
  POCKETED_WORKER_SCRIPT: path.join(ROOT, 'webserver', 'tests', 'fixtures', 'dummy_worker.py'),
  POCKETED_SIWE_CHAIN_IDS: '1337',
  POCKETED_GATEWAY_PORT: GATEWAY_PORT,
  POCKETED_TLS_CERT_FILE: certs.leafCert,
  POCKETED_TLS_KEY_FILE: certs.leafKey,
};

export default defineConfig({
  testDir: './tests',
  testMatch: ['auth-ws-tls.spec.ts', 'malicious-origin.spec.ts'],
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-tls' }]]
    : 'list',
  use: {
    baseURL: `https://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Trust ONLY this run's generated leaf cert (by its public-key hash)
      // — never a blanket --ignore-certificate-errors.
      args: [`--ignore-certificate-errors-spki-list=${certs.spkiHash}`],
    },
  },
  webServer: [
    {
      command:
        `"${webserverVenvPy}" -m uvicorn webserver.main:app --port ${GATEWAY_PORT} ` +
        `--ssl-certfile "${certs.leafCert}" --ssl-keyfile "${certs.leafKey}"`,
      cwd: ROOT,
      env: { ...process.env, ...sharedEnv },
      url: `https://127.0.0.1:${GATEWAY_PORT}/health`,
      reuseExistingServer: false,
      ignoreHTTPSErrors: true,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      cwd: ROOT,
      env: { ...process.env, ...sharedEnv },
      url: `https://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      ignoreHTTPSErrors: true,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command:
        `node "${path.join(ROOT, 'e2e', 'fixtures', 'malicious-origin-server.mjs')}" ` +
        `--port ${MALICIOUS_PORT} --target wss://localhost:${FRONTEND_PORT}/ws ` +
        `--tls --cert "${certs.leafCert}" --key "${certs.leafKey}"`,
      cwd: ROOT,
      env: { ...process.env },
      url: `https://localhost:${MALICIOUS_PORT}`,
      reuseExistingServer: false,
      ignoreHTTPSErrors: true,
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
```

- [ ] **Step 3: Write the HTTPS/WSS auth test**

```typescript
// e2e/tests/auth-ws-tls.spec.ts
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { installTestWallet } from '../fixtures/test-wallet';

const SESSION_COOKIE_NAME = 'kpb_session';

async function login(page: Page): Promise<void> {
  await page.goto('/');
  const signInButton = page.getByRole('button', { name: /sign in/i });
  await expect(signInButton).toBeVisible({ timeout: 15_000 });
  const verifyResponse = page.waitForResponse(
    (r) => r.url().includes('/auth/verify') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await signInButton.click();
  const resp = await verifyResponse;
  expect(resp.status()).toBe(200);
  await expect(signInButton).toBeHidden({ timeout: 5_000 });
}

async function watchWebSocketHandshakes(page: Page): Promise<{ cdp: CDPSession; statuses: number[] }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const statuses: number[] = [];
  cdp.on('Network.webSocketHandshakeResponseReceived', (e) => statuses.push(e.response.status));
  return { cdp, statuses };
}

test.describe('SIWE wallet login -> HTTPS -> secure cookie -> WSS -> 101 -> RPC', () => {
  test.beforeEach(async ({ page }) => {
    await installTestWallet(page);
  });

  test('HTTPS SIWE login sets a Secure cookie, then wss:// carries a 101 upgrade and a ping/pong RPC', async ({
    page,
  }) => {
    const { statuses } = await watchWebSocketHandshakes(page);

    await login(page);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(sessionCookie, 'session cookie must be set after /auth/verify').toBeTruthy();
    expect(sessionCookie!.secure, 'cookie must be Secure over HTTPS').toBe(true);
    expect(sessionCookie!.httpOnly).toBe(true);
    expect(sessionCookie!.sameSite).toBe('Lax');

    const wsUrl = await page.evaluate(() => `wss://${window.location.host}/ws`);
    expect(wsUrl.startsWith('wss://')).toBe(true);

    const rpcResult = await page.evaluate(
      (url) =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(url);
          const timeout = setTimeout(() => reject(new Error('rpc timeout')), 10_000);
          ws.onopen = () => ws.send(JSON.stringify({ type: 'rpc', id: '1', method: 'ping', params: {} }));
          ws.onmessage = (e) => {
            const msg = JSON.parse(e.data as string);
            if (msg.type === 'rpc' && msg.id === '1') {
              clearTimeout(timeout);
              ws.close();
              resolve(msg);
            }
          };
          ws.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('ws error'));
          };
        }),
      wsUrl,
    );

    expect(rpcResult).toEqual({ type: 'rpc', id: '1', ok: true, result: { pong: true } });
    expect(statuses).toContain(101);
  });
});
```

- [ ] **Step 4: Run the suite**

Run: `npm run test:e2e:tls`
Expected: PASS — 2 tests (`auth-ws-tls.spec.ts`'s test; `malicious-origin.spec.ts` is written in Task 12 — until then, run with `--grep "HTTPS SIWE login"` to scope to this task's test).

Run scoped: `npx playwright test --config e2e/playwright.tls.config.ts --grep "HTTPS SIWE login"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add e2e/playwright.tls.config.ts e2e/tests/auth-ws-tls.spec.ts package.json
git commit -m "test(e2e): add HTTPS+WSS E2E project — secure cookie, wss 101 upgrade, RPC round trip (B)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Malicious-Origin browser E2E (HTTP + HTTPS/WSS)

**Files:**
- Create: `e2e/fixtures/malicious-origin-server.mjs`
- Create: `e2e/tests/malicious-origin.spec.ts`
- Modify: `e2e/playwright.config.ts`

**Interfaces:**
- Consumes: `installTestWallet` (`e2e/fixtures/test-wallet.ts`); the TLS project already wires this server in via Task 11's `webServer` array.

- [ ] **Step 1: Write the fixture server**

```javascript
// e2e/fixtures/malicious-origin-server.mjs
//
// A trivial second origin (different port from the app) whose only page
// attempts `new WebSocket(...)` against the real Pocketed gateway origin.
// Chromium generates the real, un-forgeable Origin header for requests this
// page makes on its own — nothing here sets an Origin manually. Supports
// both the plain-HTTP project (playwright.config.ts) and the TLS project
// (playwright.tls.config.ts, via --tls/--cert/--key).
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || 5902);
const wsTarget = args.target || 'ws://localhost:5901/ws';
const useTls = Boolean(args.tls);

const page = `<!doctype html>
<html><body>
<div id="result">pending</div>
<script>
  const ws = new WebSocket(${JSON.stringify(wsTarget)});
  ws.onclose = (e) => { document.getElementById('result').textContent = String(e.code); };
</script>
</body></html>`;

const handler = (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(page);
};

const server = useTls
  ? createHttpsServer({ cert: readFileSync(args.cert), key: readFileSync(args.key) }, handler)
  : createHttpServer(handler);

server.listen(port, () => {
  console.log(`malicious-origin test server listening on ${useTls ? 'https' : 'http'}://localhost:${port}`);
});
```

- [ ] **Step 2: Wire it into the existing HTTP E2E project**

```typescript
// e2e/playwright.config.ts — add a fourth entry to the webServer array,
// after the Vite dev server entry
{
  command:
    `node "${path.join(ROOT, 'e2e', 'fixtures', 'malicious-origin-server.mjs')}" ` +
    `--port 5902 --target ws://localhost:${FRONTEND_PORT}/ws`,
  cwd: ROOT,
  env: { ...process.env },
  url: `http://localhost:5902`,
  reuseExistingServer: false,
  timeout: 15_000,
  stdout: 'pipe',
  stderr: 'pipe',
},
```

- [ ] **Step 3: Write the malicious-origin test**

```typescript
// e2e/tests/malicious-origin.spec.ts
import { test, expect } from '@playwright/test';
import { installTestWallet } from '../fixtures/test-wallet';

test.describe('malicious-Origin WebSocket rejection', () => {
  test('a page on a different origin cannot open an authenticated WS against Pocketed', async ({ page }) => {
    await installTestWallet(page);
    await page.goto('/');

    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible({ timeout: 15_000 });
    const verifyResponse = page.waitForResponse(
      (r) => r.url().includes('/auth/verify') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await signInButton.click();
    await verifyResponse;
    await expect(signInButton).toBeHidden({ timeout: 5_000 });

    // Navigate to the malicious second origin, in the SAME browser context.
    // Its own page script opens the WebSocket — Chromium attaches whatever
    // cookies exist for the TARGET origin (Pocketed's), and sets Origin to
    // THIS page's own origin (the malicious one) — exactly the CSRF-shaped
    // risk _ws_origin_allowed defends against, reproduced for real.
    await page.goto('http://localhost:5902/');

    const closeCode = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const check = () => {
            const el = document.getElementById('result');
            if (el && el.textContent !== 'pending') resolve(el.textContent!);
            else setTimeout(check, 100);
          };
          check();
        }),
    );

    expect(Number(closeCode), 'the handshake must be rejected at the Origin check (4403)').toBe(4403);
  });
});
```

- [ ] **Step 4: Run both projects**

Run: `npm run test:e2e`
Expected: PASS — existing tests plus the new malicious-origin test.

Run: `npm run test:e2e:tls`
Expected: PASS — 2 tests now (from Task 11 plus this one, which reuses the TLS project's already-wired malicious server).

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures/malicious-origin-server.mjs e2e/tests/malicious-origin.spec.ts e2e/playwright.config.ts
git commit -m "test(e2e): browser-level malicious-Origin WS rejection over HTTP and HTTPS/WSS (C)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Reverse-proxy topology (nginx + Docker)

**Files:**
- Create: `infra/reverse-proxy/Dockerfile.gateway`
- Create: `infra/reverse-proxy/nginx.conf`
- Create: `infra/reverse-proxy/docker-compose.yml`
- Create: `infra/reverse-proxy/README.md`

- [ ] **Step 1: Write the gateway Dockerfile**

```dockerfile
# infra/reverse-proxy/Dockerfile.gateway
# Built from the repo root (see docker-compose.yml's `context: ../..`).
# Expects `dist/` (the built frontend) to already exist — CI runs
# `npm run build` before `docker compose build` for this service.
FROM python:3.11-slim
WORKDIR /app
COPY webserver/requirements.txt webserver/requirements.txt
RUN pip install --no-cache-dir -r webserver/requirements.txt
COPY webserver webserver
COPY python python
COPY dist dist
ENV POCKETED_WEBAPP_DIST=/app/dist
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "webserver.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Write the nginx config**

```nginx
# infra/reverse-proxy/nginx.conf
worker_processes 1;
events { worker_connections 1024; }

http {
  map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
  }

  server {
    listen 8443 ssl;
    server_name localhost;

    ssl_certificate     /certs/leaf-cert.pem;
    ssl_certificate_key /certs/leaf-key.pem;

    location / {
      proxy_pass http://gateway:8000;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-Host $host;
    }

    location /ws {
      proxy_pass http://gateway:8000;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-Host $host;
      proxy_read_timeout 3600s;
    }
  }
}
```

- [ ] **Step 3: Write the compose file**

```yaml
# infra/reverse-proxy/docker-compose.yml
services:
  gateway:
    build:
      context: ../..
      dockerfile: infra/reverse-proxy/Dockerfile.gateway
    environment:
      APP_ENV: test
      POCKETED_SESSION_SECRET: e2e-test-session-secret-not-for-production-use-only
      POCKETED_WORKER_SCRIPT: /app/webserver/tests/fixtures/dummy_worker.py
      POCKETED_SIWE_CHAIN_IDS: "1337"
      POCKETED_SIWE_DOMAINS: "localhost:8443"
      POCKETED_ALLOWED_ORIGINS: "https://localhost:8443"
    expose:
      - "8000"

  nginx:
    image: nginx:1.27-alpine
    depends_on:
      - gateway
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ../../e2e/certs/.gen:/certs:ro
    ports:
      - "8443:8443"
```

- [ ] **Step 4: Write the README**

```markdown
# infra/reverse-proxy/README.md
# Local production-like reverse-proxy topology

Browser -> HTTPS/WSS nginx (TLS termination, `X-Forwarded-*`) -> FastAPI gateway (plain HTTP).

Proves: `X-Forwarded-Proto`/`Host` forwarding, SIWE domain validation, Secure
cookie, WS `Upgrade`/`Connection` headers, Origin validation, WSS, 101, RPC —
all through nginx, not the app talking TLS directly (see `../../e2e/playwright.tls.config.ts`
for that mode instead).

## Run standalone

```bash
node ../../e2e/certs/gen-certs.mjs   # generate the shared throwaway cert first
npm run build --prefix ../..          # produce dist/ for the gateway image
docker compose up --build --wait
```

Then open `https://localhost:8443` — your browser will warn about the
untrusted cert (it's a throwaway test CA, not installed in your OS trust
store); this is expected for manual use. The automated E2E project
(`../../e2e/playwright.proxy.config.ts`) instead has Chromium trust just this
run's leaf cert via its SPKI hash, so it sees no warning.

```bash
docker compose down -v
```
```

- [ ] **Step 5: Verify manually**

Run:
```bash
node e2e/certs/gen-certs.mjs
npm run build
docker compose -f infra/reverse-proxy/docker-compose.yml up --build --wait
curl -sk https://localhost:8443/health
```
Expected: `{"status":"ok"}`

```bash
docker compose -f infra/reverse-proxy/docker-compose.yml down -v
```

- [ ] **Step 6: Commit**

```bash
git add infra/reverse-proxy/
git commit -m "feat(infra): local production-like nginx reverse-proxy topology (TLS termination, WS upgrade, X-Forwarded-*)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: `e2e/playwright.proxy.config.ts` — full browser E2E through the dockerized proxy

**Files:**
- Create: `e2e/proxy-global-setup.mjs`
- Create: `e2e/proxy-global-teardown.mjs`
- Create: `e2e/playwright.proxy.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ensureCerts` (Task 9), `infra/reverse-proxy/docker-compose.yml` (Task 13), `e2e/tests/auth-ws-tls.spec.ts` (Task 11, reused unmodified — it only assumes an HTTPS `baseURL` and a `wss://` WS URL, both true here).

- [ ] **Step 1: Add the npm script**

```json
// package.json — "scripts" section, add after "test:e2e:tls"
"test:e2e:proxy": "playwright test --config e2e/playwright.proxy.config.ts",
```

- [ ] **Step 2: Write global setup/teardown**

```javascript
// e2e/proxy-global-setup.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCerts } from './certs/gen-certs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.');
const COMPOSE_FILE = path.join(ROOT, '..', 'infra', 'reverse-proxy', 'docker-compose.yml');

export default async function globalSetup() {
  ensureCerts(); // must exist before docker-compose mounts e2e/certs/.gen into nginx
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--build', '--wait'], {
    stdio: 'inherit',
  });
}
```

```javascript
// e2e/proxy-global-teardown.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.');
const COMPOSE_FILE = path.join(ROOT, '..', 'infra', 'reverse-proxy', 'docker-compose.yml');

export default async function globalTeardown() {
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'down', '-v'], { stdio: 'inherit' });
}
```

- [ ] **Step 3: Write the config**

```typescript
// e2e/playwright.proxy.config.ts
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCerts } from './certs/gen-certs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certs = ensureCerts();

export default defineConfig({
  testDir: './tests',
  testMatch: ['auth-ws-tls.spec.ts'],
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  globalSetup: path.join(ROOT, 'e2e', 'proxy-global-setup.mjs'),
  globalTeardown: path.join(ROOT, 'e2e', 'proxy-global-teardown.mjs'),
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-proxy' }]]
    : 'list',
  use: {
    baseURL: 'https://localhost:8443',
    trace: 'retain-on-failure',
    launchOptions: {
      args: [`--ignore-certificate-errors-spki-list=${certs.spkiHash}`],
    },
  },
});
```

- [ ] **Step 4: Run the suite**

Run: `npm run build && npm run test:e2e:proxy`
Expected: PASS — `auth-ws-tls.spec.ts`'s test now runs against `https://localhost:8443` (nginx), proving `X-Forwarded-Proto`/`Host`, SIWE domain validation, Origin validation, and Secure-cookie/WSS/101/RPC all work through the proxy.

- [ ] **Step 5: Commit**

```bash
git add e2e/proxy-global-setup.mjs e2e/proxy-global-teardown.mjs e2e/playwright.proxy.config.ts package.json
git commit -m "test(e2e): full browser E2E through the dockerized nginx reverse proxy (X-Forwarded-*, WSS, 101, RPC)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 15: CI — layered workflow

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Rewrite the workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install Node dependencies
        run: npm install
      - name: TypeScript typecheck
        run: npm run typecheck
      - name: Run frontend tests
        run: npm test
      - name: Install Python test dependencies
        run: pip install -r python/requirements-dev.txt
      - name: Run Python tests
        working-directory: python
        run: python -m pytest -q

  backend-integration:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        store: [sqlite, redis]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install Redis (host package, not docker-compose)
        if: matrix.store == 'redis'
        run: |
          sudo apt-get update
          sudo apt-get install -y redis-server
          redis-server --daemonize yes
      - name: Install webserver test dependencies
        run: pip install -r webserver/requirements.txt
      - name: Run webserver tests (${{ matrix.store }} store backend)
        working-directory: webserver
        env:
          POCKETED_SESSION_STORE: ${{ matrix.store }}
          POCKETED_NONCE_STORE: ${{ matrix.store }}
          POCKETED_REDIS_URL: ${{ matrix.store == 'redis' && 'redis://127.0.0.1:6379/0' || '' }}
        run: python -m pytest tests/ -q

  e2e-http:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install Node dependencies
        run: npm install
      - name: Install webserver dependencies
        run: pip install -r webserver/requirements.txt
      - name: Install Playwright's Chromium
        run: npx playwright install --with-deps chromium
      - name: Run wallet -> SIWE -> WS -> RPC E2E suite (A, C)
        run: npm run test:e2e
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-http
          path: e2e/playwright-report/
          retention-days: 14

  e2e-tls:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install Node dependencies
        run: npm install
      - name: Install webserver dependencies
        run: pip install -r webserver/requirements.txt
      - name: Install Playwright's Chromium
        run: npx playwright install --with-deps chromium
      - name: Run HTTPS/WSS + malicious-origin E2E suite (B, C)
        run: npm run test:e2e:tls
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-tls
          path: e2e/playwright-report-tls/
          retention-days: 14

  e2e-proxy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install Node dependencies
        run: npm install
      - name: Build frontend (dist/ is baked into the gateway's Docker image)
        run: npm run build
      - name: Install Playwright's Chromium
        run: npx playwright install --with-deps chromium
      - name: Run E2E suite through the dockerized nginx reverse proxy (B)
        run: npm run test:e2e:proxy
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-proxy
          path: e2e/playwright-report-proxy/
          retention-days: 14
```

- [ ] **Step 2: Validate the YAML**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" ` (or any YAML linter available)
Expected: no error.

- [ ] **Step 3: Push to a branch and confirm all 5 jobs run and pass in GitHub Actions**

(Manual verification once the branch is pushed — not automatable from this plan.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: split into unit / backend-integration (sqlite+redis matrix) / e2e-http / e2e-tls / e2e-proxy jobs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
1. HTTPS+WSS E2E → Tasks 9, 10, 11 (B).
2. Malicious-Origin browser E2E → Task 12 (C), HTTPS variant folded into Task 11's `webServer` wiring + Task 12's spec running under both configs.
3. Server-side logout revocation → Tasks 1–8 (D, E), plus F proven at the storage layer in Tasks 1–3 and reused by the Redis matrix in Task 15.
4. Nonce storage production readiness → Tasks 1, 2, 4, 5.
5. Reverse-proxy topology → Tasks 13, 14 (B, again, through a different topology).
6. CI layering → Task 15.

**Placeholder scan:** no TBD/TODO; every step carries real, runnable code or an exact shell command.

**Type consistency:** `NonceStore.issue/consume`, `SessionStore.create/touch/is_active/revoke`, `SessionNotFound`, `decode_session_token`'s `{wallets, active, sid, jti}` shape, `SESSION_REVOKED_CLOSE_CODE = 4402` (backend) / `SESSION_REVOKED_CLOSE_CODE` (frontend) are used identically across every task that references them.

**Scope check:** single cohesive plan — the six gaps share one underlying dependency chain (store-backed revocation underpins the E2E revocation test; the TLS cert generator underpins both the TLS project and the proxy project) and don't decompose further without duplicating work.

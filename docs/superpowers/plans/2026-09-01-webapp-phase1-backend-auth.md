# Webapp Fase 1: Backend Multi-Tenant + Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new `webserver/` FastAPI gateway that lets multiple users log in with a wallet signature (SIWE) and each get their own isolated `python/service.py` backend worker over a WebSocket, replacing the Electron main process's stdio JSON-RPC bridge — with no order signing/trading enabled yet (that's Fase 2).

**Architecture:** One FastAPI process (`webserver/main.py`) fronts SIWE auth (`webserver/auth.py`) and a `Supervisor` (`webserver/supervisor.py`) that spawns/reuses one `python/service.py` subprocess per authenticated wallet address, isolated by a per-user `KRYPT_POLYBOT_USERDATA` directory (the same env var `python/db.py` already reads — no changes needed there). The gateway proxies each user's WebSocket to their worker using the exact line-delimited JSON-RPC protocol Electron already speaks (`electron/system/python-backend.ts`), so `python/service.py` itself is untouched.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, `siwe` (EIP-4361), PyJWT (session cookies), `eth-account` (tests), pytest + pytest-asyncio, Starlette `TestClient`.

**Spec:** [C:\Users\Admin\.claude\plans\emplea-superpoews-vamos-a-federated-cloud.md](C:\Users\Admin\.claude\plans\emplea-superpoews-vamos-a-federated-cloud.md)

## Global Constraints

- No repo commits use `--no-verify` or skip hooks.
- No trading/credential RPC methods (`setCredentials`, `clearCredentials`, `testCredentials`, `cancelAllOpen`, `flatten`) may succeed through the webapp gateway in this phase — the spec places order signing/execution in Fase 2. The gateway must refuse them with a clear error, not silently pass them through.
- `python/service.py` and everything under `python/` besides reading `KRYPT_POLYBOT_USERDATA` (already supported) must not be modified.
- Session tokens are signed with a secret from `KRYPT_POLYBOT_SESSION_SECRET`; the app must refuse to start without it (no baked-in default secret — this handles real wallet-identified sessions).
- All new code lives under `webserver/`.

---

### Task 1: Project scaffolding

**Files:**
- Create: `webserver/__init__.py`
- Create: `webserver/requirements.txt`
- Create: `webserver/pytest.ini`
- Create: `webserver/tests/__init__.py`
- Create: `webserver/tests/conftest.py`
- Create: `.gitignore` additions (if `webserver/.venv` isn't already covered)

**Interfaces:**
- Produces: an installable `webserver/.venv` with `fastapi`, `uvicorn`, `siwe`, `pyjwt`, `eth-account`, `websockets`, `pytest`, `pytest-asyncio`, `httpx` available, and a working `pytest` discovery under `webserver/`.

- [ ] **Step 1: Initialize git (the repo has none yet) and commit the existing tree as a baseline**

```bash
cd "C:\Users\Admin\Documents\workspace\Krypt-Polybot-main"
git init
git add -A
git commit -m "chore: initial commit of existing Krypt-Polybot tree"
```

- [ ] **Step 2: Create the `webserver` package and requirements file**

`webserver/__init__.py`:
```python
```

`webserver/requirements.txt`:
```
fastapi>=0.115
uvicorn[standard]>=0.30
websockets>=12,<14
siwe>=4.2.0
pyjwt>=2.9.0
eth-account>=0.13.0
pytest>=8.0
pytest-asyncio>=0.24
httpx>=0.28.0
```

`webserver/pytest.ini`:
```ini
[pytest]
asyncio_mode = strict
```

- [ ] **Step 3: Create the venv and install dependencies**

```bash
cd "C:\Users\Admin\Documents\workspace\Krypt-Polybot-main"
python -m venv webserver/.venv
source webserver/.venv/Scripts/activate
pip install -r webserver/requirements.txt
```

- [ ] **Step 4: Add test scaffolding**

`webserver/tests/__init__.py`:
```python
```

`webserver/tests/conftest.py`:
```python
"""Shared pytest fixtures for the webserver test suite."""
import asyncio
import os
import sys

import pytest

# webserver.main reads this at import time and refuses to import without
# it. Set a test default here (module-level, so it runs during conftest
# collection) — before any test module does `import webserver.main`.
os.environ.setdefault("KRYPT_POLYBOT_SESSION_SECRET", "test-secret")


@pytest.fixture(scope="session", autouse=True)
def _windows_proactor_event_loop_policy():
    # asyncio.create_subprocess_exec needs the Proactor loop on Windows.
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    yield
```

Confirm `webserver/.venv` is ignored by git (check `.gitignore`; if `*.venv`/`.venv/` isn't already covered, append it):

```bash
grep -q "^\.venv" .gitignore || printf '\n# per-package venvs\n**/.venv/\n' >> .gitignore
```

- [ ] **Step 5: Verify test discovery works (no tests yet, should collect 0 and exit 0)**

Run: `cd webserver && ../webserver/.venv/Scripts/python -m pytest --collect-only`
Expected: `collected 0 items`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add webserver .gitignore
git commit -m "chore: scaffold webserver package for Fase 1 webapp gateway"
```

---

### Task 2: SIWE auth (`webserver/auth.py`)

**Files:**
- Create: `webserver/auth.py`
- Test: `webserver/tests/test_auth.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Task 4):
  - `AuthError(Exception)`
  - `generate_nonce() -> str`
  - `verify_siwe(message: str, signature: str) -> str` — returns checksummed wallet address, raises `AuthError`
  - `create_session_token(wallet_address: str, *, secret: str) -> str`
  - `decode_session_token(token: str, *, secret: str) -> str` — returns wallet address, raises `AuthError`
  - `SESSION_TTL_SECONDS: int`

- [ ] **Step 1: Write the failing tests**

`webserver/tests/test_auth.py`:
```python
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


def test_session_token_round_trip():
    token = auth.create_session_token("0xABC", secret="test-secret")

    address = auth.decode_session_token(token, secret="test-secret")

    assert address == "0xABC"


def test_session_token_rejects_wrong_secret():
    token = auth.create_session_token("0xABC", secret="test-secret")

    with pytest.raises(auth.AuthError):
        auth.decode_session_token(token, secret="other-secret")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webserver && .venv/Scripts/python -m pytest tests/test_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webserver.auth'` (or `ImportError`).

- [ ] **Step 3: Implement `webserver/auth.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webserver && .venv/Scripts/python -m pytest tests/test_auth.py -v`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add webserver/auth.py webserver/tests/test_auth.py
git commit -m "feat(webserver): SIWE nonce issuance, verification, and session tokens"
```

---

### Task 3: Per-user worker supervisor (`webserver/supervisor.py`)

**Files:**
- Create: `webserver/supervisor.py`
- Create: `webserver/tests/fixtures/dummy_worker.py`
- Test: `webserver/tests/test_supervisor.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Task 4):
  - `class WorkerStartError(Exception)`
  - `class WorkerProcess` with `.user_id`, `.data_dir: Path`, `.process`, `async def request(method: str, params: dict | None = None, timeout: float = 30.0) -> Any`, `def subscribe() -> asyncio.Queue`, `def unsubscribe(q: asyncio.Queue) -> None`, `async def stop() -> None`
  - `class Supervisor` with `def __init__(self, data_root: Path, *, script_path: Path | None = None, python_executable: str | None = None)`, `async def get_or_create(user_id: str) -> WorkerProcess`, `def start_reaper() -> None`, `async def stop_all() -> None`

- [ ] **Step 1: Write the dummy worker test fixture**

`webserver/tests/fixtures/dummy_worker.py`:
```python
"""Minimal stand-in for python/service.py's stdio JSON-RPC contract, used
by supervisor tests so they don't depend on the full trading backend's
dependencies (py_clob_client_v2, keyring, etc.) being installed."""
import json
import sys


def _send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main() -> None:
    _send({"type": "event", "name": "backend:ready", "data": {}})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        if req.get("type") != "rpc":
            continue
        method = req.get("method")
        if method == "shutdown":
            _send({"type": "rpc", "id": req["id"], "ok": True, "result": None})
            return
        if method == "ping":
            _send({"type": "rpc", "id": req["id"], "ok": True, "result": {"pong": True}})
            continue
        if method == "crash":
            sys.exit(1)
        _send({"type": "rpc", "id": req["id"], "ok": False, "error": f"unknown method {method}"})


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write the failing tests**

`webserver/tests/test_supervisor.py`:
```python
import asyncio
from pathlib import Path

import pytest

from webserver.supervisor import Supervisor, WorkerStartError

FIXTURE_SCRIPT = Path(__file__).parent / "fixtures" / "dummy_worker.py"


@pytest.mark.asyncio
async def test_get_or_create_starts_and_reuses_worker(tmp_path):
    sup = Supervisor(tmp_path, script_path=FIXTURE_SCRIPT)

    worker_a = await sup.get_or_create("user-1")
    worker_b = await sup.get_or_create("user-1")

    assert worker_a is worker_b
    assert worker_a.process is not None
    await sup.stop_all()


@pytest.mark.asyncio
async def test_request_ping_roundtrip(tmp_path):
    sup = Supervisor(tmp_path, script_path=FIXTURE_SCRIPT)
    worker = await sup.get_or_create("user-1")

    result = await worker.request("ping", {}, timeout=5.0)

    assert result == {"pong": True}
    await sup.stop_all()


@pytest.mark.asyncio
async def test_two_users_get_isolated_data_dirs(tmp_path):
    sup = Supervisor(tmp_path, script_path=FIXTURE_SCRIPT)

    worker_a = await sup.get_or_create("user-a")
    worker_b = await sup.get_or_create("user-b")

    assert worker_a.data_dir == tmp_path / "users" / "user-a"
    assert worker_b.data_dir == tmp_path / "users" / "user-b"
    await sup.stop_all()


@pytest.mark.asyncio
async def test_crash_triggers_backoff_on_next_start(tmp_path):
    sup = Supervisor(tmp_path, script_path=FIXTURE_SCRIPT)
    worker = await sup.get_or_create("user-1")

    with pytest.raises(RuntimeError, match="worker exited"):
        await worker.request("crash", {}, timeout=5.0)

    await asyncio.sleep(0.2)  # let the exit handler run

    with pytest.raises(WorkerStartError):
        await sup.get_or_create("user-1")

    await sup.stop_all()


@pytest.mark.asyncio
async def test_stop_all_terminates_workers(tmp_path):
    sup = Supervisor(tmp_path, script_path=FIXTURE_SCRIPT)
    worker = await sup.get_or_create("user-1")

    await sup.stop_all()

    assert sup.workers == {}
    await asyncio.sleep(0.2)
    assert worker.process is None or worker.process.returncode is not None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd webserver && .venv/Scripts/python -m pytest tests/test_supervisor.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webserver.supervisor'`.

- [ ] **Step 4: Implement `webserver/supervisor.py`**

```python
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger("webserver.supervisor")

REPO_ROOT = Path(__file__).resolve().parent.parent
PYTHON_DIR = REPO_ROOT / "python"
SERVICE_SCRIPT = PYTHON_DIR / "service.py"

IDLE_TIMEOUT_SECONDS = 15 * 60
CRASH_BACKOFF_BASE_SECONDS = 2.0
CRASH_BACKOFF_MAX_SECONDS = 30.0
STABLE_UPTIME_SECONDS = 30.0
SHUTDOWN_GRACE_SECONDS = 1.5


class WorkerStartError(Exception):
    """Raised when a per-user backend worker cannot be started."""


def _resolve_python_executable() -> str:
    venv_python = (
        PYTHON_DIR / ".venv" / "Scripts" / "python.exe"
        if sys.platform == "win32"
        else PYTHON_DIR / ".venv" / "bin" / "python"
    )
    if venv_python.exists():
        return str(venv_python)
    return sys.executable


@dataclass
class _Pending:
    future: asyncio.Future
    method: str
    started_at: float


class WorkerProcess:
    """One per-user backend subprocess, speaking the same line-delimited
    JSON-RPC protocol the Electron main process already used
    (electron/system/python-backend.ts): stdin carries
    {"type": "rpc", "id", "method", "params"} requests; stdout carries
    {"type": "rpc", ...}, {"type": "event", ...}, {"type": "log", ...} lines.
    """

    def __init__(
        self,
        user_id: str,
        data_dir: Path,
        *,
        python_executable: str | None = None,
        script_path: Path | None = None,
    ):
        self.user_id = user_id
        self.data_dir = data_dir
        self.python_executable = python_executable or _resolve_python_executable()
        self.script_path = script_path or SERVICE_SCRIPT
        self.process: asyncio.subprocess.Process | None = None
        self.pending: dict[str, _Pending] = {}
        self.subscribers: list[asyncio.Queue] = []
        self.last_active = time.monotonic()
        self.connection_count = 0
        self.crash_count = 0
        self.last_crash_at = 0.0
        self._started_at = 0.0
        self._stopping = False
        self._next_id = 1
        self._reader_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def ensure_started(self) -> None:
        async with self._lock:
            if self.process is not None and self.process.returncode is None:
                return
            if self.crash_count > 0:
                backoff = min(
                    CRASH_BACKOFF_BASE_SECONDS * (2 ** (self.crash_count - 1)),
                    CRASH_BACKOFF_MAX_SECONDS,
                )
                elapsed = time.monotonic() - self.last_crash_at
                if elapsed < backoff:
                    raise WorkerStartError(
                        f"worker for user={self.user_id} crashed recently; "
                        f"retry in {backoff - elapsed:.1f}s"
                    )
            if not self.script_path.exists():
                raise WorkerStartError(f"backend script not found at {self.script_path}")

            self.data_dir.mkdir(parents=True, exist_ok=True)
            env = {
                **os.environ,
                "KRYPT_POLYBOT_USERDATA": str(self.data_dir),
                "PYTHONUNBUFFERED": "1",
                "PYTHONIOENCODING": "utf-8",
            }
            self._stopping = False
            self.process = await asyncio.create_subprocess_exec(
                self.python_executable, str(self.script_path),
                cwd=str(self.script_path.parent),
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            self._started_at = time.monotonic()
            self._reader_task = asyncio.create_task(
                self._read_stdout(), name=f"worker-reader-{self.user_id}"
            )
            asyncio.create_task(
                self._drain_stderr(), name=f"worker-stderr-{self.user_id}"
            )
            logger.info(f"worker started for user={self.user_id} pid={self.process.pid}")

    async def _read_stdout(self) -> None:
        assert self.process is not None and self.process.stdout is not None
        stream = self.process.stdout
        while True:
            line = await stream.readline()
            if not line:
                break
            try:
                obj = json.loads(line.decode("utf-8").strip())
            except Exception:
                continue
            self._route_incoming(obj)
        await self._on_exit()

    async def _drain_stderr(self) -> None:
        if self.process is None or self.process.stderr is None:
            return
        stream = self.process.stderr
        while True:
            line = await stream.readline()
            if not line:
                break
            logger.warning(
                f"[worker {self.user_id} stderr] {line.decode('utf-8', 'replace').strip()}"
            )

    def _route_incoming(self, obj: dict) -> None:
        if obj.get("type") == "rpc":
            pending = self.pending.pop(obj.get("id"), None)
            if pending is None or pending.future.done():
                return
            if obj.get("ok"):
                pending.future.set_result(obj.get("result"))
            else:
                pending.future.set_exception(RuntimeError(obj.get("error") or "rpc failed"))
            return
        for q in list(self.subscribers):
            try:
                q.put_nowait(obj)
            except asyncio.QueueFull:
                pass

    async def _on_exit(self) -> None:
        code = self.process.returncode if self.process else None
        logger.warning(f"worker for user={self.user_id} exited (code={code})")
        if not self._stopping:
            uptime = time.monotonic() - self._started_at
            if uptime < STABLE_UPTIME_SECONDS:
                self.crash_count += 1
                self.last_crash_at = time.monotonic()
            else:
                self.crash_count = 0
        for pending in self.pending.values():
            if not pending.future.done():
                pending.future.set_exception(RuntimeError("worker exited"))
        self.pending.clear()
        self.process = None
        for q in list(self.subscribers):
            try:
                q.put_nowait(
                    {"type": "event", "name": "backend:workerExited", "data": {"code": code}}
                )
            except asyncio.QueueFull:
                pass

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self.subscribers.append(q)
        self.connection_count += 1
        self.last_active = time.monotonic()
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self.subscribers:
            self.subscribers.remove(q)
        self.connection_count = max(0, self.connection_count - 1)
        self.last_active = time.monotonic()

    async def request(self, method: str, params: dict | None = None, timeout: float = 30.0) -> Any:
        if self.process is None or self.process.stdin is None:
            raise RuntimeError("worker not running")
        req_id = f"r{self._next_id}"
        self._next_id += 1
        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self.pending[req_id] = _Pending(future=future, method=method, started_at=time.monotonic())
        self._write({"type": "rpc", "id": req_id, "method": method, "params": params or {}})
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self.pending.pop(req_id, None)

    def _write(self, obj: dict) -> None:
        if self.process is None or self.process.stdin is None:
            raise RuntimeError("worker not running")
        self.process.stdin.write((json.dumps(obj) + "\n").encode("utf-8"))
        self.last_active = time.monotonic()

    async def stop(self) -> None:
        if self.process is None:
            return
        self._stopping = True
        try:
            self._write({"type": "rpc", "id": "shutdown", "method": "shutdown", "params": {}})
        except Exception:
            pass
        try:
            await asyncio.wait_for(self.process.wait(), timeout=SHUTDOWN_GRACE_SECONDS)
        except asyncio.TimeoutError:
            try:
                self.process.kill()
            except ProcessLookupError:
                pass
        if self._reader_task:
            self._reader_task.cancel()

    def idle_seconds(self) -> float:
        if self.connection_count > 0:
            return 0.0
        return time.monotonic() - self.last_active


class Supervisor:
    """Owns one WorkerProcess per authenticated user, with crash-backoff and
    idle-timeout reaping."""

    def __init__(
        self,
        data_root: Path,
        *,
        script_path: Path | None = None,
        python_executable: str | None = None,
    ):
        self.data_root = data_root
        self.script_path = script_path or SERVICE_SCRIPT
        self.python_executable = python_executable
        self.workers: dict[str, WorkerProcess] = {}
        self._reaper_task: asyncio.Task | None = None

    def start_reaper(self) -> None:
        if self._reaper_task is None:
            self._reaper_task = asyncio.create_task(self._reap_loop(), name="worker-reaper")

    async def _reap_loop(self) -> None:
        while True:
            await asyncio.sleep(60)
            for user_id, worker in list(self.workers.items()):
                if worker.idle_seconds() >= IDLE_TIMEOUT_SECONDS:
                    logger.info(f"idle-timeout: stopping worker for user={user_id}")
                    await worker.stop()
                    self.workers.pop(user_id, None)

    async def get_or_create(self, user_id: str) -> WorkerProcess:
        worker = self.workers.get(user_id)
        if worker is None:
            worker = WorkerProcess(
                user_id,
                self.data_root / "users" / user_id,
                python_executable=self.python_executable,
                script_path=self.script_path,
            )
            self.workers[user_id] = worker
        await worker.ensure_started()
        return worker

    async def stop_all(self) -> None:
        for worker in list(self.workers.values()):
            await worker.stop()
        self.workers.clear()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webserver && .venv/Scripts/python -m pytest tests/test_supervisor.py -v`
Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add webserver/supervisor.py webserver/tests/test_supervisor.py webserver/tests/fixtures/dummy_worker.py
git commit -m "feat(webserver): per-user worker supervisor with crash-backoff and idle reaping"
```

---

### Task 4: FastAPI gateway (`webserver/main.py`)

**Files:**
- Create: `webserver/main.py`
- Test: `webserver/tests/test_main_ws.py`

**Interfaces:**
- Consumes: `webserver.auth` (Task 2), `webserver.supervisor.Supervisor`/`WorkerStartError` (Task 3).
- Produces: `app: FastAPI`, module-level `supervisor: Supervisor`, module-level `SESSION_SECRET: str`.

- [ ] **Step 1: Write the failing tests**

`webserver/tests/test_main_ws.py`:
```python
from datetime import datetime, timezone
from pathlib import Path

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient
from siwe import SiweMessage

import webserver.main as main_module
from webserver.supervisor import Supervisor

FIXTURE_SCRIPT = Path(__file__).parent / "fixtures" / "dummy_worker.py"


@pytest.fixture(autouse=True)
def _test_session_secret(monkeypatch):
    monkeypatch.setattr(main_module, "SESSION_SECRET", "test-secret")


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_supervisor = Supervisor(tmp_path, script_path=FIXTURE_SCRIPT)
    monkeypatch.setattr(main_module, "supervisor", test_supervisor)
    with TestClient(main_module.app) as c:
        yield c


def _login(client) -> str:
    account = Account.create()
    nonce = client.post("/auth/nonce").json()["nonce"]
    msg = SiweMessage(
        domain="testserver",
        address=account.address,
        statement="Sign in to Krypt PolyBot",
        uri="http://testserver/auth",
        version="1",
        chain_id=137,
        nonce=nonce,
        issued_at=datetime.now(timezone.utc).isoformat(),
    )
    prepared = msg.prepare_message()
    signed = Account.sign_message(encode_defunct(text=prepared), private_key=account.key)
    resp = client.post(
        "/auth/verify",
        json={"message": prepared, "signature": signed.signature.hex()},
    )
    assert resp.status_code == 200
    return resp.json()["walletAddress"]


def test_nonce_endpoint_returns_a_nonce(client):
    resp = client.post("/auth/nonce")

    assert resp.status_code == 200
    assert len(resp.json()["nonce"]) > 0


def test_verify_endpoint_sets_session_cookie(client):
    wallet_address = _login(client)

    assert wallet_address
    assert main_module.SESSION_COOKIE_NAME in client.cookies


def test_verify_endpoint_rejects_bad_signature(client):
    account = Account.create()
    nonce = client.post("/auth/nonce").json()["nonce"]
    msg = SiweMessage(
        domain="testserver", address=account.address, statement="Sign in",
        uri="http://testserver/auth", version="1", chain_id=137, nonce=nonce,
        issued_at=datetime.now(timezone.utc).isoformat(),
    )
    prepared = msg.prepare_message()

    resp = client.post("/auth/verify", json={"message": prepared, "signature": "0x" + "00" * 65})

    assert resp.status_code == 401


def test_ws_requires_session_cookie(client):
    with client.websocket_connect("/ws") as ws:
        with pytest.raises(Exception):
            ws.receive_json()


def test_ws_ping_roundtrip_after_login(client):
    _login(client)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "rpc", "id": "1", "method": "ping", "params": {}})
        reply = ws.receive_json()
        assert reply == {"type": "rpc", "id": "1", "ok": True, "result": {"pong": True}}


def test_ws_blocks_phase1_disabled_trading_methods(client):
    _login(client)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "rpc", "id": "2", "method": "setCredentials", "params": {}})
        reply = ws.receive_json()
        assert reply["ok"] is False
        assert "Fase 2" in reply["error"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webserver && .venv/Scripts/python -m pytest tests/test_main_ws.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webserver.main'`.

- [ ] **Step 3: Implement `webserver/main.py`**

```python
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

from fastapi import Cookie, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from webserver import auth
from webserver.supervisor import Supervisor, WorkerStartError

logger = logging.getLogger("webserver.main")

SESSION_COOKIE_NAME = "kpb_session"
SESSION_SECRET = os.environ.get("KRYPT_POLYBOT_SESSION_SECRET")
if not SESSION_SECRET:
    raise RuntimeError(
        "KRYPT_POLYBOT_SESSION_SECRET must be set — refusing to sign "
        "sessions with a default secret."
    )

DATA_ROOT = Path(
    os.environ.get(
        "KRYPT_POLYBOT_WEBAPP_DATA",
        str(Path(__file__).resolve().parent.parent / "python" / "data" / "webapp"),
    )
)

# Fase 1 explicitly excludes order signing/execution (see spec). Any RPC
# method that touches credentials or live trading is refused at the
# gateway, before it ever reaches a worker.
_TRADING_METHODS_DISABLED_PHASE1 = {
    "setCredentials", "clearCredentials", "testCredentials",
    "cancelAllOpen", "flatten",
}

app = FastAPI(title="Krypt PolyBot webapp gateway")
supervisor = Supervisor(DATA_ROOT)


@app.on_event("startup")
async def _on_startup() -> None:
    supervisor.start_reaper()


class NonceResponse(BaseModel):
    nonce: str


@app.post("/auth/nonce", response_model=NonceResponse)
async def issue_nonce() -> NonceResponse:
    return NonceResponse(nonce=auth.generate_nonce())


class VerifyRequest(BaseModel):
    message: str
    signature: str


@app.post("/auth/verify")
async def verify(body: VerifyRequest) -> JSONResponse:
    try:
        wallet_address = auth.verify_siwe(body.message, body.signature)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e

    token = auth.create_session_token(wallet_address, secret=SESSION_SECRET)
    response = JSONResponse({"walletAddress": wallet_address})
    response.set_cookie(
        SESSION_COOKIE_NAME, token,
        httponly=True, secure=True, samesite="lax",
        max_age=auth.SESSION_TTL_SECONDS,
    )
    return response


@app.websocket("/ws")
async def ws_endpoint(
    websocket: WebSocket,
    kpb_session: str | None = Cookie(default=None),
) -> None:
    await websocket.accept()

    try:
        wallet_address = auth.decode_session_token(kpb_session or "", secret=SESSION_SECRET)
    except auth.AuthError:
        await websocket.close(code=4401)
        return

    try:
        worker = await supervisor.get_or_create(wallet_address)
    except WorkerStartError as e:
        await websocket.send_json(
            {"type": "event", "name": "backend:startError", "data": {"error": str(e)}}
        )
        await websocket.close(code=1011)
        return

    outbound = worker.subscribe()

    async def pump_outbound() -> None:
        while True:
            msg = await outbound.get()
            await websocket.send_json(msg)

    outbound_task = asyncio.create_task(pump_outbound())
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
        worker.unsubscribe(outbound)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webserver && KRYPT_POLYBOT_SESSION_SECRET=test .venv/Scripts/python -m pytest tests/test_main_ws.py -v`
Expected: all 6 tests PASS.

- [ ] **Step 5: Run the full webserver test suite**

Run: `cd webserver && KRYPT_POLYBOT_SESSION_SECRET=test .venv/Scripts/python -m pytest -v`
Expected: all tests across `test_auth.py`, `test_supervisor.py`, `test_main_ws.py` PASS.

- [ ] **Step 6: Commit**

```bash
git add webserver/main.py webserver/tests/test_main_ws.py
git commit -m "feat(webserver): FastAPI gateway wiring SIWE auth to per-user worker WS"
```

---

### Task 5: Manual end-to-end verification harness

**Files:**
- Create: `webserver/tests/manual_client.py`

**Interfaces:**
- Consumes: `webserver.main.app` running live (via `uvicorn`), a real SIWE-capable wallet (a throwaway `eth_account.Account` for local testing).
- Produces: a runnable script for the human verification step below — not part of the pytest suite.

- [ ] **Step 1: Write the manual client script**

`webserver/tests/manual_client.py`:
```python
"""Manual end-to-end check for the Fase 1 webapp gateway. Not run by pytest.

Usage (with the gateway already running — see Task 5 verification steps):
    python webserver/tests/manual_client.py
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import httpx
import websockets
from eth_account import Account
from eth_account.messages import encode_defunct
from siwe import SiweMessage

BASE_URL = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000/ws"


async def main() -> None:
    account = Account.create()
    print(f"using throwaway test wallet: {account.address}")

    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        nonce = (await client.post("/auth/nonce")).json()["nonce"]
        msg = SiweMessage(
            domain="127.0.0.1", address=account.address,
            statement="Sign in to Krypt PolyBot (manual test)",
            uri=f"{BASE_URL}/auth", version="1", chain_id=137, nonce=nonce,
            issued_at=datetime.now(timezone.utc).isoformat(),
        )
        prepared = msg.prepare_message()
        signed = Account.sign_message(encode_defunct(text=prepared), private_key=account.key)
        resp = await client.post(
            "/auth/verify",
            json={"message": prepared, "signature": signed.signature.hex()},
        )
        resp.raise_for_status()
        print("login ok:", resp.json())
        cookie = resp.cookies.get("kpb_session")

    async with websockets.connect(WS_URL, extra_headers={"Cookie": f"kpb_session={cookie}"}) as ws:
        await ws.send(json.dumps({"type": "rpc", "id": "1", "method": "ping", "params": {}}))
        reply = json.loads(await ws.recv())
        print("ping reply:", reply)
        assert reply.get("ok") is True, "ping did not succeed"
        print("OK — worker responded through the gateway")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Add `httpx` and `websockets` client usage check (already in requirements.txt) — run against the real gateway**

Run in one terminal:
```bash
cd "C:\Users\Admin\Documents\workspace\Krypt-Polybot-main\webserver"
KRYPT_POLYBOT_SESSION_SECRET=dev-secret .venv/Scripts/python -m uvicorn webserver.main:app --reload
```

Run in a second terminal:
```bash
cd "C:\Users\Admin\Documents\workspace\Krypt-Polybot-main"
webserver/.venv/Scripts/python webserver/tests/manual_client.py
```

Expected output ends with `OK — worker responded through the gateway`. This spawns a real `python/service.py` worker (not the dummy fixture) under a throwaway test wallet address, so it also proves the venv at `python/.venv` (from `npm run py:setup`) has the trading backend's own dependencies installed — if that venv is missing, `service.py` will fail to start and the manual client will hang on the ping reply until timeout; run `npm run py:setup` first if so.

- [ ] **Step 3: Commit**

```bash
git add webserver/tests/manual_client.py
git commit -m "test(webserver): manual end-to-end SIWE + WS verification script"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md` (add a new section)

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a "Webapp (Fase 1, in progress)" section to `README.md`**

Add near the existing Architecture section:
```markdown
## Webapp (Fase 1, in progress)

Krypt PolyBot is being migrated from an Electron desktop app to a hosted,
multi-user webapp. Fase 1 (this repo state) adds a `webserver/` FastAPI
gateway that authenticates users by wallet signature (SIWE / EIP-4361,
no passwords) and gives each logged-in wallet its own isolated
`python/service.py` backend worker — the same trading engine the desktop
app uses, unmodified, just proxied over a WebSocket instead of Electron's
stdio bridge.

**Not yet enabled in the webapp:** placing or signing any order. Wallet
key custody for actual trading arrives in Fase 2 (client-side signing —
no private key ever reaches the server). Until then, `setCredentials`,
`clearCredentials`, `testCredentials`, `cancelAllOpen`, and `flatten` are
refused by the gateway.

Run it locally:
\`\`\`bash
cd webserver
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
KRYPT_POLYBOT_SESSION_SECRET=dev-secret .venv/Scripts/python -m uvicorn webserver.main:app --reload
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: describe Fase 1 webapp gateway and its scope"
```

---

## End-to-end verification (after all tasks)

1. `cd webserver && KRYPT_POLYBOT_SESSION_SECRET=test .venv/Scripts/python -m pytest -v` — full suite green.
2. Run the manual harness from Task 5 against a live `uvicorn` instance — confirms SIWE login + WS ping round-trip through a *real* `python/service.py` worker (not the test fixture).
3. Open two manual client runs back-to-back with two different throwaway wallets (edit `manual_client.py` temporarily or run it twice — each run generates a fresh `Account.create()`) and confirm in the server logs that two distinct `pid=`s are spawned and `webserver/../python/data/webapp/users/<addr>/` gets two separate directories with two separate `krypt-polybot.db` files.

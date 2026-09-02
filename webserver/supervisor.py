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
                "POCKETED_USERDATA": str(self.data_dir),
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

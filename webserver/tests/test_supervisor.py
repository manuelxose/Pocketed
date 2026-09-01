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

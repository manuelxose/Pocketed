import threading
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


def test_touch_of_expired_session_raises(store):
    sid, _jti = store.create(["0xAAA"], "0xAAA", ttl_seconds=0)
    time.sleep(0.01)
    with pytest.raises(SessionNotFound):
        store.touch(sid, wallets=["0xAAA"], active="0xAAA", ttl_seconds=60)


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


def test_two_store_instances_sharing_a_file_see_each_others_revoke(tmp_path):
    """Proxy for cross-process revocation at the storage layer: two separate
    SqliteSessionStore objects (standing in for two gateway processes) opened
    against the same db file must agree on session state after one revokes."""
    db_path = tmp_path / "sessions.db"
    store_a = SqliteSessionStore(db_path)
    store_b = SqliteSessionStore(db_path)
    sid, _jti = store_a.create(["0xAAA"], "0xAAA", ttl_seconds=60)

    assert store_b.is_active(sid) is True
    store_b.revoke(sid)
    assert store_a.is_active(sid) is False


def test_two_store_instances_racing_touch_and_revoke_under_real_concurrency(tmp_path):
    """A stronger version of the sequential cross-instance test above: races
    touch() and revoke() against each other via a threading.Barrier, so a
    non-atomic implementation would be caught rather than just row-
    correctness under a sequential call order."""
    db_path = tmp_path / "sessions.db"
    store_a = SqliteSessionStore(db_path)
    store_b = SqliteSessionStore(db_path)
    sid, _jti = store_a.create(["0xAAA"], "0xAAA", ttl_seconds=60)

    barrier = threading.Barrier(2)
    results = {}

    def do_touch():
        barrier.wait()
        try:
            results["touch"] = store_a.touch(
                sid, wallets=["0xAAA"], active="0xAAA", ttl_seconds=60
            )
        except SessionNotFound:
            results["touch"] = None

    def do_revoke():
        barrier.wait()
        store_b.revoke(sid)
        results["revoke"] = "done"

    t1 = threading.Thread(target=do_touch)
    t2 = threading.Thread(target=do_revoke)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    # Whichever order the two operations actually landed in, the store must
    # end up revoked (revoke always wins eventually) and must not have
    # raised/deadlocked/corrupted the row.
    assert results["revoke"] == "done"
    assert store_a.is_active(sid) is False


import os  # noqa: E402

from webserver._store_common import redis_client_from_env  # noqa: E402
from webserver.session_store import RedisSessionStore  # noqa: E402

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


@requires_redis
def test_redis_touch_of_expired_session_raises():
    client = redis_client_from_env()
    store = RedisSessionStore(client)
    sid, _jti = store.create(["0xAAA"], "0xAAA", ttl_seconds=1)
    time.sleep(1.5)  # Redis EX is second-granularity; give the key time to actually expire
    with pytest.raises(SessionNotFound):
        store.touch(sid, wallets=["0xAAA"], active="0xAAA", ttl_seconds=60)

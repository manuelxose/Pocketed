import threading
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


def test_two_store_instances_racing_consume_under_real_concurrency(tmp_path):
    """A stronger version of the sequential test above: this one actually
    races two consume() calls against each other via a threading.Barrier,
    so a non-atomic implementation (e.g. SELECT-then-DELETE without a
    transaction) would be caught, not just row-correctness under a
    sequential call order."""
    db_path = tmp_path / "nonces.db"
    store_a = SqliteNonceStore(db_path)
    store_b = SqliteNonceStore(db_path)
    nonce = store_a.issue()

    barrier = threading.Barrier(2)
    results = {}

    def consume(store, key):
        barrier.wait()
        results[key] = store.consume(nonce)

    t1 = threading.Thread(target=consume, args=(store_a, "a"))
    t2 = threading.Thread(target=consume, args=(store_b, "b"))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert sorted(results.values()) == [False, True]


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

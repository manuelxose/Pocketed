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

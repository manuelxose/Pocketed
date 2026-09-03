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

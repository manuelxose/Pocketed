"""Shared pytest fixtures for the webserver test suite."""
import asyncio
import os
import sys

import pytest

# webserver.main reads this at import time and refuses to import without
# it. Set a test default here (module-level, so it runs during conftest
# collection) — before any test module does `import webserver.main`.
os.environ.setdefault(
    "POCKETED_SESSION_SECRET", "test-secret-at-least-32-bytes-long-for-hs256"
)
os.environ.setdefault("POCKETED_AA_SERVICE_URL", "http://aa-service.test")


@pytest.fixture(scope="session", autouse=True)
def _windows_proactor_event_loop_policy():
    # asyncio.create_subprocess_exec needs the Proactor loop on Windows.
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    yield


# Re-exported so any test module can use `client`/`_test_session_secret`
# without a local import, matching the pattern test_main_session_key_routes.py
# already uses (`from webserver.tests.test_main_aa_routes import client, ...`).
from webserver.tests.test_main_aa_routes import (  # noqa: E402
    _login,
    _test_session_secret,
    client,
)

__all__ = ["_login", "_test_session_secret", "client"]


import webserver.main as main_module  # noqa: E402


@pytest.fixture
def authed_client(client):
    """A test client with a valid session cookie already attached.

    Ports `_login`'s body (see test_main_aa_routes.py:28-53) into a
    reusable fixture rather than inventing a second auth path.
    """
    _wallet_address, session_cookie = _login(client)
    client.cookies.set(main_module.SESSION_COOKIE_NAME, session_cookie)
    return client

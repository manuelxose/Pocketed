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

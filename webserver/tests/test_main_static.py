"""Frontend static-file serving (webserver/main.py's SPA catch-all).

Covers the Finding-1 fix from the final whole-branch review: production had
no static-file serving at all, despite vite.config.ts's dev-proxy comment
claiming FastAPI serves the built `dist/` in production.
"""
import os
import subprocess
import sys
from pathlib import Path

import webserver.main as main_module

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def test_import_does_not_crash_when_dist_missing(tmp_path):
    """Importing webserver.main must not raise even if dist/ doesn't exist
    (e.g. backend started before the frontend was ever built, or in a
    dev/test environment). Run the import in a fresh subprocess pointed at
    a directory that truly doesn't exist — a real check of import-time
    behavior, rather than mutating the already-imported shared module
    (which other test files in this suite also depend on).
    """
    missing_dir = tmp_path / "does-not-exist"
    env = {
        "POCKETED_SESSION_SECRET": "test-secret-at-least-32-bytes-long-for-hs256",
        "POCKETED_AA_SERVICE_URL": "http://aa-service.test",
        "POCKETED_WEBAPP_DIST": str(missing_dir),
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
        "PATH": os.environ.get("PATH", ""),
    }
    result = subprocess.run(
        [sys.executable, "-c", "import webserver.main"],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"


def test_unmatched_route_serves_index_html(tmp_path, monkeypatch):
    """An unmatched GET route falls back to dist/index.html (SPA
    client-side routing) when a real dist/ with an index.html exists."""
    fake_dist = tmp_path / "dist"
    fake_dist.mkdir()
    index_file = fake_dist / "index.html"
    index_file.write_text("<html><body>krypt polybot app shell</body></html>", encoding="utf-8")

    monkeypatch.setattr(main_module, "DIST_DIR", fake_dist)

    from fastapi.testclient import TestClient

    with TestClient(main_module.app) as c:
        # root path
        root_resp = c.get("/")
        assert root_resp.status_code == 200
        assert "krypt polybot app shell" in root_resp.text

        # an arbitrary unmatched path also falls back to index.html
        deep_resp = c.get("/some/deep/unmatched/route")
        assert deep_resp.status_code == 200
        assert "krypt polybot app shell" in deep_resp.text


def test_real_static_asset_is_served_when_present(tmp_path, monkeypatch):
    """A file that actually exists under dist/ (e.g. a built JS/CSS asset)
    is served directly rather than falling back to index.html.

    Requests a path with no dedicated `/assets` mount (the mount is bound
    to the real DIST_DIR at import time, so monkeypatching DIST_DIR here
    doesn't retarget it) to exercise the catch-all's own file-serving path
    instead, which does read DIST_DIR dynamically per request.
    """
    fake_dist = tmp_path / "dist"
    fake_dist.mkdir()
    (fake_dist / "index.html").write_text("<html>shell</html>", encoding="utf-8")
    (fake_dist / "app.js").write_text("console.log('hi');", encoding="utf-8")

    monkeypatch.setattr(main_module, "DIST_DIR", fake_dist)

    from fastapi.testclient import TestClient

    with TestClient(main_module.app) as c:
        resp = c.get("/app.js")

    assert resp.status_code == 200
    assert "console.log" in resp.text


def test_api_route_not_shadowed_by_static_catch_all(client):
    """A real API route (registered before the catch-all) still works and
    is not swallowed by the SPA fallback."""
    resp = client.post("/auth/nonce")
    assert resp.status_code == 200
    assert "nonce" in resp.json()

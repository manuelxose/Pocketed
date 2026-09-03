"""Health/readiness endpoints, and proof the gateway starts and serves /ws
without ERC-4337 (aa-service/bundler/paymaster) configuration.

Covers the "gateway must not require ERC-4337 just to open the web app"
requirement: only AA-specific routes may 503 when POCKETED_AA_SERVICE_URL is
unset; /health, /ready and /ws must work regardless.
"""
import os
import subprocess
import sys
from pathlib import Path

import webserver.main as main_module

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def test_health_always_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_ready_reports_aa_configured_false_when_unset(client, monkeypatch):
    monkeypatch.setattr(main_module, "AA_SERVICE_URL", None)
    resp = client.get("/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["aa_configured"] is False


def test_ready_reports_aa_configured_true_when_set(client, monkeypatch):
    monkeypatch.setattr(main_module, "AA_SERVICE_URL", "http://aa-service.test")
    resp = client.get("/ready")
    assert resp.status_code == 200
    assert resp.json()["aa_configured"] is True


def test_import_and_health_work_without_aa_service_url_or_session_secret(tmp_path):
    """Importing webserver.main, and hitting /health, must succeed with
    NEITHER POCKETED_AA_SERVICE_URL NOR POCKETED_SESSION_SECRET set (the
    default APP_ENV is "development", which allows the insecure dev
    fallback secret rather than refusing to start)."""
    script = (
        "from fastapi.testclient import TestClient\n"
        "import webserver.main as m\n"
        "with TestClient(m.app) as c:\n"
        "    r = c.get('/health')\n"
        "    assert r.status_code == 200, r.text\n"
        "    r2 = c.get('/ready')\n"
        "    assert r2.status_code == 200, r2.text\n"
        "    assert r2.json()['aa_configured'] is False, r2.text\n"
        "print('OK')\n"
    )
    env = {
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
        "PATH": os.environ.get("PATH", ""),
        # deliberately NOT setting POCKETED_SESSION_SECRET / POCKETED_AA_SERVICE_URL
    }
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"
    assert "OK" in result.stdout


def test_production_still_requires_a_real_session_secret(tmp_path):
    """APP_ENV=production must still refuse to start without a real
    POCKETED_SESSION_SECRET — the dev fallback must never leak into prod."""
    result = subprocess.run(
        [sys.executable, "-c", "import webserver.main"],
        cwd=str(REPO_ROOT),
        env={
            "APP_ENV": "production",
            "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
            "PATH": os.environ.get("PATH", ""),
        },
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "POCKETED_SESSION_SECRET" in result.stderr

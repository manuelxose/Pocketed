def test_get_config_requires_auth(client):
    resp = client.get("/config")
    assert resp.status_code == 401


def test_get_and_patch_config_roundtrip(authed_client):
    resp = authed_client.get("/config")
    assert resp.status_code == 200
    resp2 = authed_client.patch("/config", json={"enableTrading": True})
    assert resp2.status_code == 200
    assert resp2.json()["enableTrading"] is True


def test_list_strategies(authed_client):
    resp = authed_client.get("/strategies")
    assert resp.status_code == 200
    assert len(resp.json()) > 0


def test_profiles_crud(authed_client):
    resp = authed_client.post("/profiles", json={"name": "P1", "scope": "main"})
    assert resp.status_code == 200
    pid = resp.json()["id"]
    resp2 = authed_client.get("/profiles")
    assert any(p["id"] == pid for p in resp2.json())
    resp3 = authed_client.delete(f"/profiles/{pid}")
    assert resp3.status_code == 200


def test_apply_nonexistent_strategy_returns_404(authed_client):
    resp = authed_client.post("/strategies/does-not-exist/apply")
    assert resp.status_code == 404


def test_apply_nonexistent_profile_returns_404(authed_client):
    resp = authed_client.post("/profiles/does-not-exist/apply")
    assert resp.status_code == 404


def test_rename_nonexistent_profile_returns_404(authed_client):
    resp = authed_client.patch("/profiles/does-not-exist", json={"name": "X"})
    assert resp.status_code == 404


def test_duplicate_nonexistent_profile_returns_404(authed_client):
    resp = authed_client.post("/profiles/does-not-exist/duplicate")
    assert resp.status_code == 404


def test_export_nonexistent_profile_returns_404(authed_client):
    resp = authed_client.get("/profiles/does-not-exist/export")
    assert resp.status_code == 404


def test_import_malformed_json_returns_400(authed_client):
    resp = authed_client.post("/profiles/import", json={"json": "{not valid json"})
    assert resp.status_code == 400


def test_get_active_profiles_requires_auth(client):
    resp = client.get("/profiles/active")
    assert resp.status_code == 401


def test_get_active_profiles_defaults_to_none(authed_client):
    resp = authed_client.get("/profiles/active")
    assert resp.status_code == 200
    assert resp.json() == {"main": None, "crypto": None, "copy": None}


def test_get_active_profiles_reflects_applied_strategy(authed_client):
    resp = authed_client.post("/strategies/krypt-edge/apply")
    assert resp.status_code == 200
    resp2 = authed_client.get("/profiles/active")
    assert resp2.json()["main"] == "krypt-edge"


def test_get_onboarding_requires_auth(client):
    resp = client.get("/onboarding")
    assert resp.status_code == 401


def test_get_and_patch_onboarding_roundtrip(authed_client):
    resp = authed_client.get("/onboarding")
    assert resp.status_code == 200
    assert resp.json() == {"acceptedDisclaimer": False}
    resp2 = authed_client.patch("/onboarding", json={"acceptedDisclaimer": True})
    assert resp2.status_code == 200
    assert resp2.json() == {"acceptedDisclaimer": True}
    resp3 = authed_client.get("/onboarding")
    assert resp3.json() == {"acceptedDisclaimer": True}

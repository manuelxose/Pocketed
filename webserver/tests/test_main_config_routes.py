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

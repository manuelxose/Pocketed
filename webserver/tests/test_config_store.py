import pytest
from pathlib import Path
from webserver import config_store


@pytest.fixture
def user_dir(tmp_path: Path) -> Path:
    return tmp_path / "user1"


def test_get_config_returns_defaults_when_no_file(user_dir):
    cfg = config_store.get_config(str(user_dir))
    assert isinstance(cfg, dict)
    assert "enableTrading" in cfg


def test_patch_config_persists(user_dir):
    config_store.patch_config(str(user_dir), {"enableTrading": True})
    cfg = config_store.get_config(str(user_dir))
    assert cfg["enableTrading"] is True


def test_replace_config_overwrites_fully(user_dir):
    config_store.patch_config(str(user_dir), {"enableTrading": True})
    defaults = config_store.get_config(str(user_dir))
    replaced = config_store.replace_config(str(user_dir), {**defaults, "enableTrading": False})
    assert replaced["enableTrading"] is False


def test_reset_config_restores_defaults(user_dir):
    config_store.patch_config(str(user_dir), {"enableTrading": True})
    reset = config_store.reset_config(str(user_dir))
    assert reset["enableTrading"] is False


def test_list_strategies_nonempty():
    assert len(config_store.list_strategies()) > 0


def test_active_profile_ids_defaults_to_none(user_dir):
    ids = config_store.active_profile_ids(str(user_dir))
    assert ids == {"main": None, "crypto": None, "copy": None}


def test_active_profile_ids_reflects_apply_strategy(user_dir):
    config_store.apply_strategy(str(user_dir), "krypt-edge")
    ids = config_store.active_profile_ids(str(user_dir))
    assert ids["main"] == "krypt-edge"


def test_profile_crud_roundtrip(user_dir):
    p = config_store.save_profile(str(user_dir), "My Profile", "desc", "main")
    assert p["name"] == "My Profile"
    listed = config_store.list_profiles(str(user_dir))
    assert any(x["id"] == p["id"] for x in listed)
    renamed = config_store.rename_profile(str(user_dir), p["id"], "Renamed")
    assert renamed["name"] == "Renamed"
    dup = config_store.duplicate_profile(str(user_dir), p["id"])
    assert dup["id"] != p["id"]
    exported = config_store.export_profile(str(user_dir), p["id"])
    assert "kryptTraderProfile" in exported
    config_store.delete_profile(str(user_dir), p["id"])
    assert not any(x["id"] == p["id"] for x in config_store.list_profiles(str(user_dir)))


def test_onboarding_roundtrip(user_dir):
    assert config_store.get_onboarding(str(user_dir))["acceptedDisclaimer"] is False
    config_store.set_onboarding(str(user_dir), {"acceptedDisclaimer": True})
    assert config_store.get_onboarding(str(user_dir))["acceptedDisclaimer"] is True

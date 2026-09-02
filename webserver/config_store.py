"""Per-user config/strategies/profiles persistence.

Python port of the Electron main-process modules `electron/system/settings-store.ts`
and `electron/system/strategies.ts`, plus the profile-scoping helpers in
`electron/ipc.ts:38-70`. Field names, defaults, and the strategy preset list are
copied verbatim from the TypeScript source — this is a port, not a redesign.

Unlike the Electron version (single global `userData` directory, in-memory
cache), this module is keyed by `user_id` — a per-user data directory path
supplied by the caller — and reads/writes fresh from disk on every call. There
is no in-process cache since a FastAPI process serves many users at once.
"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

DEFAULT_CONFIG: dict[str, Any] = {
    "network": "mainnet",
    "enableTrading": False,
    "tradeWhales": True,
    "tradeMomentum": True,
    "tradeConvergence": False,
    "minEdgePtsWhale": 5.0,
    "minEdgePtsMomentum": 5.0,
    "minConfidenceWhale": 55.0,
    "minConfidenceMomentum": 55.0,
    "minEntryPriceCents": 15,
    "maxEntryPriceCents": 85,
    "maxResolutionDays": 0,
    "allowedMomentumSignalTypes": ["trade_cluster"],
    "allowedCategories": None,
    "allowedWhaleCategories": None,
    "allowedMomentumCategories": None,
    "contrarianOnly": True,
    "useRules": False,
    "rules": [],
    "baseSizeFraction": 0.03,
    "minSizeFraction": 0.02,
    "maxSizeFraction": 0.06,
    "sizingBaseEdge": 5.0,
    "sizingMaxEdge": 20.0,
    "hardMaxPositionUsd": 50.0,
    "minCashReserveFraction": 0.05,
    "orderStyle": "limit_cross",
    "crossSpreadFallbackOffset": 2,
    "orderExpirationSec": 300,
    "maxOpenPositions": 25,
    "maxPositionsPerEvent": 1,
    "maxDailyNewPositions": 40,
    "unlimitedDailyNewPositions": False,
    "maxTotalExposureFraction": 0.75,
    "tradeScanInterval": 20,
    "positionPollInterval": 30,
    "balancePollInterval": 60,
    "resolutionCheckInterval": 300,
    "whaleScanInterval": 120,
    "momentumScanInterval": 90,
    "marketRefreshInterval": 300,
    "maxSignalAgeSec": 120,
    "startBankrollUsd": 0.0,
    "stopLossOnDay": -50.0,
    "takeProfitOnDay": 0.0,
    "flattenOnDailyStop": False,
    "tradingHoursEnabled": False,
    "tradingHoursStart": "00:00",
    "tradingHoursEnd": "23:59",
    "tradingDays": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    "tradingTimezoneOffsetMin": 0,
    "minWhaleUsd": 2500.0,
    "minWhaleConfidence": 30.0,
    "minWhaleEdge": 2.0,
    "minMomentumConfidence": 0.0,
    "minMomentumEdge": 5.0,
    "minEntryPriceFrac": 0.5,
    "eventWebhookUrl": "",
    "statsWebhookUrl": "",
    "whaleWebhookUrl": "",
    "momentumWebhookUrl": "",
    "statsPushInterval": 1800,
    "statsChartWindowHours": 168,
    "enableDiscord": True,
    "crypto15mEnabled": False,
    "crypto15mSizingMode": "fixed",
    "crypto15mOrderSize": 5,
    "crypto15mBalancePct": 0.02,
    "crypto15mMaxLossPct": 0,
    "crypto15mStreakSizing": False,
    "crypto15mStreakLossPct": 20,
    "crypto15mStreakWinPct": 0,
    "crypto15mStreakMaxMult": 4,
    "crypto15mMaxConcurrent": 7,
    "crypto15mTakeProfitTotal": 0,
    "crypto15mDirectionMode": "favorite",
    "crypto15mModelMinProb": 0.97,
    "crypto15mModelMinEdgeCents": 2.0,
    "crypto15mModelFinalMinute": True,
    "crypto15mModelAutopause": True,
    "crypto15mModelMaxBookGapCents": 25,
    "crypto15mSpotWs": True,
    "crypto15mRtdsWs": True,
    "crypto15mPairedMode": False,
    "crypto15mPairedMaxCombinedCents": 99,
    "crypto15mPairedTilt1Cents": 3,
    "crypto15mPairedTilt2Cents": 6,
    "crypto15mPairedTilt3Cents": 10,
    "crypto15mSellIntoStrength": False,
    "crypto15mSellStrengthCents": 80,
    "crypto15mTimeDelayMin": 8,
    "crypto15mEntryThreshold": 0.95,
    "crypto15mEntryMax": 0.98,
    "crypto15mExitThreshold": 0.4,
    "crypto15mTakeProfit": 0,
    "crypto15mStopLossPct": 0,
    "crypto15mMinRsi": 0,
    "crypto15mMinMacdHist": 0,
    "crypto15mMinDeltaPct": 0,
    "crypto15mEntryDiff": 0.02,
    "crypto15mEntryStyle": "taker",
    "crypto15mTakerFak": True,
    "crypto15mMakerCancelMin": 1,
    "crypto15mMakerEscalate": True,
    "crypto15mHoursStartUtc": 0,
    "crypto15mHoursEndUtc": 24,
    "crypto15mRecordSignals": True,
    "mainRecordSignals": True,
    "crypto15mArbDetect": True,
    "crypto15mArbMinEdgeCents": 1,
    "crypto15mImbalanceDetect": True,
    "crypto15mImbalanceLevels": 3,
    "crypto15mImbalanceGate": False,
    "crypto15mImbalanceGateMin": 0.2,
    "crypto15mIndicatorDetect": True,
    "crypto15mWsBook": True,
    "crypto15mUseRules": False,
    "crypto15mRules": [],
    "copyEnabled": False,
    "copyWallets": [],
    "copySizingMode": "fixed",
    "copyFixedUsd": 10,
    "copyBalancePct": 0.02,
    "copyMinTradeUsd": 25,
    "copyMaxConcurrent": 10,
    "copyEntryMaxCents": 95,
    "copyDailyLossLimit": -50,
    "copyPollSec": 10,
    "copyFastPollSec": 5,
    "copyActivityWs": True,
    "copyMirrorReductions": True,
    "copyReduceThreshold": 0.25,
    "scriptsLiveEnabled": False,
    "scriptPollSec": 5,
    "scriptMaxEntryCents": 97,
    "scriptMaxContracts": 20,
    "scriptMaxOpen": 2,
    "scriptDailyLossUsd": 25,
    "scriptMaxEnabled": 10,
    "scriptMarketLimit": 150,
    "scriptMarketMinVolume": 5000,
    "scriptMarketMaxSpreadCents": 2,
}

DEFAULT_STATE: dict[str, Any] = {
    "config": dict(DEFAULT_CONFIG),
    "activeProfileId": None,
    "activeCryptoProfileId": None,
    "activeCopyProfileId": None,
    "customProfiles": [],
    "startMinimized": False,
    "startWithWindows": False,
    "enableDiscordRpc": True,
    "acceptedDisclaimer": False,
    "windowBounds": None,
}


def _merge_config(loaded: dict[str, Any] | None) -> dict[str, Any]:
    return {**DEFAULT_CONFIG, **(loaded or {})}


def _merge_profile(loaded: Any) -> dict[str, Any] | None:
    if not isinstance(loaded, dict):
        return None
    if not loaded.get("id") or not loaded.get("name") or not loaded.get("config"):
        return None
    scope = loaded.get("scope") if loaded.get("scope") in ("crypto", "copy") else "main"
    now = _now_iso()
    profile: dict[str, Any] = {
        "id": str(loaded["id"]),
        "name": str(loaded["name"]),
        "scope": scope,
        "createdAt": loaded.get("createdAt") or now,
        "updatedAt": loaded.get("updatedAt") or now,
        "builtin": bool(loaded.get("builtin")),
        "config": _merge_config(loaded.get("config")),
    }
    if loaded.get("description"):
        profile["description"] = str(loaded["description"])
    else:
        profile["description"] = None
    return profile


def _merge_state(loaded: Any) -> dict[str, Any]:
    if not isinstance(loaded, dict):
        return json.loads(json.dumps(DEFAULT_STATE))
    raw_profiles = loaded.get("customProfiles")
    profiles: list[dict[str, Any]] = []
    if isinstance(raw_profiles, list):
        for p in raw_profiles:
            merged = _merge_profile(p)
            if merged is not None:
                profiles.append(merged)
    return {
        "config": _merge_config(loaded.get("config")),
        "activeProfileId": loaded.get("activeProfileId") or None,
        "activeCryptoProfileId": loaded.get("activeCryptoProfileId") or None,
        "activeCopyProfileId": loaded.get("activeCopyProfileId") or None,
        "customProfiles": profiles,
        "startMinimized": bool(loaded.get("startMinimized")),
        "startWithWindows": bool(loaded.get("startWithWindows")),
        "enableDiscordRpc": (
            loaded["enableDiscordRpc"] if isinstance(loaded.get("enableDiscordRpc"), bool) else True
        ),
        "acceptedDisclaimer": bool(loaded.get("acceptedDisclaimer")),
        "windowBounds": loaded.get("windowBounds") or None,
    }


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z"


def _gen_id() -> str:
    return f"p_{uuid.uuid4().hex}"


def _settings_file(user_dir: str) -> Path:
    return Path(user_dir) / "config.json"


def _profiles_file(user_dir: str) -> Path:
    return Path(user_dir) / "profiles.json"


def _ensure_dir(user_dir: str) -> None:
    Path(user_dir).mkdir(parents=True, exist_ok=True)


def _load_state(user_dir: str) -> dict[str, Any]:
    f = _settings_file(user_dir)
    if not f.exists():
        return json.loads(json.dumps(DEFAULT_STATE))
    try:
        parsed = json.loads(f.read_text(encoding="utf-8"))
        return _merge_state(parsed)
    except Exception:
        return json.loads(json.dumps(DEFAULT_STATE))


def _save_state(user_dir: str, state: dict[str, Any]) -> dict[str, Any]:
    _ensure_dir(user_dir)
    f = _settings_file(user_dir)
    f.write_text(json.dumps(state, indent=2), encoding="utf-8")
    return state


def _load_profiles(user_dir: str) -> list[dict[str, Any]]:
    """Profile CRUD in this port keeps its list in a dedicated
    `profiles.json` (per the brief), separate from the config file that
    mirrors settings-store.ts's single settings.json. State is still read
    through `_load_state`/`_save_state` for the config/onboarding fields;
    `customProfiles` in that state is kept in sync with `profiles.json`.
    """
    f = _profiles_file(user_dir)
    if not f.exists():
        return []
    try:
        parsed = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(parsed, list):
            return []
        out = []
        for p in parsed:
            merged = _merge_profile(p)
            if merged is not None:
                out.append(merged)
        return out
    except Exception:
        return []


def _save_profiles(user_dir: str, profiles: list[dict[str, Any]]) -> None:
    _ensure_dir(user_dir)
    _profiles_file(user_dir).write_text(json.dumps(profiles, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def get_config(user_id: str) -> dict[str, Any]:
    return _load_state(user_id)["config"]


def patch_config(user_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    state = _load_state(user_id)
    state["config"] = {**state["config"], **patch}
    _save_state(user_id, state)
    return state["config"]


def replace_config(user_id: str, cfg: dict[str, Any]) -> dict[str, Any]:
    state = _load_state(user_id)
    state["config"] = _merge_config(cfg)
    _save_state(user_id, state)
    return state["config"]


def reset_config(user_id: str) -> dict[str, Any]:
    state = _load_state(user_id)
    state["config"] = dict(DEFAULT_CONFIG)
    state["activeProfileId"] = None
    state["activeCryptoProfileId"] = None
    state["activeCopyProfileId"] = None
    _save_state(user_id, state)
    return state["config"]


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

def _merge_strategy_config(over: dict[str, Any]) -> dict[str, Any]:
    return {**DEFAULT_CONFIG, **over}


BUILTIN_STRATEGIES: list[dict[str, Any]] = [
    {
        "id": "krypt-edge",
        "name": "Edge Stack",
        "tagline": "Two sources at once — crypto whales + sports momentum.",
        "description": (
            "Runs both signal sources together, each restricted to where it tends to "
            "work: whale-following in CRYPTO / EXOTICS / ENTERTAINMENT and contrarian "
            "trade-cluster momentum in SPORTS (confidence ≥ 40, since momentum "
            "scores run low), with an 85¢ entry cap to skip near-decided favorites. "
            "Diversifies across two independent setups. Experimental — start with a "
            "small balance you can afford to lose."
        ),
        "riskLabel": "experimental",
        "config": _merge_strategy_config({
            "tradeWhales": True,
            "tradeMomentum": True,
            "contrarianOnly": True,
            "allowedCategories": None,
            "allowedWhaleCategories": ["crypto", "exotics", "entertainment"],
            "allowedMomentumCategories": ["sports"],
            "allowedMomentumSignalTypes": ["trade_cluster"],
            "minConfidenceWhale": 55.0,
            "minEdgePtsWhale": 5.0,
            "minConfidenceMomentum": 40.0,
            "minEntryPriceCents": 15,
            "maxEntryPriceCents": 85,
        }),
    },
    {
        "id": "krypt-crypto-whale",
        "name": "Crypto Whale",
        "tagline": "Whale-following, crypto markets only.",
        "description": (
            "Follows $2.5k+ taker orders in CRYPTO markets only, with momentum "
            "disabled. The entry cap is raised to 98¢ so it can follow the "
            "high-price favorites that crypto whales tend to back. Experimental — "
            "start with a small balance you can afford to lose."
        ),
        "riskLabel": "experimental",
        "badge": "new",
        "config": _merge_strategy_config({
            "tradeWhales": True,
            "tradeMomentum": False,
            "allowedCategories": ["crypto"],
            "minConfidenceWhale": 55.0,
            "minEdgePtsWhale": 5.0,
            "minEntryPriceCents": 15,
            "maxEntryPriceCents": 98,
        }),
    },
    {
        "id": "krypt-aggressive",
        "name": "Krypt Aggressive",
        "tagline": "More signals, larger sizing, higher variance.",
        "description": (
            "Loosens edge gates to 3pts and confidence to 50%. Sizing scales 4-10% "
            "of bankroll, $100 cap, higher max-open count. High variance — use only "
            "with a bankroll you can stand to drop 30% on a bad day."
        ),
        "riskLabel": "aggressive",
        "config": _merge_strategy_config({
            "minEdgePtsWhale": 3.0,
            "minEdgePtsMomentum": 3.0,
            "minConfidenceWhale": 50.0,
            "minConfidenceMomentum": 50.0,
            "baseSizeFraction": 0.06,
            "minSizeFraction": 0.04,
            "maxSizeFraction": 0.1,
            "hardMaxPositionUsd": 100.0,
            "maxOpenPositions": 40,
            "maxDailyNewPositions": 80,
            "maxTotalExposureFraction": 0.85,
            "stopLossOnDay": -100.0,
        }),
    },
]


def list_strategies() -> list[dict[str, Any]]:
    return BUILTIN_STRATEGIES


def find_strategy(strategy_id: str) -> dict[str, Any] | None:
    for s in BUILTIN_STRATEGIES:
        if s["id"] == strategy_id:
            return s
    return None


_PRESERVE_PREFIXES = ("crypto15m", "copy", "script")
_PRESERVE_KEYS = {
    "eventWebhookUrl", "statsWebhookUrl", "whaleWebhookUrl",
    "momentumWebhookUrl", "enableDiscord", "statsPushInterval",
    "statsChartWindowHours",
}


def apply_strategy(user_id: str, strategy_id: str) -> dict[str, Any]:
    strategy = find_strategy(strategy_id)
    if strategy is None:
        raise KeyError("Strategy not found")
    if strategy.get("comingSoon"):
        return get_config(user_id)

    state = _load_state(user_id)
    cur_config = state["config"]
    preserved = {
        k: v for k, v in cur_config.items()
        if k.startswith(_PRESERVE_PREFIXES) or k in _PRESERVE_KEYS
    }
    new_config = _merge_config({
        **strategy["config"],
        **preserved,
        "network": cur_config["network"],
        "enableTrading": cur_config["enableTrading"],
    })
    state["config"] = new_config
    state["activeProfileId"] = strategy_id
    _save_state(user_id, state)
    return new_config


# ---------------------------------------------------------------------------
# Profile scoping helpers (electron/ipc.ts:38-70)
# ---------------------------------------------------------------------------

def _scope_of_key(key: str) -> str:
    if key.startswith("crypto15m"):
        return "crypto"
    if key.startswith("copy"):
        return "copy"
    return "main"


def _norm_scope(scope: Any) -> str:
    return scope if scope in ("crypto", "copy") else "main"


def _active_key_for(scope: str) -> str:
    if scope == "crypto":
        return "activeCryptoProfileId"
    if scope == "copy":
        return "activeCopyProfileId"
    return "activeProfileId"


def _scoped_apply_patch(cfg: dict[str, Any], scope: str) -> dict[str, Any]:
    patch = {k: v for k, v in cfg.items() if _scope_of_key(k) == scope}
    if scope == "main":
        patch.pop("enableTrading", None)
        patch.pop("network", None)
    elif scope == "crypto":
        patch.pop("crypto15mEnabled", None)
    else:
        patch.pop("copyEnabled", None)
    return patch


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

def list_profiles(user_id: str) -> list[dict[str, Any]]:
    return _load_profiles(user_id)


def save_profile(
    user_id: str, name: str, description: str | None, scope: str
) -> dict[str, Any]:
    sc = _norm_scope(scope)
    state = _load_state(user_id)
    now = _now_iso()
    profile = {
        "id": _gen_id(),
        "name": name.strip(),
        "description": (description.strip() if description and description.strip() else None),
        "scope": sc,
        "createdAt": now,
        "updatedAt": now,
        "builtin": False,
        "config": json.loads(json.dumps(state["config"])),
    }
    profiles = _load_profiles(user_id)
    profiles.append(profile)
    _save_profiles(user_id, profiles)
    state[_active_key_for(sc)] = profile["id"]
    _save_state(user_id, state)
    return profile


def _find_profile(profiles: list[dict[str, Any]], profile_id: str) -> dict[str, Any] | None:
    for p in profiles:
        if p["id"] == profile_id:
            return p
    return None


def apply_profile(user_id: str, profile_id: str) -> dict[str, Any]:
    profiles = _load_profiles(user_id)
    profile = _find_profile(profiles, profile_id)

    if profile is None:
        strategy = find_strategy(profile_id)
        if strategy is None:
            raise KeyError("Profile not found")
        if strategy.get("comingSoon"):
            return get_config(user_id)
        state = _load_state(user_id)
        state["config"] = {**state["config"], **_scoped_apply_patch(strategy["config"], "main")}
        state["activeProfileId"] = profile_id
        _save_state(user_id, state)
        return state["config"]

    sc = _norm_scope(profile["scope"])
    state = _load_state(user_id)
    state["config"] = {**state["config"], **_scoped_apply_patch(profile["config"], sc)}
    state[_active_key_for(sc)] = profile_id
    _save_state(user_id, state)
    return state["config"]


def rename_profile(user_id: str, profile_id: str, name: str) -> dict[str, Any]:
    profiles = _load_profiles(user_id)
    profile = _find_profile(profiles, profile_id)
    if profile is None:
        raise KeyError("Profile not found")
    profile["name"] = name.strip()
    profile["updatedAt"] = _now_iso()
    _save_profiles(user_id, profiles)
    return profile


def delete_profile(user_id: str, profile_id: str) -> None:
    profiles = _load_profiles(user_id)
    profiles = [p for p in profiles if p["id"] != profile_id]
    _save_profiles(user_id, profiles)
    state = _load_state(user_id)
    for key in ("activeProfileId", "activeCryptoProfileId", "activeCopyProfileId"):
        if state.get(key) == profile_id:
            state[key] = None
    _save_state(user_id, state)


def duplicate_profile(user_id: str, profile_id: str) -> dict[str, Any]:
    profiles = _load_profiles(user_id)
    orig = _find_profile(profiles, profile_id)
    if orig is None:
        raise KeyError("Profile not found")
    now = _now_iso()
    dup = {
        **orig,
        "id": _gen_id(),
        "name": f"{orig['name']} (copy)",
        "config": json.loads(json.dumps(orig["config"])),
        "createdAt": now,
        "updatedAt": now,
    }
    profiles.append(dup)
    _save_profiles(user_id, profiles)
    return dup


def export_profile(user_id: str, profile_id: str) -> str:
    profiles = _load_profiles(user_id)
    profile = _find_profile(profiles, profile_id)
    if profile is None:
        raise KeyError("Profile not found")
    return json.dumps({"kryptTraderProfile": 1, "profile": profile}, indent=2)


def import_profile(user_id: str, json_str: str) -> dict[str, Any]:
    parsed = json.loads(json_str)
    norm = _merge_profile(parsed.get("profile") if isinstance(parsed, dict) else None)
    if norm is None:
        raise ValueError("Not a valid Krypt PolyBot profile")
    now = _now_iso()
    dup = {**norm, "id": _gen_id(), "createdAt": now, "updatedAt": now}
    profiles = _load_profiles(user_id)
    profiles.append(dup)
    _save_profiles(user_id, profiles)
    return dup


# ---------------------------------------------------------------------------
# Onboarding
# ---------------------------------------------------------------------------

def get_onboarding(user_id: str) -> dict[str, Any]:
    state = _load_state(user_id)
    return {"acceptedDisclaimer": state["acceptedDisclaimer"]}


def set_onboarding(user_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    state = _load_state(user_id)
    if "acceptedDisclaimer" in patch:
        state["acceptedDisclaimer"] = bool(patch["acceptedDisclaimer"])
    _save_state(user_id, state)
    return {"acceptedDisclaimer": state["acceptedDisclaimer"]}

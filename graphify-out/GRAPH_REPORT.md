# Graph Report - Krypt-Polybot-main  (2026-09-01)

## Corpus Check
- 159 files · ~199,507 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2631 nodes · 5515 edges · 154 communities (109 shown, 29 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 155 edges (avg confidence: 0.85)
- Token cost: 0 input · 187,240 output

## Community Hubs (Navigation)
- Test Crypto15m Trader
- Test Engine Integration
- Test Parlay
- Polymarket Auth
- Crypto15m Trader
- Test Settlement Model
- Crypto15m
- Scripts
- Types
- Test Script Engine
- Test Loss Guards
- Test Crypto15m Backtest
- Clob Ws
- Test Security
- Toastprovider
- Test Candle Completeness
- Trader
- Test Polymarket Api
- Script Engine
- Test Script Engine
- Test Wallet Signature Types
- Common
- Test Copy Trader
- Polymarket Api
- Backtest
- Service
- Crypto15m
- Tsconfig.json
- Python Backend
- Test Script Sandbox
- Script Backtest
- Spot Ws
- Script Audit
- Mainengine
- Terminal
- Main
- Bossfight
- Python Utils.mjs
- Activity Ws
- Polymarket Api
- Tsconfig.node.json
- Links
- Ipc
- Test Backtest
- Test Presets
- Service
- Test Api Retry
- Script Sandbox
- Volume Farm
- Package.json
- Db
- Underconfidence Study
- Webhook
- Settings Store
- Package.json
- Test Db Maintenance
- Visualizer
- Readme
- Scanner
- Db
- Test Db Maintenance
- Test Category Gates
- Test Script Independence
- Readme
- Package.json
- Momentum Oos
- Shadow Pricer Eval
- Test Funding Floor
- Positions
- Package.json
- Instance Lock
- Trader
- Requirements
- Probe Btc Momentum
- Test Script Paste Encoding
- Arming.e2e.mjs
- Accounts
- Crypto15m Backfill
- Script Engine
- Service
- Test Market Pagination
- Test Signature Type Reconcile
- Turbine Import
- Scripteditor
- Ferrari Copyability
- Test Backtest Caveats
- Package.json
- Pmxt Backfill
- Polymarket Api
- Service
- Readme
- Test Script Engine
- Package.json
- Whale Momentum Survey
- Turbine Backtest
- Package.json
- Db
- Test Script Engine
- Test Script Engine
- Package.json
- Conftest
- Pm Sports Bias
- Test Script Engine
- Disclaimer
- Python Backend
- Service
- Package.json
- Service
- Readme
- Test Trader Logic
- Test Script Engine
- Ws Ssl
- Readme
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Package.json
- Db
- Test Trader Logic
- Krypt

## God Nodes (most connected - your core abstractions)
1. `cls()` - 81 edges
2. `merge_with_defaults()` - 59 edges
3. `run_async()` - 48 edges
4. `useApp()` - 46 edges
5. `_cfg()` - 38 edges
6. `_stub_snapshot()` - 37 edges
7. `fmtUsd()` - 37 edges
8. `_script()` - 36 edges
9. `run_tick()` - 34 edges
10. `run_async()` - 34 edges

## Surprising Connections (you probably didn't know these)
- `No Paper/Demo Mode` --semantically_similar_to--> `Shadow Mode`  [INFERRED] [semantically similar]
  DISCLAIMER.md → README.md
- `SlotProps` --references--> `CredentialsState`  [EXTRACTED]
  src/pages/ApiKeys.tsx → shared/types.ts
- `test_save_rpc_survives_a_mangled_paste()` --indirect_call--> `db()`  [INFERRED]
  python/tests/test_script_paste_encoding.py → python/research/pmxt_backfill.py
- `AppStateApi` --references--> `BackendInfo`  [EXTRACTED]
  src/state/AppStateProvider.tsx → shared/types.ts
- `examples/btc-momentum.py` --conceptually_related_to--> `Shadow Mode`  [EXTRACTED]
  python/research/MOMENTUM_OOS.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Layered Script Safety Model** — readme_sandboxed_scripts, readme_trusted_mode, readme_safety_rails, readme_risk_audit, readme_shadow_mode [EXTRACTED 0.85]
- **Engine Reliability Mechanisms** — readme_backend_reliability_resolution, readme_startup_reconciliation, readme_idempotent_signing [EXTRACTED 0.85]
- **Fee-Aware Out-of-Sample Edge Research** — python_research_momentum_oos_btc_momentum_strategy, python_research_pm_sports_bias_favourite_longshot_bias, python_research_momentum_oos_honest_fill_model, python_research_pm_sports_bias_crypto_deep_favourite_contrast [INFERRED 0.75]

## Communities (154 total, 29 thin omitted)

### Community 0 - "Test Crypto15m Trader"
Cohesion: 0.05
Nodes (83): _capture_orders(), cfg(), env_net(), fresh_db(), _future(), _mock_place(), _mock_quotes(), _paired_asset() (+75 more)

### Community 2 - "Test Engine Integration"
Cohesion: 0.08
Nodes (64): cfg(), count_rows(), env_net(), fetch(), fresh_db(), _install_sell_stubs(), _open_market(), fixture (+56 more)

### Community 3 - "Test Parlay"
Cohesion: 0.05
Nodes (53): generate(), main(), _print_summary(), _qualifies(), save_schedule(), set_armed(), _split(), _stats() (+45 more)

### Community 4 - "Polymarket Auth"
Cohesion: 0.08
Nodes (58): _api_creds_file(), _atomic_write_600(), _b64url_decode(), _b64url_encode(), _chmod_600(), clear_api_creds(), clear_credentials(), create_signed_order() (+50 more)

### Community 5 - "Crypto15m Trader"
Cohesion: 0.08
Nodes (58): _age_seconds(), _bankroll_usd(), _best_bid_cents(), _book_exit_from_chain(), _chase_missing_leg(), check_model_calibration(), _clamp01(), compute_entry_contracts() (+50 more)

### Community 6 - "Test Settlement Model"
Cohesion: 0.07
Nodes (43): _asset(), _model_cfg(), _paired_cfg(), _rtds_update(), _seed_replay_window(), _seed_windows(), test_calibration_insufficient_evidence_never_pauses(), test_calibration_ok_with_high_hit_rate() (+35 more)

### Community 7 - "Crypto15m"
Cohesion: 0.06
Nodes (33): _apply_cross_asset(), asset_enabled(), asset_indicators(), _asset_snapshot(), _blank_asset(), _const(), derive_script_fields(), _fee_cents() (+25 more)

### Community 8 - "Scripts"
Cohesion: 0.07
Nodes (46): BotRun, Crypto15mPosition, ScriptApiDocs, ScriptAudit, ScriptShadowOrder, TradingStatus, UserScript, BacktestPanel() (+38 more)

### Community 9 - "Types"
Cohesion: 0.07
Nodes (45): api, C15_PRESET_CORE, AccountByEnv, AccountSnapshot, ActionResult, AppState, BotPosition, BotRunsResponse (+37 more)

### Community 10 - "Test Script Engine"
Cohesion: 0.06
Nodes (32): _add_crypto_pos(), _all_engines_off(), _install_script(), test_a_crypto_only_script_does_not_ask_for_the_signal_feed(), test_a_live_entry_is_refused_when_the_balance_cannot_fund_it(), test_a_refusal_row_consumes_the_window(), test_a_scoped_script_sees_only_its_own_coins(), test_a_script_that_imports_the_stdlib_compiles_fine() (+24 more)

### Community 11 - "Test Loss Guards"
Cohesion: 0.09
Nodes (46): _bankroll_usd(), _book_gone_copy(), _compute_copy_contracts(), _enter_copy(), _exit_copy(), _filter_new_entries(), _followed_holdings(), _lifetime_loss_tripped() (+38 more)

### Community 12 - "Test Crypto15m Backtest"
Cohesion: 0.07
Nodes (28): _capture(), _capture_lookback_min(), _capture_ticks(), record_tick(), _resolve(), _settled_up_won(), fresh_db(), _macd_sig() (+20 more)

### Community 14 - "Clob Ws"
Cohesion: 0.06
Nodes (8): _best_from_levels(), ClobMarketFeed, _iter_messages(), parse_book(), parse_last_trade(), parse_price_changes(), fresh_db(), fixture

### Community 15 - "Test Security"
Cohesion: 0.05
Nodes (23): merge_with_defaults(), _h_c15_backtest(), _h_main_backtest(), _h_script_api_docs(), _h_script_context_pack(), test_momentum_gate_validation_forces_detector_and_clamps(), test_should_stop_loss_pct(), test_should_take_profit_pct() (+15 more)

### Community 16 - "Toastprovider"
Cohesion: 0.09
Nodes (34): App(), PageId, Shell(), drawCard(), drawStat(), FlexStatsCard(), money(), roundRect() (+26 more)

### Community 17 - "Test Candle Completeness"
Cohesion: 0.08
Nodes (22): compute(), ema_last(), ema_series(), _floats(), macd(), pct_change(), _rel_pct(), _round() (+14 more)

### Community 18 - "Trader"
Cohesion: 0.12
Nodes (39): fetch_markets_map(), get_activity(), get_fills_for_order(), get_env(), trading_address(), audit_pnl(), _breach_persists(), can_open_new_entries() (+31 more)

### Community 19 - "Test Polymarket Api"
Cohesion: 0.07
Nodes (17): _Resp, _stub_order_path(), test_authed_request_non_auth_400_does_not_rederive(), test_authed_request_self_heals_stale_creds(), test_fak_no_liquidity_is_clean_unmatched_not_error(), test_place_limit_order_defaults_to_gtc(), test_place_limit_order_marketable_fak(), test_place_limit_order_refuses_eoa_maker() (+9 more)

### Community 20 - "Script Engine"
Cohesion: 0.12
Nodes (32): _already_attempted(), _cool_off(), _count_open_for_script(), _disable(), _drain_logs(), _emit_event(), _fail_market_entry(), _fetch_new_signals() (+24 more)

### Community 21 - "Test Script Engine"
Cohesion: 0.16
Nodes (36): _asset(), _cfg(), _market(), _script(), _shadow_rows(), test_a_long_stale_shadow_order_is_retired_rather_than_left_open(), test_a_rails_refused_market_is_not_reoffered_immediately(), test_contract_cap_below_the_exchange_minimum_is_never_exceeded() (+28 more)

### Community 22 - "Test Wallet Signature Types"
Cohesion: 0.12
Nodes (35): _FakeAcct, _meta_at(), _run(), test_absent_meta_is_a_raw_eoa_wallet(), test_authz_expired_session_signer_still_rejects(), test_authz_legacy_proxy_without_owner_abstains(), test_authz_no_funder_abstains(), test_authz_owner_matches_signer() (+27 more)

### Community 23 - "Common"
Cohesion: 0.10
Nodes (20): AccountInfo, Card(), Empty(), NameDialog(), Page(), RULE_OPS, RuleFieldSpec, Section() (+12 more)

### Community 24 - "Test Copy Trader"
Cohesion: 0.29
Nodes (32): _all_copies(), _cfg(), env_net(), fresh_db(), _open_copies(), _patch_live(), _patch_positions(), _patch_positions_split() (+24 more)

### Community 25 - "Polymarket Api"
Cohesion: 0.13
Nodes (27): book_imbalance(), _category_from_tags(), _clob_price(), close_clients(), _fee_schedule_from_gamma(), fetch_all_open_markets(), fetch_crypto_updown(), fetch_events() (+19 more)

### Community 26 - "Backtest"
Cohesion: 0.15
Nodes (29): _bonferroni_t(), build_report(), _cluster_key(), crypto15m_eval(), crypto15m_macd_breakdown(), crypto15m_report(), _crypto15m_verdict(), demo_signals() (+21 more)

### Community 27 - "Service"
Cohesion: 0.09
Nodes (12): _h_cancelAllOpen(), _h_script_backtest(), _h_script_save(), _h_script_set_assets(), _h_script_set_dry_run(), _h_script_set_enabled(), _h_script_validate(), _h_scripts_list() (+4 more)

### Community 28 - "Crypto15m"
Cohesion: 0.08
Nodes (23): Crypto15mSizing, RuleCondition, AssetCard(), C15_ALL_ASSETS, C15_DEFAULTS, C15_EXAMPLE_STRATEGIES, C15_INTERVALS, C15_PRESETS (+15 more)

### Community 29 - "Tsconfig.json"
Cohesion: 0.07
Nodes (27): DOM, DOM.Iterable, src, compilerOptions, allowImportingTsExtensions, baseUrl, esModuleInterop, forceConsistentCasingInFileNames (+19 more)

### Community 30 - "Python Backend"
Cohesion: 0.16
Nodes (3): PythonBackend, BackendInfo, BackendStatus

### Community 31 - "Test Script Sandbox"
Cohesion: 0.08
Nodes (3): parametrize, test_any_single_entry_hook_satisfies_the_contract(), test_full_python_is_accepted()

### Community 32 - "Script Backtest"
Cohesion: 0.15
Nodes (24): _hours_to_close(), parse_asset_scope(), Any, _replay_signals(), run(), sanitize_intent(), sanitize_manage(), sanitize_market_intent() (+16 more)

### Community 34 - "Script Audit"
Cohesion: 0.15
Nodes (11): AST, Attribute, Call, Constant, Global, Import, ImportFrom, Name (+3 more)

### Community 35 - "Mainengine"
Cohesion: 0.09
Nodes (17): CopyStatus, NumberInput(), RuleBuilder(), Switch(), CopyTradingPage(), isAddr(), KV(), ModePill() (+9 more)

### Community 36 - "Terminal"
Cohesion: 0.12
Nodes (21): Crypto15mAsset, Crypto15mSnapshot, Crypto15mStatus, bookHist, cachedPnl, clamp(), conf01(), dpr() (+13 more)

### Community 37 - "Main"
Cohesion: 0.18
Nodes (18): appendLog(), broadcastState(), bootstrap(), createMainWindow(), gotLock, iconPath(), installCsp(), toggleTradingFromTray() (+10 more)

### Community 38 - "Bossfight"
Cohesion: 0.13
Nodes (20): Player/Enemy Character Sprite Concept, Sprite Animation Frames Concept, spritebluey.png (Blue Character Sprite Sheet), ARCH_BY_TIER, ARCHE, BossArena(), BossWidget(), COLORS (+12 more)

### Community 39 - "Python Utils.mjs"
Cohesion: 0.19
Nodes (15): exe, out, st, __dirname, ensureVenv(), findSystemPython(), PY_DIR, ROOT (+7 more)

### Community 41 - "Polymarket Api"
Cohesion: 0.18
Nodes (20): _authed_request(), check_deposit_wallet_authorization(), check_trading_ready(), detect_wallet_signature_type(), ensure_api_creds(), _erc20_balance_usd(), _extract_allowance(), get_balance() (+12 more)

### Community 42 - "Tsconfig.node.json"
Cohesion: 0.11
Nodes (19): node, vite.config.ts, compilerOptions, allowSyntheticDefaultImports, baseUrl, esModuleInterop, lib, module (+11 more)

### Community 43 - "Links"
Cohesion: 0.14
Nodes (13): SIGNATURE_TYPE_LABELS, SlotProps, WalletSlot(), OnboardingModal(), KRYPT_DISCORD, KRYPT_HOME, KRYPT_TOOLS, KRYPT_TRADER_PAGE (+5 more)

### Community 44 - "Ipc"
Cohesion: 0.18
Nodes (16): activeKeyFor(), err(), genId(), logsBuffer, normScope(), ok(), pushConfigToBackend(), registerIpc() (+8 more)

### Community 45 - "Test Backtest"
Cohesion: 0.15
Nodes (10): sig(), sig_ev(), test_clustering_deflates_correlated_significance(), test_fair_odds_lose_exactly_the_fee(), test_real_edge_survives_fees(), test_solo_signals_have_per_event_t_equal_to_per_signal_t(), test_threshold_sweep_filters_by_confidence(), test_verdict_calls_negative_when_net_negative() (+2 more)

### Community 46 - "Test Presets"
Cohesion: 0.21
Nodes (15): _as_float(), _camel_to_snake(), _clampf(), _clampi(), crypto15m_preset_config(), Any, strategy_full_config(), _validate_config() (+7 more)

### Community 47 - "Service"
Cohesion: 0.16
Nodes (18): _dispatch_request(), emit_event(), _establish_auth(), _h_clearCredentials(), _h_flatten(), _h_setConfig(), _h_setCredentials(), _h_shutdown() (+10 more)

### Community 48 - "Test Api Retry"
Cohesion: 0.20
Nodes (11): fixture, _Resp, _run(), _StatusClient, _stub_api(), test_idempotent_get_still_retries_on_5xx(), test_idempotent_get_still_retries_on_timeout(), test_post_order_not_retried_on_5xx() (+3 more)

### Community 49 - "Script Sandbox"
Cohesion: 0.18
Nodes (10): BaseException, call_budgeted(), code_hash(), Any, Exception, ScriptBudgetExceeded, ScriptError, _Tracer (+2 more)

### Community 50 - "Volume Farm"
Cohesion: 0.24
Nodes (15): Namespace, _load_progress(), main(), parse_args(), _parse_order(), pick_market(), _poll_fill(), Progress (+7 more)

### Community 51 - "Package.json"
Cohesion: 0.12
Nodes (16): bugs, url, dependencies, discord-rpc, description, homepage, discord-rpc, license (+8 more)

### Community 52 - "Db"
Cohesion: 0.21
Nodes (17): backup_research(), cleanup_old_data(), _data_dir(), db_path(), _delete_batched(), factory_reset(), get_db(), init_db() (+9 more)

### Community 53 - "Underconfidence Study"
Cohesion: 0.21
Nodes (15): clustered_t(), _epoch(), fee_ct(), fetch_history(), fetch_markets(), _get(), main(), _month_windows() (+7 more)

### Community 54 - "Webhook"
Cohesion: 0.26
Nodes (16): event_embed(), _fmt_cents(), _fmt_pnl(), _is_allowed_webhook(), _krypt_footer(), momentum_embed(), _now_iso(), _post() (+8 more)

### Community 55 - "Settings Store"
Cohesion: 0.32
Nodes (15): DEFAULT_STATE, ensureDir(), get(), load(), mergeConfig(), mergeProfile(), mergeState(), patchConfig() (+7 more)

### Community 56 - "Package.json"
Cohesion: 0.13
Nodes (16): build, appId, asarUnpack, directories, dmg, extraResources, files, productName (+8 more)

### Community 57 - "Test Db Maintenance"
Cohesion: 0.19
Nodes (7): _add_trade(), _now(), _seed_history(), test_batched_delete_clears_a_large_backlog(), test_cleanup_prunes_old_keeps_recent(), test_clear_trade_history_wipes_history_keeps_feed(), test_run_maintenance_compacts_when_forced()

### Community 58 - "Visualizer"
Cohesion: 0.18
Nodes (14): SignalSource, BucketTile(), BucketTileProps, drawOrb(), drawSun(), drawSweep(), Mini(), Orb (+6 more)

### Community 59 - "Readme"
Cohesion: 0.15
Nodes (12): conftest.py, test_scoring.py, test_script_engine.py, test_security.py, test_serialize.py, test_trader_logic.py, Script Risk Audit, Script Safety Rails (+4 more)

### Community 60 - "Scanner"
Cohesion: 0.28
Nodes (10): categorize_by_keywords(), is_micro_market(), compute_momentum_confidence(), compute_whale_score(), _parse_days_to_close(), _resolve_category(), scan_momentum(), scan_whales() (+2 more)

### Community 61 - "Db"
Cohesion: 0.18
Nodes (15): bank_realized_pnl_before_wipe(), clear_trade_history(), crypto15m_today_pnl(), _daily_wiped_pnl(), _engine_pnl_source(), _engine_resolved_pnl_sum(), engine_today_pnl(), insert_trade() (+7 more)

### Community 62 - "Test Db Maintenance"
Cohesion: 0.19
Nodes (15): db(), fresh_db(), _make_marker_db(), _marker_survived(), fixture, test_db_restore_prefers_newest_local_backup_over_vault(), test_db_restores_from_local_backups_when_missing(), test_db_restores_from_vault_after_full_userdata_wipe() (+7 more)

### Community 63 - "Test Category Gates"
Cohesion: 0.33
Nodes (14): _cfg(), parametrize, _signal(), test_camel_keys_from_the_ui_map_to_the_snake_keys_the_trader_reads(), test_convergence_shares_the_whale_list(), test_global_and_per_source_compose_with_AND(), test_global_empty_list_means_trade_nothing(), test_global_filter_allows_a_listed_category() (+6 more)

### Community 65 - "Readme"
Cohesion: 0.15
Nodes (11): krypt-polybot-backend.spec (PyInstaller), PyInstaller --selftest Gate, 15-Minute Crypto Module, Auto-Trader Engine, Copy Trading, Idempotent Signing, Momentum Scanner, npm run py:backtest (+3 more)

### Community 66 - "Package.json"
Cohesion: 0.15
Nodes (13): scripts, build, dev, dist, predev, py:backtest, py:backtest15m, py:dist (+5 more)

### Community 67 - "Momentum Oos"
Cohesion: 0.19
Nodes (12): 65c Ask Cap Parameter, Baseline Fill Model, examples/btc-momentum.py, BTC 15m Price-Momentum Strategy, Daily-Stop Interaction Risk, Honest (Combined) Fill Model, momentum_band_stability.py, momentum_cap_sweep.py (+4 more)

### Community 68 - "Shadow Pricer Eval"
Cohesion: 0.32
Nodes (12): calibration(), _clip(), default_db(), edge_pnl(), fee_cents(), _first_qualifying_trade(), load_rows(), main() (+4 more)

### Community 69 - "Test Funding Floor"
Cohesion: 0.33
Nodes (12): _funding_issue(), _issues_for(), order_cost_usd(), parametrize, test_balance_below_one_dollar_is_a_hard_stop(), test_balance_below_the_probe_threshold_is_flagged(), test_balance_that_can_trade_cheap_markets_is_not_told_it_cannot(), test_cheapest_possible_order_is_one_dollar_not_five() (+4 more)

### Community 70 - "Positions"
Cohesion: 0.22
Nodes (10): TickerLink(), PositionRow(), STATUS_COLORS, Tab, Tabs(), fmtCents(), cache, LinkArgs (+2 more)

### Community 71 - "Package.json"
Cohesion: 0.17
Nodes (12): nsis, allowToChangeInstallationDirectory, createDesktopShortcut, createStartMenuShortcut, include, installerIcon, menuCategory, oneClick (+4 more)

### Community 72 - "Instance Lock"
Cohesion: 0.24
Nodes (6): claim(), foreign_holder(), _lock_dir(), _lock_file(), Path, release()

### Community 73 - "Trader"
Cohesion: 0.21
Nodes (12): cancel_order(), get_order(), get_quote(), _compute_limit_price_cents(), _confirm_sell(), _db_status_from_order(), _f(), _liquidate_position() (+4 more)

### Community 74 - "Requirements"
Cohesion: 0.18
Nodes (8): pytest, cryptography, eth-account, httpx, keyring (macOS/Linux credential store), py_clob_client_v2 (Polymarket V2 CLOB client), websockets (clob_ws.py feed), Windows DPAPI Credential Encryption

### Community 75 - "Probe Btc Momentum"
Cohesion: 0.38
Nodes (9): _btc(), _fmt_btc(), live(), main(), preflight(), _ts(), _warm_feeds(), main() (+1 more)

### Community 76 - "Test Script Paste Encoding"
Cohesion: 0.20
Nodes (5): _mangled(), parametrize, test_mangled_paste_in_actual_CODE_reports_a_normal_error(), test_sanitizer_handles_empty_input(), test_save_rpc_survives_a_mangled_paste()

### Community 77 - "Arming.e2e.mjs"
Cohesion: 0.20
Nodes (7): APP_DIR, APPDATA, failures, LOCALAPPDATA, SANDBOX, userData, VALID

### Community 78 - "Accounts"
Cohesion: 0.33
Nodes (9): AccountEntry, accountsRoot(), applyAccountFromArgv(), createAccount(), currentAccount(), launchAccount(), listAccounts(), parseAccountArg() (+1 more)

### Community 79 - "Crypto15m Backfill"
Cohesion: 0.36
Nodes (8): backfill(), backfill_bulk(), _epoch_ms(), _fetch_candles_coinbase(), _fetch_candles_hyperliquid(), main(), _pending_groups(), AsyncClient

### Community 80 - "Script Engine"
Cohesion: 0.31
Nodes (9): _call_hook(), _compile_timeout(), _get_compiled(), _hook_timeout(), _manage_pass(), _open_crypto_for_script(), Any, _run_bounded() (+1 more)

### Community 81 - "Service"
Cohesion: 0.29
Nodes (10): _build_account_snapshot(), _fire_and_forget(), _h_account(), _h_clearHistory(), _h_factoryReset(), _loop_watchdog(), _scanner_and_trader_loop(), _should_fire_event_webhook() (+2 more)

### Community 82 - "Test Market Pagination"
Cohesion: 0.33
Nodes (8): _fake_gamma(), parametrize, test_exactly_one_full_page_then_empty(), test_fetch_all_open_markets_reaches_past_the_first_page(), test_max_pages_still_bounds_the_walk(), test_page_cap_below_requested_limit_still_paginates(), test_pagination_stops_on_a_short_final_page(), test_small_result_sets()

### Community 84 - "Test Signature Type Reconcile"
Cohesion: 0.38
Nodes (9): test_a_failed_detection_retries_on_the_next_connect(), test_abstain_never_overwrites_stored_type(), test_correct_type_is_left_alone(), test_corrupt_type_1_is_repaired_to_3_on_connect(), test_detection_failure_is_swallowed_and_never_blocks_auth(), test_genuine_poly_proxy_is_preserved(), test_raw_eoa_wallet_skips_detection(), test_runs_at_most_once_per_launch() (+1 more)

### Community 85 - "Turbine Import"
Cohesion: 0.42
Nodes (9): _change_field(), _ge(), _gt(), import_all(), import_strategy(), _le(), load_library(), _lt() (+1 more)

### Community 86 - "Scripteditor"
Cohesion: 0.20
Nodes (8): EditorDiagnostic, EditorField, HOOK_SNIPPETS, kryptTheme, MARKET_FIELDS, POSITION_FIELDS, SIGNAL_FIELDS, ScriptEditor

### Community 87 - "Ferrari Copyability"
Cohesion: 0.47
Nodes (8): _cat(), drift_after_fill(), fetch_all(), _get(), pct(), AsyncClient, Semaphore, run()

### Community 88 - "Test Backtest Caveats"
Cohesion: 0.44
Nodes (8): _caveats(), parametrize, _run(), test_a_decide_script_on_an_empty_db_still_blames_the_data(), test_it_points_at_shadow_mode_as_the_alternative(), test_non_window_scripts_say_NOT_BACKTESTABLE(), test_the_not_backtestable_caveat_comes_first(), test_zero_trades_is_reported_consistently()

### Community 89 - "Package.json"
Cohesion: 0.25
Nodes (8): linux, artifactName, category, icon, maintainer, target, AppImage, deb

### Community 90 - "Pmxt Backfill"
Cohesion: 0.54
Nodes (7): _fetch_series_coinbase(), backfill_hours(), fetch_candles(), fetch_meta(), main(), Connection, simulate()

### Community 91 - "Polymarket Api"
Cohesion: 0.29
Nodes (7): _assert_maker_is_deposit_wallet(), _deposit_wallet_issue(), _is_no_match_error(), place_limit_order(), PolymarketAPIError, Exception, _snap_price_to_tick()

### Community 92 - "Service"
Cohesion: 0.25
Nodes (8): _h_botRuns(), _h_pnlSeries(), _h_script_shadow_orders(), _h_signals(), _iso_utc(), _run_row_to_js(), _script_status_js(), _signal_row_to_js()

### Community 93 - "Readme"
Cohesion: 0.29
Nodes (8): test_script_sandbox.py, Script Backtesting, Custom Strategy Scripts, decide(ctx) Hook, decide_market(market) Hook, manage(position, ctx) Hook, Sandboxed Scripts (AST validation), Trusted Mode

### Community 95 - "Test Script Engine"
Cohesion: 0.39
Nodes (8): _fee(), _mk_shadow(), test_a_losing_market_shadow_books_the_loss(), test_a_recent_unresolved_row_is_left_alone(), test_an_unresolvable_row_is_retired_so_it_stops_eating_the_cap(), test_crypto_shadow_settlement_is_unaffected(), test_market_shadow_settles_from_the_live_api_not_the_local_table(), test_stuck_rows_no_longer_retire_a_script()

### Community 96 - "Package.json"
Cohesion: 0.29
Nodes (7): autoprefixer, codemirror, devDependencies, autoprefixer, codemirror, recharts, recharts

### Community 97 - "Whale Momentum Survey"
Cohesion: 0.52
Nodes (6): app_config(), clustered_t(), fmt(), follower_pnl(), main(), summarize()

### Community 98 - "Turbine Backtest"
Cohesion: 0.48
Nodes (6): test_get_quote_reads_clob_prices(), main(), _meta(), _rank_score(), run(), _tstat()

### Community 99 - "Package.json"
Cohesion: 0.33
Nodes (6): mac, artifactName, category, icon, target, dmg

### Community 100 - "Db"
Cohesion: 0.33
Nodes (6): kv_set(), latest_snapshot(), note_transfer_if_unexplainable(), transfer_adjustment_run(), transfer_adjustment_today(), _utc_today()

### Community 101 - "Test Script Engine"
Cohesion: 0.33
Nodes (6): _clean_engine_globals(), emitted(), engine_stubs(), fresh_db(), placed(), fixture

### Community 102 - "Test Script Engine"
Cohesion: 0.33
Nodes (6): _mod(), test_heartbeat_fires_on_the_first_tick_so_the_panel_is_never_empty(), test_heartbeat_never_breaks_a_trading_pass(), test_heartbeat_rate_limits_to_one_line_per_interval(), test_heartbeat_resets_its_counters_after_emitting(), test_supervise_does_not_run_in_shadow_mode()

### Community 104 - "Package.json"
Cohesion: 0.40
Nodes (5): win, artifactName, icon, target, nsis

### Community 105 - "Conftest"
Cohesion: 0.60
Nodes (4): _hermetic_balance(), _hermetic_market_meta(), _hermetic_quote(), fixture

### Community 107 - "Pm Sports Bias"
Cohesion: 0.50
Nodes (4): Favourite-Longshot Bias, Krypt Scout Tracker DB (kryptscout.sqlite), Market Calibration Finding, examples/sports-favourite-bias.py

### Community 108 - "Test Script Engine"
Cohesion: 0.40
Nodes (5): _hours_from_now(), test_market_universe_drops_markets_that_already_closed(), test_market_universe_never_repeats_a_market_across_the_two_slices(), test_market_universe_reserves_half_the_budget_for_imminent_markets(), test_market_universe_spends_the_whole_budget_when_nothing_closes_soon()

### Community 109 - "Disclaimer"
Cohesion: 0.50
Nodes (3): Affiliate Disclosure, No Paper/Demo Mode, Shadow Mode

### Community 110 - "Python Backend"
Cohesion: 0.50
Nodes (3): EventCallback, LogCallback, Pending

### Community 111 - "Service"
Cohesion: 0.50
Nodes (3): LogRecord, _setup_logging(), _StdoutHandler

### Community 112 - "Package.json"
Cohesion: 0.50
Nodes (4): author, email, name, url

### Community 114 - "Service"
Cohesion: 0.50
Nodes (4): _h_positions(), _h_runOnce(), _live_pnl_usd(), _position_row_to_js()

### Community 115 - "Readme"
Cohesion: 0.50
Nodes (4): test_engine_integration.py, Resolution via Direct API, reconcile_positions_with_polymarket(), Startup Reconciliation

### Community 116 - "Test Trader Logic"
Cohesion: 0.50
Nodes (4): _iso_in_days(), test_days_until_close_parses_and_fails_soft(), test_resolution_gate_applies_in_rules_mode(), test_should_trade_resolution_days_gate()

### Community 117 - "Test Script Engine"
Cohesion: 0.67
Nodes (3): market_to_js(), test_market_ctx_exposes_both_sides_and_derived_fields(), test_market_ctx_rejects_out_of_range_prices_as_none()

### Community 120 - "Readme"
Cohesion: 0.67
Nodes (3): Electron + React Renderer, Python Backend (child process), window.krypt.* IPC

## Knowledge Gaps
- **251 isolated node(s):** `APP_DIR`, `SANDBOX`, `userData`, `APPDATA`, `LOCALAPPDATA` (+246 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 842 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **29 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `merge_with_defaults()` connect `Test Security` to `Test Crypto15m Trader`, `Whale Momentum Survey`, `Test Engine Integration`, `Test Parlay`, `Turbine Backtest`, `Test Settlement Model`, `Probe Btc Momentum`, `Test Crypto15m Backtest`, `Test Loss Guards`, `Test Presets`, `Service`, `Test Trader Logic`, `Test Trader Logic`, `Test Copy Trader`, `Service`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `APP_DIR`, `SANDBOX`, `userData` to the rest of the system?**
  _251 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Test Crypto15m Trader` be split into smaller, more focused modules?**
  _Cohesion score 0.05365178262374524 - nodes in this community are weakly interconnected._
- **Should `Db` be split into smaller, more focused modules?**
  _Cohesion score 0.023809523809523808 - nodes in this community are weakly interconnected._
- **Should `Test Engine Integration` be split into smaller, more focused modules?**
  _Cohesion score 0.08056265984654731 - nodes in this community are weakly interconnected._
- **Should `Test Parlay` be split into smaller, more focused modules?**
  _Cohesion score 0.05480769230769231 - nodes in this community are weakly interconnected._
- **Should `Polymarket Auth` be split into smaller, more focused modules?**
  _Cohesion score 0.08382936507936507 - nodes in this community are weakly interconnected._
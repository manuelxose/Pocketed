<div align="center">

# Pocketed

**A free, open-source Polymarket auto-trading webapp.**
Whale tracker · momentum scanner · short-term crypto module · copy trading · **your own Python strategy scripts** — in one polished app.

[![CI](https://github.com/TODO/pocketed/actions/workflows/ci.yml/badge.svg)](https://github.com/TODO/pocketed/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Status: beta](https://img.shields.io/badge/status-beta-orange)

</div>

> [!WARNING]
> **This software places real orders on your Polymarket account and trading carries real financial risk.**
> The bundled strategies are heuristics with **no proven, fee-adjusted edge** — they may lose money.
> This is **not financial advice**. You are solely responsible for your trades and for complying with
> [Polymarket's Terms of Service](https://polymarket.com/terms) and the laws of your jurisdiction.
> Polymarket trades on **Polygon mainnet with real USDC** — there is no demo exchange, and **there is no
> paper or simulation mode**. Every engine ships **off by default** and places **real orders** the moment
> you enable it and connect a funded wallet. Note the **short-term crypto** tab has its *own* **LIVE**
> switch that trades independently — leave it off unless you intend to. Please read the full
> [**Disclaimer**](./DISCLAIMER.md).

---

## What it does

- **Whale tracker** — watches the public Polymarket trade feed for $2.5k+ taker orders, scores them with a
  heuristic point-system, and surfaces the highest-edge ones live.
- **Momentum scanner** — detects volume spikes, price moves, and trade clusters, with a contrarian-only
  mode that fades the crowd against the underdog.
- **15-minute crypto** — monitors Polymarket's 15-min crypto markets (BTC/ETH/SOL/XRP/DOGE/HYPE/BNB) with a
  configurable momentum strategy (entry window, favorite threshold, underlying-delta filter, stop-loss,
  favorite-follow or contrarian-fade), plus an optional live executor (off by default). The app
  passively logs every quarter's signal + outcome to your local DB for review.
- **Custom strategy scripts** *(new in 2.0)* — write your own strategy in Python, backtest it against your
  own recorded ticks, and let it trade under hard safety rails. See
  [Custom strategy scripts](#custom-strategy-scripts).
- **Copy trading** — follow chosen wallets and mirror their entries at your own size, with exit tracking
  and per-wallet filters.
- **Auto-trader** — sizes positions 2-6% of bankroll (scaled by edge), places limit-cross orders, polls
  fills, marks resolutions, and reconciles its book against Polymarket on every restart. Daily P&L
  stop-loss / take-profit gate, lifetime drawdown breaker, trading-hours windows, and a master
  kill-switch.
- **Profiles** — save / load / import / export tuned configs, plus built-in strategy presets.
- **Discord** — optional webhooks for trade events / whales / momentum + Rich Presence.
- **Standalone webapp** — Pocketed runs as a normal website: a React app talking to a `webserver/`
  FastAPI gateway over WebSocket + REST, with no desktop install, no IPC bridge, and no local
  Electron shell. It sends **no** telemetry, analytics, or usage data of any kind (see the
  [Disclaimer](DISCLAIMER.md)).

## How it works

```
┌───────────────────────┐    WebSocket (RPC) + REST     ┌───────────────────────┐    stdio JSON-RPC    ┌──────────────────────────┐
│   React app (src/)    │ ─────────────────────────────▶ │  webserver/ (FastAPI) │ ────────────────────▶ │ python/service.py worker │
│  dashboard, settings…  │ ◀───────────────────────────── │  auth · config · WS   │ ◀──────────────────── │  scanners + trade engine │
└───────────┬────────────┘   events / responses / logs   └───────────┬───────────┘   events / responses  └────────────┬─────────────┘
            │ browser (any origin serving the built dist/)           │ one worker process per logged-in wallet        │
            ▼                                                        ▼                                                ▼
      SIWE wallet sign-in                                    per-user data dir                        Polymarket API · CoinGecko · SQLite
```

The browser never talks to Polymarket directly. You sign in with your wallet (SIWE / EIP-4361, no
passwords); `webserver/` spawns you an isolated `python/service.py` worker that runs the scanners and
trading engine, signs Polymarket CLOB orders (EIP-712), and persists to a per-user SQLite DB. In
production `webserver/` also serves the built React app itself (`npm run build` → `dist/`), so
everything is same-origin — see [Deploy / production build](#deploy--production-build).

## Custody & session keys

Pocketed is non-custodial: your wallet's private key never reaches the server. Two paths exist for
authorizing trades, at different stages of completion:

- **Direct credentials** (raw API key/private key handed to the worker) — the historical desktop-app
  model, still present in the code (`python/polymarket_auth.py`) but **intentionally disabled** at the
  gateway today: `setCredentials`, `clearCredentials`, `testCredentials`, `cancelAllOpen`, and `flatten`
  are refused with "not available yet."
- **Session keys** (the intended webapp path) — you sign one `eth_signTypedData_v4` message authorizing
  a session key to trade on your behalf via an ERC-4337 Kernel (ZeroDev) smart account, submitted
  through a self-hosted bundler (Alto) and gas-sponsored by `aa-service/`. See the Sidebar → Session Key
  page.

**Known blocking gap — nothing today installs the Kernel permission validator on-chain.** The smart
account is deployed with an empty `initConfig` (no permission validator, no policies), so a signature
produced under a session key routes to a permission id the account has no on-chain configuration for,
and a real verifier would reject it. Concretely:

- The daily USD spend cap is **software-enforced only** (a local counter in `python/session_key.py`).
- The session key's expiry and allowed-caller restriction are **encoded into the signature's permission
  id but not enforced by any deployed contract**, because that validator is never installed. Do not
  describe them as contract-enforced until the validator install ships.
- The `eth_signTypedData_v4` payload you sign (`session_key.build_enable_typed_data`) is a **local
  consent record** — verified on activation to prove the request came from the account owner, but it is
  not Kernel's on-chain enable payload and authorizes nothing on-chain.

See the module docstring at the top of `python/session_key.py` for the two candidate ways to close this
(install at deploy time via `initConfig`, or via a one-time UserOp after deploy). The Session Key page's
"Activate auto-trading" button exercises the whole mint → sign → activate flow end to end, but treat it
as a local smoke test — not production-ready unattended trading — until the gap above is closed.

Running the full stack locally (three processes) — only needed if you want to exercise the
session-key/smart-account flow; the app runs fine without any of these three (see
[Quick start](#quick-start-development)):
```bash
# 1. bundler
cd infra/bundler && docker compose up -d

# 2. aa-service (all four env vars are required — it refuses to start
#    without them; POLYGON_RPC_URL/BUNDLER_RPC_URL below point at Polygon
#    Amoy testnet, swap for your own RPC provider; PAYMASTER_PRIVATE_KEY is
#    aa-service's own operational signing key, never a user's wallet key.
#    CHAIN_ID must match the bundler above, 80002 = Amoy, 137 = Polygon mainnet)
cd aa-service && npm install
POLYGON_RPC_URL=https://rpc-amoy.polygon.technology \
  BUNDLER_RPC_URL=http://localhost:4337 \
  CHAIN_ID=80002 \
  PAYMASTER_PRIVATE_KEY=0xyour_aa_service_operational_private_key \
  PAYMASTER_DAILY_GAS_CAP_WEI=1000000000000000000 \
  npm run dev

# 3. gateway
cd webserver && POCKETED_SESSION_SECRET=dev-secret \
  POCKETED_AA_SERVICE_URL=http://localhost:4001 \
  .venv/Scripts/python -m uvicorn webserver.main:app --reload
```

## Custom strategy scripts

The **Scripts** tab lets you write a strategy in plain Python, backtest it on the ticks the app has
already recorded, and arm it to trade — without touching the codebase or rebuilding anything.

A script defines one or more hooks. Every hook is optional except that you need at least one:

| Hook | When it runs | What it does |
| --- | --- | --- |
| `decide(ctx)` | once per coin per tick, while a crypto Up/Down window is open | return an order intent to buy a side |
| `decide_market(market)` | once per tick per top general market by volume | trade politics, sports, news — anything on Polymarket |
| `manage(position, ctx)` | every tick, per open position | `"sell"` to flatten now, or retune take-profit / stop-loss (trailing stops) |
| `decide_signal(signal)` | on each new whale / momentum signal | filter and size which signals to follow |
| `supervise(app)` | once per tick | flip **whitelisted** config (e.g. strategy posture, or switch an engine off) |
| `on_start` / `on_fill` / `on_settle` | lifecycle | keep cross-tick memory in the persistent `state` dict |

```python
# pocketed-script v1
# name: Late Favorite Follow
# description: Buys the favorite in the last 3 minutes when it is 80-95c with a real book.

def decide(ctx):
    if ctx["minsLeft"] is None or ctx["minsLeft"] > 3.0:
        return None
    fav = ctx["favorite"]
    if fav not in ("up", "down"):
        return None
    ask = ctx["upAsk"] if fav == "up" else ctx["downAsk"]
    if ask is None:
        return None          # no real order book this tick — never trade a phantom quote
    if 0.80 <= ask <= 0.95:
        return {"side": fav, "price": "ask", "reason": "late favorite"}
    return None
```

`ctx` carries ~50 fields per tick — book asks/bids, the underlying's spot and realized volatility, MACD /
RSI / VWAP / EMA / SMA indicators, model probability and fee-net edge, time left in the window, and your
own `portfolio` (balance, open positions, today's P&L). Convenience fields save you the fiddly parts:
`spreadCents` (book width), `modelEdgePts` (signed model-vs-book disagreement), `favoriteAskCents` (the
favorite's real executable ask), and `timeFracLeft` (0..1 through the window — write one script that
works on the 5m, 15m *and* hourly series). Every derived field is computed by a single shared helper used
by both the live engine and the backtester, so a field can never quietly mean two different things.

**Safety rails.** Every script runs behind caps you set on the Scripts page: max entry price, max
contracts per order, max open positions per script, a per-script daily-loss breaker that auto-disables
on a bad day, and a cap on how many scripts run at once. One entry attempt per market window per
script. Any exception, malformed return, or hook that overruns its wall-clock limit auto-disables that
script and surfaces the reason in the UI — the engine loop never sees a script error. Scripts also
cannot place an order the rails would refuse: where a cap and the exchange's own minimum contradict
each other, the entry is **refused**, never rounded up past your cap.

**Full Python, audited — not sandboxed.** Scripts are ordinary Python: import what you like, use the
standard library. There is no language sandbox (the old AST whitelist blocked most useful code while
never being a real security boundary). Instead every script is statically scanned and the findings are
shown on its **Risk** tab — network access, filesystem writes, subprocesses, credential-shaped names,
dynamic execution, and obfuscation, which is flagged as critical in its own right. A flagged script
says so again when you arm it. **Read any script you did not write**, especially one an AI generated:
it runs in the process holding your decrypted wallet key. See [SECURITY.md](./SECURITY.md).

**Independent of the other engines.** A script never needs the main bot, the crypto engine or
copy-trading switched on. It fetches its own market snapshot, picks its own coins (the 15m Crypto
tab's asset checkboxes do not touch it), and the whale/momentum collector is kept running for any
script that reads signals. Shadow scripts start ticking the moment you enable one — the "Scripts
live" master switch gates *real orders*, not the engine. Each script shows whether it is actually
running and, if not, which gate is holding it.

**Beyond crypto.** `decide_market(market)` hands your script the highest-volume general Polymarket
markets each tick — politics, sports, news — with title, category, both sides of the book, spread, volume
and open interest. It buys through the same rails and lands in the same position table as the built-in
engine, so fills, resolution, and reconciliation are handled for you. The universe size is a setting
(`Markets/tick`, default 150, `0` disables it) because each market costs one sandboxed hook call per
script. Crypto Up/Down windows are excluded — `decide()` already owns those. Note this hook is **not
simulated in backtests** (the recorded corpus only covers crypto windows), so validate it in shadow mode.

**Shadow mode.** Every new script starts in **shadow**: it runs against the same live ticks and through
every rail, but the exchange call is replaced by a recorded entry — the order it *would* have sent. Those
shadow orders settle from the real window outcome with the same taker fee charged, so a script builds a
genuine *forward* track record before it ever spends money. Arming it for real orders is an explicit,
confirmed action. This is the closest thing the app has to a paper mode, and it exists precisely where
the risk is highest: code you (or an AI) just wrote. Note that shadow simulates **entries only** — exits
need a real position, so shadow orders are held to settlement; a strategy that leans on `manage()` for
its exits will behave differently once live.

**Backtesting.** Backtest any script over your recorded windows before arming it. The report is
deliberately pessimistic and ships its own caveats — resting limits are not modeled as maker fills, exit
fills into a recorded bid are flagged as optimistic (these markets frequently have *no* bid and gap to
$0), and `script_max_open` and the daily-loss breaker are not simulated, so live is a rail-limited subset
of what the backtest shows. It is also in-sample by construction: a script tuned on this panel is fit to
the past. Watch it run before arming it.

**Writing them.** The editor autocompletes `ctx[…]` field names with their documentation inline and
offers hook skeletons, and underlines errors as you type using the same validator that gates saving —
so the editor can never disagree with the engine. Scripts import and export as plain `.py` files;
imported ones arrive disabled and in shadow mode, and still have to validate before they can run.

**Writing scripts with an AI.** The Scripts page generates a copy-paste context pack — the full field
vocabulary, the return contract, your actual rails, and your data inventory — rendered *from* the live
sandbox and engine modules, so it cannot drift from what really runs. Paste it into any assistant, paste
the script back, and the validator checks it before it can be enabled.

> [!WARNING]
> **Sandboxed vs Trusted.** Sandboxed scripts are validated at the AST level — no imports, no classes, no
> dunder or frame access, and every name must resolve to a curated builtin — then run under a CPU/time
> budget. This is a guardrail against accidental damage and naive-malicious code, **not a hard security
> boundary**: CPython sandboxes are escapable by a determined attacker. **Trusted mode skips validation
> entirely** and runs with the same privileges as the trading engine, in the process holding your
> decrypted wallet key. Only ever flip a script to Trusted if you have read and understood its code.
> Trusted bypasses the *language* sandbox only — never the money rails.

## Engine reliability

1. **Resolution via direct API.** Unresolved positions are reconciled against the Gamma market
   (`closed` + `outcomePrices`) and your on-chain positions directly, so a settled market no longer
   sits in `filled` forever and blocks new trades.
2. **Startup reconciliation.** On launch, `reconcile_positions_with_polymarket()` rebuilds the local book
   from your live Polymarket positions, so a crash mid-fill doesn't permanently inflate the count.
3. **Idempotent signing.** CLOB orders are EIP-712 signed locally and deduped by signal, so a restart
   never double-trades the same signal.

## Project layout

```
pocketed/
├─ webserver/            FastAPI gateway (auth, config/profile persistence, session-key routes)
├─ python/               Consolidated backend (scanner, trader, crypto15m, service) + tests/
├─ src/                  React UI (dashboard, settings, 15m crypto, etc.), talks to webserver/ over WS+REST
├─ shared/types.ts       Types shared across the frontend
├─ resources/            Icons (pocketed.png, pocketed.ico)
├─ scripts/              Node-based build helpers (no PowerShell needed)
└─ package.json          Frontend build config
```

## Quick start (development)

**Prerequisites:** [Node.js](https://nodejs.org) 18+ and [Python](https://python.org) 3.10+ on PATH
(`py`, `python`, or `python3`).

Two processes, in separate terminals:

```bash
# 1. the FastAPI gateway (webserver/) — spawns your per-wallet Python worker
cd webserver
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
POCKETED_SESSION_SECRET=dev-secret .venv/Scripts/python -m uvicorn webserver.main:app --reload --port 8000
```
(Run uvicorn from the repo root, not from inside `webserver/`, so the `webserver` package resolves —
see `webserver/tests/manual_client.py` for a runnable end-to-end smoke test against a live instance.)

```bash
# 2. the React dev server (repo root) — proxies /auth, /config, /ws, etc. to the gateway above on :8000
git clone <this-repo-url>
cd pocketed
npm install
npm run dev          # `predev` auto-creates python/.venv and installs backend deps (~30s, one-time)
```

Open the URL Vite prints, connect a wallet (SIWE sign-in), then **Wallet** to connect your Polymarket
credentials (currently gated, see [Custody & session keys](#custody--session-keys)) or **Session Key**
for the intended unattended-trading path. Every engine starts **off**; nothing trades until you enable
it — and once enabled it places **real orders** (there is no paper mode).

Bootstrap just the Python venv without launching the app: `npm run py:setup`.

## Deploy / production build

```bash
npm run build         # produces dist/ (the built React app)
cd webserver && POCKETED_SESSION_SECRET=<a-real-secret> \
  .venv/Scripts/python -m uvicorn webserver.main:app --host 0.0.0.0 --port 8000
```

`webserver/` serves the built `dist/` itself (same-origin with the API/WS routes — see
`webserver/main.py`'s "Frontend static serving" section), so this one process is the whole deployment.
Point `POCKETED_WEBAPP_DIST`/`POCKETED_WEBAPP_DATA`/`POCKETED_AA_SERVICE_URL` at your own paths/services
if you're not running everything from a single checkout. There is currently no packaged installer or
Docker image — this is a from-source deployment only.

## Testing

```bash
npm run py:test                      # Python backend tests (pytest)
cd webserver && .venv/Scripts/python -m pytest tests/ -q   # gateway tests (auth, config, WS, AA, session-key routes)
npm test                             # frontend tests (vitest)
npm run typecheck                    # TypeScript
```

Three separate suites, one per layer: the Python trading engine (`python/tests/`), the FastAPI gateway
(`webserver/tests/`), and the React app (`src/**/*.test.tsx`). CI runs typecheck + all three test suites
on every push and pull request.

## Strategies & honesty

The strategies are **heuristic point systems with hand-tuned constants**, not validated models, and they
have **no proven, out-of-sample, fee-adjusted edge**. The entry/sizing logic does **not** fully model
Polymarket's taker fees — which can erode small edges. The built-in engines have **no paper mode** —
enabling one risks real money — so treat the presets as starting points, start with a small amount, and
form your own view before sizing up. The one exception is **user scripts**, which start in
[shadow mode](#custom-strategy-scripts) and record what they *would* have traded until you arm them.

## Project status & roadmap

**Beta.** A polished, tested app — but **not** a finished "trust-it-with-real-money" product.

Done:
- [x] **Migrated off Electron to a standalone webapp** — `src/` is a plain React SPA talking to
  `webserver/` over WebSocket + REST; no desktop install, no IPC bridge.
- [x] **Fee-aware backtest harness** (`cd python && .venv/Scripts/python backtest.py`) — measures the
  net-of-fee edge of the scanners' signals. Run it on your own data before trusting any strategy. (On
  the author's history the default presets were net-*negative* after fees; the `Crypto Whale` and
  `Sports Momentum` presets target the slices that backtested positive — still in-sample, so treat them
  with caution.)
- [x] **Test suite + CI** — pytest over the trading engine, sizing, P&L, reconciliation, config
  validation, credential encryption, the short-term crypto executor, the copy engine, and the script
  sandbox / money rails, plus a pytest suite for the FastAPI gateway and a vitest suite for the React
  app; all three run in CI on every push and pull request.
- [x] **Custom strategy scripts** — sandboxed Python hooks, a backtester, and per-script safety rails.
- [x] **Server-side config validation** (clamps money-critical knobs before they can drive an order).
- [x] **15-minute crypto** monitor + live executor (off by default) with a stop-loss exit and a
  **percentage-based** delta filter.

Still open:
- [ ] **Install the Kernel permission validator on-chain** — session-key trading is currently a local
  smoke test, not enforceable by any deployed contract; see [Custody & session keys](#custody--session-keys).
- [ ] **Re-enable direct credentials** — `setCredentials`/`testCredentials`/`cancelAllOpen`/`flatten`
  are intentionally gated at the webapp gateway today.
- [ ] **Validate a strategy forward** — confirm any preset is +EV *out-of-sample*, not just in-sample.
- [ ] A true "flatten" (sell-to-close) for the main engine (today's "Cancel All" cancels resting orders).
- [ ] Broader React UI test coverage — the vitest suite covers the WS/REST hook layer, but end-to-end
  UI flows (e.g. the script arming flow) aren't covered yet.
- [ ] **A backtest path for `decide_market()`** — the recorded tick corpus only covers crypto windows,
  so general-market scripts can only be validated in shadow mode today.
- [ ] **Exit simulation in shadow mode** — shadow records entries and holds them to settlement, so a
  strategy that leans on `manage()` for its exits behaves differently once armed.

## File locations

Data lives wherever the `webserver/` process runs — your own machine if you self-host it (the default
for [Quick start](#quick-start-development)), or wherever you deploy it otherwise. Each logged-in wallet
gets its own isolated directory under `POCKETED_WEBAPP_DATA` (default: `python/data/webapp/` in this
checkout), and its own worker's SQLite DB under `POCKETED_USERDATA` (set per-worker by the gateway, not
by you directly).

| What | Where | Configurable via |
| --- | --- | --- |
| Per-user webapp data (config, profiles, sessions) | `python/data/webapp/users/<wallet>/` | `POCKETED_WEBAPP_DATA` |
| Built frontend served by `webserver/` | repo root's `dist/` | `POCKETED_WEBAPP_DIST` |
| aa-service gas-cap tracking / vault | see `aa-service/` and `python/db.py` | `POCKETED_VAULT` |

## Security

Pocketed is non-custodial by design: your wallet's private key never reaches the server (see
[Custody & session keys](#custody--session-keys)). The historical direct-credentials path
(`python/polymarket_auth.py`) is currently disabled at the gateway, but for completeness: when enabled,
credentials are encrypted at rest with the OS keystore (DPAPI on Windows, OS keychain elsewhere) on
whichever machine runs the `python/service.py` worker — your own machine if you self-host, the server's
disk otherwise. Anyone with your private key controls that wallet's funds, so use a dedicated trading
wallet funded only with what you intend to trade. To report a vulnerability, see
[SECURITY.md](./SECURITY.md).

## Contributing

PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Keep changes small and tested, and never commit
credentials or local data.

## Need a Polymarket account?

Sign up through our link, then deposit **$20** and place your first trade — Polymarket's current new-user offer is **up to $50 in trading credits** (trading credit, not instantly withdrawable — a small playthrough applies; amount, minimum deposit, and terms are set by Polymarket and can change). The link is our referral, at no extra cost to you:
<https://polymarket.com?via=yuhgo>

> Just use the link. Eligibility varies by region.

## Acknowledgements

The 15-minute crypto module is a generic favorite-follow / momentum approach — buy the late favorite (or
fade it), gated by an underlying-price delta — reimplemented independently and fully configurable in-app.
It is a starting point, not a proven edge. Built with React, Vite, Tailwind, FastAPI, lucide-react,
recharts, httpx, and cryptography.

## License

[MIT](./LICENSE) © Pocketed. Provided **as-is, with no warranty** — see the [Disclaimer](./DISCLAIMER.md).

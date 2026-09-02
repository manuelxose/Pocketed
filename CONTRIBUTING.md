# Contributing to Pocketed

Thanks for your interest! This is a real-money trading app, so correctness and safety matter — please
keep changes small, tested, and easy to review.

## Development setup

**Prerequisites:** Node.js 18+ and Python 3.10+ on PATH.

```bash
cd webserver && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
POCKETED_SESSION_SECRET=dev-secret .venv/Scripts/python -m uvicorn webserver.main:app --reload --port 8000

# in a second terminal, from the repo root
npm install
npm run dev           # vite dev server, proxies API/WS calls to the gateway above; `predev` sets up python/.venv
```

## Before you open a PR

```bash
npm run typecheck                                            # TypeScript must pass
npm run py:test                                               # Python backend tests must pass
(cd webserver && .venv/Scripts/python -m pytest tests/ -q)   # gateway tests must pass
npm test                                                       # frontend tests must pass
```

All four are also enforced by CI on every pull request.

## Guidelines

- **Match the surrounding code.** Naming, comment density, and idioms should look native to the file.
- **Add tests for logic changes** — especially anything touching the trading engine, sizing, P&L, or
  reconciliation. The Python tests live in `python/tests/`.
- **Never commit secrets or local state.** No private keys, API credentials, `.env` files, local databases, or
  logs. The `.gitignore` is set up to prevent this — don't override it.
- **Be careful with money paths.** Changes to order placement, settlement, or reconciliation should be
  conservative and well-tested. When in doubt, gate new behavior behind a config flag that defaults off.
- **Keep PRs focused.** One logical change per PR, with a clear description of what and why.

## Architecture quick reference

- `webserver/` — FastAPI gateway (auth, config/profile persistence, session-key routes). Talks to the
  browser over WebSocket (RPC) + REST, and to `python/service.py` over stdio JSON-RPC, one worker
  process per logged-in wallet.
- `python/` — backend: `service.py` (RPC loop), `scanner.py`, `trader.py`, `crypto15m*.py`, `db.py`.
- `src/` — React UI, built with Vite and served by `webserver/` in production. `shared/types.ts` holds
  types used across the frontend.

## Reporting bugs / security issues

Open a GitHub issue for bugs. For **security** issues, follow [SECURITY.md](./SECURITY.md) instead of
filing a public issue.

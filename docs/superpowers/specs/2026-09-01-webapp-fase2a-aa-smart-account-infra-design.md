# Webapp Fase 2a: Infra de smart account (ERC-4337 + Kernel)

## Contexto

Fase 1 (completa) dio auth SIWE + worker por-usuario, sin trading. El
primer intento de Fase 2 (firma EIP-712 directa desde el browser,
ver [2026-09-01-webapp-fase2-client-signing-design.md](2026-09-01-webapp-fase2-client-signing-design.md),
ahora superseded) se descartó: una wallet no-custodial solo firma con el
navegador abierto, y el auto-trader de Krypt PolyBot (scanners, whale
tracker, 15-min crypto) dispara órdenes sin usuario presente — el
producto entero depende de eso (ver README, sección "What it does").

Decisión (brainstorming de esta sesión): mantener el modelo no-custodial
pero delegar autoridad de firma a una **session key** con tope de gasto,
contrato permitido y expiración **exigidos por el contrato**, no solo por
software. Eso descarta Safe+Zodiac Allowance Module (gobierna
transferencias directas de tokens, no extiende `isValidSignature` — no
sirve para delegar quién puede producir una firma EIP-712 de orden válida
para Polymarket) y apunta a **ERC-4337 con un smart account que soporte
session-keys de verdad**: Kernel (ZeroDev), con `validateUserOp` stateful
capaz de decrementar un tope on-chain en cada operación — algo que un
ERC-1271 `view` normal no puede hacer.

**Decisiones de infra tomadas:**
- Smart account: **Kernel (ZeroDev)**, con su plugin de session-keys.
- Bundler: **self-hosted** (no el hosteado de ZeroDev/Pimlico).
- Paymaster: **propio**, la app patrocina el gas (usuario deposita solo
  USDC, no MATIC).
- Chain: Polygon mainnet, `chainId=137` (mismo que ya usa
  `python/polymarket_auth.py`).
- Ante Polymarket, la Kernel account opera como **maker** con
  `signatureType=POLY_1271` (contract wallet) — mismo signatureType que
  el modo "deposit wallet" que el código desktop ya soporta hoy
  (`SIGNATURE_TYPE_POLY_1271 = 3` en `polymarket_auth.py`).

## Decomposición (roadmap de Fase 2, referencia — solo 2a se detalla acá)

1. **Fase 2a (este spec)** — deploy + funding de la Kernel account,
   bundler y paymaster propios funcionando end-to-end, sin session-keys
   todavía. Cada UserOp lo firma el owner (usuario) en vivo. Prueba la
   plomería de infra antes de meter la pieza difícil.
2. **Fase 2b** (futura, spec propio) — emisión de session-key (política:
   tope de gasto, contrato permitido = Polymarket Exchange, expiración)
   vía una única firma del owner; `python/service.py` usa esa key para
   firmar y mandar órdenes sin usuario presente; revocación on-chain.
3. **Fase 2c** (futura, spec propio) — rotación de session-key,
   monitoreo/alertas de uso, kill-switch existente conectado a revocar
   on-chain (no solo pausar localmente).

## Diseño (Fase 2a)

### Arquitectura

```
Browser (webserver/static/signer.html, extiende el harness de Fase 1/2)
  │ 1. connect wallet (owner EOA) — reusa SIWE de Fase 1
  │ 2. GET /aa/account → gateway calcula la Kernel account address
  │    (CREATE2 counterfactual — determinista, sin gas todavía)
  │ 3. usuario transfiere USDC a esa address (tx normal desde su wallet,
  │    no necesita nada nuestro para esto)
  │ 4. [smoke test] POST /aa/test-userop → gateway arma un UserOp trivial
  │    (ej. transfer de vuelta una fracción a sí mismo), usuario lo firma
  │    (eth_signTypedData_v4 sobre el hash del UserOp), browser lo manda
  │    de vuelta
  ▼
webserver/aa.py (nuevo) — calcula address, arma UserOps, habla con
  bundler propio; NO tiene ni ve ninguna private key de usuario
  ▼
Bundler propio (self-hosted — Alto, OSS de Pimlico) ──> EntryPoint (Polygon)
Paymaster propio (nuevo servicio) — valida policy (solo nuestras Kernel
  accounts, tope de gas diario propio) y firma paymasterAndData
  ▼
Kernel smart account del usuario — se deploya en la primera UserOp real
```

### Componentes nuevos

- **`webserver/aa.py`** — `compute_account_address(owner) -> str`
  (CREATE2 determinista vía Kernel factory, sin llamada on-chain),
  `build_user_op(account, calls) -> dict` (UserOp sin firmar),
  `submit_user_op(signed_user_op) -> str` (manda al bundler, devuelve
  hash), `get_user_op_status(hash) -> dict` (polling).
- **`webserver/main.py`** — rutas nuevas, detrás de la sesión SIWE:
  `GET /aa/account`, `POST /aa/test-userop/build`,
  `POST /aa/test-userop/submit`, `GET /aa/test-userop/{hash}/status`.
- **`infra/bundler/`** (nuevo, fuera de `webserver/` — es un proceso
  separado) — Alto (bundler OSS de Pimlico) configurado contra un RPC de
  Polygon y el EntryPoint de Kernel. Documentar cómo correrlo
  (Docker o binario) y qué variables de entorno necesita.
- **`infra/paymaster/`** (nuevo, proceso separado) — servicio mínimo:
  recibe un UserOp candidato, valida que el `sender` sea una Kernel
  account nuestra (registro que llevamos en la DB del gateway) y que no
  se pase de un tope de gas diario propio, firma `paymasterAndData` con
  una key financiada (MATIC/USDC) que nosotros operamos.
- **`webserver/static/signer.html`** — se extiende: mostrar address
  counterfactual + instrucciones de depósito + botón de smoke-test UserOp.

### Fuera de alcance en 2a (explícito)

- **Sin session-keys.** Cada UserOp lo firma el owner en vivo — esta
  fase no resuelve auto-trading desatendido, solo prueba que la infra
  (bundler+paymaster+Kernel account+funding) funciona de punta a punta.
  Eso es Fase 2b.
- **Sin integración con `python/service.py` ni con Polymarket.** El
  smoke-test UserOp es una operación trivial (ej. mover una fracción de
  USDC de vuelta al owner), no coloca órdenes.
- **Sin migración de usuarios desktop.** Esto es exclusivo del camino
  webapp; Electron sigue con su flujo de key local sin tocar.

### Manejo de errores

- Bundler rechaza el UserOp (simulation revert) → gateway devuelve el
  motivo crudo del bundler al browser, no lo enmascara.
- Paymaster rechaza patrocinar (sender no registrado, o tope de gas
  diario excedido) → 402/403 explícito antes de intentar el bundler.
- Cuenta sin fondos suficientes (si algún día un UserOp no está
  patrocinado del todo) → error claro, no reintento silencioso.
- Bundler/paymaster caídos (son procesos propios que operamos) → el
  gateway lo reporta como 503, no como error de firma del usuario —
  distinción importante para no confundir al usuario con un problema de
  infra nuestra.

### Testing

- Unit: `compute_account_address` determinista — mismo owner produce
  siempre la misma address (test contra un valor conocido/fixture, no
  contra la red real).
- Integración contra una red de prueba de Polygon (Amoy testnet) con
  bundler+paymaster propios apuntando ahí — deploy real de una Kernel
  account, depósito con un faucet, smoke-test UserOp de punta a punta.
  Esto sí tiene testnet disponible (a diferencia del CLOB de Polymarket,
  que no lo tiene) — usarla en vez de mainnet para todo lo que sea
  puramente infra de cuenta/bundler/paymaster.
- Manual E2E en mainnet (dinero real, mínimo): un solo smoke-test con
  fondos de prueba pequeños, confirmación explícita del usuario antes de
  correrlo — igual que el resto del proyecto, no se automatiza en CI.

## Archivos críticos

- Nuevo: `webserver/aa.py`, `infra/bundler/`, `infra/paymaster/`
- Modificar: `webserver/main.py`, `webserver/static/signer.html`
- Referencia: Kernel (ZeroDev) docs de counterfactual deployment y
  formato de UserOp; Alto (Pimlico) para el bundler self-hosted; ERC-4337
  spec (`EntryPoint`, `UserOperation`) como contrato de referencia.
- Sin cambios: todo `python/`, flujo Electron completo, Fase 1
  (`webserver/auth.py`, `webserver/supervisor.py`) — 2a solo agrega
  rutas/módulos nuevos en `webserver/main.py`, no toca lo existente.

# Webapp Fase 2: Custodia no-custodial — firma client-side (EIP-712)

## Contexto

Fase 1 (completa, committeada) dio un `webserver/` FastAPI gateway con auth
SIWE y un `Supervisor` que spawnea un `python/service.py` por wallet
autenticada, aislado por `KRYPT_POLYBOT_USERDATA`. Ningún método de
trading/credenciales funciona todavía — el gateway los rechaza con "Fase 2".

Fase 2 habilita colocar y cancelar órdenes reales en el CLOB de Polymarket
sin que el servidor toque nunca la clave privada del usuario. El modelo
acordado: el navegador conecta la wallet del usuario (injected provider o
WalletConnect v2), firma localmente (EIP-712), y el servidor solo relaya
la firma ya hecha. Decisión previa (spec de Fase 1, sección "Decisiones ya
tomadas"): custodia no-custodial, firma client-side, servidor nunca guarda
claves privadas de trading.

**Spec padre (roadmap completo):**
`C:\Users\Admin\.claude\plans\emplea-superpoews-vamos-a-federated-cloud.md`

**Decisiones tomadas en brainstorming de este plan:**
1. Harness de prueba: página HTML/JS mínima servida por el gateway
   (`webserver/static/signer.html`), no se espera a Fase 3 (React) para
   verificar el flujo end-to-end.
2. Tipos de firma soportados: EOA directa (signatureType=0) **y**
   proxy/deposit wallet (POLY_1271) — paridad con lo que ya soporta el
   flujo desktop/Electron hoy.
3. Relay de orden firmada: el browser manda la orden firmada al gateway;
   el gateway/worker la reenvía al CLOB (no se llama a Polymarket
   directo desde el navegador).
4. Wallet connect: WalletConnect v2 completo (además de injected
   provider), para soportar wallets móviles vía QR.

## Diseño

### Arquitectura

```
Browser (webserver/static/signer.html + signer.js)
  │ 1. connect wallet (window.ethereum o WalletConnect v2) → address
  │ 2. SIWE login (Fase 1, sin cambios) → session cookie
  │ 3. WS /ws (Fase 1, sin cambios)
  │
  │ 4. si el worker no tiene API creds de Polymarket derivadas:
  │      GET  /wallet/l1-challenge          → typed-data ClobAuth (EIP-712)
  │      [browser firma con eth_signTypedData_v4]
  │      POST /wallet/l1-verify {signature} → gateway → worker RPC deriveApiCreds()
  │
  │ 5. colocar orden:
  │      GET  /wallet/order-challenge?ticker&side&price&size
  │           → worker resuelve token_id/tick/min_size (igual que hoy
  │             place_limit_order), arma salt+timestamp+maker/takerAmount,
  │             devuelve typed-data Order (variante EOA o POLY_1271 según
  │             el signatureType configurado para ese usuario)
  │      [browser firma con eth_signTypedData_v4]
  │      POST /wallet/order-submit {signature, dryRun?}
  │           → gateway → worker RPC submitSignedOrder()
  ▼
FastAPI gateway (webserver/) — solo relay + sesión SIWE, nunca ve private key
  ▼
python/service.py worker (por-usuario, Fase 1) — RPC nuevos:
  deriveApiCreds, submitSignedOrder
  │ arma headers L1 (con la firma que llegó del browser) y L2 (HMAC con
  │ el api secret ya derivado, sin private key)
  ▼
Polymarket CLOB API — POST /auth/api-key, POST /order (sin cambios)
```

**Principio de mínimo cambio:** todo lo que hoy hace `polymarket_auth.py`
con la private key local (`_load_private_key`, `_eip712_sign`,
`create_signed_order`, `_create_signed_order_1271`) se reemplaza, **solo
en el camino webapp**, por un ciclo challenge (worker arma typed-data) →
sign (browser) → submit (worker usa la firma ya hecha). Toda la
validación de mercado (tick size, min_size, risk checks) y la llamada
HTTP a Polymarket se reusan de `polymarket_api.py::place_limit_order` sin
cambios de lógica — solo se le inyecta el paso de firma ya resuelto en
vez de llamarlo internamente. El flujo Electron/desktop con clave local
cifrada en disco **no se toca ni se borra** (referencia/fallback, como ya
establece el spec de Fase 1).

### El detalle crítico: signatureType POLY_1271

El modo `POLY_1271` (deposit/proxy wallet) en `py_clob_client_v2` **no**
es un `eth_signTypedData_v4` plano sobre el struct `Order`. Es un wrapper
estilo Solady "TypedDataSign": el hash final combina el hash del struct
`Order` con un domain separator `DepositWallet`/`"1"`, calculado a mano
(`abi_encode` + `keccak`) y firmado con `Account._sign_hash` (firma cruda
sobre un digest, no un `eth_signTypedData_v4` normal) —
ver `python/.venv/Lib/site-packages/py_clob_client_v2/order_utils/exchange_order_builder_v2.py`,
función `_build_poly_1271_order_signature`.

Para que una wallet estándar (MetaMask, WalletConnect) pueda producir la
misma firma sin un método RPC custom, el challenge que el servidor manda
al browser para el modo POLY_1271 debe ser el JSON EIP-712 anidado
completo — `primaryType: "TypedDataSign"`, con el struct `Order` como
subcampo `contents` y domain `{name: "DepositWallet", version: "1",
chainId, verifyingContract: signer, salt: 0x00...}` — de forma que
`eth_signTypedData_v4` estándar, aplicado a ese JSON, produzca el digest
idéntico al que calcula `_build_poly_1271_order_signature`. Esto se debe
verificar con un test cruzado (ver sección Testing) antes de dar por
buena la implementación — es la pieza de mayor riesgo técnico del plan.

Modo EOA (signatureType=0) es el caso simple: el challenge es el struct
`Order` bajo el domain `CTF_EXCHANGE_V2` tal cual, firmado directo.

### Componentes nuevos/modificados

- **`webserver/wallet.py`** (nuevo) — construye los typed-data de
  challenge: `build_l1_challenge(address) -> dict`,
  `build_order_challenge(order_data, signature_type) -> dict` (ambas
  variantes EOA/POLY_1271). No toca clave privada — solo arma JSON.
- **`webserver/main.py`** — 4 rutas nuevas, todas detrás de la cookie de
  sesión SIWE ya existente (igual que `/ws`):
  - `GET /wallet/l1-challenge` → `{typedData}`
  - `POST /wallet/l1-verify` `{signature}` → relay a worker
    `deriveApiCreds`, responde `{ok: true}` o 400 con el error del worker
  - `GET /wallet/order-challenge?ticker&side&action&count&price_cents` →
    `{typedData, orderId}` (orderId correlaciona con el submit)
  - `POST /wallet/order-submit` `{orderId, signature, dryRun}` → relay a
    worker `submitSignedOrder`
- **`python/polymarket_auth.py`** — funciones nuevas, sin tocar las
  existentes (desktop las sigue usando):
  - `set_derived_api_creds(wallet_address, api_key, secret, passphrase)`
    — persiste igual que `_api_creds_file` hoy, pero recibido en vez de
    derivado localmente.
  - `build_order_typed_data(token_id, side, price, size, neg_risk,
    signature_type) -> dict` — arma el mismo dict que hoy arma
    `ExchangeOrderBuilderV2.build_order_typed_data`, pero para exportarlo
    al browser en vez de firmarlo localmente.
  - `finalize_signed_order(typed_data, signature) -> dict` — arma el
    dict final de orden (mismo shape que `create_signed_order` devuelve
    hoy) a partir del typed-data + la firma ya hecha, sin llamar
    `_eip712_sign`.
- **`python/service.py`** — 2 handlers RPC nuevos:
  - `_h_deriveApiCreds(signature, timestamp, nonce)` — arma headers L1
    con la firma recibida (mismo shape que `l1_headers()` hoy, pero con
    firma externa), llama al endpoint de derivación de api-key de
    Polymarket, guarda el resultado vía `set_derived_api_creds`.
  - `_h_submitSignedOrder(orderId, signature, dryRun)` — resuelve el
    typed-data pendiente por `orderId`, llama `finalize_signed_order`,
    si `dryRun` es true valida forma/digest y responde sin llamar a
    Polymarket; si no, sigue el mismo camino que
    `place_limit_order` a partir del paso `POST /order`.
  - Los métodos ya bloqueados en Fase 1 (`cancelAllOpen`, `flatten`,
    `testCredentials`) se desbloquean — solo requieren L2 (api secret ya
    derivado), no firma por-orden.
  - `setCredentials` / `clearCredentials` (flujo de key local cifrada en
    disco) **siguen bloqueados** en el camino webapp — ese flujo es
    exclusivamente Electron/desktop; el webapp solo usa
    `deriveApiCreds`/`submitSignedOrder`.
- **`webserver/static/signer.html` + `signer.js`** (nuevo) — harness
  vanilla JS, ES modules importados desde CDN (ethers v6 +
  `@walletconnect/ethereum-provider`), sin build step. Sirve de
  verificación E2E real (equivalente browser del `manual_client.py` de
  Fase 1) y de base reusable para Fase 3.

### Persistencia de credenciales derivadas

Las api creds derivadas (apiKey/secret/passphrase) **no son la clave
privada** — son un secreto de alcance API, análogo a lo que hoy guarda
`_api_creds_file()`. Se persisten cifradas en el mismo directorio
`KRYPT_POLYBOT_USERDATA` del worker (aislamiento por-usuario ya dado por
Fase 1, sin mecanismo nuevo de storage).

### Manejo de errores

- Challenge sin sesión válida → 401 (igual que `/ws` hoy).
- Firma inválida en `/wallet/l1-verify` o `/order-submit` → 400 con
  mensaje claro; el worker no reintenta solo.
- `submitSignedOrder` sin api creds derivadas aún → error explícito
  "derive API creds first" (no crashea el worker).
- Address de la firma recibida ≠ wallet de la sesión SIWE → rechazado
  (evita que un usuario firme órdenes a nombre de otro).
- `orderId` de un `order-challenge` vencido/desconocido en el submit →
  400, el worker no reintenta con datos viejos (salt/timestamp deben
  corresponder al challenge exacto que se firmó).
- Salt y timestamp los genera el worker (server-side, mismo mecanismo
  que ya usa `generate_order_salt`/`time.time_ns` hoy); el browser solo
  firma lo que se le entrega — evita inconsistencia de digest.

### Fuera de alcance en Fase 2 (explícito)

- No se toca `src/` (React) — el harness HTML es standalone, vive en
  `webserver/static/`, no reemplaza ni anticipa Fase 3.
- No se borra el flujo Electron/desktop con clave local cifrada
  (`_load_private_key`, `setCredentials`) — sigue disponible sin cambios.
- No se agrega sandboxing de scripts de usuario — eso es Fase 5.
- No hay entorno sandbox conocido del CLOB de Polymarket — probar
  `order-submit` sin `dryRun` implica dinero real (ver Testing).

## Testing

- **Cross-check de firma (crítico, cubre el riesgo del wrapper
  POLY_1271):** tests en `webserver/tests/` que, para ambos
  signatureType, arman el mismo typed-data que expone
  `build_order_typed_data`, lo firman con `eth_account` localmente
  (simulando lo que haría `eth_signTypedData_v4` en un browser real), y
  verifican que `finalize_signed_order` produce exactamente el mismo
  dict/signature que `ExchangeOrderBuilderV2.build_signed_order` produce
  hoy para el mismo input determinístico (mismo salt/timestamp fijados
  en el test).
- **Flujo SIWE + challenge/response:** tests de `/wallet/l1-challenge` →
  firma → `/wallet/l1-verify`, y `/wallet/order-challenge` → firma →
  `/wallet/order-submit` con `dryRun=true`, sobre el `dummy_worker.py`
  extendido con los 2 métodos nuevos (mismo patrón que Fase 1).
- **Aislamiento:** dos usuarios derivando api creds en paralelo no se
  cruzan (mismo patrón de test que Fase 1 para DBs separadas).
- **Manual E2E (dinero real, riesgo explícito):** abrir
  `webserver/static/signer.html`, conectar una wallet de test con fondos
  mínimos en Polygon mainnet (no existe sandbox conocido del CLOB),
  colocar una orden pequeña con `dryRun=false`, confirmar que aparece en
  Polymarket. Este paso requiere confirmación explícita del usuario antes
  de ejecutarse — no se automatiza en CI.

## Archivos críticos

- Nuevo: `webserver/wallet.py`, `webserver/static/signer.html`,
  `webserver/static/signer.js`
- Modificar: `webserver/main.py`, `python/service.py`,
  `python/polymarket_auth.py` (solo funciones nuevas, no se tocan las
  existentes)
- Referencia (schema EIP-712 exacto a replicar):
  `python/.venv/Lib/site-packages/py_clob_client_v2/order_utils/exchange_order_builder_v2.py`,
  `.../model/ctf_exchange_v2_typed_data.py`
- Sin cambios: `python/polymarket_api.py` (validación de mercado
  reusada tal cual), flujo Electron completo

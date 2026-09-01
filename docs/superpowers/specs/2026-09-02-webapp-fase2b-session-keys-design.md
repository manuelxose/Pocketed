# Webapp Fase 2b: Session keys — trading desatendido sin custodia

## Contexto

Fase 1 (completa) dio auth SIWE + worker por-usuario. Fase 2a (completa,
ver [2026-09-01-webapp-fase2a-aa-smart-account-infra-design.md](2026-09-01-webapp-fase2a-aa-smart-account-infra-design.md))
dio la infra de smart account (Kernel/ZeroDev + bundler propio + paymaster
propio) funcionando end-to-end, sin session-keys — cada UserOp lo firma el
owner en vivo, lo cual no resuelve el problema central: el auto-trader de
Krypt PolyBot (scanners, whale tracker, 15-min crypto) dispara órdenes sin
usuario presente, y una wallet no-custodial solo puede firmar con el
navegador abierto.

Fase 2b cierra ese hueco: delega autoridad de firma de órdenes a una
**session key** efímera, con política de contrato-permitido y expiración
**exigidos por el contrato** (Kernel permission-validator), vía una única
firma del owner. `python/service.py` usa esa key para firmar y mandar
órdenes reales al CLOB de Polymarket sin usuario presente.

**Spec padre (roadmap completo):**
`C:\Users\Admin\.claude\plans\emplea-superpoews-vamos-a-federated-cloud.md`

**Precedente descartado:** el primer intento de Fase 2 (firma EIP-712
directa desde el browser por-orden, ver
[2026-09-01-webapp-fase2-client-signing-design.md](2026-09-01-webapp-fase2-client-signing-design.md))
está marcado SUPERSEDIDO en su propio doc — no resuelve trading
desatendido. Este spec es su reemplazo real (vía 2a + 2b), no una
continuación de aquel.

## Decisión de arquitectura (spike previo a este spec)

Pregunta abierta antes de diseñar: ¿el session-key validator de Kernel
(ZeroDev) puede producir una firma EIP-1271 válida para el digest de una
orden Polymarket arbitraria (no un UserOp), bajo policy de contrato
permitido + expiración? Se investigó contra el código fuente instalado de
`@zerodev/sdk` (`createKernelAccount.js`, método `signMessage`/
`signTypedData` — delega al validator plugin activo, sea root/ECDSA o un
permission-validator, ver línea 383 de ese archivo) y la doc de ZeroDev
(`toSignatureCallerPolicy`, `docs.zerodev.app/sdk/permissions/policies/signature`).

**Resultado: sí funciona**, con un hallazgo importante:

- **Contrato permitido** → `toSignatureCallerPolicy({allowedCallers:
  [CTF_EXCHANGE_V2_ADDRESS]})`. Restringe quién puede llamar
  `isValidSignature` en la cuenta Kernel — el CTF Exchange es
  `msg.sender` en ese call durante la verificación de una orden (flujo
  ERC-1271 estándar), así que esta policy sí ata la session key a "solo
  sirve para que Polymarket Exchange valide esta firma" — **contract-
  enforced**.
- **Expiración** → `validAfter`/`validUntil` nativo del
  permission-validator — **contract-enforced**.
- **Tope de gasto (hallazgo, gap frente al plan original de 2a):** no
  existe policy estándar de ZeroDev que limite el monto USD de una orden
  firmada off-chain — `GasPolicy`/`CallPolicy` solo aplican al camino de
  ejecución de UserOp (on-chain), que no es el camino de una orden
  Polymarket (firma off-chain, sin ejecución on-chain del Kernel). El cap
  de gasto para Fase 2b **solo puede ser software-enforced** (en
  `python/service.py`), no contract-enforced. Se acepta esta limitación
  explícitamente — la revocación on-chain (2c) y la expiración
  contract-enforced siguen cubriendo el peor caso (session key
  comprometida/filtrada).

## Diseño

### Decisión: dónde vive la session key y quién firma la orden

Tres approaches evaluados:

- **A. aa-service como oráculo de firma** — key en Node
  (`aa-service`), el worker llama HTTP por-orden. Simple, pero acopla el
  camino de trading a la disponibilidad de `aa-service` — contradice el
  principio de reliability del proyecto (ver README: reconciliación de
  arranque, firma idempotente — el auto-trader no debe pararse porque un
  proceso propio esté caído).
- **B. Worker firma local (elegida)** — key efímera generada y guardada
  en `python/service.py`, cifrada con el mismo mecanismo que ya usa
  `polymarket_auth.py` para la wallet key local
  (Fernet/DPAPI/keyring, `KRYPT_POLYBOT_USERDATA` por-usuario). El worker
  replica en Python el wrap EIP-712 de Kernel y el encoding de firma del
  permission-validator, firma con `eth_account` localmente, y arma la
  orden `POLY_1271` igual que hoy hace para deposit-wallet. `aa-service`
  solo interviene en el cómputo del address Kernel (ya existe, 2a) — el
  camino de trading no depende de `aa-service`/bundler estar vivos.
- **C. Híbrido (endpoint sign-hash genérico en aa-service)** — reduce
  acoplamiento de protocolo pero no de disponibilidad; descartado por la
  misma razón que A.

**Elegida: B.** Consistente con el principio de mínimo cambio ya usado en
el spec de Fase 2 original (reusar `build_order_typed_data`/
`finalize_signed_order`, solo cambia quién produce la firma) y con el
requisito de que el auto-trader nunca pare por infra propia caída.

### Arquitectura

```
Browser (webserver/static/signer.html, extiende harness de 2a)
  │ 1. GET /aa/account → address Kernel (ya existe, 2a)
  │ 2. usuario deposita USDC (ya existe, 2a)
  │ 3. POST /session-key/init
  │      → gateway → worker genera keypair de session key (efímera)
  │      → responde {sessionKeyAddress, enableTypedData}
  │        (typed-data EIP-712 "enable" del permission-validator de
  │        Kernel: autoriza ese signer + policy [allowedCaller=
  │        CTF_EXCHANGE_V2, validUntil, dailyUsdCap])
  │      [browser firma con eth_signTypedData_v4 — única firma del owner]
  │ 4. POST /session-key/activate {signature}
  │      → gateway → worker guarda enableSignature + policy junto a la
  │        session key (mismo storage cifrado por-usuario de hoy)
  ▼
FastAPI gateway (webserver/) — solo relay + sesión SIWE, nunca ve la
  session key ni la enableSignature en claro más de lo necesario para
  el relay
  ▼
python/service.py worker (por-usuario) — RPC nuevos:
  mintSessionKey, activateSessionKey, revokeSessionKey
  │
  │ orden disparada por scanner/whale-tracker (sin usuario presente):
  │   1. build_order_typed_data() — ya existe (Fase 2 original, sin
  │      cambios de lógica)
  │   2. session_key.sign_order_as_session_key(typed_data, session_key):
  │      wrap Kernel (equivalente Python de eip712WrapHash) + encoding
  │      de firma permission-validator (sessionKeyAddr + policyId +
  │      validUntil + firma ECDSA cruda sobre el digest ya wrapeado)
  │   3. la key se descifra en memoria solo durante la firma, igual que
  │      _load_private_key hoy — nunca se persiste en claro
  │   4. finalize_signed_order() → POST /order al CLOB,
  │      signatureType=POLY_1271, maker=address Kernel — sin llamar a
  │      aa-service
  ▼
Polymarket CLOB API — sin cambios
```

### Componentes nuevos/modificados

- **`python/session_key.py`** (nuevo):
  - `generate_session_key() -> (address: str, encrypted_privkey: bytes)`
  - `build_enable_typed_data(kernel_addr, session_key_addr, policy: dict) -> dict`
    — arma el typed-data EIP-712 que el owner firma una sola vez.
  - `store_session_key(wallet_address, address, encrypted_privkey, policy, enable_signature, env=NETWORK) -> None`
    — persiste vía `_atomic_write_600`, reusando `_fernet`/`_dpapi_encrypt`/
    `_keyring_encrypt` de `polymarket_auth.py` (mismo mecanismo de
    cifrado, archivo nuevo junto a `_wallet_key_file`).
  - `load_active_session_key(env=NETWORK) -> Optional[dict]` — `None` si
    no hay session key activa o si venció (`validUntil` local, chequeo
    software además del contract-enforced).
  - `sign_order_as_session_key(typed_data: dict, session_key: dict) -> str`
    — implementa el wrap Kernel + encoding permission-validator; devuelve
    la firma final en el formato que espera `finalize_signed_order`.
  - `revoke_session_key_soft(env=NETWORK) -> None` — marca inactiva
    localmente (kill-switch), no toca on-chain (eso es Fase 2c).
- **`python/polymarket_auth.py`** — sin cambios a funciones existentes;
  reusa `SIGNATURE_TYPE_POLY_1271`, `build_order_typed_data`,
  `finalize_signed_order` (ya definidas en el spec de Fase 2 original).
- **`webserver/main.py`** — rutas nuevas detrás de la sesión SIWE:
  - `POST /session-key/init` → `{sessionKeyAddress, enableTypedData}`
  - `POST /session-key/activate` `{signature}` → relay a worker
    `activateSessionKey`, `{ok: true}` o 400
  - `POST /session-key/revoke` → relay a worker `revokeSessionKey`
    (revocación blanda/local; ver Fuera de alcance)
- **`python/service.py`** — RPC nuevos `_h_mintSessionKey`,
  `_h_activateSessionKey`, `_h_revokeSessionKey`; el path de
  `_h_submitSignedOrder` (ya definido en Fase 2 original) pasa a usar
  `session_key.sign_order_as_session_key` cuando hay session key activa,
  en vez de rechazar con "Fase 2".
- **`webserver/static/signer.html`** — se extiende: botón "activar
  auto-trading" que dispara init→firma→activate, muestra estado de la
  session key (activa/vencida/revocada) y el `dailyUsdCap` configurado.
- **`aa-service`** — sin cambios de responsabilidad; solo se sigue
  usando `GET /account/:owner` (ya existe, 2a) para calcular el address
  Kernel al que apunta el `enableTypedData`.

### Cap de gasto (software-enforced, ver hallazgo del spike)

`policy.dailyUsdCap` se guarda junto a la session key. Antes de firmar,
`_h_submitSignedOrder` suma el notional de la orden a un contador
por-día-UTC en la misma DB por-usuario que ya usan los loss-guards; si se
excede, rechaza antes de firmar (mismo patrón que
`test_funding_floor`/loss-guards: rechazo limpio, no se trata como error
de Polymarket).

### Revocación

- **Blanda (esta fase):** `revoke_session_key_soft` marca la key inactiva
  en storage local — deja de firmar órdenes nuevas de inmediato. Es el
  mismo comportamiento que ya tiene el kill-switch existente del
  proyecto, aplicado a la session key.
- **Dura/on-chain (Fase 2c, explícitamente fuera de este spec):**
  desinstalar el permission-validator o invalidar el policy-id vía un
  UserOp firmado en vivo por el owner (reusa `/aa/test-userop/build|submit`
  de 2a como base). No se implementa acá — la expiración `validUntil`
  (contract-enforced) y la revocación blanda ya cubren el caso de uso
  normal; la revocación dura cubre el caso de key comprometida y merece su
  propio diseño (reintentos si el bundler está caído, alertas — ver
  spec de 2a, sección "Decomposición").

### Manejo de errores

- Session key nunca activada → `_h_submitSignedOrder` responde error
  explícito "session key not active", no intenta firmar con nada.
- `dailyUsdCap` excedido → rechazo antes de firmar, no dispara ni loggea
  como fallo de Polymarket.
- Firma de `/session-key/activate` inválida o de address distinto al
  owner de la sesión SIWE → 400.
- `sign_order_as_session_key` con digest mal formado (bug de wrap) →
  error explícito, nunca se manda al CLOB una firma no verificada por el
  cross-check test (ver Testing) — la implementación de este wrap se
  considera no confiable hasta que ese test pase.
- Session key vencida (`validUntil` pasado, chequeo local) →
  mismo error que "not active", no se intenta firmar (evita depender
  solo del rechazo on-chain del CLOB, que igual pasaría).

### Fuera de alcance en 2b (explícito)

- **Revocación on-chain real** — Fase 2c (ver arriba).
- **Rotación de session-key, monitoreo/alertas de uso** — Fase 2c.
- **Cap de gasto contract-enforced** — no existe mecanismo estándar de
  ZeroDev para esto en el camino de firma off-chain (ver hallazgo del
  spike); si en el futuro se necesita, requiere un policy/validator
  custom — spec propio.
- **No se toca `aa-service`** más allá de seguir usando `/account/:owner`
  ya existente.
- **No se toca el flujo Electron/desktop** con clave local cifrada.
- **No se toca `src/` (React)** — Fase 3, sin relación con este spec.

## Testing

- **Cross-check crítico (cubre el riesgo validado en el spike):** test
  en `python/tests/` que arma el mismo order typed-data
  (`build_order_typed_data`), computa a mano en el test el wrap Kernel +
  encoding permission-validator (valores fijos determinísticos: mismo
  salt/timestamp/policy-id), firma con `eth_account` localmente, y
  compara contra lo que devuelve `session_key.sign_order_as_session_key`
  para el mismo input. Sin este test no se puede confiar en que el CLOB
  vaya a aceptar la firma real.
- **Flujo init→activate:** test de `/session-key/init` → firma →
  `/session-key/activate`, sobre `dummy_worker.py` extendido con los 3
  RPC nuevos (mismo patrón que Fase 1/2a).
- **Cap de gasto:** test que confirma que una orden que excede
  `dailyUsdCap` se rechaza antes de firmar, y que el contador resetea
  por día UTC (mismo patrón que `test_db_maintenance`/loss-guards).
- **Expiración:** test que confirma que una session key con
  `validUntil` vencido no firma, sin necesidad de llamada de red.
- **Aislamiento:** dos usuarios con session keys en paralelo no se
  cruzan (mismo patrón ya usado en Fase 1/2).
- **Manual E2E (dinero real, riesgo explícito):** activar session key en
  `signer.html`, dejar que el scanner/whale-tracker dispare una orden
  real sin usuario presente, confirmar que aparece en Polymarket. Este
  paso requiere confirmación explícita del usuario antes de ejecutarse —
  no se automatiza en CI (mismo criterio que Fase 2/2a).

## Archivos críticos

- Nuevo: `python/session_key.py`
- Modificar: `webserver/main.py`, `python/service.py`,
  `webserver/static/signer.html`
- Reusado sin cambios: `python/polymarket_auth.py`
  (`build_order_typed_data`, `finalize_signed_order`,
  `SIGNATURE_TYPE_POLY_1271`), `webserver/aa.py` /
  `aa-service` (`GET /account/:owner`)
- Referencia (wrap EIP-712 de Kernel a replicar en Python):
  `aa-service/node_modules/@zerodev/sdk/_cjs/accounts/kernel/utils/common/eip712WrapHash.js`,
  `aa-service/node_modules/@zerodev/sdk/_cjs/accounts/kernel/createKernelAccount.js`
  (método `signMessage`, línea ~383)
- Referencia (policies ZeroDev): `docs.zerodev.app/sdk/permissions/policies/signature`
  (`toSignatureCallerPolicy`), `docs.zerodev.app/sdk/permissions/intro`
  (`toPermissionValidator`, `validAfter`/`validUntil`)
- Sin cambios: `python/polymarket_api.py`, flujo Electron completo,
  `aa-service/src/*` (sin nuevas responsabilidades)

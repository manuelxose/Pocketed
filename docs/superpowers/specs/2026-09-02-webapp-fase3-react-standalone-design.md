# Webapp Fase 3: migrar `src/` (React) de Electron renderer a webapp standalone

**Spec padre (roadmap completo):**
`C:\Users\Admin\.claude\plans\emplea-superpoews-vamos-a-federated-cloud.md`

## Contexto

Fase 1 dio `webserver/` (FastAPI gateway, auth SIWE, supervisor por-usuario,
proxy JSON-RPC sobre WS). Fase 2/2a/2b dieron custodia no-custodial vía
account abstraction (ERC-4337 + Kernel + session-keys), con un harness HTML
standalone (`webserver/static/signer.html`) para probar el flujo sin
esperar a React.

`src/` (React) sigue siendo hoy el renderer de una app Electron: habla con
el backend vía `window.krypt.*`, expuesto por `electron/preload.ts`
(contextBridge) sobre IPC hacia `electron/main.ts`, que spawnea
`python/service.py` localmente (`electron/system/python-backend.ts`).

Fase 3 reemplaza esa capa de transporte y quita Electron: `src/` pasa a
correr en cualquier browser, servido como estático por `webserver/`, y
habla con el backend por WebSocket + REST contra el gateway ya existente.

## Alcance

- **Migración completa a webapp standalone.** Electron se elimina del todo
  (no queda como shell opcional/doble-target).
- Reusa el auth SIWE + WS del gateway de Fase 1 (nonce → firma → sesión →
  un WS por usuario) — no se inventa esquema nuevo.
- Features Electron-only sin equivalente web directo (tray icon, autostart
  al login, Discord RPC nativo, frameless title bar) se **dropean sin
  reemplazo** en esta fase. Quedan como regresión conocida, a revisar en
  Fase 4/5 si hace falta.
- El flujo de activación de session-key (`webserver/static/signer.html`,
  Fase 2b) se **migra a React**: páginas/componentes dentro de `src/`
  reemplazan el harness HTML standalone.
- Full rewrite del state layer: se agrega `@tanstack/react-query` como
  dependencia nueva. Las llamadas RPC pasan a ser queries/mutations; los
  push-events del WS invalidan/actualizan la cache de React Query en vez
  de alimentar un Context custom.

## Arquitectura

```
Browser (Vite build, servido como estático por webserver/)
   │  SIWE login (nonce → firma → verify) → session cookie
   │  un WS: /ws?session=... (mismo framing JSON-RPC que el proxy
   │  gateway↔worker de Fase 1)
   ▼
webserver/ (FastAPI gateway, sin cambios: auth, supervisor, rutas
            /session-key/*, /aa/*)
   ▼
python/service.py (worker, sin cambios en lógica de negocio)
```

Piezas nuevas en `src/`:
- `src/lib/ws-client.ts` — conexión WS única, JSON-RPC request/response
  por id + dispatch de push-events, reconexión con backoff.
- `src/lib/queryClient.ts` + `@tanstack/react-query` — las llamadas RPC se
  vuelven queries/mutations que internamente llaman
  `ws-client.request(method, params)`.
- `useWsEvent` — hook central (vive en el provider de WS) que escucha
  push-events (`position:update`, líneas de log, stats de scanner, ticks
  de precio) y los enruta a la cache de React Query
  (`queryClient.setQueryData` / `invalidateQueries`) — no hay árbol de
  estado paralelo.
- Páginas de session-key (mint/activate/revoke) — reemplazan
  `signer.html`, llaman a las rutas REST `/session-key/*` ya existentes +
  firma EIP-712 en el browser (wagmi/ethers), reusando como referencia el
  código de firma del harness de Fase 2b.
- `src/state/AuthGate.tsx` — gate de sesión: si no hay cookie válida,
  fuerza el flujo SIWE antes de montar el resto de la app.

Se elimina por completo: `electron/` (todo el directorio), configuración
de `electron-builder` y campos `main`/`dist-electron` en `package.json`,
dependencias `electron`, `electron-builder`, `vite-plugin-electron`,
`vite-plugin-electron-renderer`, y cualquier UI de tray/autostart/Discord
RPC nativo/title bar frameless dentro de `src/`.

## Data flow

1. Boot: `main.tsx` monta `AuthGate` → chequea cookie de sesión; si no
   hay, pantalla de login SIWE (connect wallet → `POST /auth/nonce` →
   firma → `POST /auth/verify`).
2. Post-auth: `WsProvider` abre el WS único, expone `ws-client` por
   contexto.
3. Cada página/componente usa un hook fino por llamada
   (`useAccountQuery()`, `usePositionsQuery()`,
   `useSetStrategyMutation()`, ...) — React Query envuelve
   `ws-client.request(method, params)`. Este es el rewrite de los 26
   archivos: cada `window.krypt.x.y(...)` pasa a ser una llamada a un
   hook de query/mutation.
4. Push-events del worker llegan por el mismo WS, tageados por nombre de
   evento; `useWsEvent` los escucha centralmente en `WsProvider` y llama
   `queryClient.setQueryData([...], ...)`, así los componentes
   re-renderizan vía las subscripciones normales de React Query.
5. Las páginas de session-key llaman REST (`fetch`) directo a
   `/session-key/init|activate|revoke` (acciones one-shot HTTP de Fase
   2b, no RPC por WS) más firma EIP-712 en browser antes de `/activate`.

## Error handling

- Caída del WS → `ws-client` reconecta con backoff (mismo patrón de
  crash-restart del worker de Fase 1); requests en vuelo rechazan con un
  error tipado `WsDisconnected`; React Query expone eso como estado
  `error` de la query → el `ToastProvider` ya existente lo muestra, igual
  que hoy con fallos de `window.krypt`.
- Reconexión exitosa → re-subscribe push-events, invalida todas las
  queries activas una vez (refetch barato) para que el estado no quede
  silenciosamente desactualizado.
- Expiración de sesión/cookie (401 en REST, o rechazo de auth en el WS) →
  redirect duro a login SIWE, sin retry silencioso.
- Respuestas de error RPC (`{error: ...}` del worker) → promise
  rechazada → se expone por `onError` de la query/mutation, misma
  granularidad por-call-site que hoy.

## Testing

- Unit: `ws-client` (matching request/response, reconexión/backoff,
  dispatch de eventos) con `WebSocket` mockeado.
- Unit: cada hook reescrito (mock de `ws-client`, assert de shape del
  request + actualización de cache en push-event).
- Integración: servidor WS de gateway falso + React Testing Library —
  login → connect → un round trip RPC → un push-event actualiza la UI
  renderizada.
- Páginas de session-key: reusar los patrones de test ya existentes de
  Fase 2b (flujo init→firma→activate), movidos de `dummy_worker.py`/curl
  a tests a nivel de componente contra las mismas rutas REST.
- Manual E2E: dos sesiones de browser (dos wallets de test), confirmar
  aislamiento; confirmar que quitar los builds Electron-only del CI/scripts
  no rompe otros jobs de CI.

## Archivos afectados

Nuevo:
- `src/lib/ws-client.ts`, `src/lib/queryClient.ts`
- `src/hooks/*` (hooks de query/mutation por dominio)
- Páginas/componentes de session-key (reemplazan `signer.html`)
- `src/state/AuthGate.tsx`, `WsProvider`

Reescritos (los 26 archivos que hoy llaman `window.krypt.*`):
```
src/components/BacktestPanel.tsx
src/components/Sidebar.tsx
src/components/TitleBar.tsx
src/components/WhyNotTrading.tsx
src/components/common.tsx
src/pages/About.tsx
src/pages/Accounts.tsx
src/pages/ApiKeys.tsx
src/pages/Backtest.tsx
src/pages/CopyTrading.tsx
src/pages/Crypto15m.tsx
src/pages/Dashboard.tsx
src/pages/Guide.tsx
src/pages/History.tsx
src/pages/Logs.tsx
src/pages/MainEngine.tsx
src/pages/Onboarding.tsx
src/pages/Positions.tsx
src/pages/Profiles.tsx
src/pages/Scripts.tsx
src/pages/Settings.tsx
src/pages/Terminal.tsx
src/pages/Visualizer.tsx
src/state/AppStateProvider.tsx
src/utils/polymarket.ts
src/utils/share.ts
```

Eliminados:
- `electron/` completo (`main.ts`, `preload.ts`, `ipc.ts`,
  `system/accounts.ts`, `system/autostart.ts`, `system/discord.ts`,
  `system/python-backend.ts`, `system/settings-store.ts`,
  `system/strategies.ts`, `system/tray.ts`)
- Config de `electron-builder`, campos `main`/`dist-electron` en
  `package.json`
- Dependencias `electron`, `electron-builder`, `vite-plugin-electron`,
  `vite-plugin-electron-renderer`
- UI de tray/autostart/Discord RPC nativo/title bar frameless en `src/`

Sin cambios: `webserver/`, `python/service.py`, rutas REST
`/session-key/*` y `/aa/*` ya existentes.

## Decisiones ya tomadas

- Migración completa a webapp standalone (no Electron híbrido).
- Reusa SIWE + WS del gateway de Fase 1, sin esquema nuevo.
- Features Electron-only sin equivalente web se dropean sin reemplazo
  esta fase (regresión conocida, revisar en Fase 4/5).
- `signer.html` se retira; su flujo se migra a React.
- Se agrega `@tanstack/react-query`; full rewrite del state layer sobre
  WS (no se mantiene el Context custom actual).

# Para retomar el proyecto — leer esto primero

Puerta de entrada para una sesión nueva (otra cuenta de Claude, otra persona). Actualizado al **2026-10-03**.

**El contexto completo del proyecto está en el otro repo: `neaserisgod/Nodo-Sur-Pos` → `CONTEXTO.md`.** Ahí está el
sistema entero (PC, celular y este sitio), cómo trabaja el dueño, cómo se publica y qué quedó pendiente. Este archivo
cubre lo propio del sitio. Los detalles de cada función del servidor están en `README.md`.

## Qué es este repo

**horsepos.com**: la web de Nodo Sur y el servidor del sistema POS. Cloudflare Worker con archivos estáticos
(`wrangler.jsonc`, worker `broad-frog-1e4b`), base D1 `nodosur`, bucket R2 para versiones y copias, y un Durable Object
(`SyncHub`) para avisar cambios en vivo. Se publica solo al mezclar a `main`.

- **Nodo Sur Servicios en el navegador** (`/app/`, 2026-10-12): la app del celular compilada para web, servida desde R2 (ver README, "Nodo Sur Servicios en el navegador"). En `/demo/`, la misma app sin cuenta y con un negocio de ejemplo, para mostrarla.
- **Páginas** (HTML + JS sin build): home, páginas del sistema y guías, `/ingresar`, `/cuenta`, `/negocio`, `/unirse`,
  `/vincular`, `/pagar`, `/descargar`, `/admin`.
- **API** (`worker.js` → `functions/`): login con Google; negocios, sucursales, miembros e invitaciones; suscripciones
  (Mercado Pago de Nodo Sur, `MP_ACCESS_TOKEN`); dispositivos y vinculación de PC/celular; copias cifradas
  (`/api/backup`); sync por sucursal (`/api/sync` + WebSocket); versiones y actualizaciones (`/api/update`,
  `scripts/publicar-release.mjs`, se conservan 2 por plataforma y canal); **Mercado Pago del negocio** (`/api/mp/*`:
  conectar por OAuth, terminal por sucursal, órdenes Point, imprimir en la terminal, cobros reales para el cierre y
  registro de actividad); **IA de Google del negocio** (`/api/ia/*`, 2026-10-07: el dueño carga la clave de Gemini una vez desde
  su PC o celular, queda cifrada en `ia_claves` y todos los equipos del negocio piden a la IA por `/api/ia/generar` sin verla);
  **bot de WhatsApp** (`/api/bot/*`, 2026-10-09: configuración, catálogo y pedidos por sucursal, solo con un plan con bot; ver
  README); mails con Resend (`functions/_lib/mail_template.js`).

## Cómo se trabaja

- Rama por tarea, PR, **merge solo con el OK del dueño** ("mergeá"). Al mezclar a `main` el sitio se publica solo.
- Pruebas: `for f in tests/*.test.mjs; do node --experimental-sqlite "$f" || echo "FALLA $f"; done` (Node 22). Mercado
  Pago, Google y Resend están simulados en las pruebas.
- Si cambiás un `.js` o `.css` de las páginas: `node scripts/versionar-estaticos.mjs` antes de commitear (la prueba
  `tests/estaticos.test.mjs` lo exige).
- Las páginas arman todo con `textContent` (hay una prueba que prohíbe `innerHTML`).
- Secretos (Cloudflare → Workers → broad-frog-1e4b → Variables and secrets): `BACKUP_KEY`, `MP_CLIENT_SECRET`,
  `MP_ACCESS_TOKEN`, `RESEND_API_KEY`, `MAIL_FROM`, entre otros (lista en `README.md`). No se pueden leer desde una
  sesión: si falta uno, pedírselo al dueño.

## Diseño

Mismo lenguaje que el POS: estilo antigravity.google (fondo blanco, bloques `#F3F4F7`, tinta `#121317`, pastillas,
Figtree, poco texto). Home con `home.css`/`home.js`; páginas internas con `styles.css` + `theme.css`/`theme.js` +
`fx.js`. Mocks del rediseño en `mocks/antigravity/` (no se publican). Las capturas del POS que muestra el sitio (`img/pos/*-v4.webp`, 2026-10-07) salen del mock v4 de la PC (`Nodo-Sur-Pos/docs/mock-pc/NodoSurPC-v4.html`) y de las capturas reales del celular (`flutter test test/companion/capturas_mock_test.dart`); `/img/*` tiene caché inmutable, así que una imagen nueva lleva nombre nuevo. Detalle en `README.md` ("Rediseño del index").

## Prueba por autoservicio (2026-10-12)

Todo "Probar 7 días gratis" del sitio lleva a `/pagar/` (Google + Mercado Pago, hoy $ 0); WhatsApp queda solo como
"¿Dudas?". La instalación del sistema POS es del cliente, con ayuda opcional; el bot la sigue haciendo el dueño (la cubre
el alta). Pendiente en Mercado Pago (lo hace el dueño, no se puede desde una sesión):

- **Volver al sitio después de activar la prueba:** en cada plan de suscripción (Mercado Pago → Suscripciones → planes),
  poner como URL de retorno `https://horsepos.com/cuenta/`, donde aparece el botón de descarga.

## Estado al 2026-10-03

- Publicado y en uso: negocios y sucursales con sync por sucursal, Mercado Pago por negocio (cobro, impresión, cobros
  reales para el cierre, actividad), herencia de lo del dueño a sus miembros (cuentas admin/eximidas = suscripción
  activa sin vencimiento), plantilla de mails, retención de 2 versiones, caché de 2 minutos del estado de pago y caché
  larga de `.js`/`.css` con huella.
- Versiones del POS publicadas: no se anotan acá (quedan viejas); mirarlas en `/admin/` → Versiones o en la tabla `releases`.
- Pendiente que toca este repo (ver la lista completa en `Nodo-Sur-Pos/CONTEXTO.md`): webhooks de Mercado Pago (avisos de
  pagos en vivo), devoluciones desde el POS y saldo real del negocio en el cierre. El MCP de Mercado Pago sirve para
  configurar webhooks de la app y leer documentación, no para ver la cuenta real.

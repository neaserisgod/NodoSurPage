# horsepos.com

Sitio de Nodo Sur (sistema POS, bot de WhatsApp y páginas web) y servidor del POS. Sin build: los archivos de la raíz se publican tal cual. **Para retomar el trabajo, empezá por [`CONTEXTO.md`](./CONTEXTO.md)** (y el de `neaserisgod/Nodo-Sur-Pos`).

- Hosting: Cloudflare Worker con archivos estáticos (`wrangler.jsonc`), se publica al mezclar a `main`.
- Dominio canónico: `https://horsepos.com`.
- `_headers`: seguridad y caché. `sitemap.xml` / `robots.txt` / `llms.txt`: SEO.
- WhatsApp de contacto: +54 9 2944 796044 (wa.me/5492944796044).

## Login con Google, "Mi cuenta" y administración

El sitio se publica como **Worker con archivos estáticos** (`wrangler.jsonc`, nombre `broad-frog-1e4b`). `worker.js` atiende solo `/api/*` con el código de `functions/`; el resto sale directo de los archivos. `.assetsignore` evita publicar código interno (`functions/`, `tests/`, `migrations/`).

- `/ingresar/` → `/api/auth/google` → Google → `/api/auth/callback` → `/cuenta/` (o `/pagar/` si venía de elegir un plan). Sesión = cookie firmada (HMAC) de 30 días, con un id propio: "Cerrar sesión" la anota como cerrada en el servidor (`sesiones_cerradas`), así una copia de la cookie deja de entrar.
- `/cuenta/`: datos del cliente y su suscripción de Mercado Pago (se busca por el **mail verificado de Google == mail de pago**); permite cancelarla.
- `/admin/`: solo `gtalovergamer@gmail.com` (o `ADMIN_EMAILS`). Clientes, último uso, suscripciones, ingresos. Requiere D1.
- Solo se ven/cancelan suscripciones de los 3 planes propios (`functions/_lib/mp.js`).

### Negocios, sucursales y miembros

Hoy todo cuelga del `sub` de una persona. El modelo nuevo agrega el **negocio** (el que paga) entre la persona y todo lo demás. Se implementa por fases; ya están el modelo (fase 1), el acceso calculado por negocio (fase 2), la API de miembros, invitaciones y sucursales (fase 3), las pantallas (fase 4) y la transferencia de propiedad con la facturación (fase 5). El POS ya lo usa (2026-10-03): la PC y el celular se vinculan a una sucursal y sincronizan por sucursal.

- **`orgs`** (negocio, con `billing_email`), **`branches`** (sucursales), **`memberships`** (persona + rol + sucursales), **`invitations`**. Definición en `functions/_lib/orgs.js` (se crean solas) y `migrations/0005_orgs.sql` (opcional).
- Todo negocio nace con una **"Sucursal principal"**; `devices` y `backups` ganan `owner_org` y `branch_id` (nullable). `backfillOrgs` convierte lo que ya existe, es idempotente y solo toca filas sin negocio.
- **Roles**: `owner` (todo), `manager` (descarga, copias, opera) y `employee` (solo opera). Un empleado solo ve su sucursal. Los permisos viven en un único archivo, `functions/_lib/permisos.js`; nadie compara roles a mano.
- **Paga el negocio entero**, una vez; las sucursales son ilimitadas. Los miembros son ilimitados (la idea es empezar a cobrar algo si algún negocio llega a ~50).
- **`billing_email` queda aparte del dueño**: Mercado Pago cobra por el mail del pagador y la propiedad se puede transferir.
- **El panel del negocio (`/negocio/`) es distinto de `/admin/`**: `/admin/` es de Nodo Sur (solo `ADMIN_EMAILS`); un cliente es dueño de su negocio y no admin de la plataforma.
- **Acceso por negocio (fase 2)**: `functions/_lib/access.js` decide descargas y copias. Lo paga el negocio (se verifica el `billing_email` en Mercado Pago) y cada rol hace lo que permite `permisos.js`. Quien no tiene negocio sigue entrando por la suscripción de su propio mail.
  - Vincular un CELULAR (`/vincular/?tipo=celular`, `tipo: 'celular'` en `/api/device/authorize`): lo vincula cada miembro (empleado, encargado o dueño) con SU cuenta, solo en una sucursal donde trabaja (`vincular_celular` en `permisos.js`). Así el celular sabe quién es: `GET /api/device/me` (token de dispositivo) devuelve `{email, name, role, orgId, branchId}` y la app toma el perfil de ahí, sin selector. El nombre sale de la cuenta de Google y queda en `devices.person_name`. `GET /api/device/team` (token de dispositivo, solo lectura) le da a la PC el nombre de su sucursal y, si la vinculó el dueño, el equipo del negocio (nombre, mail, rol y sucursales; nunca invitaciones): la PC lo muestra en Configuración → Cuenta de Nodo Sur. Un encargado o un empleado recibe `members: null`.
  - Vincular una PC (`/api/device/authorize`, opcionales `orgId` y `branchId`): solo el dueño. La primera vez crea su negocio y su "Sucursal principal" y pasa a ese negocio sus PC y copias anteriores. Una PC deja de valer si quien la vinculó deja de ser miembro activo.
  - Copias: cada una queda en la sucursal de su PC y se rotan **las últimas 5 por sucursal**. La web muestra todas al dueño y solo las asignadas a un encargado; un empleado no ve ninguna. Un id de otro negocio devuelve 404.
  - El barrido de cuentas inactivas no marca a quien está cubierto por la suscripción de su negocio. El cron diario corre `backfillOrgs` (idempotente) para completar lo anterior al modelo.
- **Miembros, invitaciones y sucursales (fase 3)**: API en `functions/api/org/` (lógica en `functions/_lib/miembros.js`). Solo el dueño administra, solo por sesión web con mismo origen (nunca desde una PC).
  - `POST /api/org/invite` `{orgId, email, role: manager|employee, branchIds | allBranches}` → link `/unirse/?t=<token>` (se manda por mail si `RESEND_API_KEY` y `MAIL_FROM` están cargados; si no, el dueño copia el link). Vence a los 7 días, reinvitar reemplaza la anterior, hasta 100 pendientes por negocio. En la base queda solo la huella SHA-256 del token.
  - `GET /api/org/invitation?t=` (vista previa) y `POST /api/org/accept` `{token}`: se aceptan solo con el Google cuyo **mail verificado coincide** con el invitado; con otro mail, 403 sin mostrar a qué negocio era. El link sirve una sola vez; quien ya fue quitado se reactiva; un dueño no se degrada aceptando.
  - `GET /api/org/members?org=`, `POST /api/org/member/update` y `/remove`: rol y sucursales; al dueño no se lo toca (la propiedad se transfiere aparte, fase 5). Quitar deja al miembro inactivo (las ventas viejas conservan su nombre) y sus PC dejan de valer.
  - `GET /api/org/branches`, `POST /api/org/branch` y `/branch/update`: crear, renombrar, cerrar y reabrir. No se puede cerrar la última activa ni una con PC vinculadas.
  - `MAX_MIEMBROS_SIN_COSTO` (por defecto 50): la lista de miembros devuelve `softCap` y `overSoftCap`; solo avisa, no bloquea.
- **Pantallas (fase 4)**
  - `/negocio/` (Mi negocio): el **dueño** administra equipo (invitar, cambiar rol y sucursales, quitar), sucursales, PC vinculadas y copias. Un **encargado** ve sus sucursales, copias y descargas. Un **empleado** ve solo su lugar de trabajo: sin copias, descargas ni facturación. Con más de un negocio hay selector. Las secciones salen de `can` en `/api/me` (que viene de `permisos.js`): la pantalla no repite la tabla de permisos.
  - `/unirse/?t=`: aceptar una invitación. Sin sesión manda a `/ingresar/` y vuelve (el token de 64 hex es lo único que `safeNext` deja pasar). El token se saca de la barra de direcciones apenas se lee. Con otro mail muestra el mail enmascarado y no revela el negocio.
  - `/cuenta/`: muestra "Tu negocio" y, a quien solo es encargado o empleado (`billing: false` en `/api/me`), no le consulta Mercado Pago ni le ofrece "elegí tu sistema". `/vincular/` deja elegir negocio y sucursal (una PC la vincula solo el dueño; un celular, cada miembro con su cuenta).
  - `/admin/`: tabla de **Negocios** (solo lectura: dueño, mail de cobro, suscripción, equipo, sucursales, PC, tope blando). Es distinta de `/negocio/`: la de admin es de Nodo Sur, la otra es de cada dueño.
  - Las páginas arman todo con `textContent` (nombres y mails vienen de la base; hay un test que prohíbe `innerHTML`).
- **Transferencia de propiedad y facturación (fase 5)**
  - En dos pasos: el dueño propone a un miembro (`POST /api/org/transfer`) y esa persona acepta (`/accept`) o rechaza (`/decline`); el dueño puede retirarla (`/cancel`). Una sola pendiente por negocio (índice parcial), vence a los 7 días, y quitar a la persona del equipo la retira. Hasta que acepte no cambia nada.
  - Al aceptar: el nuevo es `owner` con todas las sucursales y el anterior queda de **encargado** con todas (sus PC siguen andando: el negocio no se queda sin caja ese día). Si el nuevo dueño lo quita después, las PC que vinculó dejan de valer (la pantalla lo avisa).
  - **El mail de cobro (`billing_email`) no cambia solo** (Mercado Pago cobra a quien pagó). `GET/POST /api/org/billing` (solo el dueño): muestra quién paga (enmascarado si no es él) y deja **pasar el cobro a la suscripción propia**.
  - Reglas de seguridad: (1) el mail sale **siempre de la sesión**, nunca del pedido, y debe tener una suscripción vigente: si no, cualquiera podría apuntar su negocio a la suscripción de otro cliente y usar el sistema sin pagar; (2) **nadie cancela la suscripción de otra persona** (puede cubrir otros negocios suyos): `cancel.js` no se tocó, cancela quien paga; (3) el administrador de la plataforma puede ajustar el mail de cobro (`POST /api/admin/org`, botón «Mail de cobro» en `/admin/`) para casos de soporte.
  - `/api/me` suma `covered`: el dueño de un negocio cubierto por la suscripción de otra persona no recibe «elegí tu sistema». `/negocio/` muestra la propuesta recibida y la tarjeta de Facturación.
- Cada sucursal tiene su propia caja y su propio stock: las ventas viajan a la nube cifradas solo para sincronizar los dispositivos de esa sucursal (`/api/sync`), y no hay reportes consolidados entre sucursales.

### Pagar exige ingresar (y se recuerda el plan)

Los links de pago de Mercado Pago **no están en el sitio**: viven en `functions/_lib/plans.js` y solo se llega a ellos por `GET /api/checkout`, que exige sesión.

1. Todos los botones de suscribirse llevan a `/pagar/`. Ahí el botón apunta a `/api/checkout?plan=pos|pos-bot|bot[&promo=1]` (y `?item=alta&plan=…` para el alta del bot).
2. **Sin sesión**: `/api/checkout` manda a `/ingresar/?plan=…`, que muestra el plan elegido. El plan viaja firmado dentro del flujo de Google (`ns_oauth`), se guarda en la base (`users.plan_interest`, `promo_interest`, `plan_chosen_at`) y al volver se cae en `/pagar/?plan=…` con el plan ya seleccionado.
3. **Con sesión**: se guarda el plan y se redirige a Mercado Pago (o a WhatsApp si es precio de fundador).
4. **Registrado sin pagar**: `/cuenta/` muestra "Elegí tu sistema" con los 3 planes (resalta el elegido) y, en el resto del sitio, una franja "Elegí tu sistema" con botón para cerrarla. La franja usa cookies de solo lectura (`ns_sub`, `ns_plan`) que actualiza `/api/me`; no son autenticación.
5. **Admin**: columna "Plan elegido" y el contador "Registrados sin pagar" (se calcula solo si Mercado Pago responde).

Las columnas nuevas de `users` se crean solas la primera vez; `migrations/0003_plan_interest.sql` es opcional. Sin D1 el flujo igual exige sesión, pero no recuerda el plan entre visitas.

### Baja de suscripciones

- **Cliente**: `/cuenta/` → "Cancelar suscripción" (con confirmación) → `POST /api/subscription/cancel`. Solo puede cancelar la suya: se comprueba que el mail de pago de la suscripción sea su mail verificado de Google.
- **Administrador**: `/admin/` → "Dar de baja" en la fila del cliente (o en "Suscriptores sin cuenta") → `POST /api/admin/subscription`. Solo suscripciones de los 3 planes propios.
- Las dos cortan los cobros siguientes en Mercado Pago (`PUT /preapproval/{id}` con `status: cancelled`). No borran la cuenta del sitio ni devuelven plata; la devolución (30 días) se resuelve a mano. Requieren `MP_ACCESS_TOKEN`.

### Descargas y actualizaciones del sistema POS (Flutter)

Los instaladores viven en **R2** (bucket privado `nodosur-releases`, binding `RELEASES`); los datos de cada versión, en **D1** (`releases` y `downloads`, se crean solas al publicar la primera). El bucket hay que crearlo antes en el panel de Cloudflare → R2, si no el deploy falla.

- **Instalador** (`/descargar/`, `GET /api/download?platform=windows|macos|linux|android`): exige sesión y suscripción `authorized` en Mercado Pago; administradores y cuentas eximidas entran siempre y son las únicas que ven el canal `beta`. Si Mercado Pago no responde, no habilita. Solo entrega la versión más nueva **liberada al 100 %**. Administradores y cuentas eximidas ven además un historial (`historial` en `/api/downloads`) y pueden bajar una versión puntual con `&version=` para volver atrás si una beta sale mal; una versión bloqueada no se ofrece. Se cuenta cada descarga (no las continuaciones).
- **Actualizaciones** (públicas; los archivos van firmados, la app verifica la firma):
  - `GET /api/update/appcast.xml?platform=windows|macos|linux&channel=stable&cid=<id de instalación>`: feed Sparkle/WinSparkle para el paquete `auto_updater` de Flutter. `sparkle:version` sale como `nombre.build` (`1.0.0+2098` → `1.0.0.2098`), que es como Flutter versiona el `.exe` en Windows.
  - `GET /api/update/latest.json?platform=android&version=1.0.0%2B2097&cid=…`: JSON para cualquier otro actualizador (`{update:false}` o `{update:true, version, url, sha256, size, signature, notes, mandatory}`).
  - `cid` es un id aleatorio guardado por la instalación: reparte el despliegue gradual de forma estable. Sin `cid` solo se ofrece lo liberado al 100 %.
  - El canal `beta` del feed es solo para instalaciones de cuentas de pruebas: pedir `channel=beta` a mano no devuelve nada.
  - `/api/update/file?id=N`: una versión **estable al 100 %** se baja libre (la recibe cualquier instalación, aunque no tenga cuenta). Una beta o una versión a medio liberar solo con el permiso firmado (`&p=`, 7 días) que pone el feed en la dirección para la instalación a la que le toca.
- **Firma de la actualización**: `sparkle:edSignature` (EdDSA, por defecto) o `sparkle:dsaSignature` si la versión se publica con `--signature-type dsa`. El paquete `auto_updater` 1.0 de Flutter trae WinSparkle 0.8.1, que solo entiende DSA (EdDSA llegó en WinSparkle 0.9.0), así que para Windows se publica con `--signature-type dsa`.
- **Versiones**: `1.0.0+2098` (nombre + build de `pubspec.yaml`) o `1.0.0.2098` (la forma con puntos que usa Windows y `tool/publicar_release.ps1`); son la misma versión. Dentro del mismo nombre gana el build más alto.
- **Publicar** (desde la compu donde se compila): `RELEASE_TOKEN=… node scripts/publicar-release.mjs --file LaPlazoleta-Setup.exe --platform windows --version 1.0.0+2099 --notes "…" --signature <EdDSA> --rollout 10`. Sube a R2 con `wrangler` y registra la versión; `--dry-run` muestra qué haría sin tocar nada. Conviene publicar al 10 % y subir el porcentaje desde `/admin/` → *Versiones*.
- **Volver atrás**: en `/admin/` → *Versiones*, **Retirar** la versión mala (pasa a ser la vigente la anterior) o **Bloquear** (deja de entregarse por completo).
- Secreto nuevo: `RELEASE_TOKEN` (Secret, 24+ caracteres) para publicar desde scripts o CI sin sesión de Google.
- Los archivos no se suben a través del sitio (un Worker acepta hasta 100 MB por pedido en el plan gratis): se suben con `wrangler` (hasta 5 GB por archivo).
- Cosas que no resuelve el sitio: firmar el `.exe` (sin firma, Windows SmartScreen avisa), generar la firma EdDSA de cada actualización, y firmar el APK con una llave de publicación propia.

### Cuenta, copias de seguridad y versiones de prueba del POS

La PC con el POS se **vincula a la cuenta de Google** del dueño y sube copias de su base al servidor. Si se borra el sistema y la base, se reinstala, se entra con la misma cuenta y se recupera todo. Todo va atado al `sub` de Google (no a la fila de `users`): el barrido automático puede borrar y recrear esa fila sin perder dispositivos ni copias.

- **Vincular** (como "iniciar sesión en el navegador"): la app abre `/vincular/?port&state&challenge&device&name`, la persona entra con Google y confirma, el sitio devuelve un código de un solo uso a `http://127.0.0.1:<port>/callback` y la app lo canjea en `POST /api/device/token` (PKCE: el verificador tiene que dar el `challenge`). Devuelve un **token de dispositivo** de 1 año (se renueva solo desde `ping` cuando quedan menos de 60 días). Se firma con un secreto derivado distinto del de la sesión web: un token de dispositivo no vale como sesión ni al revés. Después de ingresar solo se vuelve a `/vincular/` (lista blanca), nunca a una URL libre.
- **Mercado Pago por negocio** (`functions/_lib/mp_conexion.js`, `functions/api/mp/`): cada negocio conecta SU cuenta (OAuth "Authorization code" + PKCE; aplicación "Nodo Sur POS"). El dueño toca "Conectar Mercado Pago" en `/negocio/` (`POST /api/mp/conectar` → dirección de `auth.mercadopago.com`; vuelve a `GET /api/mp/callback`). El token queda **cifrado en el servidor** (BACKUP_KEY) y no sale nunca: la PC y el celular piden las órdenes al sitio (`POST/GET /api/mp/orden`, `POST /api/mp/orden/cancelar`), con permiso `operar` sobre la sucursal del dispositivo. También imprime en la terminal (`POST /api/mp/imprimir`) y devuelve los cobros reales de un rango para el cierre de caja (`GET /api/mp/cobros?desde&hasta`, en segundos, hasta 31 días: bruto, devolución, comisión y neto por cobro, solo donde el negocio es el cobrador). Cada orden, cancelación e impresión queda en `mp_actividad` (`GET /api/mp/actividad`, para el dueño). Se renueva solo (cada renovación cambia el refresh_token; se guarda con compare-and-set); si Mercado Pago lo rechaza queda "para reconectar". Cada sucursal elige su terminal Point (`GET /api/mp/terminales`, `POST /api/mp/terminal`, que la pasa a modo PDV). Configuración: variable `MP_CLIENT_ID` (en `wrangler.jsonc`) y secreto `MP_CLIENT_SECRET`; dirección de retorno registrada en Mercado Pago: `https://horsepos.com/api/mp/callback`.
  - **Blindaje (revisión 2026-10-04)**: todo pedido saliente (Mercado Pago, Google, Resend) tiene plazo de 20 s (`fetchConPlazo`, `util.js`; el de renovar el token del negocio, el doble, porque renovar rota el refresh_token): un corte o un plazo vencido contesta 504 y **nunca** marca la conexión para reconectar (eso solo lo hace un 400/401 de Mercado Pago). El webhook descarta cuerpos de más de 16 KB (413) antes de leerlos. Cancelar o devolver una orden de OTRA sucursal del negocio da 403 (`orden_de_otra_sucursal`). Crear/consultar/cancelar/devolver distinguen un rechazo de Mercado Pago (4xx → 502 `mp_rechazo`: no se creó) de "no sé" (5xx o sin respuesta → 504 `mp_sin_respuesta`: quizá sí se creó): la app reintenta solo en el segundo caso, con la misma clave de idempotencia. `GET /api/admin/mp-reporte?generar=si` crea algo en Mercado Pago, así que rechaza pedidos con `Sec-Fetch-Site: cross-site`. Las pruebas corren en cada PR (`.github/workflows/tests.yml`). La política de contenido (`_headers`) no permite scripts en línea (`script-src 'self'` + Cloudflare Insights): una prueba (`tests/estaticos.test.mjs`) falla si una página vuelve a tener un `<script>` en línea o un `onclick=`; los datos JSON-LD (`type="application/ld+json"`) están permitidos.
  - **Vencimiento y avisos en vivo (2026-10-04)**: cada orden vence sola a los 2 minutos (`expiration_time: PT2M`) y queda anotada en `mp_ordenes` (de qué negocio y sucursal es, 30 días). Mercado Pago avisa cada cambio de una orden a `POST /api/mp/webhook`; con la firma válida (`x-signature`, HMAC-SHA256 con la clave de la aplicación) el sitio despierta a los equipos de esa sucursal por el hub de sync (`{"mp":{"orden","accion"}}`). El aviso solo despierta: la app consulta la orden antes de grabar nada. **Para activarlo** (una vez): en Mercado Pago → Tus integraciones → "Nodo Sur POS" → Webhooks → Configurar notificaciones → Modo productivo, URL `https://horsepos.com/api/mp/webhook`, evento **Order (Mercado Pago)**, Guardar; copiar la clave secreta que genera y cargarla con `wrangler secret put MP_WEBHOOK_SECRET`. Sin ese secreto el endpoint contesta 503 y todo sigue andando como antes (la app consulta sola).
  - **Avisos de cobros, contracargos y reclamos (etapa D, 2026-10-04)**: en el mismo panel de Webhooks, además de **Order (Mercado Pago)**, se tildan **Pagos**, **Contracargos** y **Reclamos** (temas `payment`, `topic_chargebacks_wh`, `topic_claims_integration_wh`; son opcionales: sin ellos solo faltan esos avisos). El sitio consulta el objeto con el token del negocio, descarta lo que no es un cobro aprobado de la cuenta conectada, lo guarda 30 días en `mp_avisos` (sin datos de quien pagó) y despierta a los equipos de la sucursal (`{"mp":{"aviso":…}}`); la PC los cruza con sus ventas y muestra en la campanita solo lo que no cierra. Lo que llegó con la PC apagada se baja con `GET /api/mp/avisos?desde=<id>`.
  - **Saldo real para el cierre (etapa E, 2026-10-04)**: `POST /api/mp/saldo {desde}` pide el reporte de Liquidaciones de la cuenta (crea la configuración la primera vez) y devuelve un id; `GET /api/mp/saldo?id=N` contesta `pendiente` (el reporte tarda unos minutos), `error` o `listo` con el saldo disponible (última fila real del reporte), lo cobrado y todavía no liberado (`money_release_date` a futuro, de los pagos), el total y los movimientos (sin el saldo inicial ni los pares `reserve_for_*`). El token no sale del servidor. Los endpoints de prueba `/api/admin/mp-saldo` y `/api/admin/mp-reporte` siguen para administradores.
  - **Devoluciones, crédito y modo de la terminal (etapas B y C, 2026-10-04)**: `POST /api/mp/orden/devolver` devuelve el total de una orden cobrada (permiso `devolver`: dueño y encargado; clave de idempotencia fija que manda la app; `ya_devuelta`/`no_cobrada` si no corresponde), y `/api/mp/estado` del dispositivo dice `canRefund`. El canal `credit_card` va siempre en 1 pago (`default_installments: 1`, `medioDePagoOrden`): Mercado Pago solo deja limitar cuotas si la orden es de crédito. `POST /api/mp/terminal/modo` (dueño) pasa la terminal de una sucursal a `STANDALONE` (cobra sola, sin el sistema) o la vuelve a `PDV`; `/negocio` muestra el modo y el botón.
- **Bot de WhatsApp** (`functions/_lib/bot.js`, `functions/api/bot.js`, 2026-10-09; plan en `Nodo-Sur-Pos/docs/PLAN-BOT.md`): el bot corre en un celular con Termux vinculado como un equipo más de la sucursal (`/vincular/?tipo=bot`, `devices.kind = 'bot'`; lo vincula el dueño o un encargado, permiso `configurar_bot`, y nunca crea un negocio). **Solo con un plan con bot** ("Sistema + Bot" o "Solo el bot", `PLANES_CON_BOT`) o un negocio de pruebas; si no, `403 sin_plan_bot`. Todo por sucursal y **cifrado** (BACKUP_KEY: tiene teléfonos y nombres de clientes).
  - `GET /api/bot/estado` (la app): si el negocio tiene el bot, si este equipo lo puede configurar, la versión de la configuración y los bots vinculados con su última señal.
  - `GET/POST /api/bot/config`: la app (dueño o encargado) guarda `{ config }` (lo que era el `config.json` del bot, hasta 32 KB; el sitio no lo interpreta) y sube `version`; el bot la baja.
  - `GET/POST /api/bot/catalogo`: la app publica `{ items: [{ gid, nombre, precioCentavos, hay }] }` (sin costos ni proveedores; si no cambió, no avisa); el bot lo baja para contestar precio y si hay.
  - `POST /api/bot/pedido` (el bot): entra **"por confirmar"**, idempotente por el `id` que manda el bot. `GET /api/bot/pedidos?desde=<ms>`: lo que cambió desde el cursor. `POST /api/bot/pedido/resolver` (la app): `aceptado` o `rechazado`, una sola vez. Aceptar no toca stock acá: el encargue lo crea la app en su base. Los pedidos se borran a los 30 días. Cada línea lleva `cantidad` o `gramos` (lo que se pesa, con el precio por kilo); un pedido con gramos entra solo si todas las apps de la sucursal que leyeron pedidos en los últimos 30 días avisaron que los entienden (`?gramos=1`, tabla `bot_lectores`) y al menos una lo hizo: una app anterior descartaría el pedido sin avisar. Si no, 400 `gramos_no_soportado` y el bot lo manda al local por WhatsApp.
  - **Turnos** (negocios de servicios, `functions/_lib/bot_turnos.js`, 2026-10-10): `POST /api/bot/turno` (el bot) **reserva** el horario con una sola sentencia que inserta solo si no hay otro turno que lo ocupe (D1 la ejecuta atómica: dos clientes con las 10:00 a la vez, entra uno y el otro recibe `409 ocupado`); idempotente por `id`. `POST /api/bot/ocupados` (la app): lo que ocupa su agenda de hoy en adelante, **sin nombres ni teléfonos**, reemplazando lo anterior. `POST /api/bot/turno/cambio` (los dos): estado u horario; el bot no puede pisar otro turno, la app sí (sobreturno). `GET /api/bot/turnos?desde=<ms>`: lo que cambió. Los turnos del bot van cifrados y se borran 30 días después de terminar.
  - **Avisos en vivo** por el mismo hub de la sync: los sockets del bot llevan la etiqueta `tipo:bot` (`X-Tipo` en `/api/sync/escuchar`). Configuración, catálogo y pedido resuelto van solo al bot; un pedido nuevo, solo a la app; los lotes de la sync y los avisos de Mercado Pago nunca al bot.
- **Notificaciones con la app cerrada** (`functions/_lib/push.js`, 2026-10-10): el celular registra su token de Firebase Cloud Messaging con `POST /api/device/push` (`{ token }`, atado al equipo vinculado). Un pedido o un turno nuevo del bot le llega a los celulares de esa sucursal (no a los bots). El Worker firma un JWT con la cuenta de servicio y usa la API HTTP v1 de FCM; un token que FCM ya no reconoce (404) se borra. **Secreto `FCM_SERVICE_ACCOUNT`**: el JSON entero de la cuenta de servicio (Firebase › Configuración del proyecto › Cuentas de servicio › Generar nueva clave privada). Sin él no se manda nada y todo lo demás anda igual.
- **Dispositivos**: `POST /api/device/ping` (versión, sistema y `cid` de instalación), `GET /api/devices`, `POST /api/device/revoke` (desde la sesión web, cualquiera propio; desde la app, el propio).
- **Versiones de prueba**: si la PC pertenece a un administrador o a una cuenta eximida, el feed de actualizaciones (por su `cid`) le ofrece también las versiones **beta**, antes que a los clientes. Desvincularla le quita eso.
- **Copias** (`PUT/GET/DELETE /api/backup`, `GET /api/backups`): el cuerpo es la base ya comprimida (máx. 25 MB); la app manda `X-Sha256`, `X-Schema-Version` y `X-App-Version`. Se guardan **cifradas en el servidor** (AES-256-GCM, secreto `BACKUP_KEY`) en `cuentas/<hash del sub>/…` del mismo bucket que las versiones (o de `BACKUPS` si algún día se separa). Solo quedan las **últimas 5** por cuenta. Permisos: suben quienes tienen suscripción vigente (administradores y eximidas siempre); quien cancela conserva **90 días para restaurar**; si Mercado Pago no responde, no se habilita nada. Una copia que no descifra o cuyo hash no coincide nunca se entrega como buena.
- **Limpieza**: el cron diario borra las copias de cuentas sin suscripción y fuera de la ventana de 90 días. Si no se puede consultar Mercado Pago, no borra nada.
- **Secreto nuevo**: `BACKUP_KEY` (Secret): 32 bytes aleatorios en base64. Sin él (o mal puesto) las rutas de copias responden 503 y nada se sube. Generarlo: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Si se pierde, las copias guardadas no se pueden recuperar**: respaldarlo aparte.

### Variables (Cloudflare → Workers & Pages → broad-frog-1e4b → Settings → Variables and secrets → tipo **Secret**)

| Nombre | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID de Google Cloud (OAuth, tipo Web) |
| `GOOGLE_CLIENT_SECRET` | Client secret del mismo cliente |
| `SESSION_SECRET` | Texto aleatorio de 48+ caracteres |
| `MP_ACCESS_TOKEN` | Access token de producción de la app de Mercado Pago |
| `BACKUP_KEY` | (copias de seguridad) 32 bytes aleatorios en base64; ver «Cuenta, copias de seguridad…» |
| `RELEASE_TOKEN` | (para publicar versiones del POS desde scripts/CI) texto aleatorio de 24+ caracteres |
| `ADMIN_EMAILS` | (opcional) mails admin separados por coma; por defecto `gtalovergamer@gmail.com` |
| `AUTO_DELETE` | (opcional) `on` habilita el borrado real; por defecto apagado |
| `RESEND_API_KEY`, `MAIL_FROM` | (opcionales) mails de **invitaciones** a un negocio y **propuestas de transferencia**. `MAIL_FROM` tiene que ser de un dominio verificado en Resend (ej.: `Nodo Sur <hola@avisos.horsepos.com>`); con el remitente de prueba `onboarding@resend.dev` Resend solo entrega a la cuenta dueña. Sin esto, la invitación devuelve el link para copiar. |
| `AVISOS_BORRADO` | (opcional) `on` permite que la limpieza diaria mande el aviso «tu cuenta se eliminará en 3 días». **Apagado por defecto, a propósito**: configurar Resend NO alcanza para activarlo, porque es un mail a gente real que no se puede desmandar. Antes de encenderlo, revisá `/admin/` → «Simular limpieza ahora». Sin aviso no hay borrado. |

`wrangler.jsonc` tiene `keep_vars: true`, así que los deploys no borran lo cargado desde el panel.

Google Cloud → Google Auth Platform → Clientes (Aplicación web):
- Orígenes autorizados: `https://horsepos.com`
- URI de redireccionamiento: `https://horsepos.com/api/auth/callback`
- Público: **En producción**; política de privacidad `https://horsepos.com/privacidad/`.

### Uso, administración y limpieza automática (etapa 2: D1)

1. Crear la base D1 `nodosur` y ejecutar `migrations/0001_users.sql` en su Console.
2. En `wrangler.jsonc`, `d1_databases` ya apunta a la base `nodosur` (ID 285a2863-…).
3. El cron diario (`triggers.crons`) corre `functions/_lib/sweep.js`: una cuenta se avisa y, a los 3 días, se elimina si NO está eximida, NO es admin, NO tiene suscripción vigente (`authorized`/`pending`/`paused`), tiene más de 14 días de antigüedad y 30 sin uso.
   - **Solo se elimina si el aviso se envió de verdad.** Sin `RESEND_API_KEY` + `MAIL_FROM` no se avisa y **no se borra nada** (queda "pendiente de aviso" en el panel).
   - **El borrado real está apagado** hasta `AUTO_DELETE = on`; antes solo simula (botón "Simular limpieza" del panel).
   - Si Mercado Pago no responde, la limpieza aborta sin tocar nada.

### Pruebas

Todas (Node 22): `for f in tests/*.test.mjs; do node --experimental-sqlite "$f" || echo "FALLA $f"; done`

## Precio de fundador (interruptor)

El precio de fundador se activa o desactiva desde **/admin/** (sección "Precio de fundador"). El estado se guarda en la tabla `settings` de D1 (se crea sola al usarlo; `migrations/0002_settings.sql` es opcional). Por defecto está **activo**. Al desactivarlo desaparece de `/pagar/`, del bloque de la home y de las páginas del sistema, sin volver a publicar el sitio. `GET /api/promo` devuelve `{"activa": true|false}` (público). Los enlaces de pago con el precio de fundador se cargan en `pagar.js` (`promoHref` de cada plan).

## Rediseño del index (estilo "antigravity")

El index usa `home.css` + `home.js` (el resto de las páginas siguen con `styles.css`).
Para volver a una versión anterior: `git checkout index-pre-antigravity -- index.html` (original) o `index-antigravity-v1` (primera versión del rediseño). Hay que acompañar con `home.css`/`home.js` de ese tag si se usa v1.

Las páginas internas (sistema-pos, bot-whatsapp, guías, ingresar, pagar, 404, etc.) usan `theme.css` + `theme.js` encima de `styles.css`, con `fx.js` (partículas, compartido con el index). Para quitar el tema de esas páginas basta con sacar los `<link>`/`<script>` de `theme.*` y `fx.js`.

Disposición de las páginas de contenido (12 páginas): el HTML se reordenó en bloques `.blk` (título a la izquierda, texto a la derecha, tarjetas `.card2`, pasos `.steps2`, capturas `.halo`, preguntas `<details class="q2">`). El texto es el mismo. Para volver a la disposición anterior de una página: `git checkout <commit anterior a este cambio> -- <pagina>/index.html`.

### Sincronización entre dispositivos (PC y celulares de una sucursal)

`POST /api/sync` sube un lote de cambios y `GET /api/sync?desde=<seq>` baja los de los **otros** dispositivos de la misma **sucursal**. La nube es un buzón ordenado, no una copia maestra: quien aplica los lotes en el orden en que llegaron (`seq`) deja que el último pise a los anteriores; el reloj de los dispositivos no decide nada. Stock y caja se suman como movimientos.

- **El alcance es la sucursal, no la persona**: la PC y el celular de una misma sucursal se ven entre sí; otra sucursal del mismo dueño, o otro negocio, no ven nada (cada sucursal tiene su caja y su stock). El alcance (`scopeDeSync`) sale **siempre del dispositivo autenticado**, nunca del pedido: ni un parámetro ni una cabecera lo cambian. Un dispositivo anterior al modelo de negocios sigue atado a la persona hasta que se completa (`adoptarLegado` al vincular, o el cron). Por eso, al vincular el celular hay que elegir **la misma sucursal** que la PC.
- Solo con token de dispositivo. Mismas reglas que las copias (`backupScope` + `backupAccess`): suscripción vigente **del negocio** (su mail de cobro), cuenta eximida o administrador, y que quien vinculó el dispositivo siga siendo miembro activo (si lo quitan, el dispositivo deja de sincronizar). Quien canceló puede bajar durante la ventana de restauración, no subir.
- Lotes cifrados con AES-256-GCM (`BACKUP_KEY`); las tablas que sincroniza la app no llevan tokens. Tope de 1 MB por lote.
- Subir es idempotente por `X-Lote-Id`. Los lotes viejos se borran solo si pasaron 365 días Y la sucursal supera 50 MB (la revisión corre cada 25 lotes): un local chico nunca purga, así un celular nuevo baja la historia entera. Quien quede detrás de lo ya borrado recibe `expirado: true`. Tablas D1 `sync_lotes` y `sync_cuentas`, ambas por alcance (se crean solas, una vez por instancia).

**Aviso en vivo, para no consultar de más.** `GET /api/sync/escuchar` (WebSocket) conecta al dispositivo con el Durable Object `SyncHub` de su sucursal (binding `SYNC_HUB`, clase con SQLite: está en el plan gratis; el nombre del hub es un hash, sin nada en claro). Cuando alguien sube un lote, el hub manda `{"seq":N}` a los demás dispositivos y recién ahí bajan; sin cambios no hay ningún pedido. Costo (WebSocket Hibernation): conectar es 1 pedido; un socket quieto no consume cómputo; los mensajes salientes y los pings no se cobran. El cliente no manda nada por el socket. Sin el binding todo anda igual, solo que los dispositivos tienen que consultar de vez en cuando. Cada subida hace ~3 consultas a D1 y 1 pedido al hub; cada bajada, 2 consultas.

**La PC en el wifi del local (2026-10-03).** `POST /api/device/pc-local` `{ip, puerto, token}`: la PC vinculada avisa su dirección del wifi (solo 10.x, 172.16–31.x o 192.168.x) y la llave de su servidor para celulares; la llave se guarda cifrada con `BACKUP_KEY`. `GET /api/device/pc-local`: un celular de la **misma sucursal** la pide y se conecta con un toque, sin QR ni código. **Publicar la dirección solo puede una PC** (`devices.kind = 'pc'`, que el sitio guarda al vincular; las vinculadas antes valen si quien las vinculó puede vincular PC): si no, el celular de un empleado podría hacerse pasar por la PC. Pedirla, mismo control que sincronizar (quien opera la sucursal, negocio al día); se ofrece la que avisó más reciente, si no pasaron 30 días (`functions/_lib/pc_local.js`).

## Cambiar un .js o .css de las páginas

Los `.js` y `.css` se guardan un año en el navegador (`_headers`, `immutable`) porque su dirección lleva la huella del contenido (`/main.js?v=77beb36bb3`). Si editás uno, **corré `node scripts/versionar-estaticos.mjs`** antes de commitear: actualiza la huella en todas las páginas. Si te olvidás, la prueba `tests/estaticos.test.mjs` falla antes de publicar.

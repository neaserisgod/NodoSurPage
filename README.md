# horsepos.com

Sitio estático de Nodo Sur (sistema POS, bot de WhatsApp y páginas web). Sin build: los archivos de la raíz se publican tal cual.

- Hosting: Cloudflare Pages (directorio de salida: raíz `/`, sin comando de build).
- Dominio canónico: `https://horsepos.com`.
- `_headers`: seguridad y caché. `sitemap.xml` / `robots.txt` / `llms.txt`: SEO.
- WhatsApp de contacto: +54 9 2944 796044 (wa.me/5492944796044).

## Login con Google, "Mi cuenta" y administración

El sitio se publica como **Worker con archivos estáticos** (`wrangler.jsonc`, nombre `broad-frog-1e4b`). `worker.js` atiende solo `/api/*` con el código de `functions/`; el resto sale directo de los archivos. `.assetsignore` evita publicar código interno (`functions/`, `tests/`, `migrations/`).

- `/ingresar/` → `/api/auth/google` → Google → `/api/auth/callback` → `/cuenta/` (o `/pagar/` si venía de elegir un plan). Sesión = cookie firmada (HMAC) de 30 días.
- `/cuenta/`: datos del cliente y su suscripción de Mercado Pago (se busca por el **mail verificado de Google == mail de pago**); permite cancelarla.
- `/admin/`: solo `gtalovergamer@gmail.com` (o `ADMIN_EMAILS`). Clientes, último uso, suscripciones, ingresos. Requiere D1.
- Solo se ven/cancelan suscripciones de los 3 planes propios (`functions/_lib/mp.js`).

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

- **Instalador** (`/descargar/`, `GET /api/download?platform=windows|macos|linux|android`): exige sesión y suscripción `authorized` en Mercado Pago; administradores y cuentas eximidas entran siempre y son las únicas que ven el canal `beta`. Si Mercado Pago no responde, no habilita. Solo entrega la versión más nueva **liberada al 100 %**. Se cuenta cada descarga (no las continuaciones).
- **Actualizaciones** (públicas; los archivos van firmados, la app verifica la firma):
  - `GET /api/update/appcast.xml?platform=windows|macos|linux&channel=stable&cid=<id de instalación>`: feed Sparkle/WinSparkle para el paquete `auto_updater` de Flutter. `sparkle:version` sale como `nombre.build` (`1.0.0+2098` → `1.0.0.2098`), que es como Flutter versiona el `.exe` en Windows.
  - `GET /api/update/latest.json?platform=android&version=1.0.0%2B2097&cid=…`: JSON para cualquier otro actualizador (`{update:false}` o `{update:true, version, url, sha256, size, signature, notes, mandatory}`).
  - `cid` es un id aleatorio guardado por la instalación: reparte el despliegue gradual de forma estable. Sin `cid` solo se ofrece lo liberado al 100 %.
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
| `RESEND_API_KEY`, `MAIL_FROM` | (opcionales) para enviar el aviso previo al borrado |

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

`node --experimental-sqlite tests/auth.test.mjs && node --experimental-sqlite tests/admin.test.mjs && node --experimental-sqlite tests/checkout.test.mjs && node --experimental-sqlite tests/baja.test.mjs && node --experimental-sqlite tests/releases.test.mjs && node --experimental-sqlite tests/devices.test.mjs && node --experimental-sqlite tests/backups.test.mjs && node tests/worker.test.mjs`

## Precio de fundador (interruptor)

El precio de fundador se activa o desactiva desde **/admin/** (sección "Precio de fundador"). El estado se guarda en la tabla `settings` de D1 (se crea sola al usarlo; `migrations/0002_settings.sql` es opcional). Por defecto está **activo**. Al desactivarlo desaparece de `/pagar/`, del bloque de la home y de las páginas del sistema, sin volver a publicar el sitio. `GET /api/promo` devuelve `{"activa": true|false}` (público). Los enlaces de pago con el precio de fundador se cargan en `pagar.js` (`promoHref` de cada plan).

## Rediseño del index (estilo "antigravity")

El index usa `home.css` + `home.js` (el resto de las páginas siguen con `styles.css`).
Para volver a una versión anterior: `git checkout index-pre-antigravity -- index.html` (original) o `index-antigravity-v1` (primera versión del rediseño). Hay que acompañar con `home.css`/`home.js` de ese tag si se usa v1.

Las páginas internas (sistema-pos, bot-whatsapp, guías, ingresar, pagar, 404, etc.) usan `theme.css` + `theme.js` encima de `styles.css`, con `fx.js` (partículas, compartido con el index). Para quitar el tema de esas páginas basta con sacar los `<link>`/`<script>` de `theme.*` y `fx.js`.

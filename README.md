# horsepos.com

Sitio estático de Nodo Sur (sistema POS, bot de WhatsApp y páginas web). Sin build: los archivos de la raíz se publican tal cual.

- Hosting: Cloudflare Pages (directorio de salida: raíz `/`, sin comando de build).
- Dominio canónico: `https://horsepos.com`.
- `_headers`: seguridad y caché. `sitemap.xml` / `robots.txt` / `llms.txt`: SEO.
- WhatsApp de contacto: +54 9 2944 796044 (wa.me/5492944796044).

## Login con Google, "Mi cuenta" y administración

El sitio se publica como **Worker con archivos estáticos** (`wrangler.jsonc`, nombre `broad-frog-1e4b`). `worker.js` atiende solo `/api/*` con el código de `functions/`; el resto sale directo de los archivos. `.assetsignore` evita publicar código interno (`functions/`, `tests/`, `migrations/`).

- `/ingresar/` → `/api/auth/google` → Google → `/api/auth/callback` → `/cuenta/`. Sesión = cookie firmada (HMAC) de 30 días.
- `/cuenta/`: datos del cliente y su suscripción de Mercado Pago (se busca por el **mail verificado de Google == mail de pago**); permite cancelarla.
- `/admin/`: solo `gtalovergamer@gmail.com` (o `ADMIN_EMAILS`). Clientes, último uso, suscripciones, ingresos. Requiere D1.
- Solo se ven/cancelan suscripciones de los 3 planes propios (`functions/_lib/mp.js`).

### Variables (Cloudflare → Workers & Pages → broad-frog-1e4b → Settings → Variables and secrets → tipo **Secret**)

| Nombre | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID de Google Cloud (OAuth, tipo Web) |
| `GOOGLE_CLIENT_SECRET` | Client secret del mismo cliente |
| `SESSION_SECRET` | Texto aleatorio de 48+ caracteres |
| `MP_ACCESS_TOKEN` | Access token de producción de la app de Mercado Pago |
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

`node --experimental-sqlite tests/auth.test.mjs && node --experimental-sqlite tests/admin.test.mjs && node tests/worker.test.mjs`

## Precio de fundador (interruptor)

El precio de fundador se activa o desactiva desde **/admin/** (sección "Precio de fundador"). El estado se guarda en la tabla `settings` de D1 (se crea sola al usarlo; `migrations/0002_settings.sql` es opcional). Por defecto está **activo**. Al desactivarlo desaparece de `/pagar/`, del bloque de la home y de las páginas del sistema, sin volver a publicar el sitio. `GET /api/promo` devuelve `{"activa": true|false}` (público). Los enlaces de pago con el precio de fundador se cargan en `pagar.js` (`promoHref` de cada plan).

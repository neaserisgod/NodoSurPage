# horsepos.com

Sitio estático de Nodo Sur (sistema POS, bot de WhatsApp y páginas web). Sin build: los archivos de la raíz se publican tal cual.

- Hosting: Cloudflare Pages (directorio de salida: raíz `/`, sin comando de build).
- Dominio canónico: `https://horsepos.com`.
- `_headers`: seguridad y caché. `sitemap.xml` / `robots.txt` / `llms.txt`: SEO.
- WhatsApp de contacto: +54 9 2944 796044 (wa.me/5492944796044).

## Login con Google y "Mi cuenta"

Cloudflare Pages Functions (`functions/`, solo se ejecutan en `/api/*` por `_routes.json`). Sin base de datos: la sesión es una cookie firmada (HMAC) de 30 días.

- `/ingresar/` → `/api/auth/google` → Google → `/api/auth/callback` → `/cuenta/`.
- `/cuenta/` muestra los datos del cliente y su suscripción de Mercado Pago (se busca por el **mail verificado de Google == mail de pago**) y permite cancelarla (`/api/subscription/cancel`).
- Solo se ven/cancelan suscripciones de los 3 planes propios (ver `functions/_lib/mp.js`).

Variables de entorno (Cloudflare Pages → Settings → Variables and Secrets, como **Secrets**):

| Nombre | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID de Google Cloud (OAuth, tipo Web) |
| `GOOGLE_CLIENT_SECRET` | Client secret del mismo cliente |
| `SESSION_SECRET` | Texto aleatorio largo, p. ej. `openssl rand -base64 48` |
| `MP_ACCESS_TOKEN` | Access token de producción de la app de Mercado Pago |
| `SITE_URL` | (opcional) `https://horsepos.com` |

Google Cloud → APIs y servicios → Credenciales → ID de cliente OAuth (Aplicación web):
- Orígenes autorizados: `https://horsepos.com`
- URI de redireccionamiento: `https://horsepos.com/api/auth/callback`
- Pantalla de consentimiento: publicar la app (alcances `openid`, `email`, `profile`) con la política `https://horsepos.com/privacidad/`.

Pruebas del servidor: ver `functions/` (se probaron con Google y Mercado Pago simulados).

## Administración, uso y limpieza automática

- **Administrador:** el mail `gtalovergamer@gmail.com` (o los de `ADMIN_EMAILS`, separados por coma), verificado por Google, ve `/admin/`: clientes, último uso, suscripciones de Mercado Pago, ingresos estimados. Desde ahí se puede eximir, quitar un aviso o eliminar una cuenta.
- **Uso:** guardado en D1 (tabla `users`, ver `migrations/0001_users.sql`). Cada login y cada visita a "Mi cuenta" actualiza `last_seen`.
- **Limpieza (Worker `worker-limpieza/`, cron diario):** una cuenta se avisa y, a los 3 días, se elimina si NO está eximida, NO es admin, NO tiene suscripción vigente (`authorized`/`pending`/`paused`), tiene más de 14 días de antigüedad y 30 días sin uso. Reglas en `functions/_lib/sweep.js`.
  - **Solo se elimina si el aviso se envió de verdad.** Sin servicio de mail (`RESEND_API_KEY` + `MAIL_FROM`) no se avisa y **no se borra nada**; la cuenta queda "pendiente de aviso" en el panel.
  - **El borrado real está apagado** hasta que `AUTO_DELETE = "on"`. Mientras tanto solo simula (botón "Simular limpieza" del panel).
  - Si Mercado Pago no responde, la limpieza aborta sin tocar nada.

Puesta en marcha (una vez):
1. `npx wrangler d1 create nodosur` y ejecutar `migrations/0001_users.sql` en esa base (`npx wrangler d1 execute nodosur --file=migrations/0001_users.sql --remote`).
2. Cloudflare Pages → proyecto → Settings → Bindings: agregar D1 con nombre `DB`.
3. Copiar el `database_id` en `worker-limpieza/wrangler.toml` y desplegar: `cd worker-limpieza && npx wrangler deploy`; cargar secretos: `npx wrangler secret put MP_ACCESS_TOKEN` (y, si se usan avisos, `RESEND_API_KEY`, `MAIL_FROM`).

Pruebas: `node --experimental-sqlite tests/auth.test.mjs && node --experimental-sqlite tests/admin.test.mjs`.

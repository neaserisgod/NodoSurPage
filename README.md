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

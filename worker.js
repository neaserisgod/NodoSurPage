// Worker único del sitio: atiende /api/* (login, cuenta, admin) y el resto lo sirve como archivos estáticos.
// Además corre la limpieza diaria (cron). Ver wrangler.jsonc y README.
import * as google from './functions/api/auth/google.js';
import * as callback from './functions/api/auth/callback.js';
import * as logout from './functions/api/auth/logout.js';
import * as me from './functions/api/me.js';
import * as cancel from './functions/api/subscription/cancel.js';
import * as adminOverview from './functions/api/admin/overview.js';
import * as adminUser from './functions/api/admin/user.js';
import * as adminSweep from './functions/api/admin/sweep.js';
import * as checkout from './functions/api/checkout.js';
import * as promo from './functions/api/promo.js';
import * as adminPromo from './functions/api/admin/promo.js';
import { sweep } from './functions/_lib/sweep.js';
import { hasDB } from './functions/_lib/db.js';

const ROUTES = {
  'GET /api/auth/google': google.onRequestGet,
  'GET /api/auth/callback': callback.onRequestGet,
  'POST /api/auth/logout': logout.onRequestPost,
  'GET /api/me': me.onRequestGet,
  'POST /api/subscription/cancel': cancel.onRequestPost,
  'GET /api/admin/overview': adminOverview.onRequestGet,
  'POST /api/admin/user': adminUser.onRequestPost,
  'POST /api/admin/sweep': adminSweep.onRequestPost,
  'GET /api/checkout': checkout.onRequestGet,
  'GET /api/promo': promo.onRequestGet,
  'POST /api/admin/promo': adminPromo.onRequestPost,
};
const NO_STORE = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const handler = ROUTES[`${request.method} ${url.pathname}`];
    if (!handler) {
      const known = Object.keys(ROUTES).some((k) => k.endsWith(` ${url.pathname}`));
      return new Response(JSON.stringify({ error: known ? 'method_not_allowed' : 'not_found' }), { status: known ? 405 : 404, headers: NO_STORE });
    }
    try {
      return await handler({ request, env, ctx });
    } catch (e) {
      console.error('api_error', url.pathname, e && e.message);
      return new Response(JSON.stringify({ error: 'server' }), { status: 500, headers: NO_STORE });
    }
  },

  // Cron diario: avisa y limpia cuentas inactivas sin suscripción (apagado por defecto, ver README).
  async scheduled(_event, env, ctx) {
    if (!hasDB(env) || !env.MP_ACCESS_TOKEN) return;
    ctx.waitUntil(sweep(env, { apply: true }).then((r) =>
      console.log(JSON.stringify({ ok: r.ok, autoDelete: r.autoDelete, notifier: r.notifier, actions: (r.actions || []).map((a) => `${a.action}:${a.email}:${a.applied ?? ''}`) }))));
  },
};

import { json, now, isAdminEmail, cookie } from '../_lib/util.js';
import { currentUser, clearedSession } from '../_lib/auth.js';
import { hasDB, touch, getPromo } from '../_lib/db.js';
import { isPlan } from '../_lib/plans.js';
import { listSubscriptions, listPayments } from '../_lib/mp.js';

export async function onRequestGet({ request, env }) {
  const cu = await currentUser(request, env);
  if (!cu.session) return json({ error: 'no_session' }, 401);
  if (cu.gone) return clearedSession(); // la cuenta fue eliminada
  const s = cu.session;

  let user = cu.user;
  if (user) user = await touch(env, user, now()); // visitar "Mi cuenta" cuenta como uso

  let subscriptions = null, mpError = false;
  if (env.MP_ACCESS_TOKEN) {
    try {
      subscriptions = await listSubscriptions(env, s.email);
      await Promise.all(subscriptions.map(async (sub) => { sub.payments = await listPayments(env, sub.id); }));
    } catch { mpError = true; subscriptions = null; }
  }
  const isAdmin = isAdminEmail(env, s.email);
  const intent = user && isPlan(user.plan_interest) ? { plan: user.plan_interest, promo: Boolean(user.promo_interest) } : null;
  const res = json({
    user: { name: s.name, email: s.email, since: user ? user.created_at : s.iat, lastSeen: user ? user.last_seen : null },
    subscriptions,
    mpConfigured: Boolean(env.MP_ACCESS_TOKEN),
    mpError,
    isAdmin,
    intent,
    promoActive: await getPromo(env),
    notice: user && user.delete_after ? { deleteAfter: user.delete_after } : null,
    tracked: hasDB(env),
  });
  // Cookies de solo lectura para el navegador (no son autenticación): permiten mostrar el aviso
  // "elegí tu sistema" en todo el sitio sin consultar a Mercado Pago en cada página.
  const has = (subscriptions || []).some((x) => ['authorized', 'pending', 'paused'].includes(x.status));
  const month = 30 * 24 * 3600;
  if (isAdmin || has) res.headers.append('Set-Cookie', cookie('ns_sub', '1', { maxAge: month, httpOnly: false }));
  else if (!mpError) res.headers.append('Set-Cookie', cookie('ns_sub', '0', { maxAge: month, httpOnly: false }));
  res.headers.append('Set-Cookie', cookie('ns_plan', intent ? intent.plan : '', { maxAge: intent ? month : 0, httpOnly: false }));
  return res;
}

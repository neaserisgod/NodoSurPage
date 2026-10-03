import { json, now, isAdminEmail, cookie } from '../_lib/util.js';
import { currentUser, clearedSession } from '../_lib/auth.js';
import { hasDB, touch, getPromo } from '../_lib/db.js';
import { isPlan } from '../_lib/plans.js';
import { listSubscriptions, listPayments } from '../_lib/mp.js';
import { membershipsOf, describirOrgs } from '../_lib/orgs.js';

export async function onRequestGet({ request, env }) {
  const cu = await currentUser(request, env);
  if (!cu.session) return json({ error: 'no_session' }, 401);
  if (cu.gone) return clearedSession(); // la cuenta fue eliminada
  const s = cu.session;

  let user = cu.user;
  if (user) user = await touch(env, user, now()); // visitar "Mi cuenta" cuenta como uso

  // Negocios de la persona. Quien solo es miembro (encargado o empleado) y no es dueño de ninguno no paga nada: la
  // suscripción es del negocio. A esa persona no se le consulta Mercado Pago ni se le ofrece "elegí tu sistema".
  const membresias = hasDB(env) ? await membershipsOf(env, s.sub) : [];
  const isAdmin = isAdminEmail(env, s.email);
  const exempt = Boolean(user && user.exempt); // cuenta eximida: como la de administración, no paga
  const billing = isAdmin || !membresias.length || membresias.some((m) => m.role === 'owner');

  let subscriptions = null, mpError = false;
  if (billing && env.MP_ACCESS_TOKEN) {
    try {
      subscriptions = await listSubscriptions(env, s.email);
      await Promise.all(subscriptions.map(async (sub) => { sub.payments = await listPayments(env, sub.id); }));
    } catch { mpError = true; subscriptions = null; }
  }
  // ¿El negocio del que es dueño está cubierto por la suscripción de OTRA persona (típico tras una transferencia, mientras
  // la dueña anterior siga pagando)? Entonces no se la molesta con "elegí tu sistema". Solo se mira si ella no paga por su cuenta.
  let covered = false;
  if (billing && env.MP_ACCESS_TOKEN && !mpError && !(subscriptions || []).some((x) => x.status === 'authorized')) {
    const otros = [...new Set(membresias.filter((m) => m.role === 'owner' && m.org.billing_email !== s.email).map((m) => m.org.billing_email))];
    for (const e of otros) {
      try { if ((await listSubscriptions(env, e)).some((x) => x.status === 'authorized')) { covered = true; break; } } catch { /* ante la duda, no se asume cubierta */ }
    }
  }
  const intent = billing && user && isPlan(user.plan_interest) ? { plan: user.plan_interest, promo: Boolean(user.promo_interest) } : null;
  const res = json({
    user: { name: s.name, email: s.email, since: user ? user.created_at : s.iat, lastSeen: user ? user.last_seen : null },
    subscriptions,
    billing,
    covered,
    orgs: await describirOrgs(env, membresias),
    mpConfigured: Boolean(env.MP_ACCESS_TOKEN),
    mpError,
    isAdmin,
    exempt,
    intent,
    promoActive: await getPromo(env),
    notice: user && user.delete_after ? { deleteAfter: user.delete_after } : null,
    tracked: hasDB(env),
  });
  // Cookies de solo lectura para el navegador (no son autenticación): permiten mostrar el aviso
  // "elegí tu sistema" en todo el sitio sin consultar a Mercado Pago en cada página.
  const has = (subscriptions || []).some((x) => ['authorized', 'pending', 'paused'].includes(x.status));
  const month = 30 * 24 * 3600;
  // ns_sub: 1 = puede descargar (el menú muestra "Descargar"), 0 = debería suscribirse (aparece "Elegí tu sistema"), 2 = no necesita
  // ni una cosa ni la otra (un empleado: lo paga el negocio y no descarga). Dos usos distintos de la misma cookie, así que el valor
  // "no molestar" no puede ser 1: un empleado vería un "Descargar" que lo llevaría a una página que le niega el acceso.
  const puedeDescargar = (await describirOrgs(env, membresias)).some((o) => o.can.descargar);
  if (isAdmin || exempt || has || covered || (!billing && puedeDescargar)) res.headers.append('Set-Cookie', cookie('ns_sub', '1', { maxAge: month, httpOnly: false }));
  else if (!billing) res.headers.append('Set-Cookie', cookie('ns_sub', '2', { maxAge: month, httpOnly: false }));
  else if (!mpError) res.headers.append('Set-Cookie', cookie('ns_sub', '0', { maxAge: month, httpOnly: false }));
  res.headers.append('Set-Cookie', cookie('ns_plan', intent ? intent.plan : '', { maxAge: intent ? month : 0, httpOnly: false }));
  return res;
}

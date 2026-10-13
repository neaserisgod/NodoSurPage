import { now, siteUrl } from '../_lib/util.js';
import { currentUser } from '../_lib/auth.js';
import { hasDB, setIntent } from '../_lib/db.js';
import { isPlan, checkoutTarget, ALTA_URL } from '../_lib/plans.js';

const go = (location) => new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });

// Único camino para pagar: exige sesión. Sin sesión, recuerda el plan y manda a ingresar con Google.
//   /api/checkout?plan=pos|pos-bot|bot|emprendedor   -> suscripción en Mercado Pago
//   /api/checkout?item=alta&plan=pos-bot|bot         -> alta única del bot
export async function onRequestGet({ request, env }) {
  const site = siteUrl(env);
  const q = new URL(request.url).searchParams;
  const plan = q.get('plan');
  const alta = q.get('item') === 'alta';
  if (!isPlan(plan) || (alta && !['pos-bot', 'bot'].includes(plan))) return go(`${site}/pagar/`);

  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) {
    const back = new URLSearchParams({ plan });
    if (alta) back.set('item', 'alta');
    return go(`${site}/ingresar/?${back}`);
  }

  if (hasDB(env) && cu.user) {
    try { await setIntent(env, cu.user.id, plan, now()); } catch { /* recordar el plan no debe impedir pagar */ }
  }
  return go(alta ? ALTA_URL : checkoutTarget(plan));
}

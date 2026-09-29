import { getSession, json } from '../_lib/util.js';
import { listSubscriptions, listPayments } from '../_lib/mp.js';

export async function onRequestGet({ request, env }) {
  const s = await getSession(request, env);
  if (!s) return json({ error: 'no_session' }, 401);

  let subscriptions = null, mpError = false;
  if (env.MP_ACCESS_TOKEN) {
    try {
      subscriptions = await listSubscriptions(env, s.email);
      await Promise.all(subscriptions.map(async (sub) => { sub.payments = await listPayments(env, sub.id); }));
    } catch { mpError = true; subscriptions = null; }
  }
  return json({
    user: { name: s.name, email: s.email, since: s.iat },
    subscriptions,
    mpConfigured: Boolean(env.MP_ACCESS_TOKEN),
    mpError,
  });
}

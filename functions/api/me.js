import { json, now, isAdminEmail } from '../_lib/util.js';
import { currentUser, clearedSession } from '../_lib/auth.js';
import { hasDB, touch } from '../_lib/db.js';
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
  return json({
    user: { name: s.name, email: s.email, since: user ? user.created_at : s.iat, lastSeen: user ? user.last_seen : null },
    subscriptions,
    mpConfigured: Boolean(env.MP_ACCESS_TOKEN),
    mpError,
    isAdmin: isAdminEmail(env, s.email),
    notice: user && user.delete_after ? { deleteAfter: user.delete_after } : null,
    tracked: hasDB(env),
  });
}

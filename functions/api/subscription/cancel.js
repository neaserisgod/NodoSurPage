import { json, sameOriginPost } from '../../_lib/util.js';
import { currentUser } from '../../_lib/auth.js';
import { listSubscriptions, cancelSubscription } from '../../_lib/mp.js';

export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') {
    return json({ error: 'forbidden' }, 403);
  }
  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return json({ error: 'no_session' }, 401);
  const s = cu.session;
  if (!env.MP_ACCESS_TOKEN) return json({ error: 'not_configured' }, 503);

  let id;
  try { ({ id } = await request.json()); } catch { return json({ error: 'bad_request' }, 400); }
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) return json({ error: 'bad_request' }, 400);

  let subs;
  try { subs = await listSubscriptions(env, s.email); } catch { return json({ error: 'mp_error' }, 502); }
  const sub = subs.find((x) => x.id === id);
  if (!sub) return json({ error: 'not_yours' }, 403); // solo la propia, por mail verificado
  if (sub.status === 'cancelled') return json({ ok: true, already: true });

  const r = await cancelSubscription(env, id);
  return r.ok ? json({ ok: true }) : json({ error: 'mp_error' }, 502);
}

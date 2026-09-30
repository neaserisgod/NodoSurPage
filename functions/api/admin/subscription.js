import { json, sameOriginPost } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { listAllSubscribers, cancelSubscription, clearMpCache } from '../../_lib/mp.js';

// El administrador da de baja la suscripción de cualquier cliente (solo de los planes propios).
// Corta los cobros en Mercado Pago; no borra la cuenta del sitio ni devuelve plata.
export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  const g = await requireAdmin(request, env);
  if (g.error) return g.error;
  if (!env.MP_ACCESS_TOKEN) return json({ error: 'not_configured' }, 503);

  let id;
  try { ({ id } = await request.json()); } catch { return json({ error: 'bad_request' }, 400); }
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) return json({ error: 'bad_request' }, 400);

  let sub;
  try { sub = (await listAllSubscribers(env, { fresh: true })).find((x) => x.id === id); }
  catch { return json({ error: 'mp_error' }, 502); }
  if (!sub) return json({ error: 'not_found' }, 404); // solo suscripciones de nuestros planes
  if (sub.status === 'cancelled' || sub.status === 'canceled') return json({ ok: true, already: true });

  const r = await cancelSubscription(env, id);
  clearMpCache(); // que el panel muestre el estado nuevo enseguida
  return r.ok ? json({ ok: true }) : json({ error: 'mp_error' }, 502);
}

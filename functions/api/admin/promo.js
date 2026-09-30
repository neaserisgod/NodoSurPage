import { json, sameOriginPost, now } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { hasDB, setPromo } from '../../_lib/db.js';

// El administrador activa o desactiva el precio de fundador a voluntad.
export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  const g = await requireAdmin(request, env);
  if (g.error) return g.error;
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (typeof body.activa !== 'boolean') return json({ error: 'bad_request' }, 400);
  await setPromo(env, body.activa, now());
  return json({ ok: true, activa: body.activa });
}

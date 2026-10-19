import { json, sameOriginPost } from '../_lib/util.js';
import { currentUser, clearedSession } from '../_lib/auth.js';
import { hasDB } from '../_lib/db.js';
import { canjearPiloto } from '../_lib/pilotos.js';

// La página /invitado/ canjea su link: sin sesión responde 401 y la página manda a ingresar con Google.
export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  const cu = await currentUser(request, env);
  if (!cu.session) return json({ error: 'no_session' }, 401);
  if (cu.gone) return clearedSession();
  if (!hasDB(env) || !cu.user) return json({ error: 'no_db' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (!/^[0-9a-f]{64}$/.test(String(body.token || ''))) return json({ error: 'no_valido' }, 400);
  const r = await canjearPiloto(env, body.token, cu.user);
  return r.ok ? json(r) : json(r, 409);
}

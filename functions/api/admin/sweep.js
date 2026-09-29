import { json, sameOriginPost } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { sweep } from '../../_lib/sweep.js';

// Simulación de la limpieza: muestra qué pasaría, sin enviar avisos ni borrar nada.
export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  const g = await requireAdmin(request, env);
  if (g.error) return g.error;
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  return json(await sweep(env, { apply: false }));
}

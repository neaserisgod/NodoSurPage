import { json, sameOriginPost } from '../../_lib/util.js';
import { currentUser } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { crearOtroNegocio } from '../../_lib/orgs.js';

// Crear otro negocio desde "Mi negocio" (2026-10-13): una misma cuenta puede tener varios, y cada uno paga su plan. Cuerpo:
// { name }. Devuelve { orgId }.
export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return json({ error: 'no_session' }, 401);
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const r = await crearOtroNegocio(env, cu.session, b && b.name);
  return r.error ? json({ error: r.error }, r.status) : json({ orgId: r.org.id });
}

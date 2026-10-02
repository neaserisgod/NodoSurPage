import { json, sameOriginPost } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { ensureOrgTables, getOrg } from '../../_lib/orgs.js';
import { emailValido, normEmail, readJson } from '../../_lib/miembros.js';

// El administrador de la plataforma ajusta el mail con el que se cobra un negocio (caso de soporte: pagó con otro
// mail, o una transferencia que no se resolvió sola). Solo cambia a quién se le pregunta en Mercado Pago.
export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  const g = await requireAdmin(request, env);
  if (g.error) return g.error;
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  const b = await readJson(request);
  const email = normEmail(b && b.billingEmail);
  if (!b || !Number.isInteger(b.orgId) || !emailValido(email)) return json({ error: 'bad_request' }, 400);
  await ensureOrgTables(env);
  if (!(await getOrg(env, b.orgId))) return json({ error: 'not_found' }, 404);
  await env.DB.prepare('UPDATE orgs SET billing_email = ?2 WHERE id = ?1').bind(b.orgId, email).run();
  return json({ ok: true });
}

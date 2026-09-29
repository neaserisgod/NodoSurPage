import { json, sameOriginPost } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { hasDB, getById, setExempt, clearNotice, deleteUser } from '../../_lib/db.js';
import { isAdminEmail } from '../../_lib/util.js';

// Acciones manuales del administrador sobre un usuario: eximir, quitar aviso, eliminar.
export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  const g = await requireAdmin(request, env);
  if (g.error) return g.error;
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const id = Number(body.id), action = body.action;
  if (!Number.isInteger(id) || !['exempt', 'unexempt', 'clear_notice', 'delete'].includes(action)) return json({ error: 'bad_request' }, 400);

  const u = await getById(env, id);
  if (!u) return json({ error: 'not_found' }, 404);
  if (action === 'delete' && (isAdminEmail(env, u.email) || u.id === g.user.id)) return json({ error: 'protected' }, 409);

  if (action === 'exempt') await setExempt(env, id, true);
  else if (action === 'unexempt') await setExempt(env, id, false);
  else if (action === 'clear_notice') await clearNotice(env, id);
  else await deleteUser(env, id);
  return json({ ok: true });
}

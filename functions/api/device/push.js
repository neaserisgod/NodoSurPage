import { json } from '../../_lib/util.js';
import { actorOf } from '../../_lib/actor.js';
import { hasDB } from '../../_lib/db.js';
import { guardarTokenPush, tokenPushValido } from '../../_lib/push.js';

// POST /api/device/push (la app del celular): `{ token }`, el token de Firebase Cloud Messaging de este equipo. Con eso le llegan
// los pedidos y turnos nuevos del bot aunque la app esté cerrada (`functions/_lib/push.js`). Queda atado al equipo vinculado.
export async function onRequestPost({ request, env }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  if (!hasDB(env)) return json({ error: 'db' }, 503);
  if (!a.device.owner_org) return json({ error: 'sin_negocio' }, 409);
  let b = null; try { b = await request.json(); } catch { /* cuerpo roto */ }
  if (!b || !tokenPushValido(b.token)) return json({ error: 'bad_request' }, 400);
  await guardarTokenPush(env, { deviceId: a.device.id, orgId: a.device.owner_org, branchId: a.device.branch_id ?? 0, token: b.token });
  return json({ ok: true });
}

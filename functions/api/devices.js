import { json } from '../_lib/util.js';
import { actorOf, csrfOk, forbidden } from '../_lib/actor.js';
import { listDevices, revokeDevice } from '../_lib/devices.js';
import { orgsWith } from '../_lib/orgs.js';

const pub = (d, actual) => ({ id: d.id, name: d.name, version: d.app_version, os: d.os, lastSeen: d.last_seen, createdAt: d.created_at, branchId: d.branch_id ?? null, orgId: d.owner_org ?? null, current: d.id === actual });

// Mis dispositivos (Mi cuenta, o la propia app): los que vinculé yo y, si soy dueña, los de todo mi negocio.
const orgIdsDe = async (env, sub) => (await orgsWith(env, sub, 'vincular_pc')).map((o) => o.org.id);
export async function onRequestGet({ request, env }) {
  const a = await actorOf(request, env);
  if (!a) return json({ error: 'no_session' }, 401);
  return json({ devices: (await listDevices(env, a.sub, await orgIdsDe(env, a.sub))).map((d) => pub(d, a.device && a.device.id)) });
}

// Desvincular un dispositivo (PC perdida o dada de baja). Desde la sesión web, cualquiera propio o de un negocio
// que administro; desde la app, el propio.
export async function onRequestRevoke({ request, env }) {
  const a = await actorOf(request, env);
  if (!a) return json({ error: 'no_session' }, 401);
  if (!csrfOk(request, env, a)) return forbidden();
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const id = a.via === 'device' ? a.device.id : b.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) return json({ error: 'bad_request' }, 400);
  await revokeDevice(env, id, a.sub, await orgIdsDe(env, a.sub));
  return json({ ok: true });
}

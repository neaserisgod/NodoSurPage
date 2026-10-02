import { json } from '../../_lib/util.js';
import { actorOf } from '../../_lib/actor.js';
import { hasDB } from '../../_lib/db.js';
import { getMembership } from '../../_lib/orgs.js';

// Quién es la persona que vinculó ESTE dispositivo (con el token de dispositivo): el celular lo usa para tomar su perfil
// de la cuenta en vez de elegirlo de una lista. Nunca devuelve ids de Google.
export async function onRequestGet({ request, env }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  let role = null;
  if (hasDB(env) && a.device.owner_org) {
    try { const m = await getMembership(env, a.device.owner_org, a.sub); role = m && m.status === 'active' ? m.role : null; } catch { role = null; }
  }
  const name = (a.device.person_name || '').trim() || String(a.email).split('@')[0];
  return json({ email: a.email, name, role, orgId: a.device.owner_org ?? null, branchId: a.device.branch_id ?? null });
}

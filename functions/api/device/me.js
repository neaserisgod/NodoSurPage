import { json } from '../../_lib/util.js';
import { actorOf } from '../../_lib/actor.js';
import { hasDB } from '../../_lib/db.js';
import { getMembership, getOrg, listBranches } from '../../_lib/orgs.js';

// Quién es la persona que vinculó ESTE dispositivo (con el token de dispositivo): el celular lo usa para tomar su perfil
// de la cuenta en vez de elegirlo de una lista. Nunca devuelve ids de Google. Con el negocio y la sucursal (id y nombre): una
// cuenta puede tener varios negocios en el mismo celular, y la app los muestra por nombre (2026-10-13).
export async function onRequestGet({ request, env }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  let role = null, orgName = null, branchName = null;
  if (hasDB(env) && a.device.owner_org) {
    try { const m = await getMembership(env, a.device.owner_org, a.sub); role = m && m.status === 'active' ? m.role : null; } catch { role = null; }
    try {
      orgName = (await getOrg(env, a.device.owner_org) || {}).name ?? null;
      branchName = ((await listBranches(env, a.device.owner_org)).find((b) => b.id === a.device.branch_id) || {}).name ?? null;
    } catch { /* solo para mostrar */ }
  }
  const name = (a.device.person_name || '').trim() || String(a.email).split('@')[0];
  return json({ email: a.email, name, role, orgId: a.device.owner_org ?? null, branchId: a.device.branch_id ?? null, orgName, branchName });
}

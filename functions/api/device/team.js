import { json } from '../../_lib/util.js';
import { actorOf } from '../../_lib/actor.js';
import { hasDB } from '../../_lib/db.js';
import { getMembership, listBranches, getOrg } from '../../_lib/orgs.js';

// El equipo del negocio visto desde la PC (solo lectura, con el token de dispositivo): en qué sucursal está esta PC y, si quien la
// vinculó es el dueño, quiénes trabajan en el negocio con su rol y sus sucursales. La PC lo muestra en Configuración → Cuenta.
// Las listas completas (/api/org/members, /api/org/branches) siguen siendo solo de la sesión web del dueño: acá no se puede
// cambiar nada. Un encargado o un empleado ve su sucursal y nada del resto del equipo.
export async function onRequestGet({ request, env }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  const orgId = a.device.owner_org;
  if (!hasDB(env) || !orgId) return json({ org: null, branch: null, role: null, members: null });

  const yo = await getMembership(env, orgId, a.sub);
  const role = yo && yo.status === 'active' ? yo.role : null;
  const org = await getOrg(env, orgId);
  const sucursales = await listBranches(env, orgId);
  const mia = sucursales.find((b) => Number(b.id) === Number(a.device.branch_id));
  const cuerpo = {
    org: org ? { id: org.id, name: org.name } : null,
    branch: mia ? { id: mia.id, name: mia.name } : null,
    role,
    members: null,
  };
  if (role !== 'owner') return json(cuerpo);

  const nombres = new Map(sucursales.map((b) => [Number(b.id), b.name]));
  const filas = (await env.DB.prepare(
    `SELECT m.id, m.email, m.role, m.all_branches, u.name AS user_name FROM memberships m LEFT JOIN users u ON u.sub = m.user_sub
     WHERE m.org_id = ?1 AND m.status = 'active' ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.id`).bind(orgId).all()).results;
  cuerpo.members = [];
  for (const m of filas) {
    const ramas = (await env.DB.prepare('SELECT branch_id FROM membership_branches WHERE membership_id = ?1 ORDER BY branch_id').bind(m.id).all()).results
      .map((r) => nombres.get(Number(r.branch_id))).filter(Boolean);
    cuerpo.members.push({ name: m.user_name || null, email: m.email, role: m.role, allBranches: Boolean(m.all_branches), branches: ramas });
  }
  return json(cuerpo);
}

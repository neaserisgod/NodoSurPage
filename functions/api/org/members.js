import { json } from '../../_lib/util.js';
import { guard, readJson, listarMiembros, cambiarMiembro, quitarMiembro } from '../../_lib/miembros.js';

const fallo = (r) => json({ error: r.error }, r.status);

// El equipo del negocio (solo el dueño): miembros activos, invitaciones pendientes y sucursales. ?org=ID
export async function onRequestGet({ request, env }) {
  const g = await guard(request, env, { orgId: Number(new URL(request.url).searchParams.get('org')), accion: 'miembros' });
  if (g.error) return g.error;
  return json(await listarMiembros(env, g.org, g.a.sub));
}

// Cambiar rol y/o sucursales de un miembro. Cuerpo: { orgId, memberId, role?, allBranches?, branchIds? }.
export async function onRequestUpdate({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'miembros' });
  if (g.error) return g.error;
  const r = await cambiarMiembro(env, g.org, b.memberId, b);
  return r.error ? fallo(r) : json({ ok: true });
}

// Quitar a un miembro (queda inactivo). Cuerpo: { orgId, memberId }.
export async function onRequestRemove({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'miembros' });
  if (g.error) return g.error;
  const r = await quitarMiembro(env, g.org, b.memberId);
  return r.error ? fallo(r) : json({ ok: true });
}

import { json } from '../../_lib/util.js';
import { guard, readJson, listarSucursales, crearSucursal, cambiarSucursal } from '../../_lib/miembros.js';

const fallo = (r) => json({ error: r.error }, r.status);

// Sucursales del negocio, con cuántas PC tiene cada una (solo el dueño). ?org=ID
export async function onRequestGet({ request, env }) {
  const g = await guard(request, env, { orgId: Number(new URL(request.url).searchParams.get('org')), accion: 'sucursales' });
  if (g.error) return g.error;
  return json({ branches: await listarSucursales(env, g.org) });
}

// Crear una sucursal. Cuerpo: { orgId, name }.
export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'sucursales' });
  if (g.error) return g.error;
  const r = await crearSucursal(env, g.org, b.name);
  return r.error ? fallo(r) : json({ ok: true, branch: r.branch });
}

// Renombrar o cerrar/reabrir una sucursal. Cuerpo: { orgId, branchId, name?, active? }.
export async function onRequestUpdate({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'sucursales' });
  if (g.error) return g.error;
  const r = await cambiarSucursal(env, g.org, b.branchId, b);
  return r.error ? fallo(r) : json({ ok: true, branch: r.branch });
}

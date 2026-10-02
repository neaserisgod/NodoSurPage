// Miembros, invitaciones y sucursales de un negocio. Solo el dueño las administra (permisos.js decide).
//
// Una invitación es un link con un token de 256 bits: en la base queda solo su huella (SHA-256), así que ni
// una filtración de la base permite aceptarla. Se acepta con el Google cuyo mail verificado coincide con el
// invitado: el token solo no alcanza, y quien tenga el link con otro mail no entra ni ve a qué negocio era.
import { json, now, randomHex, sha256b64u, siteUrl } from './util.js';
import { actorOf, csrfOk, forbidden } from './actor.js';
import { hasDB } from './db.js';
import { ensureOrgTables, orgsWith, getOrg, listBranches } from './orgs.js';

export const INVITE_TTL = 7 * 24 * 3600;
export const MAX_PENDIENTES = 100;
export const MAX_SUCURSALES = 200;
export const ROLES_INVITABLES = ['manager', 'employee'];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;
export const softCap = (env) => Number(env.MAX_MIEMBROS_SIN_COSTO) || 50;

export const readJson = async (request) => { try { const b = await request.json(); return b && typeof b === 'object' ? b : null; } catch { return null; } };
const err = (error, status) => ({ error: json({ error }, status) });
export const normEmail = (e) => String(e ?? '').trim().toLowerCase();
export const enmascarar = (e) => String(e).replace(/^(.).*(@.*)$/, '$1***$2');

// Quien llama (solo sesión web, nunca una PC), con mismo origen en lo que escribe y, si se pide `accion`, con ese
// permiso sobre el negocio `orgId`. Devuelve { a, org, membership } o { error: Response }.
export async function guard(request, env, { write = false, orgId, accion } = {}) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'session') return err('no_session', 401);
  if (write && !csrfOk(request, env, a)) return { error: forbidden() };
  if (!hasDB(env)) return err('no_db', 503);
  await ensureOrgTables(env);
  if (accion === undefined) return { a };
  if (!Number.isInteger(orgId) || orgId < 1) return err('bad_request', 400);
  const hit = (await orgsWith(env, a.sub, accion)).find((o) => o.org.id === orgId);
  return hit ? { a, org: hit.org, membership: hit.membership } : err('forbidden', 403);
}

// Qué sucursales se asignan: todas, o una lista (no vacía) de sucursales ACTIVAS de este negocio.
export async function asignacion(env, orgId, body) {
  if (body.allBranches === true) return { all: 1, ids: [] };
  const ids = body.branchIds;
  if (!Array.isArray(ids) || !ids.length || !ids.every((x) => Number.isInteger(x))) return { error: 'bad_branches' };
  const validas = new Set((await listBranches(env, orgId)).filter((b) => b.active).map((b) => b.id));
  if (!ids.every((x) => validas.has(x))) return { error: 'bad_branches' };
  return { all: 0, ids: [...new Set(ids)] };
}
const guardarSucursales = async (env, membershipId, ids) => {
  await env.DB.prepare('DELETE FROM membership_branches WHERE membership_id = ?1').bind(membershipId).run();
  for (const id of ids) await env.DB.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?1, ?2)').bind(membershipId, id).run();
};

// --- invitaciones
export async function crearInvitacion(env, { org, email, role, all, ids }, t = now()) {
  if (!EMAIL_RE.test(email) || email.length > 254) return { status: 400, error: 'bad_email' };
  if (!ROLES_INVITABLES.includes(role)) return { status: 400, error: 'bad_role' };
  if (await env.DB.prepare("SELECT 1 AS x FROM memberships WHERE org_id = ?1 AND lower(email) = ?2 AND status = 'active'").bind(org.id, email).first()) return { status: 409, error: 'already_member' };
  await env.DB.prepare('DELETE FROM invitations WHERE org_id = ?1 AND email = ?2 AND accepted_at IS NULL').bind(org.id, email).run(); // reinvitar reemplaza
  await env.DB.prepare('DELETE FROM invitations WHERE accepted_at IS NULL AND exp < ?1').bind(t - 30 * 24 * 3600).run(); // limpieza: vencidas hace más de 30 días
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM invitations WHERE org_id = ?1 AND accepted_at IS NULL AND exp > ?2').bind(org.id, t).first();
  if (n >= MAX_PENDIENTES) return { status: 429, error: 'too_many_pending' };
  const token = randomHex(32);
  await env.DB.prepare(
    `INSERT INTO invitations (org_id, email, role, all_branches, branch_ids, token_hash, exp, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(org.id, email, role, all, JSON.stringify(ids), await sha256b64u(token), t + INVITE_TTL, t).run();
  const fila = await env.DB.prepare('SELECT id FROM invitations WHERE token_hash = ?1').bind(await sha256b64u(token)).first();
  return { token, invitation: { id: fila.id, email, role, allBranches: Boolean(all), branchIds: ids, exp: t + INVITE_TTL }, link: `${siteUrl(env)}/unirse/?t=${token}` };
}

const porToken = async (env, token) => (TOKEN_RE.test(token) ? env.DB.prepare('SELECT * FROM invitations WHERE token_hash = ?1').bind(await sha256b64u(token)).first() : null);

// Qué sucursales de la invitación siguen existiendo y activas (pudieron cerrarse desde que se invitó).
const sucursalesVigentes = async (env, orgId, inv) => {
  if (inv.all_branches) return { all: 1, ids: [] };
  let pedidas = []; try { pedidas = JSON.parse(inv.branch_ids || '[]'); } catch { /* vacío */ }
  const activas = new Set((await listBranches(env, orgId)).filter((b) => b.active).map((b) => b.id));
  return { all: 0, ids: pedidas.filter((x) => activas.has(x)) };
};

// Vista previa para la página de aceptar: solo para quien tiene el mail invitado.
export async function verInvitacion(env, { token, email }, t = now()) {
  const inv = await porToken(env, token);
  if (!inv) return { status: 404, error: 'not_found' };
  if (inv.email !== email) return { status: 403, error: 'wrong_email', hint: enmascarar(inv.email) };
  if (inv.accepted_at || inv.exp < t) return { status: 410, error: inv.accepted_at ? 'used' : 'expired' };
  const org = await getOrg(env, inv.org_id); if (!org) return { status: 404, error: 'not_found' };
  const v = await sucursalesVigentes(env, org.id, inv);
  const todas = await listBranches(env, org.id);
  return { org: { name: org.name }, role: inv.role, email: inv.email, allBranches: Boolean(v.all),
    branches: v.all ? todas.filter((b) => b.active).map((b) => b.name) : todas.filter((b) => v.ids.includes(b.id)).map((b) => b.name), exp: inv.exp };
}

export async function aceptarInvitacion(env, { token, sub, email }, t = now()) {
  const inv = await porToken(env, token);
  if (!inv) return { status: 404, error: 'not_found' };
  if (inv.email !== email) return { status: 403, error: 'wrong_email' }; // antes que "usada/vencida": a otra persona no se le cuenta el estado
  if (inv.accepted_at) return { status: 410, error: 'used' };
  if (inv.exp < t) return { status: 410, error: 'expired' };
  const org = await getOrg(env, inv.org_id); if (!org) return { status: 404, error: 'not_found' };
  const v = await sucursalesVigentes(env, org.id, inv);
  if (!v.all && !v.ids.length) return { status: 409, error: 'branches_unavailable' };
  const previa = await env.DB.prepare('SELECT * FROM memberships WHERE org_id = ?1 AND user_sub = ?2').bind(org.id, sub).first();
  if (previa && previa.status === 'active') return { status: 409, error: 'already_member' }; // un dueño no se degrada aceptando una invitación
  // Se "reclama" primero: si dos pedidos llegan a la vez, solo uno cambia la fila.
  const reclamo = await env.DB.prepare('UPDATE invitations SET accepted_at = ?1 WHERE id = ?2 AND accepted_at IS NULL').bind(t, inv.id).run();
  if (!reclamo.meta || reclamo.meta.changes !== 1) return { status: 410, error: 'used' };
  try {
    let id;
    if (previa) {
      id = previa.id; await env.DB.prepare("UPDATE memberships SET status = 'active', role = ?2, all_branches = ?3, email = ?4 WHERE id = ?1").bind(id, inv.role, v.all, email).run();
    } else {
      await env.DB.prepare("INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)").bind(org.id, sub, email, inv.role, v.all, t).run();
      id = (await env.DB.prepare('SELECT id FROM memberships WHERE org_id = ?1 AND user_sub = ?2').bind(org.id, sub).first()).id;
    }
    await guardarSucursales(env, id, v.ids);
  } catch (e) { await env.DB.prepare('UPDATE invitations SET accepted_at = NULL WHERE id = ?1').bind(inv.id).run(); throw e; }
  return { orgId: org.id, orgName: org.name, role: inv.role };
}

export async function revocarInvitacion(env, orgId, invitationId) {
  const r = await env.DB.prepare('DELETE FROM invitations WHERE id = ?1 AND org_id = ?2 AND accepted_at IS NULL').bind(invitationId, orgId).run();
  return r.meta && r.meta.changes === 1;
}

// --- miembros
export async function listarMiembros(env, org, subActual, t = now()) {
  const filas = (await env.DB.prepare(
    `SELECT m.*, u.name AS user_name FROM memberships m LEFT JOIN users u ON u.sub = m.user_sub
     WHERE m.org_id = ?1 AND m.status = 'active' ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.id`).bind(org.id).all()).results;
  const miembros = [];
  for (const m of filas) {
    const ramas = (await env.DB.prepare('SELECT branch_id FROM membership_branches WHERE membership_id = ?1 ORDER BY branch_id').bind(m.id).all()).results.map((r) => Number(r.branch_id));
    miembros.push({ id: m.id, email: m.email, name: m.user_name || null, role: m.role, allBranches: Boolean(m.all_branches), branchIds: ramas, since: m.created_at, isYou: m.user_sub === subActual });
  }
  const invitaciones = (await env.DB.prepare('SELECT * FROM invitations WHERE org_id = ?1 AND accepted_at IS NULL AND exp > ?2 ORDER BY id').bind(org.id, t).all()).results
    .map((i) => ({ id: i.id, email: i.email, role: i.role, allBranches: Boolean(i.all_branches), branchIds: JSON.parse(i.branch_ids || '[]'), exp: i.exp, createdAt: i.created_at }));
  const cap = softCap(env);
  return { members: miembros, invitations: invitaciones, branches: (await listBranches(env, org.id)).map((b) => ({ id: b.id, name: b.name, active: Boolean(b.active) })),
    count: miembros.length, softCap: cap, overSoftCap: miembros.length > cap };
}

const miembroDe = (env, orgId, memberId) => env.DB.prepare("SELECT * FROM memberships WHERE id = ?1 AND org_id = ?2 AND status = 'active'").bind(memberId, orgId).first();

// Cambia rol y/o sucursales. Al dueño no se lo toca (la propiedad se transfiere aparte) y nadie pasa a ser dueño por acá.
export async function cambiarMiembro(env, org, memberId, body) {
  const m = Number.isInteger(memberId) ? await miembroDe(env, org.id, memberId) : null;
  if (!m) return { status: 404, error: 'not_found' };
  if (m.role === 'owner') return { status: 403, error: 'owner_immutable' };
  if (body.role !== undefined && !ROLES_INVITABLES.includes(body.role)) return { status: 400, error: 'bad_role' };
  let asig = null;
  if (body.allBranches !== undefined || body.branchIds !== undefined) {
    asig = await asignacion(env, org.id, body); if (asig.error) return { status: 400, error: asig.error };
  }
  if (body.role !== undefined) await env.DB.prepare('UPDATE memberships SET role = ?2 WHERE id = ?1').bind(m.id, body.role).run();
  if (asig) { await env.DB.prepare('UPDATE memberships SET all_branches = ?2 WHERE id = ?1').bind(m.id, asig.all).run(); await guardarSucursales(env, m.id, asig.ids); }
  return { ok: true };
}

// Quitar = dejarlo inactivo (las ventas viejas conservan su nombre). Sus PC dejan de valer solas (deviceFromRequest).
export async function quitarMiembro(env, org, memberId) {
  const m = Number.isInteger(memberId) ? await miembroDe(env, org.id, memberId) : null;
  if (!m) return { status: 404, error: 'not_found' };
  if (m.role === 'owner') return { status: 403, error: 'owner_immutable' };
  await env.DB.prepare("UPDATE memberships SET status = 'removed', pin_hash = NULL WHERE id = ?1").bind(m.id).run();
  await env.DB.prepare('DELETE FROM membership_branches WHERE membership_id = ?1').bind(m.id).run();
  return { ok: true };
}

// --- sucursales
const limpiarNombre = (n) => String(n ?? '').replace(/[^\p{L}\p{N} ._()'&-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
const pubSucursal = (b) => ({ id: b.id, name: b.name, active: Boolean(b.active) });

export async function listarSucursales(env, org) {
  const out = [];
  for (const b of await listBranches(env, org.id)) {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE branch_id = ?1 AND revoked = 0').bind(b.id).first();
    out.push({ ...pubSucursal(b), devices: n });
  }
  return out;
}
const nombreTomado = async (env, orgId, nombre, exceptoId) =>
  (await listBranches(env, orgId)).some((b) => b.id !== exceptoId && b.name.toLowerCase() === nombre.toLowerCase());

export async function crearSucursal(env, org, name, t = now()) {
  const nombre = limpiarNombre(name); if (!nombre) return { status: 400, error: 'bad_name' };
  const todas = await listBranches(env, org.id);
  if (todas.length >= MAX_SUCURSALES) return { status: 409, error: 'too_many' };
  if (await nombreTomado(env, org.id, nombre)) return { status: 409, error: 'name_taken' };
  await env.DB.prepare('INSERT INTO branches (org_id, name, active, created_at) VALUES (?1, ?2, 1, ?3)').bind(org.id, nombre, t).run();
  return { branch: pubSucursal((await listBranches(env, org.id)).find((b) => b.name === nombre)) };
}

export async function cambiarSucursal(env, org, branchId, body) {
  const b = (await listBranches(env, org.id)).find((x) => x.id === branchId);
  if (!b) return { status: 404, error: 'not_found' };
  if (body.name !== undefined) {
    const nombre = limpiarNombre(body.name); if (!nombre) return { status: 400, error: 'bad_name' };
    if (await nombreTomado(env, org.id, nombre, b.id)) return { status: 409, error: 'name_taken' };
    await env.DB.prepare('UPDATE branches SET name = ?2 WHERE id = ?1').bind(b.id, nombre).run();
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { status: 400, error: 'bad_request' };
    if (!body.active && b.active) {
      const activas = (await listBranches(env, org.id)).filter((x) => x.active && x.id !== b.id);
      if (!activas.length) return { status: 409, error: 'last_branch' };
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE branch_id = ?1 AND revoked = 0').bind(b.id).first();
      if (n) return { status: 409, error: 'has_devices' }; // primero se desvinculan las PC: nada se corta sin que se vea
    }
    await env.DB.prepare('UPDATE branches SET active = ?2 WHERE id = ?1').bind(b.id, body.active ? 1 : 0).run();
  }
  return { branch: pubSucursal((await listBranches(env, org.id)).find((x) => x.id === b.id)) };
}

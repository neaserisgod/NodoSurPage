// Negocios (orgs), sucursales y miembros.
//
// Modelo: un negocio (el que paga) tiene sucursales; cada PC (dispositivo) y cada copia pertenecen a una
// sucursal; cada persona es miembro del negocio con un rol y, si no es dueña, con sucursales asignadas.
//
// Todo se ata al `sub` de Google, nunca a la fila de `users`: el barrido automático puede borrar y recrear
// esa fila y los negocios, dispositivos y copias no se pierden (mismo criterio que devices.js).
//
// Todo negocio nace con una "Sucursal principal", así el código nunca tiene el caso especial "sin sucursal".
// Las tablas se crean solas (como el resto del sitio); migrations/0005_orgs.sql es la misma definición, opcional.
import { now, once } from './util.js';
import { puedeEnAlguna, permisosDe } from './permisos.js';
import { ensureDeviceTables } from './devices.js';
import { ensureBackupTables } from './backups.js';

export const SUCURSAL_PRINCIPAL = 'Sucursal principal';

const DDL = [
  `CREATE TABLE IF NOT EXISTS orgs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, owner_sub TEXT NOT NULL,
     billing_email TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_orgs_owner ON orgs(owner_sub)`,
  `CREATE TABLE IF NOT EXISTS branches (
     id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, name TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_branches_org ON branches(org_id)`,
  `CREATE TABLE IF NOT EXISTS memberships (
     id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, user_sub TEXT NOT NULL, email TEXT NOT NULL,
     role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', all_branches INTEGER NOT NULL DEFAULT 0,
     pin_hash TEXT, created_at INTEGER NOT NULL, UNIQUE (org_id, user_sub))`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_sub ON memberships(user_sub)`,
  `CREATE TABLE IF NOT EXISTS membership_branches (
     membership_id INTEGER NOT NULL, branch_id INTEGER NOT NULL, PRIMARY KEY (membership_id, branch_id))`,
  `CREATE TABLE IF NOT EXISTS invitations (
     id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
     all_branches INTEGER NOT NULL DEFAULT 0, branch_ids TEXT, token_hash TEXT NOT NULL UNIQUE,
     exp INTEGER NOT NULL, created_at INTEGER NOT NULL, accepted_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email)`,
];
// devices y backups traen solas sus columnas owner_org y branch_id (ver ensureDeviceTables / ensureBackupTables).
export const ensureOrgTables = (env) => once(env, 'orgs', async () => {
  await ensureDeviceTables(env); await ensureBackupTables(env);
  for (const sql of DDL) await env.DB.prepare(sql).run();
});

const minus = (e) => String(e || '').trim().toLowerCase();

// Crea el negocio con su sucursal principal y a la persona como dueña (todas las sucursales).
// `billing_email` es el mail con el que se paga en Mercado Pago: queda aparte del dueño a propósito, porque si
// la propiedad se transfiere, la suscripción sigue a nombre de quien pagó.
export async function createOrg(env, { sub, email, name, orgName }, t = now()) {
  const nombre = String(orgName || '').trim().slice(0, 80) || (name ? `Negocio de ${name}` : 'Mi negocio');
  const o = await env.DB.prepare('INSERT INTO orgs (name, owner_sub, billing_email, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(nombre, sub, minus(email), t).run();
  const orgId = await lastId(env, 'orgs', o);
  const b = await env.DB.prepare('INSERT INTO branches (org_id, name, active, created_at) VALUES (?1, ?2, 1, ?3)')
    .bind(orgId, SUCURSAL_PRINCIPAL, t).run();
  const branchId = await lastId(env, 'branches', b);
  await env.DB.prepare(
    `INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?1, ?2, ?3, 'owner', 'active', 1, ?4)`
  ).bind(orgId, sub, minus(email), t).run();
  return {
    org: await getOrg(env, orgId),
    branch: await env.DB.prepare('SELECT * FROM branches WHERE id = ?1').bind(branchId).first(),
    membership: await getMembership(env, orgId, sub),
  };
}
// D1 devuelve el id en meta.last_row_id; el simulador de pruebas no, así que se lo pregunta a la tabla.
async function lastId(env, tabla, run) {
  const id = run && run.meta && run.meta.last_row_id;
  if (id) return id;
  return (await env.DB.prepare(`SELECT MAX(id) AS id FROM ${tabla}`).first()).id;
}

export const getOrg = (env, id) => env.DB.prepare('SELECT * FROM orgs WHERE id = ?1').bind(id).first();

// El negocio "personal" de una cuenta: el primero que posee, o uno nuevo si todavía no tiene.
export async function ensurePersonalOrg(env, { sub, email, name }, t = now()) {
  const existente = await env.DB.prepare('SELECT * FROM orgs WHERE owner_sub = ?1 ORDER BY id LIMIT 1').bind(sub).first();
  if (existente) {
    return { org: existente, branch: await mainBranch(env, existente.id), membership: await getMembership(env, existente.id, sub), created: false };
  }
  return { ...(await createOrg(env, { sub, email, name }, t)), created: true };
}

export const mainBranch = (env, orgId) =>
  env.DB.prepare('SELECT * FROM branches WHERE org_id = ?1 ORDER BY id LIMIT 1').bind(orgId).first();
export const listBranches = async (env, orgId) =>
  (await env.DB.prepare('SELECT * FROM branches WHERE org_id = ?1 ORDER BY id').bind(orgId).all()).results;

// Membresía con sus sucursales asignadas: { ..., branches: [ids] }. null si no existe.
export async function getMembership(env, orgId, sub) {
  const m = await env.DB.prepare('SELECT * FROM memberships WHERE org_id = ?1 AND user_sub = ?2').bind(orgId, sub).first();
  if (!m) return null;
  const rows = (await env.DB.prepare('SELECT branch_id FROM membership_branches WHERE membership_id = ?1').bind(m.id).all()).results;
  return { ...m, branches: rows.map((r) => Number(r.branch_id)) };
}

// Negocios donde la persona es miembro activa (para el selector de negocio).
export async function listOrgsForSub(env, sub) {
  return (await env.DB.prepare(
    `SELECT o.*, m.role AS role FROM memberships m JOIN orgs o ON o.id = m.org_id
     WHERE m.user_sub = ?1 AND m.status = 'active' ORDER BY o.id`).bind(sub).all()).results;
}

// Pasa al negocio y la sucursal indicados lo que esta persona vinculó o subió ANTES del modelo de negocios (filas
// sin negocio). Solo toca filas sin negocio, así que se puede repetir. Devuelve cuántas filas cambió.
export async function adoptarLegado(env, sub, orgId, branchId) {
  let n = 0;
  for (const tabla of ['devices', 'backups']) {
    const res = await env.DB.prepare(`UPDATE ${tabla} SET owner_org = ?1, branch_id = ?2 WHERE owner_sub = ?3 AND owner_org IS NULL`).bind(orgId, branchId, sub).run();
    n += (res.meta && res.meta.changes) || 0;
  }
  return n;
}

// Convierte lo que ya existe (dispositivos y copias atados a un `sub`) al modelo nuevo: cada dueño recibe su
// negocio y todo cuelga de su sucursal principal. Idempotente: solo toca filas sin negocio.
export async function backfillOrgs(env, t = now()) {
  await ensureOrgTables(env);
  const duenos = (await env.DB.prepare(
    `SELECT owner_sub, MAX(owner_email) AS owner_email FROM (
       SELECT owner_sub, owner_email FROM devices WHERE owner_org IS NULL
       UNION ALL SELECT owner_sub, owner_email FROM backups WHERE owner_org IS NULL
     ) GROUP BY owner_sub`).all()).results;
  let orgsCreadas = 0, filasActualizadas = 0;
  for (const d of duenos) {
    const u = await env.DB.prepare('SELECT email, name FROM users WHERE sub = ?1').bind(d.owner_sub).first();
    const r = await ensurePersonalOrg(env, { sub: d.owner_sub, email: (u && u.email) || d.owner_email || '', name: u && u.name }, t);
    if (r.created) orgsCreadas++;
    filasActualizadas += await adoptarLegado(env, d.owner_sub, r.org.id, r.branch.id);
  }
  return { orgsCreadas, filasActualizadas };
}

// --- consultas de lectura. Toleran que las tablas todavía no existan (el sitio las crea al primer uso).
const sinTabla = async (fn, vacio) => { try { return await fn(); } catch (e) { if (/no such table/i.test(String(e && e.message))) return vacio; throw e; } };

// Membresías activas de la persona, con su negocio y sus sucursales asignadas: [{...membresía, branches, org}].
export const membershipsOf = (env, sub) => sinTabla(async () => {
  if (!env.DB) return []; // sin base el sitio sigue andando, solo que sin negocios
  const filas = (await env.DB.prepare(
    `SELECT m.*, o.name AS org_name, o.owner_sub AS org_owner_sub, o.billing_email AS org_billing_email, o.created_at AS org_created_at
     FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_sub = ?1 AND m.status = 'active' ORDER BY o.id`).bind(sub).all()).results;
  const out = [];
  for (const f of filas) {
    const branches = (await env.DB.prepare('SELECT branch_id FROM membership_branches WHERE membership_id = ?1').bind(f.id).all()).results.map((r) => Number(r.branch_id));
    out.push({ ...f, branches, org: { id: f.org_id, name: f.org_name, owner_sub: f.org_owner_sub, billing_email: f.org_billing_email, created_at: f.org_created_at } });
  }
  return out;
}, []);

// Los negocios donde la persona puede hacer `accion` en alguna sucursal: [{ org, membership }].
export async function orgsWith(env, sub, accion) {
  return (await membershipsOf(env, sub)).filter((m) => puedeEnAlguna(m, accion)).map((m) => ({ org: m.org, membership: m }));
}

// Mail de cobro de cada negocio donde cada persona es miembro activa: Map(sub → [mails]). Lo usa el barrido para
// no marcar como inactiva a una cuenta cubierta por la suscripción de su negocio.
export const billingEmailsBySub = (env) => sinTabla(async () => {
  const mapa = new Map();
  if (!env.DB) return mapa;
  const filas = (await env.DB.prepare(
    `SELECT m.user_sub, o.billing_email FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.status = 'active'`).all()).results;
  for (const f of filas) mapa.set(f.user_sub, [...(mapa.get(f.user_sub) || []), f.billing_email]);
  return mapa;
}, new Map());

// Los negocios de una persona tal como los muestran las pantallas: rol, sucursales que ve (la dueña y quien tiene
// "todas" ven todas las activas; el resto, solo las asignadas) y qué puede hacer. Sin ids de Google ni mail de cobro.
export async function describirOrgs(env, membresias) {
  const out = [];
  for (const m of membresias) {
    const todas = (await listBranches(env, m.org.id)).filter((b) => b.active);
    const ve = m.role === 'owner' || m.all_branches ? todas : todas.filter((b) => m.branches.includes(b.id));
    out.push({ id: m.org.id, name: m.org.name, role: m.role, allBranches: Boolean(m.role === 'owner' || m.all_branches),
      branches: ve.map((b) => ({ id: b.id, name: b.name })), can: permisosDe(m) });
  }
  return out;
}

// Para el panel de administración (solo lectura): una fila por negocio, con sus números.
export async function listOrgsOverview(env) {
  await ensureOrgTables(env);
  return (await env.DB.prepare(
    `SELECT o.id, o.name, o.billing_email, o.created_at,
       (SELECT email FROM memberships WHERE org_id = o.id AND role = 'owner' AND status = 'active' ORDER BY id LIMIT 1) AS owner_email,
       (SELECT COUNT(*) FROM memberships WHERE org_id = o.id AND status = 'active') AS members,
       (SELECT COUNT(*) FROM branches WHERE org_id = o.id AND active = 1) AS branches,
       (SELECT COUNT(*) FROM devices WHERE owner_org = o.id AND revoked = 0) AS devices,
       (SELECT MAX(last_seen) FROM devices WHERE owner_org = o.id) AS last_seen
     FROM orgs o ORDER BY o.id`).all()).results;
}

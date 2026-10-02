// Copias de seguridad de la base del POS, atadas a la cuenta de Google (`sub`).
//
//  * Se guardan cifradas en el servidor (AES-256-GCM, clave en el secreto BACKUP_KEY): si se filtrara
//    el bucket, no sirven. El operador, técnicamente, puede descifrarlas (ver política de privacidad).
//  * Solo quedan las últimas MAX_COPIAS por cuenta: la más vieja se borra al subir una nueva. No es una sola
//    a propósito: si una copia saliera dañada, con una sola se perdería todo.
//  * Suben quienes tienen suscripción vigente (o cuenta eximida/administrador). Quien cancela conserva la
//    posibilidad de RESTAURAR durante VENTANA_RESTAURAR_DIAS. Quién puede qué se decide en access.js.
//  * Cada copia pertenece a un negocio y a una sucursal (owner_org / branch_id); las copias anteriores al modelo
//    de negocios, sin negocio, siguen atadas a la persona (owner_sub) hasta que backfillOrgs las completa.
import { now, once, addColumn } from './util.js';
import { isPrivilegedSub } from './devices.js';

export const MAX_COPIAS = 5;
export const MAX_BYTES = 25 * 1024 * 1024;
export const VENTANA_RESTAURAR_DIAS = 90;
const DAY = 86400;

export const backupBucket = (env) => env.BACKUPS || env.RELEASES;
const claveValida = (k) => { try { return atob(String(k).trim()).length === 32; } catch { return false; } };
export const backupsReady = (env) => Boolean(env.DB && backupBucket(env) && claveValida(env.BACKUP_KEY));

const DDL = [
  `CREATE TABLE IF NOT EXISTS backups (
     id INTEGER PRIMARY KEY AUTOINCREMENT, owner_sub TEXT NOT NULL, owner_email TEXT, device_id TEXT,
     file_key TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
     schema_version INTEGER, app_version TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_backups_owner ON backups(owner_sub, created_at)`,
];
export const ensureBackupTables = (env) => once(env, 'backups', async () => {
  for (const sql of DDL) await env.DB.prepare(sql).run();
  await addColumn(env, 'backups', 'owner_org INTEGER'); await addColumn(env, 'backups', 'branch_id INTEGER');
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_backups_org ON backups(owner_org, branch_id, created_at)').run();
});
const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { if (/no such table/i.test(String(e && e.message))) return fallback; throw e; } };

// --- cifrado
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
async function claveAes(env) {
  let raw;
  try { raw = Uint8Array.from(atob(String(env.BACKUP_KEY).trim()), (c) => c.charCodeAt(0)); } catch { raw = null; }
  if (!raw || raw.length !== 32) throw new Error('BACKUP_KEY debe ser 32 bytes en base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function cifrar(env, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await claveAes(env), bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12);
  return out;
}
export async function descifrar(env, bytes) {
  const b = new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, await claveAes(env), b.slice(12)));
}

// Carpeta de la cuenta en el bucket: el `sub` no va en claro.
const carpetaDe = async (sub) => (await sha256Hex(new TextEncoder().encode(`cuenta:${sub}`))).slice(0, 32);

// --- almacenamiento
// Alcance de una consulta: { orgId, branchIds } (las copias de un negocio; `branchIds` null = todas sus sucursales)
// o { sub } (copias sin negocio de una persona). Un alcance sin sucursales (`branchIds: []`) no ve nada.
const filtro = (scope) => {
  if (scope.orgId == null) return { sql: 'b.owner_sub = ?1 AND b.owner_org IS NULL', args: [scope.sub] };
  const args = [scope.orgId];
  if (!scope.branchIds) return { sql: 'b.owner_org = ?1', args };
  if (!scope.branchIds.length) return { sql: '0 = 1', args };
  return { sql: `b.owner_org = ?1 AND b.branch_id IN (${scope.branchIds.map((_, i) => `?${i + 2}`).join(',')})`, args: [...args, ...scope.branchIds] };
};
export const listBackups = (env, scope) => safe(async () => {
  await ensureBackupTables(env);
  const { sql, args } = filtro(scope);
  return (await env.DB.prepare(
    `SELECT b.*, d.name AS device_name FROM backups b LEFT JOIN devices d ON d.id = b.device_id
     WHERE ${sql} ORDER BY b.created_at DESC, b.id DESC`).bind(...args).all()).results;
}, []);
// Una copia por id, solo si cae dentro del alcance: un id adivinado de otro negocio no devuelve nada.
export const getBackup = (env, id, scope) => safe(async () => {
  await ensureBackupTables(env);
  const { sql, args } = filtro(scope);
  return await env.DB.prepare(`SELECT b.* FROM backups b WHERE b.id = ?${args.length + 1} AND ${sql}`).bind(...args, id).first();
}, null);
export const publicBackup = (b) => ({ id: b.id, createdAt: b.created_at, size: b.size, sha256: b.sha256,
  schemaVersion: b.schema_version, appVersion: b.app_version, deviceName: b.device_name || null });

// Solo quedan las últimas MAX_COPIAS por sucursal (o por persona, si la copia no tiene negocio).
export async function saveBackup(env, { sub, email, deviceId, bytes, sha256, schemaVersion, appVersion, orgId, branchId }, t = now()) {
  await ensureBackupTables(env);
  const key = `cuentas/${await carpetaDe(sub)}/${t.toString(16)}-${hex(crypto.getRandomValues(new Uint8Array(6)))}.bak`;
  await backupBucket(env).put(key, await cifrar(env, bytes));
  const r = await env.DB.prepare(
    `INSERT INTO backups (owner_sub, owner_email, device_id, file_key, size, sha256, schema_version, app_version, created_at, owner_org, branch_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
  ).bind(sub, email ?? null, deviceId ?? null, key, bytes.length, sha256, schemaVersion ?? null, appVersion ?? null, t, orgId ?? null, branchId ?? null).run();
  const id = r.meta && r.meta.last_row_id ? r.meta.last_row_id : (await env.DB.prepare('SELECT id FROM backups WHERE file_key = ?1').bind(key).first()).id;
  // Rotación: no es una sola a propósito (si una saliera dañada, con una sola se perdería todo).
  const scope = orgId == null ? { sub } : { orgId, branchIds: branchId == null ? null : [branchId] };
  const todas = await listBackups(env, scope);
  for (const vieja of todas.slice(MAX_COPIAS)) await deleteBackup(env, vieja);
  return { id, createdAt: t, guardadas: Math.min(todas.length, MAX_COPIAS) };
}
export async function deleteBackup(env, b) {
  await backupBucket(env).delete(b.file_key);
  await env.DB.prepare('DELETE FROM backups WHERE id = ?1').bind(b.id).run();
}
export async function readBackup(env, b) {
  const obj = await backupBucket(env).get(b.file_key);
  if (!obj) return null;
  let bytes;
  try { bytes = await descifrar(env, await obj.arrayBuffer()); } catch { return null; } // alterada o con otra clave: GCM no descifra
  return (await sha256Hex(bytes)) === b.sha256 ? bytes : null; // integridad: lo que se devuelve es lo que se subió
}

// Limpieza (cron): copias sin suscripción vigente y fuera de la ventana de restauración. Con `subs` = todas las
// suscripciones de Mercado Pago. Si no se pudo consultar Mercado Pago, no se llama.
// Un negocio se juzga por su mail de cobro (no por el de quien subió la copia); una copia sin negocio, por el de la persona.
export async function purgeBackups(env, subs, t = now()) {
  await ensureBackupTables(env);
  const limite = t - VENTANA_RESTAURAR_DIAS * DAY;
  const protegida = (email) => subs.filter((s) => s.payerEmail === String(email || '').toLowerCase())
    .some((s) => ['authorized', 'pending', 'paused'].includes(s.status) || Date.parse(s.modified || s.since || '') / 1000 >= limite);
  const borradas = [];
  const borrarTodas = async (scope) => { for (const b of await listBackups(env, scope)) { await deleteBackup(env, b); borradas.push(b.id); } };

  const negocios = await safe(async () => (await env.DB.prepare(
    'SELECT DISTINCT o.id, o.owner_sub, o.billing_email FROM backups b JOIN orgs o ON o.id = b.owner_org').all()).results, []);
  for (const o of negocios) {
    if (await isPrivilegedSub(env, o.owner_sub, o.billing_email) || protegida(o.billing_email)) continue;
    await borrarTodas({ orgId: o.id, branchIds: null });
  }
  const sueltas = await safe(async () => (await env.DB.prepare(
    'SELECT DISTINCT owner_sub, owner_email FROM backups WHERE owner_org IS NULL').all()).results, []);
  for (const o of sueltas) {
    if (await isPrivilegedSub(env, o.owner_sub, o.owner_email) || protegida(o.owner_email)) continue;
    await borrarTodas({ sub: o.owner_sub });
  }
  return borradas;
}

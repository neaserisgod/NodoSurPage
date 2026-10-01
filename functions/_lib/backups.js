// Copias de seguridad de la base del POS, atadas a la cuenta de Google (`sub`).
//
//  * Se guardan cifradas en el servidor (AES-256-GCM, clave en el secreto BACKUP_KEY): si se filtrara
//    el bucket, no sirven. El operador, técnicamente, puede descifrarlas (ver política de privacidad).
//  * Solo quedan las últimas MAX_COPIAS por cuenta: la más vieja se borra al subir una nueva. No es una sola
//    a propósito: si una copia saliera dañada, con una sola se perdería todo.
//  * Suben quienes tienen suscripción vigente (o cuenta eximida/administrador). Quien cancela conserva la
//    posibilidad de RESTAURAR durante VENTANA_RESTAURAR_DIAS.
import { now } from './util.js';
import { listSubscriptions } from './mp.js';
import { isPrivilegedSub } from './devices.js';

export const MAX_COPIAS = 5;
export const MAX_BYTES = 25 * 1024 * 1024;
export const VENTANA_RESTAURAR_DIAS = 90;
const DAY = 86400;

export const backupBucket = (env) => env.BACKUPS || env.RELEASES;
export const claveValida = (k) => { try { return atob(String(k).trim()).length === 32; } catch { return false; } };
export const backupsReady = (env) => Boolean(env.DB && backupBucket(env) && claveValida(env.BACKUP_KEY));

const DDL = [
  `CREATE TABLE IF NOT EXISTS backups (
     id INTEGER PRIMARY KEY AUTOINCREMENT, owner_sub TEXT NOT NULL, owner_email TEXT, device_id TEXT,
     file_key TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
     schema_version INTEGER, app_version TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_backups_owner ON backups(owner_sub, created_at)`,
];
export async function ensureBackupTables(env) { for (const sql of DDL) await env.DB.prepare(sql).run(); }
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

// --- permisos
// {upload, restore} o {error:'mp_error'} si no se puede verificar (ante la duda, no).
export async function backupAccess(env, { sub, email }) {
  if (await isPrivilegedSub(env, sub, email)) return { upload: true, restore: true, privileged: true };
  if (!env.MP_ACCESS_TOKEN) return { error: 'mp_error' };
  let subs;
  try { subs = await listSubscriptions(env, email); } catch { return { error: 'mp_error' }; }
  if (subs.some((s) => s.status === 'authorized')) return { upload: true, restore: true };
  const limite = now() - VENTANA_RESTAURAR_DIAS * DAY;
  const reciente = subs.some((s) => ['cancelled', 'canceled', 'paused', 'pending'].includes(s.status)
    && Date.parse(s.modified || s.since || '') / 1000 >= limite);
  return { upload: false, restore: reciente };
}

// --- almacenamiento
export const listBackups = (env, sub) => safe(async () => (await env.DB.prepare(
  `SELECT b.*, d.name AS device_name FROM backups b LEFT JOIN devices d ON d.id = b.device_id
   WHERE b.owner_sub = ?1 ORDER BY b.created_at DESC, b.id DESC`).bind(sub).all()).results, []);
export const getBackup = (env, id, sub) => safe(() => env.DB.prepare(
  'SELECT * FROM backups WHERE id = ?1 AND owner_sub = ?2').bind(id, sub).first(), null);
export const publicBackup = (b) => ({ id: b.id, createdAt: b.created_at, size: b.size, sha256: b.sha256,
  schemaVersion: b.schema_version, appVersion: b.app_version, deviceName: b.device_name || null });

export async function saveBackup(env, { sub, email, deviceId, bytes, sha256, schemaVersion, appVersion }, t = now()) {
  await ensureBackupTables(env);
  const key = `cuentas/${await carpetaDe(sub)}/${t.toString(16)}-${hex(crypto.getRandomValues(new Uint8Array(6)))}.bak`;
  await backupBucket(env).put(key, await cifrar(env, bytes));
  const r = await env.DB.prepare(
    `INSERT INTO backups (owner_sub, owner_email, device_id, file_key, size, sha256, schema_version, app_version, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(sub, email ?? null, deviceId ?? null, key, bytes.length, sha256, schemaVersion ?? null, appVersion ?? null, t).run();
  const id = r.meta && r.meta.last_row_id ? r.meta.last_row_id : (await env.DB.prepare('SELECT id FROM backups WHERE file_key = ?1').bind(key).first()).id;
  // Rotación: solo quedan las últimas MAX_COPIAS de la cuenta.
  const todas = await listBackups(env, sub);
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

// Limpieza (cron): copias de cuentas sin suscripción vigente y fuera de la ventana de restauración. Con
// `subs` = todas las suscripciones de Mercado Pago. Si no se pudo consultar Mercado Pago, no se llama.
export async function purgeBackups(env, subs, t = now()) {
  const vivas = await safe(async () => (await env.DB.prepare(
    'SELECT DISTINCT owner_sub, owner_email FROM backups').all()).results, []);
  const limite = t - VENTANA_RESTAURAR_DIAS * DAY;
  const borradas = [];
  for (const o of vivas) {
    if (await isPrivilegedSub(env, o.owner_sub, o.owner_email)) continue;
    const suyas = subs.filter((s) => s.payerEmail === String(o.owner_email || '').toLowerCase());
    const protegida = suyas.some((s) => ['authorized', 'pending', 'paused'].includes(s.status)
      || Date.parse(s.modified || s.since || '') / 1000 >= limite);
    if (protegida) continue;
    for (const b of await listBackups(env, o.owner_sub)) { await deleteBackup(env, b); borradas.push(b.id); }
  }
  return borradas;
}

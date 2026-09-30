// Dispositivos (las PC con el POS) vinculados a una cuenta de Google.
//
// Flujo de vinculación (como una app de escritorio con "iniciar sesión en el navegador"):
//   1. La app abre /vincular/?port&state&challenge&name en el navegador.
//   2. La persona entra con Google (la sesión normal del sitio) y confirma.
//   3. El sitio devuelve un código de un solo uso a http://127.0.0.1:<port> (la app lo escucha).
//   4. La app canjea el código + su verificador (PKCE) por un token de dispositivo.
// Todo se ata al `sub` de Google, no a la fila de `users`: el barrido automático puede borrar
// y recrear esa fila y los dispositivos y las copias no se pierden.
import { sign, verify, randomHex, now, isAdminEmail } from './util.js';

export const DEVICE_TTL = 365 * 24 * 3600;
const CODE_TTL = 120;

// Secretos derivados: un token de dispositivo jamás vale como sesión web ni al revés.
const secretDispositivo = (env) => `${env.SESSION_SECRET}:dispositivo`;
const secretCodigo = (env) => `${env.SESSION_SECRET}:codigo-dispositivo`;

export const validPort = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535;
export const validState = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(s);
export const validChallenge = (c) => typeof c === 'string' && /^[A-Za-z0-9_-]{43}$/.test(c);
export const validDeviceId = (d) => typeof d === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(d);
export const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} ._()'-]/gu, '').trim().slice(0, 60) || 'Mi PC';

const DDL = [
  `CREATE TABLE IF NOT EXISTS devices (
     id TEXT PRIMARY KEY, owner_sub TEXT NOT NULL, owner_email TEXT, name TEXT, cid TEXT,
     app_version TEXT, os TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(owner_sub)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_cid ON devices(cid)`,
  `CREATE TABLE IF NOT EXISTS device_codes (jti TEXT PRIMARY KEY, exp INTEGER NOT NULL)`,
];
export async function ensureDeviceTables(env) { for (const sql of DDL) await env.DB.prepare(sql).run(); }
const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { if (/no such table/i.test(String(e && e.message))) return fallback; throw e; } };

// --- código de un solo uso (paso 3)
export async function createDeviceCode(env, { sub, email, deviceId, name, challenge }, t = now()) {
  await ensureDeviceTables(env);
  const jti = randomHex(16);
  await env.DB.prepare('DELETE FROM device_codes WHERE exp < ?1').bind(t).run(); // limpieza oportunista
  await env.DB.prepare('INSERT INTO device_codes (jti, exp) VALUES (?1, ?2)').bind(jti, t + CODE_TTL).run();
  return sign({ typ: 'devcode', sub, email, did: deviceId, name, challenge, jti, exp: t + CODE_TTL }, secretCodigo(env));
}
export async function readDeviceCode(env, code) {
  const p = await verify(code, secretCodigo(env));
  return p && p.typ === 'devcode' ? p : null;
}
// true si el código todavía no se había usado (y lo marca usado).
export async function consumeDeviceCode(env, jti) {
  const r = await safe(() => env.DB.prepare('DELETE FROM device_codes WHERE jti = ?1').bind(jti).run(), null);
  return Boolean(r && r.meta && r.meta.changes === 1);
}

// --- token de dispositivo (paso 4)
export const signDeviceToken = (env, { sub, email, deviceId }, t = now()) =>
  sign({ typ: 'dev', sub, email, did: deviceId, exp: t + DEVICE_TTL }, secretDispositivo(env));

export async function upsertDevice(env, { id, sub, email, name, cid, version, os }, t = now()) {
  await ensureDeviceTables(env);
  await env.DB.prepare(
    `INSERT INTO devices (id, owner_sub, owner_email, name, cid, app_version, os, created_at, last_seen, revoked)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 0)
     ON CONFLICT(id) DO UPDATE SET owner_sub = ?2, owner_email = ?3, name = COALESCE(?4, name), cid = COALESCE(?5, cid),
       app_version = COALESCE(?6, app_version), os = COALESCE(?7, os), last_seen = ?8, revoked = 0`
  ).bind(id, sub, email, name ?? null, cid ?? null, version ?? null, os ?? null, t).run();
}
export const touchDevice = (env, id, { version, os, cid }, t = now()) => env.DB.prepare(
  'UPDATE devices SET last_seen = ?2, app_version = COALESCE(?3, app_version), os = COALESCE(?4, os), cid = COALESCE(?5, cid) WHERE id = ?1'
).bind(id, t, version ?? null, os ?? null, cid ?? null).run();
export const getDevice = (env, id) => safe(() => env.DB.prepare('SELECT * FROM devices WHERE id = ?1').bind(id).first(), null);
export const listDevices = (env, sub) => safe(async () => (await env.DB.prepare(
  'SELECT * FROM devices WHERE owner_sub = ?1 AND revoked = 0 ORDER BY last_seen DESC').bind(sub).all()).results, []);
export const listAllDevices = (env) => safe(async () => (await env.DB.prepare(
  'SELECT * FROM devices WHERE revoked = 0 ORDER BY last_seen DESC LIMIT 500').all()).results, []);
export const revokeDevice = (env, id, sub) => env.DB.prepare(
  'UPDATE devices SET revoked = 1 WHERE id = ?1 AND owner_sub = ?2').bind(id, sub).run();

// Quién llama con "Authorization: Bearer <token de dispositivo>": {sub, email, device} o null.
export async function deviceFromRequest(request, env) {
  const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return null;
  const p = await verify(m[1], secretDispositivo(env));
  if (!p || p.typ !== 'dev' || !p.sub || !p.did) return null;
  const device = await getDevice(env, p.did);
  if (!device || device.revoked || device.owner_sub !== p.sub) return null;
  return { sub: p.sub, email: p.email, device, exp: p.exp };
}

// ¿Esta cuenta es de pruebas (administrador o eximida)? Puede recibir las versiones beta.
export async function isPrivilegedSub(env, sub, email) {
  if (isAdminEmail(env, email)) return true;
  const u = await safe(() => env.DB.prepare('SELECT exempt, email FROM users WHERE sub = ?1').bind(sub).first(), null);
  return Boolean(u && (u.exempt || isAdminEmail(env, u.email)));
}
// Para el feed de actualizaciones (público, identifica la instalación por `cid`).
export async function cidIsPrivileged(env, cid) {
  if (!cid) return false;
  const d = await safe(() => env.DB.prepare('SELECT owner_sub, owner_email FROM devices WHERE cid = ?1 AND revoked = 0').bind(cid).first(), null);
  return d ? isPrivilegedSub(env, d.owner_sub, d.owner_email) : false;
}

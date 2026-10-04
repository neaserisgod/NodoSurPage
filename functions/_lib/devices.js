// Dispositivos (las PC con el POS) vinculados a una cuenta de Google.
//
// Flujo de vinculación (como una app de escritorio con "iniciar sesión en el navegador"):
//   1. La app abre /vincular/?port&state&challenge&name en el navegador.
//   2. La persona entra con Google (la sesión normal del sitio) y confirma.
//   3. El sitio devuelve un código de un solo uso a http://127.0.0.1:<port> (la app lo escucha).
//   4. La app canjea el código + su verificador (PKCE) por un token de dispositivo.
// Todo se ata al `sub` de Google, no a la fila de `users`: el barrido automático puede borrar
// y recrear esa fila y los dispositivos y las copias no se pierden.
import { sign, verify, randomHex, now, isAdminEmail, once, addColumn } from './util.js';

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
// owner_org / branch_id: el negocio y la sucursal de la PC (null en las vinculadas antes del modelo de negocios;
// backfillOrgs las completa). Los dos lados las agregan solos: la tabla puede ser nueva o venir de producción.
export const ensureDeviceTables = (env) => once(env, 'devices', async () => {
  for (const sql of DDL) await env.DB.prepare(sql).run();
  await addColumn(env, 'devices', 'owner_org INTEGER'); await addColumn(env, 'devices', 'branch_id INTEGER'); await addColumn(env, 'devices', 'person_name TEXT');
  // 'pc' | 'celular' (2026-10-03): lo decide el sitio al vincular, no el dispositivo. Null en los vinculados antes.
  await addColumn(env, 'devices', 'kind TEXT');
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_devices_org ON devices(owner_org, branch_id)').run();
});
const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { if (/no such table/i.test(String(e && e.message))) return fallback; throw e; } };

// --- código de un solo uso (paso 3)
export async function createDeviceCode(env, { sub, email, deviceId, name, challenge, orgId, branchId, personName, kind }, t = now()) {
  await ensureDeviceTables(env);
  const jti = randomHex(16);
  await env.DB.prepare('DELETE FROM device_codes WHERE exp < ?1').bind(t).run(); // limpieza oportunista
  await env.DB.prepare('INSERT INTO device_codes (jti, exp) VALUES (?1, ?2)').bind(jti, t + CODE_TTL).run();
  return sign({ typ: 'devcode', sub, email, did: deviceId, name, challenge, org: orgId ?? null, branch: branchId ?? null, pname: personName ?? null, kind: kind ?? null, jti, exp: t + CODE_TTL }, secretCodigo(env));
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

export async function upsertDevice(env, { id, sub, email, name, cid, version, os, orgId, branchId, personName, kind }, t = now()) {
  await ensureDeviceTables(env);
  // Vincular de nuevo una PC la deja en el negocio y la sucursal indicados (o sin ninguno si no se indican).
  await env.DB.prepare(
    `INSERT INTO devices (id, owner_sub, owner_email, name, cid, app_version, os, created_at, last_seen, revoked, owner_org, branch_id, person_name, kind)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 0, ?9, ?10, ?11, ?12)
     ON CONFLICT(id) DO UPDATE SET owner_sub = ?2, owner_email = ?3, name = COALESCE(?4, name), cid = COALESCE(?5, cid),
       app_version = COALESCE(?6, app_version), os = COALESCE(?7, os), last_seen = ?8, revoked = 0, owner_org = ?9, branch_id = ?10, person_name = COALESCE(?11, person_name), kind = COALESCE(?12, kind)`
  ).bind(id, sub, email, name ?? null, cid ?? null, version ?? null, os ?? null, t, orgId ?? null, branchId ?? null, personName ?? null, kind ?? null).run();
}
export const touchDevice = (env, id, { version, os, cid }, t = now()) => env.DB.prepare(
  'UPDATE devices SET last_seen = ?2, app_version = COALESCE(?3, app_version), os = COALESCE(?4, os), cid = COALESCE(?5, cid) WHERE id = ?1'
).bind(id, t, version ?? null, os ?? null, cid ?? null).run();
export const getDevice = (env, id) => safe(() => env.DB.prepare('SELECT * FROM devices WHERE id = ?1').bind(id).first(), null);
// Las PC de una persona: las que vinculó ella, más las de los negocios donde puede administrar PC (`orgIds`).
const dePersonaONegocios = (orgIds) => (orgIds.length ? `(owner_sub = ?1 OR owner_org IN (${orgIds.map((_, i) => `?${i + 2}`).join(',')}))` : 'owner_sub = ?1');
export const listDevices = (env, sub, orgIds = []) => safe(async () => {
  await ensureDeviceTables(env);
  return (await env.DB.prepare(`SELECT * FROM devices WHERE ${dePersonaONegocios(orgIds)} AND revoked = 0 ORDER BY last_seen DESC`).bind(sub, ...orgIds).all()).results;
}, []);
export const listAllDevices = (env) => safe(async () => (await env.DB.prepare(
  'SELECT * FROM devices WHERE revoked = 0 ORDER BY last_seen DESC LIMIT 500').all()).results, []);
export const revokeDevice = async (env, id, sub, orgIds = []) => {
  await ensureDeviceTables(env);
  return env.DB.prepare(`UPDATE devices SET revoked = 1 WHERE id = ?${orgIds.length + 2} AND ${dePersonaONegocios(orgIds)}`).bind(sub, ...orgIds, id).run();
};

// Quién llama con "Authorization: Bearer <token de dispositivo>": {sub, email, device} o null.
export async function deviceFromRequest(request, env) {
  const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return null;
  const p = await verify(m[1], secretDispositivo(env));
  if (!p || p.typ !== 'dev' || !p.sub || !p.did) return null;
  const device = await getDevice(env, p.did);
  if (!device || device.revoked || device.owner_sub !== p.sub) return null;
  // La PC es del negocio: si quien la vinculó ya no es miembro activo (se fue o lo quitaron), deja de valer.
  if (device.owner_org) {
    const m = await safe(() => env.DB.prepare('SELECT status FROM memberships WHERE org_id = ?1 AND user_sub = ?2').bind(device.owner_org, p.sub).first(), null);
    if (!m || m.status !== 'active') return null;
  }
  return { sub: p.sub, email: p.email, device, exp: p.exp };
}

// ¿Esta cuenta es de pruebas (administrador o eximida)? Puede recibir las versiones beta.
export async function isPrivilegedSub(env, sub, email) {
  if (isAdminEmail(env, email)) return true;
  const u = await safe(() => env.DB.prepare('SELECT exempt, email FROM users WHERE sub = ?1').bind(sub).first(), null);
  return Boolean(u && (u.exempt || isAdminEmail(env, u.email)));
}
// ¿El negocio es de pruebas, porque su dueño (o el mail que paga) es administrador o está eximido? Quien trabaja en él
// (encargado, empleado) hereda eso: su PC o celular recibe las betas y su cuenta no se barre por inactividad, aunque
// la suya, sola, no sea de pruebas. Sin negocio (PC anteriores al modelo), false.
export async function isPrivilegedOrg(env, orgId) {
  if (!orgId) return false;
  const o = await safe(() => env.DB.prepare('SELECT owner_sub, billing_email FROM orgs WHERE id = ?1').bind(orgId).first(), null);
  return o ? isPrivilegedSub(env, o.owner_sub, o.billing_email) : false;
}
// Una cuenta es de pruebas por sí misma o por el negocio al que pertenece su dispositivo.
export const isPrivilegedDevice = async (env, sub, email, orgId) => (await isPrivilegedSub(env, sub, email)) || isPrivilegedOrg(env, orgId);
// Para el feed de actualizaciones (público, identifica la instalación por `cid`).
export async function cidIsPrivileged(env, cid) {
  if (!cid) return false;
  const d = await safe(() => env.DB.prepare('SELECT owner_sub, owner_email, owner_org FROM devices WHERE cid = ?1 AND revoked = 0').bind(cid).first(), null);
  return d ? isPrivilegedDevice(env, d.owner_sub, d.owner_email, d.owner_org) : false;
}

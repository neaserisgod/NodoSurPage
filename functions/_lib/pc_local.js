// Dónde está la PC del local en el wifi, para que un celular de la MISMA sucursal se conecte con un toque (El dueño,
// 2026-10-03: "mejorar el emparejamiento de pc y móvil"). La PC vinculada publica su dirección del wifi y la llave de su
// servidor para celulares; el celular de un miembro que opera esa sucursal la pide y se conecta directo, sin QR ni
// códigos. La llave se guarda cifrada (BACKUP_KEY, como las copias) y solo vuelve a dispositivos de la misma sucursal.
import { now, once } from './util.js';
import { cifrar, descifrar } from './backups.js';

const DDL = `CREATE TABLE IF NOT EXISTS pc_local (
  scope TEXT NOT NULL, device_id TEXT NOT NULL, nombre TEXT, ip TEXT NOT NULL, puerto INTEGER NOT NULL,
  token_enc TEXT NOT NULL, actualizado INTEGER NOT NULL, PRIMARY KEY (scope, device_id))`;
export const ensurePcLocal = (env) => once(env, 'pc_local', () => env.DB.prepare(DDL).run());

/// Una PC que no avisa hace más de esto no se ofrece: lo más probable es que haya cambiado de red o ya no exista.
export const VIGENCIA_PC_LOCAL = 30 * 24 * 3600;

const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/// Solo direcciones de una red local (192.168.x.x, 10.x.x.x, 172.16-31.x.x): nunca se guarda ni se reparte otra cosa.
export function ipLocalValida(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return false;
  return o[0] === 10 || (o[0] === 192 && o[1] === 168) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31);
}

export async function guardarPcLocal(env, { scope, deviceId, nombre, ip, puerto, token }, t = now()) {
  await ensurePcLocal(env);
  const tokenEnc = b64(await cifrar(env, new TextEncoder().encode(token)));
  await env.DB.prepare(
    `INSERT INTO pc_local (scope, device_id, nombre, ip, puerto, token_enc, actualizado) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(scope, device_id) DO UPDATE SET nombre = ?3, ip = ?4, puerto = ?5, token_enc = ?6, actualizado = ?7`
  ).bind(scope, deviceId, nombre ?? null, ip, puerto, tokenEnc, t).run();
}

/// La PC de la sucursal que avisó más recientemente (dentro de la vigencia), o null.
export async function pcLocalDe(env, scope, t = now()) {
  await ensurePcLocal(env);
  const f = await env.DB.prepare('SELECT * FROM pc_local WHERE scope = ?1 AND actualizado >= ?2 ORDER BY actualizado DESC LIMIT 1')
    .bind(scope, t - VIGENCIA_PC_LOCAL).first();
  if (!f) return null;
  let token;
  try { token = new TextDecoder().decode(await descifrar(env, unb64(f.token_enc))); } catch { return null; }
  return { nombre: f.nombre, ip: f.ip, puerto: f.puerto, token, actualizado: f.actualizado };
}

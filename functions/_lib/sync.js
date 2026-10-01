// Sincronización de las bases del POS (PC y celulares de una misma cuenta) a través de la nube.
//
// La nube NO es una copia maestra: es un buzón ordenado. Cada dispositivo sube "lotes" (los cambios de fila
// que genera su motor de sync local) y baja los lotes que subieron los OTROS dispositivos, desde el último
// número de orden (`seq`) que ya vio. Quién gana un conflicto lo decide el motor de la app (la fila más
// reciente por `actualizado_en`; el stock y la caja viajan como movimientos que se suman), no este servidor.
//
//  * Cada lote se guarda cifrado (AES-256-GCM, mismo secreto BACKUP_KEY que las copias). El operador puede
//    técnicamente descifrarlos; por eso la app no incluye en ellos los tokens de Mercado Pago ni del celular.
//  * Subir un lote es idempotente por `loteId`: reintentar tras un corte no duplica nada.
//  * Solo se conservan RETENCION_DIAS días. Un dispositivo que estuvo apagado más tiempo recibe
//    `expirado: true` y tiene que volver a ponerse al día desde una copia de seguridad.
//  * Reloj: las respuestas incluyen la hora del servidor (`ahora`, ms) para que la app corrija la diferencia
//    de su reloj antes de sellar `actualizado_en`; de eso depende que "gana el último" sea justo.
import { now } from './util.js';
import { backupAccess, cifrar, descifrar, sha256Hex, claveValida } from './backups.js';

export const RETENCION_DIAS = 60;
export const MAX_LOTE_BYTES = 1024 * 1024;      // una fila de D1 admite hasta 2 MB; base64 + cifrado agrandan
export const MAX_RESPUESTA_BYTES = 3 * 1024 * 1024;
const DAY = 86400;

export const syncReady = (env) => Boolean(env.DB && claveValida(env.BACKUP_KEY));

const DDL = [
  `CREATE TABLE IF NOT EXISTS sync_lotes (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, owner_sub TEXT NOT NULL, device_id TEXT NOT NULL, lote_id TEXT NOT NULL,
     datos TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_lote ON sync_lotes(owner_sub, lote_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_owner ON sync_lotes(owner_sub, seq)`,
  `CREATE TABLE IF NOT EXISTS sync_cuentas (owner_sub TEXT PRIMARY KEY, purgado_hasta INTEGER NOT NULL DEFAULT 0)`,
];
export async function ensureSyncTables(env) { for (const sql of DDL) await env.DB.prepare(sql).run(); }

export const validLoteId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);

const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Subir y bajar exigen lo mismo que las copias: suscripción vigente, cuenta eximida o administrador.
// Quien canceló puede BAJAR (recuperar lo suyo) durante la ventana de restauración, pero no subir.
export async function syncAccess(env, actor) {
  const a = await backupAccess(env, actor);
  return a.error ? a : { subir: Boolean(a.upload), bajar: Boolean(a.upload || a.restore) };
}

export async function guardarLote(env, { sub, deviceId, loteId, bytes }, t = now()) {
  await ensureSyncTables(env);
  const ya = await env.DB.prepare('SELECT seq FROM sync_lotes WHERE owner_sub = ?1 AND lote_id = ?2').bind(sub, loteId).first();
  if (ya) return { seq: ya.seq, repetido: true };
  const datos = b64(await cifrar(env, bytes));
  await env.DB.prepare(
    'INSERT INTO sync_lotes (owner_sub, device_id, lote_id, datos, size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  ).bind(sub, deviceId, loteId, datos, bytes.length, t).run();
  const fila = await env.DB.prepare('SELECT seq FROM sync_lotes WHERE owner_sub = ?1 AND lote_id = ?2').bind(sub, loteId).first();
  await purgarViejos(env, sub, t);
  return { seq: fila.seq, repetido: false };
}

async function purgarViejos(env, sub, t) {
  const limite = t - RETENCION_DIAS * DAY;
  const tope = await env.DB.prepare('SELECT MAX(seq) AS m FROM sync_lotes WHERE owner_sub = ?1 AND created_at < ?2').bind(sub, limite).first();
  if (!tope || !tope.m) return;
  await env.DB.prepare('DELETE FROM sync_lotes WHERE owner_sub = ?1 AND seq <= ?2').bind(sub, tope.m).run();
  await env.DB.prepare(
    `INSERT INTO sync_cuentas (owner_sub, purgado_hasta) VALUES (?1, ?2)
     ON CONFLICT(owner_sub) DO UPDATE SET purgado_hasta = MAX(purgado_hasta, excluded.purgado_hasta)`
  ).bind(sub, tope.m).run();
}

// Lotes de OTROS dispositivos con seq > desde. `hasta` es el cursor que la app guarda para el próximo pedido
// (avanza también sobre los lotes propios, que no se devuelven, para no volver a recorrerlos).
export async function leerLotes(env, { sub, deviceId, desde }) {
  await ensureSyncTables(env);
  const cuenta = await env.DB.prepare('SELECT purgado_hasta FROM sync_cuentas WHERE owner_sub = ?1').bind(sub).first();
  const purgado = cuenta ? cuenta.purgado_hasta : 0;
  if (desde < purgado) return { expirado: true, purgadoHasta: purgado };
  const filas = (await env.DB.prepare(
    'SELECT seq, device_id, datos, size, created_at FROM sync_lotes WHERE owner_sub = ?1 AND seq > ?2 ORDER BY seq LIMIT 200'
  ).bind(sub, desde).all()).results;
  const lotes = []; let hasta = desde; let bytes = 0; let mas = false;
  for (const f of filas) {
    if (f.device_id !== deviceId) {
      if (lotes.length && bytes + f.size > MAX_RESPUESTA_BYTES) { mas = true; break; }
      let plano;
      try { plano = await descifrar(env, unb64(f.datos)); } catch { plano = null; } // alterado o con otra clave: GCM no descifra
      if (!plano) { hasta = f.seq; continue; }
      lotes.push({ seq: f.seq, deviceId: f.device_id, creadoEn: f.created_at, datos: b64(plano) });
      bytes += f.size;
    }
    hasta = f.seq;
  }
  if (!mas && filas.length === 200) mas = true;
  return { expirado: false, lotes, hasta, mas };
}

export { sha256Hex };

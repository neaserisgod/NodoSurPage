import { sign, verify } from './util.js';
// Versiones del sistema POS (instaladores y actualizaciones). Los archivos viven en R2 (binding RELEASES)
// y los metadatos en D1. Las tablas se crean solas la primera vez que se publica una versión.
export const PLATFORMS = ['windows', 'macos', 'linux', 'android', 'android-servicios']; // android-servicios: Nodo Sur Servicios (la app de turnos con el bot adentro)
export const CHANNELS = ['stable', 'beta'];
export const hasR2 = (env) => Boolean(env.RELEASES);

// Formato de Flutter: 1.0.0+2098 (nombre + número de build). También 1.0.0.2098 (el que usa Windows y el feed),
// 1.0.0 y 1.0.0-beta.1. Para comparar, "1.0.0+2098" y "1.0.0.2098" son la misma versión.
const VERSION_RE = /^\d+\.\d+\.\d+(?:\.\d{1,9}|\+\d{1,9}|-[0-9A-Za-z.-]{1,32})?$/;
const KEY_RE = /^(stable|beta)\/[0-9A-Za-z.+-]{1,40}\/[A-Za-z0-9._+-]{1,120}$/;
export const validVersion = (v) => typeof v === 'string' && VERSION_RE.test(v);
export const validKey = (k) => typeof k === 'string' && KEY_RE.test(k) && !k.includes('..');

// Compara versiones tipo 1.2.10+2098: primero nombre, después número de build (desempata), y una "-pre" es anterior a la final.
export function cmpVersion(a, b) {
  const p = (v) => { const s = String(v), [core, rest] = s.split(/[-+]/, 2); const build = /\+/.test(s) ? parseInt(rest, 10) || 0 : 0;
    return { n: [...core.split('.').map((x) => parseInt(x, 10) || 0), build], pre: /-/.test(s) ? rest : null }; };
  const x = p(a), y = p(b);
  for (let i = 0; i < 4; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  const xs = x.pre.split('.'), ys = y.pre.split('.');
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === undefined) return -1;
    if (ys[i] === undefined) return 1;
    const nx = /^\d+$/.test(xs[i]), ny = /^\d+$/.test(ys[i]);
    const c = nx && ny ? Number(xs[i]) - Number(ys[i]) : xs[i] < ys[i] ? -1 : xs[i] > ys[i] ? 1 : 0;
    if (c) return c < 0 ? -1 : 1;
  }
  return 0;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS releases (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     channel TEXT NOT NULL, platform TEXT NOT NULL, version TEXT NOT NULL,
     file_key TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, signature TEXT, notes TEXT,
     mandatory INTEGER NOT NULL DEFAULT 0, rollout INTEGER NOT NULL DEFAULT 100,
     blocked INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, published_at INTEGER NOT NULL,
     UNIQUE (channel, platform, version))`,
  `CREATE TABLE IF NOT EXISTS downloads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, release_id INTEGER NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_downloads_release ON downloads(release_id)`,
];
export async function ensureTables(env) {
  for (const sql of DDL) await env.DB.prepare(sql).run();
  // Tipo de firma de la actualización: 'ed' (EdDSA, WinSparkle 0.9+/Sparkle) o 'dsa' (WinSparkle 0.8, el que trae auto_updater 1.0).
  try { await env.DB.prepare("ALTER TABLE releases ADD COLUMN sig_type TEXT NOT NULL DEFAULT 'ed'").run(); }
  catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }
}
export const SIG_TYPES = ['ed', 'dsa'];

// Cuántas versiones se conservan (y se ofrecen) por plataforma y canal: la vigente y la anterior para volver atrás.
// El resto se borra, de la base y de R2, para no acumular instaladores de 13 a 40 MB cada uno.
export const VERSIONES_A_GUARDAR = 2;
const UNA_HORA = 3600;

// Lecturas: si todavía no existe la tabla (no se publicó nada), devuelven vacío en lugar de fallar.
const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { if (/no such table/i.test(String(e && e.message))) return fallback; throw e; } };

export const listReleases = (env) => safe(async () => (await env.DB.prepare(
  `SELECT r.*, (SELECT COUNT(*) FROM downloads d WHERE d.release_id = r.id) AS downloads FROM releases r ORDER BY r.published_at DESC, r.id DESC LIMIT 200`).all()).results, []);
export const getRelease = (env, id) => safe(() => env.DB.prepare('SELECT * FROM releases WHERE id = ?1').bind(id).first(), null);
const candidates = (env, platform, channel) => safe(async () => (await env.DB.prepare(
  'SELECT * FROM releases WHERE platform = ?1 AND channel = ?2 AND active = 1 AND blocked = 0').bind(platform, channel).all()).results, []);

const newest = (rows) => rows.slice().sort((a, b) => cmpVersion(b.version, a.version))[0] || null;

// Instalador nuevo: la versión más nueva ya liberada a todos (rollout 100 %).
export async function latestForInstall(env, platform, channel) {
  return newest((await candidates(env, platform, channel)).filter((r) => r.rollout >= 100));
}

// Historial para volver atrás (rollback): las últimas versiones activas y no bloqueadas de cada canal, de la más
// nueva a la más vieja, con cualquier reparto. Solo lo consultan administradores y cuentas eximidas.
export async function historyForInstall(env, platform, channel, limit = VERSIONES_A_GUARDAR) {
  return (await candidates(env, platform, channel)).sort((a, b) => cmpVersion(b.version, a.version)).slice(0, limit);
}
// Una versión puntual (la que eligió quien hace el rollback). Respeta activa/bloqueada igual que el resto.
export async function exactForInstall(env, platform, channel, version) {
  return (await candidates(env, platform, channel)).find((r) => r.version === version) || null;
}

// ¿Le toca esta versión a esta instalación? Reparto estable por instalación (cid) y versión.
export async function eligible(release, cid) {
  if (release.rollout >= 100) return true;
  if (release.rollout <= 0 || !cid) return false;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${cid}:${release.id}`)));
  return ((h[0] << 8) | h[1]) % 100 < release.rollout;
}
// Actualización para una instalación: la más nueva que le toque y que sea mayor a la que ya tiene.
// `conBeta`: la instalación es de una cuenta de pruebas (administrador o eximida) y ve primero las betas.
export async function latestForUpdate(env, platform, channel, current, cid, { conBeta = false } = {}) {
  // El canal beta es solo para cuentas de pruebas: pedirlo a mano (`channel=beta`) no alcanza (2026-10-03).
  if (channel === 'beta' && !conBeta) return null;
  const ok = [];
  const canales = conBeta && channel === 'stable' ? ['stable', 'beta'] : [channel];
  for (const canal of canales) for (const r of await candidates(env, platform, canal)) if (await eligible(r, cid)) ok.push(r);
  const best = newest(ok);
  return best && (!current || cmpVersion(best.version, current) > 0) ? best : null;
}

export async function addRelease(env, r, t) {
  await ensureTables(env);
  return env.DB.prepare(
    `INSERT INTO releases (channel, platform, version, file_key, size, sha256, signature, notes, mandatory, rollout, published_at, sig_type)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
  ).bind(r.channel, r.platform, r.version, r.file_key, r.size, r.sha256, r.signature || null, r.notes || null, r.mandatory ? 1 : 0, r.rollout, t, r.sigType || 'ed').run();
}
// Borra las versiones que sobran: por cada plataforma y canal se quedan las `keep` más nuevas que sirven (activas y no
// bloqueadas: una bloqueada es una compilación mala y no cuenta como "la anterior"); lo más viejo se borra, con su archivo.
// Después limpia los archivos de R2 que ninguna versión registrada usa (por ejemplo, de una corrida que subió el archivo y
// no llegó a registrarse), pero solo si tienen más de una hora: uno recién subido todavía puede estar por registrarse.
export async function podarVersiones(env, { keep = VERSIONES_A_GUARDAR, t = Math.floor(Date.now() / 1000) } = {}) {
  await ensureTables(env);
  const borradas = [];
  for (const platform of PLATFORMS) for (const channel of CHANNELS) {
    const filas = (await env.DB.prepare('SELECT * FROM releases WHERE platform = ?1 AND channel = ?2').bind(platform, channel).all()).results
      .sort((a, b) => cmpVersion(b.version, a.version));
    let guardadas = 0;
    for (const r of filas) {
      if (guardadas < keep) { if (r.active && !r.blocked) guardadas++; continue; } // las más nuevas, y las bloqueadas que las preceden, se dejan
      await env.RELEASES.delete(r.file_key);
      await env.DB.prepare('DELETE FROM downloads WHERE release_id = ?1').bind(r.id).run();
      await env.DB.prepare('DELETE FROM releases WHERE id = ?1').bind(r.id).run();
      borradas.push(`${channel}/${platform}/${r.version}`);
    }
  }
  let huerfanos = 0;
  if (typeof env.RELEASES.list === 'function') {
    const usadas = new Set((await env.DB.prepare('SELECT file_key FROM releases').all()).results.map((r) => r.file_key));
    let cursor;
    do {
      const pagina = await env.RELEASES.list({ cursor, limit: 500 });
      for (const o of pagina.objects || []) {
        const subido = o.uploaded instanceof Date ? o.uploaded.getTime() / 1000 : Number(o.uploaded) || 0;
        if (!usadas.has(o.key) && /^(stable|beta)\//.test(o.key) && t - subido > UNA_HORA) { await env.RELEASES.delete(o.key); huerfanos++; }
      }
      cursor = pagina.truncated ? pagina.cursor : undefined;
    } while (cursor);
  }
  return { borradas, huerfanos };
}

export const setRollout = (env, id, v) => env.DB.prepare('UPDATE releases SET rollout = ?2 WHERE id = ?1').bind(id, v).run();
export const setBlocked = (env, id, v) => env.DB.prepare('UPDATE releases SET blocked = ?2 WHERE id = ?1').bind(id, v ? 1 : 0).run();
export const setActive = (env, id, v) => env.DB.prepare('UPDATE releases SET active = ?2 WHERE id = ?1').bind(id, v ? 1 : 0).run();
export const logDownload = (env, userId, releaseId, t) => safe(() => env.DB.prepare('INSERT INTO downloads (user_id, release_id, at) VALUES (?1, ?2, ?3)').bind(userId, releaseId, t).run(), null);

// Entrega un archivo de R2 con soporte de descarga parcial (Range) y caché condicional.
export async function streamRelease(env, request, release, { attachment = false } = {}) {
  const obj = await env.RELEASES.get(release.file_key, { range: request.headers, onlyIf: request.headers });
  if (!obj) return new Response('No encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const h = new Headers();
  if (obj.writeHttpMetadata) obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('accept-ranges', 'bytes');
  h.set('cache-control', 'private, max-age=0, must-revalidate');
  h.set('x-content-type-options', 'nosniff');
  if (!h.get('content-type')) h.set('content-type', 'application/octet-stream');
  if (attachment) h.set('content-disposition', `attachment; filename="${release.file_key.split('/').pop()}"`);
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers: h });
  let status = 200;
  if (obj.range && (obj.range.offset !== undefined || obj.range.length !== undefined || obj.range.suffix !== undefined)) {
    const off = obj.range.offset ?? (obj.range.suffix !== undefined ? obj.size - obj.range.suffix : 0);
    const len = obj.range.length ?? obj.size - off;
    if (off !== 0 || len !== obj.size) { status = 206; h.set('content-range', `bytes ${off}-${off + len - 1}/${obj.size}`); h.set('content-length', String(len)); }
  }
  if (status === 200) h.set('content-length', String(obj.size));
  return new Response(obj.body, { status, headers: h });
}

// --- Archivos de actualización (2026-10-03)
// Una versión estable liberada al 100 % se baja sin permiso: es la que recibe cualquier instalación, aunque no tenga cuenta
// (por eso la actualización no pide sesión, y el archivo va firmado). Una beta o una versión a medio liberar, en cambio,
// solo con el permiso que da el feed a la instalación a la que le toca; antes alcanzaba con probar `?id=N`.
const PERMISO_TTL = 7 * 24 * 3600; // WinSparkle puede bajar el archivo bastante después de leer el feed
const secretoPermiso = (env) => `${env.SESSION_SECRET}:archivo-actualizacion`;
export const esPublica = (r) => r.channel === 'stable' && r.rollout >= 100 && Boolean(r.active) && !r.blocked;
export const permisoArchivo = (env, id, t = Math.floor(Date.now() / 1000)) => sign({ typ: 'upd', id, exp: t + PERMISO_TTL }, secretoPermiso(env));
export async function permisoValido(env, permiso, id) {
  const p = await verify(permiso, secretoPermiso(env));
  return Boolean(p && p.typ === 'upd' && p.id === id);
}
// La dirección del archivo que va en el feed: con permiso solo si hace falta (las estables al 100 % quedan como siempre).
export async function urlArchivo(env, base, r) {
  return esPublica(r) ? base : `${base}${base.includes('?') ? '&' : '?'}p=${encodeURIComponent(await permisoArchivo(env, r.id))}`;
}

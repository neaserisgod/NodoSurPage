// La clave de la IA de Google (Gemini) es POR NEGOCIO (El dueño, 2026-10-07: "la clave es por cuenta"): el dueño la carga una vez y
// la usan todos los equipos del negocio, empleados incluidos, sin verla nunca. Mismo esquema que el token de Mercado Pago
// (`mp_conexion.js`): se guarda CIFRADA (AES-256-GCM, BACKUP_KEY) y NO sale del servidor; la PC y el celular le mandan el pedido al
// sitio (`/api/ia/generar`) y el sitio lo reenvía a Google con la clave.
//
// El pedido viaja tal cual lo arma la app (`ClienteGemini`): el sitio no lo interpreta ni lo guarda, solo agrega la clave. Así las
// funciones de IA de la app (leer facturas, vincular, nombres, promos) no cambian según de dónde salga la clave.
import { now, once } from './util.js';
import { cifrar, descifrar, claveValida } from './backups.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

// Lo que Google acepta en un pedido es 20 MB; las fotos ya llegan achicadas (la app corta en 14 MB antes del base64).
export const MAX_PEDIDO_IA = 21 * 1024 * 1024;

const DDL = [
  `CREATE TABLE IF NOT EXISTS ia_claves (org_id INTEGER PRIMARY KEY, clave_enc TEXT NOT NULL, modelo TEXT, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
];
export const ensureIaTables = (env) => once(env, 'ia', async () => { for (const sql of DDL) await env.DB.prepare(sql).run(); });
export const iaConfigurada = (env) => Boolean(env.DB && claveValida(env.BACKUP_KEY));

const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Una clave de Google: las clásicas de AI Studio son "AIza…" (letras, números, guion y guion bajo), pero Google también entrega claves
// con otro formato, con punto ("AQ.Ab8…"): el primer guardado real se rechazó por eso (El dueño, 2026-10-07). Se acepta cualquier texto
// visible sin espacios, de largo razonable: va solo en un encabezado hacia Google, así que lo único que importa es que no pueda cortar
// el encabezado (ni espacios, ni saltos de línea, ni caracteres de control).
export const claveConForma = (c) => typeof c === 'string' && /^[\x21-\x7e]{20,300}$/.test(c);
export const modeloConForma = (m) => typeof m === 'string' && /^[\w.-]{1,64}$/.test(m);

export async function guardarClaveIa(env, orgId, { clave, modelo, sub }, t = now()) {
  await ensureIaTables(env);
  const enc = b64(await cifrar(env, new TextEncoder().encode(clave)));
  await env.DB.prepare(
    `INSERT INTO ia_claves (org_id, clave_enc, modelo, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(org_id) DO UPDATE SET clave_enc = ?2, modelo = ?3, updated_by = ?4, updated_at = ?5`
  ).bind(orgId, enc, modelo || null, sub, t).run();
}

export async function borrarClaveIa(env, orgId) {
  await ensureIaTables(env);
  await env.DB.prepare('DELETE FROM ia_claves WHERE org_id = ?1').bind(orgId).run();
}

/** Si el negocio tiene clave y con qué modelo se probó. Nunca la clave. */
export async function estadoIa(env, orgId) {
  await ensureIaTables(env);
  const f = await env.DB.prepare('SELECT modelo, updated_at FROM ia_claves WHERE org_id = ?1').bind(orgId).first();
  return { configurada: Boolean(f), modelo: f ? f.modelo : null, actualizada: f ? f.updated_at : null };
}

async function claveDe(env, orgId) {
  await ensureIaTables(env);
  const f = await env.DB.prepare('SELECT clave_enc FROM ia_claves WHERE org_id = ?1').bind(orgId).first();
  return f ? new TextDecoder().decode(await descifrar(env, unb64(f.clave_enc))) : null;
}

/**
 * Le manda a Google el pedido [cuerpo] (el JSON de `generateContent`, como texto) con la clave del negocio. Devuelve el estado y el
 * cuerpo de Google tal cual, para que la app los interprete igual que si hubiera llamado directo; null si el negocio no tiene clave.
 */
export async function generarConIa(env, orgId, { modelo, cuerpo }) {
  const clave = await claveDe(env, orgId);
  if (!clave) return null;
  const r = await fetch(`${GEMINI}/models/${modelo}:generateContent`, {
    method: 'POST',
    // La clave va en el encabezado, no en la URL: una URL puede quedar en registros.
    headers: { 'x-goog-api-key': clave, 'content-type': 'application/json' },
    body: cuerpo,
  });
  return { status: r.status, body: await r.text() };
}

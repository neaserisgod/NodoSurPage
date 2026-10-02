// Utilidades compartidas de las Pages Functions (sin dependencias).
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64u = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

const hmacKey = (secret, usage) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

// Token firmado: base64url(json).base64url(hmac). `exp` en segundos.
export async function sign(payload, secret) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}
export async function verify(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), unb64u(sig), enc.encode(body));
  } catch { return null; }
  if (!ok) return null;
  try {
    const payload = JSON.parse(dec.decode(unb64u(body)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256b64u = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));
export const now = () => Math.floor(Date.now() / 1000);

// Corre `fn` una sola vez por base D1 (por instancia del Worker): sirve para crear tablas y columnas sin repetir
// el trabajo en cada pedido. Si `fn` falla, no se marca hecho y se reintenta.
const hechos = new WeakMap();
export async function once(env, clave, fn) {
  let s = hechos.get(env.DB); if (!s) hechos.set(env.DB, (s = new Set()));
  if (s.has(clave)) return;
  await fn(); s.add(clave);
}
// Agrega una columna a una tabla que ya existe en producción; si ya está, no hace nada.
export async function addColumn(env, tabla, definicion) {
  try { await env.DB.prepare(`ALTER TABLE ${tabla} ADD COLUMN ${definicion}`).run(); }
  catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
export function cookie(name, value, { maxAge, httpOnly = true, path = '/' } = {}) {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; Secure; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}`;
}

// A dónde se puede volver después de ingresar con Google: SOLO la página de vinculación de la app, con su
// consulta. Nada de URLs libres (sería un redireccionamiento abierto).
// A dónde se puede volver después de ingresar con Google: la vinculación de la app, o aceptar una invitación
// (el token de 64 hex y nada más: ni otros parámetros ni otras rutas).
export const safeNext = (n) =>
  typeof n === 'string' && n.length <= 600 && (/^\/vincular\/\?[A-Za-z0-9_%=&.~+-]*$/.test(n) || /^\/unirse\/\?t=[0-9a-f]{64}$/.test(n)) ? n : null;

export const siteUrl = (env) => (env.SITE_URL || 'https://horsepos.com').replace(/\/$/, '');

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export async function getSession(request, env) {
  const c = parseCookies(request.headers.get('Cookie'));
  const s = await verify(c.ns_session, env.SESSION_SECRET);
  return s && s.email && s.sub ? s : null;
}

// Defensa CSRF para POST: pedido "fetch" propio + Origin del mismo sitio.
export function sameOriginPost(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return origin === siteUrl(env) || origin === new URL(request.url).origin;
}

export const adminEmails = (env) =>
  String(env.ADMIN_EMAILS || 'gtalovergamer@gmail.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
export const isAdminEmail = (env, email) => adminEmails(env).includes(String(email || '').toLowerCase());

// Nombres (nunca valores) de las variables obligatorias que faltan.
export const missingConfig = (env, names) => names.filter((n) => !env[n] || !String(env[n]).trim());

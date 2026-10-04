// Conexión de cada NEGOCIO con SU cuenta de Mercado Pago (OAuth, flujo "Authorization code" + PKCE) y cobros con la
// terminal Point a través del servidor.
//
//  * El dueño autoriza una vez en Mercado Pago; acá se guarda el token del negocio, CIFRADO (AES-256-GCM, BACKUP_KEY, igual
//    que las copias). El token NUNCA sale del servidor: la PC y el celular le piden al sitio que cree o consulte la orden
//    (`/api/mp/orden`), así que ni un celular de empleado intervenido puede sacarlo.
//  * Dura ~180 días y se renueva solo. Cada renovación entrega un refresh_token NUEVO y el anterior deja de servir: por
//    eso se guarda con "compare-and-set" (si dos pedidos renuevan a la vez, solo uno gana) y, si Mercado Pago rechaza el
//    refresh, la conexión queda marcada para reconectar en vez de reintentar para siempre.
//  * Sin el permiso `offline_access` Mercado Pago no entrega refresh_token: se avisa en vez de conectar a medias.
//  * Qué terminal usa cada sucursal se guarda aparte (`mp_terminales`): una cuenta puede tener varias.
import { now, once, randomHex, sha256b64u, siteUrl } from './util.js';
import { cifrar, descifrar, claveValida } from './backups.js';

const API = 'https://api.mercadopago.com';
const AUTH = 'https://auth.mercadopago.com/authorization';
const ANTICIPO_RENOVAR = 7 * 24 * 3600; // se renueva cuando faltan menos de 7 días
const VIDA_PENDIENTE = 10 * 60;          // el `code` de Mercado Pago dura 10 minutos

const DDL = [
  `CREATE TABLE IF NOT EXISTS mp_conexiones (
     org_id INTEGER PRIMARY KEY, mp_user_id TEXT NOT NULL, access_enc TEXT NOT NULL, refresh_enc TEXT,
     expires_at INTEGER NOT NULL, scope TEXT, live_mode INTEGER NOT NULL DEFAULT 1, connected_by TEXT NOT NULL,
     connected_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, needs_reconnect INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS mp_oauth_pendientes (nonce TEXT PRIMARY KEY, org_id INTEGER NOT NULL, sub TEXT NOT NULL, verifier TEXT NOT NULL, exp INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mp_actividad (
     id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, branch_id INTEGER, device_id TEXT, device_name TEXT, accion TEXT NOT NULL,
     canal TEXT, monto_centavos INTEGER, referencia TEXT, mp_id TEXT, http_status INTEGER, resultado TEXT NOT NULL, detalle TEXT, creado INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_mp_actividad_org ON mp_actividad(org_id, id)`,
  `CREATE TABLE IF NOT EXISTS mp_terminales (org_id INTEGER NOT NULL, branch_id INTEGER NOT NULL, terminal_id TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (org_id, branch_id))`,
  // De qué negocio y sucursal es cada orden que creó el servidor: el aviso de Mercado Pago trae solo el id de la orden y la
  // cuenta, y hay que saber a qué equipos despertar. `estado` es el último que avisó Mercado Pago (informativo: la app igual
  // consulta la orden antes de dar nada por cobrado).
  `CREATE TABLE IF NOT EXISTS mp_ordenes (order_id TEXT PRIMARY KEY, org_id INTEGER NOT NULL, branch_id INTEGER NOT NULL, external_reference TEXT,
     estado TEXT, creado INTEGER NOT NULL, actualizado INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_mp_ordenes_creado ON mp_ordenes(creado)`,
];
export const ensureMpTables = (env) => once(env, 'mp_conexion', async () => { for (const sql of DDL) await env.DB.prepare(sql).run(); });
export const mpConfigurado = (env) => Boolean(env.DB && env.MP_CLIENT_ID && env.MP_CLIENT_SECRET && claveValida(env.BACKUP_KEY));

const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const enc = (env, texto) => cifrar(env, new TextEncoder().encode(texto)).then(b64);
const dec = async (env, s) => new TextDecoder().decode(await descifrar(env, unb64(s)));
export const redirectUri = (env) => `${siteUrl(env)}/api/mp/callback`;

// --- conectar
// Paso 1: devuelve la dirección de Mercado Pago a la que hay que mandar al dueño. `state` es un valor de un solo uso que
// liga la vuelta con esta persona y este negocio; el verificador de PKCE se queda en el servidor.
export async function iniciarConexion(env, { orgId, sub }, t = now()) {
  await ensureMpTables(env);
  await env.DB.prepare('DELETE FROM mp_oauth_pendientes WHERE exp < ?1').bind(t).run(); // limpieza oportunista
  const nonce = randomHex(24); const verifier = randomHex(48); // 96 caracteres: dentro de lo que permite PKCE (43-128)
  await env.DB.prepare('INSERT INTO mp_oauth_pendientes (nonce, org_id, sub, verifier, exp) VALUES (?1, ?2, ?3, ?4, ?5)').bind(nonce, orgId, sub, verifier, t + VIDA_PENDIENTE).run();
  const p = new URLSearchParams({
    client_id: env.MP_CLIENT_ID, response_type: 'code', platform_id: 'mp', state: nonce, redirect_uri: redirectUri(env),
    code_challenge: await sha256b64u(verifier), code_challenge_method: 'S256',
  });
  return `${AUTH}?${p}`;
}

async function pedirToken(env, cuerpo) {
  const r = await fetch(`${API}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: env.MP_CLIENT_ID, client_secret: env.MP_CLIENT_SECRET, ...cuerpo }) });
  let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
  return { ok: r.ok, status: r.status, j };
}

// Paso 2: Mercado Pago vuelve con `code` y `state`. `sub` es quien tiene la sesión en este navegador.
// Devuelve { ok: true, orgId } o { error }.
export async function completarConexion(env, { state, code, sub }, t = now()) {
  await ensureMpTables(env);
  if (typeof state !== 'string' || typeof code !== 'string' || !code) return { error: 'bad_request' };
  const p = await env.DB.prepare('SELECT * FROM mp_oauth_pendientes WHERE nonce = ?1').bind(state).first();
  if (!p || p.exp < t) return { error: 'expired' };
  await env.DB.prepare('DELETE FROM mp_oauth_pendientes WHERE nonce = ?1').bind(state).run(); // de un solo uso
  if (p.sub !== sub) return { error: 'other_user' }; // la vuelta tiene que ser de la misma sesión que la inició
  const r = await pedirToken(env, { grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: redirectUri(env), test_token: false });
  if (!r.ok || !r.j || !r.j.access_token || r.j.user_id == null) return { error: 'mp_rechazo', status: r.status };
  const scope = String(r.j.scope || '');
  // Sin `offline_access` no hay refresh_token: la conexión moriría sola a los ~180 días sin posibilidad de renovarla.
  if (!r.j.refresh_token || !/\boffline_access\b/.test(scope)) return { error: 'sin_offline_access' };
  const venc = t + Number(r.j.expires_in || 15552000);
  await env.DB.prepare(
    `INSERT INTO mp_conexiones (org_id, mp_user_id, access_enc, refresh_enc, expires_at, scope, live_mode, connected_by, connected_at, updated_at, needs_reconnect)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 0)
     ON CONFLICT(org_id) DO UPDATE SET mp_user_id = ?2, access_enc = ?3, refresh_enc = ?4, expires_at = ?5, scope = ?6, live_mode = ?7,
       connected_by = ?8, connected_at = ?9, updated_at = ?9, needs_reconnect = 0`
  ).bind(p.org_id, String(r.j.user_id), await enc(env, r.j.access_token), await enc(env, r.j.refresh_token), venc, scope, r.j.live_mode === false ? 0 : 1, sub, t).run();
  return { ok: true, orgId: p.org_id };
}

// --- estado y desconexión
export async function estadoConexion(env, orgId) {
  await ensureMpTables(env);
  const c = await env.DB.prepare('SELECT mp_user_id, connected_at, expires_at, needs_reconnect, live_mode FROM mp_conexiones WHERE org_id = ?1').bind(orgId).first();
  if (!c) return { connected: false };
  return { connected: !c.needs_reconnect, needsReconnect: Boolean(c.needs_reconnect), mpUserId: c.mp_user_id, connectedAt: c.connected_at, liveMode: Boolean(c.live_mode) };
}
export async function desconectar(env, orgId) {
  await ensureMpTables(env);
  await env.DB.prepare('DELETE FROM mp_conexiones WHERE org_id = ?1').bind(orgId).run();
  await env.DB.prepare('DELETE FROM mp_terminales WHERE org_id = ?1').bind(orgId).run();
}

// --- token vigente
// Devuelve el access_token del negocio, renovándolo si está por vencer (o si `forzar`). Null si no hay conexión usable.
export async function tokenDe(env, orgId, { forzar = false } = {}, t = now()) {
  await ensureMpTables(env);
  const c = await env.DB.prepare('SELECT * FROM mp_conexiones WHERE org_id = ?1').bind(orgId).first();
  if (!c || c.needs_reconnect) return null;
  if (!forzar && c.expires_at - t > ANTICIPO_RENOVAR) return dec(env, c.access_enc);
  if (!c.refresh_enc) return c.expires_at > t ? dec(env, c.access_enc) : null;
  const refresh = await dec(env, c.refresh_enc);
  const r = await pedirToken(env, { grant_type: 'refresh_token', refresh_token: refresh });
  if (!r.ok || !r.j || !r.j.access_token) {
    // 400/401 de Mercado Pago = el refresh_token ya no sirve (revocado, rotado por otro pedido, vencido): hay que reconectar.
    // Un 5xx o un corte de red no: se sigue con el token actual mientras no haya vencido y se reintenta después.
    if (r.status === 400 || r.status === 401) {
      const hoy = await env.DB.prepare('SELECT refresh_enc FROM mp_conexiones WHERE org_id = ?1').bind(orgId).first();
      if (hoy && hoy.refresh_enc !== c.refresh_enc) return tokenDe(env, orgId, {}, t); // otro pedido ya lo renovó
      await env.DB.prepare('UPDATE mp_conexiones SET needs_reconnect = 1, updated_at = ?2 WHERE org_id = ?1').bind(orgId, t).run();
      return null;
    }
    return c.expires_at > t ? dec(env, c.access_enc) : null;
  }
  // Compare-and-set: solo guarda si el refresh_token sigue siendo el que se usó. Si otro pedido ya lo cambió, el nuestro
  // se descarta y se usa lo que quedó guardado.
  const res = await env.DB.prepare(
    `UPDATE mp_conexiones SET access_enc = ?3, refresh_enc = ?4, expires_at = ?5, updated_at = ?6, needs_reconnect = 0
     WHERE org_id = ?1 AND refresh_enc = ?2`
  ).bind(orgId, c.refresh_enc, await enc(env, r.j.access_token), await enc(env, r.j.refresh_token || refresh), t + Number(r.j.expires_in || 15552000), t).run();
  if (res.meta && res.meta.changes === 0) return tokenDe(env, orgId, {}, t);
  return r.j.access_token;
}

// Llama a la API de Mercado Pago con el token del negocio. Si responde 401 se renueva una vez y se reintenta.
export async function mpFetch(env, orgId, path, init = {}) {
  let token = await tokenDe(env, orgId);
  if (!token) return { status: 409, j: { error: 'mp_no_conectado' } };
  const llamar = async (tk) => {
    const r = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}), Authorization: `Bearer ${tk}` } });
    let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, j };
  };
  let r = await llamar(token);
  if (r.status === 401) {
    token = await tokenDe(env, orgId, { forzar: true });
    if (!token) return { status: 409, j: { error: 'mp_no_conectado' } };
    r = await llamar(token);
  }
  return r;
}

// --- terminales
export async function terminalesDe(env, orgId) {
  const r = await mpFetch(env, orgId, '/terminals/v1/list?limit=50&offset=0');
  if (r.status !== 200) return { error: r.status === 409 ? 'mp_no_conectado' : 'mp_error', status: r.status };
  const lista = (r.j && ((r.j.data && r.j.data.terminals) || r.j.terminals)) || [];
  return { terminals: lista.map((x) => ({ id: String(x.id), mode: x.operating_mode || null })) };
}
export const terminalDeSucursal = async (env, orgId, branchId) => {
  await ensureMpTables(env);
  const f = await env.DB.prepare('SELECT terminal_id FROM mp_terminales WHERE org_id = ?1 AND branch_id = ?2').bind(orgId, branchId).first();
  return f ? f.terminal_id : null;
};
// Elige la terminal de una sucursal y, si todavía no lo está, la pasa a modo PDV (el único que deja cobrar por API). Una terminal
// que YA está en PDV (la que el dueño venía usando con otra integración) no se toca: cambiarle el modo a una terminal en uso
// no aporta nada y podría desarmar lo que ya funciona.
export async function elegirTerminal(env, orgId, branchId, terminalId, t = now()) {
  const lista = await terminalesDe(env, orgId);
  if (lista.error) return lista;
  const elegida = lista.terminals.find((x) => x.id === terminalId);
  if (!elegida) return { error: 'terminal_desconocida' };
  if (elegida.mode !== 'PDV') {
    const r = await mpFetch(env, orgId, '/terminals/v1/setup', { method: 'PATCH', body: JSON.stringify({ terminals: [{ id: terminalId, operating_mode: 'PDV' }] }) });
    if (r.status !== 200) return { error: 'mp_error', status: r.status, detalle: detalleError(r.j) };
  }
  await env.DB.prepare(
    'INSERT INTO mp_terminales (org_id, branch_id, terminal_id, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(org_id, branch_id) DO UPDATE SET terminal_id = ?3, updated_at = ?4'
  ).bind(orgId, branchId, terminalId, t).run();
  return { ok: true };
}

// El motivo con que Mercado Pago rechazó algo, tal cual lo dice: sus APIs usan formatos distintos (`message`, `error`, `cause[]`, o
// `errors[]` con código y detalle en las órdenes). Sin esto el dueño ve solo "no se pudo" y no hay forma de arreglarlo.
export function detalleError(j) {
  if (!j || typeof j !== 'object') return null;
  const e = Array.isArray(j.errors) && j.errors[0];
  const c = Array.isArray(j.cause) && j.cause[0];
  const partes = [
    (e && e.code) || (c && c.code) || null,
    (e && e.message) || (c && c.description) || j.message || (typeof j.error === 'string' ? j.error : null),
    e && Array.isArray(e.details) && e.details.length ? e.details.join('; ') : null,
  ].filter(Boolean).map((x) => String(x).slice(0, 200));
  return partes.length ? partes.join(' · ') : null;
}

// --- órdenes Point (mismo cuerpo que ya armaba la app de la PC: `cobro_posnet.dart`)
const decimal = (centavos) => `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
// Cada orden vence sola a los 2 minutos si nadie la paga (Orders API, `expiration_time`): un cobro olvidado no queda
// esperando en la terminal, y la app siempre termina sabiendo el resultado (vencida = no cobrada) en vez de quedarse con
// "no sé si se cobró". Misma duración que la app de la PC (`vencimientoOrdenCobroPosnet`, `domain/cobro_posnet.dart`).
export const VENCIMIENTO_ORDEN = 'PT2M';
export const MAX_ORDENES_GUARDADAS_DIAS = 30;
export async function crearOrden(env, orgId, branchId, { externalReference, idempotencyKey, montoCentavos, canal }, t = now()) {
  const terminal = await terminalDeSucursal(env, orgId, branchId);
  if (!terminal) return { status: 409, j: { error: 'mp_sin_terminal' } };
  const r = await mpFetch(env, orgId, '/v1/orders', {
    method: 'POST', headers: { 'X-Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ type: 'point', external_reference: externalReference, expiration_time: VENCIMIENTO_ORDEN,
      transactions: { payments: [{ amount: decimal(montoCentavos) }] },
      config: { point: { terminal_id: terminal, print_on_terminal: 'no_ticket' }, payment_method: { default_type: canal } } }),
  });
  if (r.status >= 200 && r.status < 300 && r.j && r.j.id) await anotarOrden(env, { orderId: String(r.j.id), orgId, branchId, externalReference, estado: r.j.status || null }, t);
  return r;
}

// Anotar nunca rompe un cobro: si falla, el cobro sigue y la app se entera igual consultando.
async function anotarOrden(env, { orderId, orgId, branchId, externalReference, estado }, t) {
  try {
    await env.DB.prepare(
      `INSERT INTO mp_ordenes (order_id, org_id, branch_id, external_reference, estado, creado, actualizado) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT(order_id) DO UPDATE SET estado = COALESCE(excluded.estado, estado), actualizado = excluded.actualizado`,
    ).bind(orderId, orgId, branchId, externalReference ?? null, estado, t).run();
    await env.DB.prepare('DELETE FROM mp_ordenes WHERE creado < ?1').bind(t - MAX_ORDENES_GUARDADAS_DIAS * 86400).run();
  } catch (e) { console.error('mp_orden_anotar', e && e.message); }
}

// --- avisos de Mercado Pago (webhook "Order"). Mercado Pago firma cada aviso con la clave secreta de la aplicación
// (`MP_WEBHOOK_SECRET`): header `x-signature: ts=…,v1=<hmac>` sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;".
// Lo que no venga se saca de la plantilla (documentación de Mercado Pago, "Validar el origen de la notificación").
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
function igualesEnTiempoConstante(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function firmaWebhookValida(secreto, { xSignature, xRequestId, dataId }) {
  if (!secreto || !xSignature) return false;
  const partes = Object.fromEntries(String(xSignature).split(',').map((p) => p.trim().split('=').map((x) => x.trim())).filter((p) => p.length === 2));
  if (!partes.ts || !partes.v1) return false;
  const id = dataId == null ? null : (/^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId));
  const manifiesto = `${id != null ? `id:${id};` : ''}${xRequestId ? `request-id:${xRequestId};` : ''}ts:${partes.ts};`;
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const esperado = hex(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(manifiesto)));
  return igualesEnTiempoConstante(esperado, String(partes.v1).toLowerCase());
}

// Un aviso de orden: ¿de qué sucursal es? Solo órdenes que creó este servidor, y solo si la cuenta que avisa es la conectada
// a ese negocio (un aviso de otra cuenta con un id ajeno no despierta a nadie). Devuelve null si no corresponde.
export async function ordenDelAviso(env, { orderId, userId, estado }, t = now()) {
  const f = await env.DB.prepare(
    `SELECT o.org_id, o.branch_id, c.mp_user_id FROM mp_ordenes o JOIN mp_conexiones c ON c.org_id = o.org_id WHERE o.order_id = ?1`,
  ).bind(String(orderId)).first();
  if (!f || (userId != null && String(f.mp_user_id) !== String(userId))) return null;
  if (estado) await env.DB.prepare('UPDATE mp_ordenes SET estado = ?2, actualizado = ?3 WHERE order_id = ?1').bind(String(orderId), String(estado).slice(0, 40), t).run();
  return { orgId: f.org_id, branchId: f.branch_id };
}
export const consultarOrden = (env, orgId, id) => mpFetch(env, orgId, `/v1/orders/${encodeURIComponent(id)}`);
export const cancelarOrden = (env, orgId, id) => mpFetch(env, orgId, `/v1/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'X-Idempotency-Key': randomHex(16) }, body: '{}' });

// Imprimir un ticket en la terminal Point de la sucursal (Terminals API, `type: print`). El contenido ya viene armado por
// la app (etiquetas {br}, {center}…); acá solo se acota y se manda con el token del negocio, así ni la PC ni el celular
// necesitan guardar un access token para imprimir.
export const MAX_CONTENIDO_TICKET = 8000;
export async function imprimirTicket(env, orgId, branchId, { externalReference, idempotencyKey, contenido }) {
  const terminal = await terminalDeSucursal(env, orgId, branchId);
  if (!terminal) return { status: 409, j: { error: 'mp_sin_terminal' } };
  return mpFetch(env, orgId, '/terminals/v1/actions', {
    method: 'POST', headers: { 'X-Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ type: 'print', external_reference: externalReference, config: { point: { terminal_id: terminal, subtype: 'custom' } }, content: contenido }),
  });
}

// --- registro de lo que el servidor hizo por el negocio (cobros, cancelaciones e impresiones). Sin secretos: ni el token ni el
// contenido del ticket. Sirve para comprobar de dónde salió cada cobro (PC, celular, por el servidor o no) y para ver rechazos.
// Registrar NUNCA rompe un cobro: si falla, se ignora. Quedan los últimos MAX_ACTIVIDAD de cada negocio.
export const MAX_ACTIVIDAD = 500;
export async function registrarActividad(env, w, { accion, canal = null, montoCentavos = null, referencia = null, r }, t = now()) {
  try {
    const ok = r && r.status >= 200 && r.status < 300;
    const detalle = ok ? (r.j && (r.j.status_detail || r.j.status) ? String(r.j.status_detail || r.j.status).slice(0, 80) : null)
      : String((r && r.j && (r.j.error || detalleError(r.j))) || 'sin_respuesta').slice(0, 200);
    await env.DB.prepare(
      `INSERT INTO mp_actividad (org_id, branch_id, device_id, device_name, accion, canal, monto_centavos, referencia, mp_id, http_status, resultado, detalle, creado)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
    ).bind(w.orgId, w.branchId ?? null, w.deviceId ?? null, w.deviceName ?? null, accion, canal, montoCentavos, referencia, ok && r.j && r.j.id ? String(r.j.id) : null,
      r ? r.status : null, ok ? 'ok' : 'rechazado', detalle, t).run();
    await env.DB.prepare('DELETE FROM mp_actividad WHERE org_id = ?1 AND id <= (SELECT id FROM mp_actividad WHERE org_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET ?2)').bind(w.orgId, MAX_ACTIVIDAD).run();
  } catch { /* el registro no puede frenar un cobro */ }
}
export const actividadDe = async (env, orgId, limite = 50) => (await env.DB.prepare(
  `SELECT id, branch_id, device_name, accion, canal, monto_centavos, referencia, mp_id, http_status, resultado, detalle, creado
   FROM mp_actividad WHERE org_id = ?1 ORDER BY id DESC LIMIT ?2`).bind(orgId, Math.min(Math.max(Number(limite) || 50, 1), 200)).all()).results;

// --- cobros reales del negocio (para el cierre de caja)
// Lo que Mercado Pago dice que ENTRÓ a la cuenta del negocio entre dos momentos: cada cobro con bruto, comisión y neto. El
// cierre de la app lo compara con lo que registró ella misma, así se ve al centavo si falta anotar un cobro, si hay uno de
// más y cuánto se llevó Mercado Pago en comisiones (la "diferencia" de MP que antes no tenía explicación).
// Solo cobros donde el negocio es el cobrador (`collector.id` = la cuenta conectada): un pago o una transferencia que el
// negocio HACE no entra acá. Los rechazados, cancelados y pendientes no son plata: se cuentan aparte, sin sumarlos.
export const MAX_COBROS = 1000;
export const ESTADOS_COBRADOS = ['approved', 'partially_refunded', 'refunded', 'charged_back'];
const POR_PAGINA = 50;
const isoMp = (seg) => new Date(seg * 1000).toISOString().replace('Z', '-00:00');
const aCentavos = (x) => Math.round(Number(x || 0) * 100);
const aSegundos = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? Math.floor(t / 1000) : null; };

export function cobroDesdePago(p) {
  const monto = aCentavos(p.transaction_amount);
  const devuelto = Math.min(aCentavos(p.transaction_amount_refunded), monto);
  const tarifas = Array.isArray(p.fee_details) ? p.fee_details.filter((f) => !f.fee_payer || f.fee_payer === 'collector') : null;
  const neto = p.transaction_details && p.transaction_details.net_received_amount != null ? aCentavos(p.transaction_details.net_received_amount) : null;
  let comision = tarifas && tarifas.length ? tarifas.reduce((a, f) => a + aCentavos(f.amount), 0) : (neto != null ? Math.max(monto - neto, 0) : 0);
  if (p.status === 'refunded') comision = 0; // devuelto entero: Mercado Pago devuelve también la comisión
  return {
    id: String(p.id), estado: p.status || null, fecha: aSegundos(p.date_approved) ?? aSegundos(p.date_created),
    montoCentavos: monto, devueltoCentavos: devuelto, comisionCentavos: comision, netoCentavos: monto - devuelto - comision,
    medio: p.payment_type_id || null, metodo: p.payment_method_id || null, referencia: p.external_reference || null,
  };
}

export function totalesDeCobros(cobros) {
  const t = { cantidad: 0, brutoCentavos: 0, devueltoCentavos: 0, comisionCentavos: 0, netoCentavos: 0, noCobrados: 0, porMedio: {} };
  for (const c of cobros) {
    if (!ESTADOS_COBRADOS.includes(c.estado)) { t.noCobrados++; continue; }
    t.cantidad++; t.brutoCentavos += c.montoCentavos; t.devueltoCentavos += c.devueltoCentavos; t.comisionCentavos += c.comisionCentavos; t.netoCentavos += c.netoCentavos;
    const m = c.medio || 'otro'; t.porMedio[m] = (t.porMedio[m] || 0) + c.montoCentavos - c.devueltoCentavos;
  }
  return t;
}

// [desde, hasta) en segundos. Devuelve { cobros, totales, truncado } o { error }.
export async function cobrosDe(env, orgId, { desde, hasta }) {
  await ensureMpTables(env);
  const c = await env.DB.prepare('SELECT mp_user_id FROM mp_conexiones WHERE org_id = ?1').bind(orgId).first();
  if (!c) return { error: 'mp_no_conectado' };
  const crudos = []; let offset = 0; let total = 0;
  do {
    const q = new URLSearchParams({ sort: 'date_created', criteria: 'asc', range: 'date_created', begin_date: isoMp(desde), end_date: isoMp(hasta),
      'collector.id': c.mp_user_id, limit: String(POR_PAGINA), offset: String(offset) });
    const r = await mpFetch(env, orgId, `/v1/payments/search?${q}`);
    if (r.status !== 200 || !r.j) return { error: r.status === 409 ? 'mp_no_conectado' : 'mp_error', status: r.status, detalle: detalleError(r.j) };
    const pagina = Array.isArray(r.j.results) ? r.j.results : [];
    total = Number((r.j.paging && r.j.paging.total) ?? pagina.length);
    crudos.push(...pagina);
    offset += POR_PAGINA;
    if (!pagina.length) break;
  } while (offset < total && offset < MAX_COBROS);
  // El filtro de Mercado Pago por cobrador se vuelve a aplicar acá: si algún día lo ignora, un pago HECHO por el negocio no
  // puede aparecer como un cobro.
  const propios = crudos.filter((p) => { const col = p.collector_id ?? (p.collector && p.collector.id); return col == null || String(col) === c.mp_user_id; });
  const cobros = propios.map(cobroDesdePago);
  return { cobros, totales: totalesDeCobros(cobros), truncado: total > MAX_COBROS };
}

// El bot de WhatsApp de un negocio (El dueño, 2026-10-09; plan completo en `Nodo-Sur-Pos/docs/PLAN-BOT.md`). El bot corre en un
// celular con Termux, vinculado como un equipo más de la sucursal (`devices.kind = 'bot'`). Acá vive lo que comparten el bot y la
// app de Nodo Sur, por sucursal:
//
//  * la CONFIGURACIÓN del bot (lo que antes era su `config.json`): la cambia la app, el bot la baja;
//  * el CATÁLOGO corto que usa para contestar precio y si hay: lo publica la app (que tiene el stock calculado), el bot lo baja;
//  * los PEDIDOS que toma: los manda el bot, entran "por confirmar" y los acepta o rechaza la app. Aceptar NO toca stock acá: el
//    encargue lo crea la app en su base, como cualquier encargue (el sitio no ve las bases, solo guarda lotes cifrados).
//
// Todo se guarda cifrado (AES-256-GCM, BACKUP_KEY, como el token de Mercado Pago): la configuración y los pedidos tienen teléfonos
// y nombres de clientes. Solo se usa con un plan que incluye el bot (o una cuenta de pruebas).
import { now, once } from './util.js';
import { cifrar, descifrar, claveValida, sha256Hex } from './backups.js';
import { getOrg } from './orgs.js';
import { isPrivilegedOrg } from './devices.js';
import { listSubscriptionsCached, PLANES_CON_BOT } from './mp.js';
import { hubReady, hubDeCuenta } from './sync.js';

export const MAX_CONFIG_BYTES = 32 * 1024;
export const MAX_CATALOGO_ITEMS = 5000;
export const MAX_ITEMS_PEDIDO = 50;
export const MAX_PEDIDOS_LISTA = 200;
export const VIDA_PEDIDO = 30 * 24 * 3600; // un pedido viejo (resuelto o no) se borra a los 30 días
export const ESTADOS_PEDIDO = ['por_confirmar', 'aceptado', 'rechazado'];

const DDL = [
  `CREATE TABLE IF NOT EXISTS bot_config (org_id INTEGER NOT NULL, branch_id INTEGER NOT NULL, datos_enc TEXT NOT NULL, version INTEGER NOT NULL,
     updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (org_id, branch_id))`,
  `CREATE TABLE IF NOT EXISTS bot_catalogo (org_id INTEGER NOT NULL, branch_id INTEGER NOT NULL, datos_enc TEXT NOT NULL, huella TEXT NOT NULL,
     items INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (org_id, branch_id))`,
  // `pedido_id` lo inventa el bot: si reintenta tras un corte, el mismo pedido no entra dos veces. `actualizado` en milisegundos es el
  // cursor con el que la app y el bot piden "lo que cambió desde la última vez".
  `CREATE TABLE IF NOT EXISTS bot_pedidos (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
     pedido_id TEXT NOT NULL, estado TEXT NOT NULL, datos_enc TEXT NOT NULL, creado INTEGER NOT NULL, actualizado INTEGER NOT NULL,
     resuelto_por TEXT, UNIQUE (org_id, branch_id, pedido_id))`,
  `CREATE INDEX IF NOT EXISTS idx_bot_pedidos_cambio ON bot_pedidos(org_id, branch_id, actualizado)`,
];
export const ensureBotTables = (env) => once(env, 'bot', async () => { for (const sql of DDL) await env.DB.prepare(sql).run(); });
export const botConfigurado = (env) => Boolean(env.DB && claveValida(env.BACKUP_KEY));

const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const cifrarJson = async (env, v) => b64(await cifrar(env, new TextEncoder().encode(JSON.stringify(v))));
const descifrarJson = async (env, s) => JSON.parse(new TextDecoder().decode(await descifrar(env, unb64(s))));

// --- ¿El negocio tiene el bot? -----------------------------------------------------------------------------------------------
// Con un plan que lo incluye ("Sistema + Bot" o "Solo el bot") autorizado en Mercado Pago, o si el negocio es de pruebas (su dueño o
// el mail que paga es administrador o está eximido, como la cuenta del dueño de Nodo Sur). `{ error: 'mp_error' }` si Mercado Pago no
// contesta: ante la duda, no.
export async function tieneBot(env, orgId) {
  if (await isPrivilegedOrg(env, orgId)) return { ok: true };
  const org = await getOrg(env, orgId);
  if (!org) return { ok: false };
  if (!env.MP_ACCESS_TOKEN) return { error: 'mp_error' };
  try {
    const subs = await listSubscriptionsCached(env, org.billing_email);
    return { ok: subs.some((s) => s.status === 'authorized' && PLANES_CON_BOT.has(s.plan)) };
  } catch {
    return { error: 'mp_error' };
  }
}

// --- Configuración -------------------------------------------------------------------------------------------------------------
// La configuración es del bot: el sitio no la interpreta (cada rubro tiene la suya, `botdemo/src/plantillas.js`), solo controla que
// sea un objeto de tamaño razonable. `version` sube con cada cambio: el bot compara para saber si tiene que recargar.
export function configValida(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  return new TextEncoder().encode(JSON.stringify(c)).length <= MAX_CONFIG_BYTES;
}

export async function leerConfig(env, orgId, branchId) {
  await ensureBotTables(env);
  const f = await env.DB.prepare('SELECT datos_enc, version, updated_at FROM bot_config WHERE org_id = ?1 AND branch_id = ?2').bind(orgId, branchId).first();
  if (!f) return { version: 0, config: null, actualizada: null };
  return { version: f.version, config: await descifrarJson(env, f.datos_enc), actualizada: f.updated_at };
}

export async function guardarConfig(env, orgId, branchId, { config, sub }, t = now()) {
  await ensureBotTables(env);
  const datos = await cifrarJson(env, config);
  await env.DB.prepare(
    `INSERT INTO bot_config (org_id, branch_id, datos_enc, version, updated_by, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?5)
     ON CONFLICT(org_id, branch_id) DO UPDATE SET datos_enc = ?3, version = version + 1, updated_by = ?4, updated_at = ?5`
  ).bind(orgId, branchId, datos, sub, t).run();
  const f = await env.DB.prepare('SELECT version FROM bot_config WHERE org_id = ?1 AND branch_id = ?2').bind(orgId, branchId).first();
  return f.version;
}

// --- Catálogo ------------------------------------------------------------------------------------------------------------------
// Lo justo para contestar "¿cuánto sale?" y "¿hay?": nada de costos, proveedores ni stock exacto.
export function itemsDeCatalogo(items) {
  if (!Array.isArray(items) || items.length > MAX_CATALOGO_ITEMS) return null;
  const limpios = [];
  for (const x of items) {
    if (!x || typeof x !== 'object') return null;
    const { gid, nombre, precioCentavos, hay } = x;
    if (typeof gid !== 'string' || !/^[\w-]{1,64}$/.test(gid)) return null;
    if (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 120) return null;
    if (!Number.isInteger(precioCentavos) || precioCentavos < 0) return null;
    if (typeof hay !== 'boolean') return null;
    limpios.push({ gid, nombre: nombre.trim(), precioCentavos, hay });
  }
  return limpios;
}

// Guarda el catálogo si cambió (la app lo puede mandar de más sin que eso despierte al bot). Devuelve si cambió.
export async function guardarCatalogo(env, orgId, branchId, items, t = now()) {
  await ensureBotTables(env);
  const huella = await sha256Hex(new TextEncoder().encode(JSON.stringify(items)));
  const previo = await env.DB.prepare('SELECT huella FROM bot_catalogo WHERE org_id = ?1 AND branch_id = ?2').bind(orgId, branchId).first();
  if (previo && previo.huella === huella) return false;
  await env.DB.prepare(
    `INSERT INTO bot_catalogo (org_id, branch_id, datos_enc, huella, items, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(org_id, branch_id) DO UPDATE SET datos_enc = ?3, huella = ?4, items = ?5, updated_at = ?6`
  ).bind(orgId, branchId, await cifrarJson(env, items), huella, items.length, t).run();
  return true;
}

export async function leerCatalogo(env, orgId, branchId) {
  await ensureBotTables(env);
  const f = await env.DB.prepare('SELECT datos_enc, updated_at FROM bot_catalogo WHERE org_id = ?1 AND branch_id = ?2').bind(orgId, branchId).first();
  return f ? { items: await descifrarJson(env, f.datos_enc), actualizado: f.updated_at } : { items: [], actualizado: null };
}

// --- Pedidos -------------------------------------------------------------------------------------------------------------------
export const pedidoIdValido = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);

// Lo que manda el bot, limpio. El precio de cada línea es el que dijo el bot en ese momento: el que vale es el del día que se
// entrega (Regla 4 de Nodo Sur, como cualquier encargue), por eso es opcional y solo orienta.
export function pedidoDesdeBot(b) {
  if (!b || typeof b !== 'object' || !pedidoIdValido(b.id)) return null;
  const c = b.cliente;
  if (!c || typeof c.nombre !== 'string' || !c.nombre.trim() || c.nombre.length > 80) return null;
  if (typeof c.telefono !== 'string' || !/^\d{8,15}$/.test(c.telefono)) return null;
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > MAX_ITEMS_PEDIDO) return null;
  const items = [];
  for (const x of b.items) {
    if (!x || typeof x !== 'object') return null;
    if (x.gid !== undefined && (typeof x.gid !== 'string' || !/^[\w-]{1,64}$/.test(x.gid))) return null;
    if (typeof x.nombre !== 'string' || !x.nombre.trim() || x.nombre.length > 120) return null;
    if (!Number.isInteger(x.cantidad) || x.cantidad < 1 || x.cantidad > 999) return null;
    if (x.precioCentavos !== undefined && (!Number.isInteger(x.precioCentavos) || x.precioCentavos < 0)) return null;
    items.push({ ...(x.gid ? { gid: x.gid } : {}), nombre: x.nombre.trim(), cantidad: x.cantidad, ...(x.precioCentavos !== undefined ? { precioCentavos: x.precioCentavos } : {}) });
  }
  if (b.nota !== undefined && (typeof b.nota !== 'string' || b.nota.length > 300)) return null;
  return { pedidoId: b.id, datos: { cliente: { nombre: c.nombre.trim(), telefono: c.telefono }, items, ...(b.nota && b.nota.trim() ? { nota: b.nota.trim() } : {}) } };
}

// Inserta el pedido "por confirmar". Si el bot reintenta con el mismo id, devuelve el que ya estaba (`repetido`).
export async function crearPedido(env, orgId, branchId, { pedidoId, datos }, tMs = Date.now()) {
  await ensureBotTables(env);
  const r = await env.DB.prepare(
    `INSERT INTO bot_pedidos (org_id, branch_id, pedido_id, estado, datos_enc, creado, actualizado) VALUES (?1, ?2, ?3, 'por_confirmar', ?4, ?5, ?5)
     ON CONFLICT(org_id, branch_id, pedido_id) DO NOTHING`
  ).bind(orgId, branchId, pedidoId, await cifrarJson(env, datos), tMs).run();
  if (!r.meta.changes) {
    const ya = await env.DB.prepare('SELECT id FROM bot_pedidos WHERE org_id = ?1 AND branch_id = ?2 AND pedido_id = ?3').bind(orgId, branchId, pedidoId).first();
    return { id: ya.id, repetido: true };
  }
  // Limpieza oportunista: lo de más de 30 días ya no le sirve a nadie (y tiene datos de clientes).
  await env.DB.prepare('DELETE FROM bot_pedidos WHERE org_id = ?1 AND branch_id = ?2 AND creado < ?3').bind(orgId, branchId, tMs - VIDA_PEDIDO * 1000).run();
  return { id: Number(r.meta.last_row_id), repetido: false };
}

const pedidoPublico = async (env, f) => ({ id: f.id, pedidoId: f.pedido_id, estado: f.estado, ...(await descifrarJson(env, f.datos_enc)), creado: f.creado, actualizado: f.actualizado });

// Lo que cambió después de `desde` (ms), en orden: la app ve los nuevos, el bot ve los que se resolvieron.
export async function pedidosDesde(env, orgId, branchId, desde = 0) {
  await ensureBotTables(env);
  const filas = (await env.DB.prepare(
    'SELECT * FROM bot_pedidos WHERE org_id = ?1 AND branch_id = ?2 AND actualizado > ?3 ORDER BY actualizado, id LIMIT ?4'
  ).bind(orgId, branchId, desde, MAX_PEDIDOS_LISTA).all()).results;
  const pedidos = [];
  for (const f of filas) pedidos.push(await pedidoPublico(env, f));
  return { pedidos, hasta: filas.length ? filas[filas.length - 1].actualizado : desde, mas: filas.length === MAX_PEDIDOS_LISTA };
}

// Aceptar o rechazar, una sola vez: un pedido ya resuelto no cambia (dos equipos tocando a la vez no lo resuelven dos veces).
export async function resolverPedido(env, orgId, branchId, { id, estado, por }, tMs = Date.now()) {
  await ensureBotTables(env);
  const r = await env.DB.prepare(
    // `actualizado` siempre avanza (aunque el reloj diga lo mismo que al crearlo): si no, quien ya leyó el pedido no vería el cambio.
    `UPDATE bot_pedidos SET estado = ?4, actualizado = MAX(?5, actualizado + 1), resuelto_por = ?6 WHERE id = ?1 AND org_id = ?2 AND branch_id = ?3 AND estado = 'por_confirmar'`
  ).bind(id, orgId, branchId, estado, tMs, por).run();
  if (r.meta.changes) return { ok: true };
  const f = await env.DB.prepare('SELECT estado FROM bot_pedidos WHERE id = ?1 AND org_id = ?2 AND branch_id = ?3').bind(id, orgId, branchId).first();
  return f ? { error: 'ya_resuelto', estado: f.estado } : { error: 'no_existe' };
}

// --- Avisos en vivo ------------------------------------------------------------------------------------------------------------
// Por el mismo hub de la sync. `para: 'bots'` llega solo a los equipos tipo bot (configuración, catálogo, pedido resuelto: a la app
// no le sirven); `para: 'equipos'` a todos menos los bots (un pedido nuevo). Nunca tira: si se pierde, el otro lado se entera en su
// próxima consulta.
export async function avisarBot(env, orgId, branchId, { para, aviso }) {
  if (!hubReady(env)) return false;
  try {
    const hub = await hubDeCuenta(env, `n${orgId}:${branchId ?? 0}`);
    await hub.fetch('https://hub/avisar', { method: 'POST', body: JSON.stringify({ bot: { para, aviso } }) });
    return true;
  } catch (e) { console.error('bot_aviso', e && e.message); return false; }
}

// Los bots vinculados a la sucursal y cuándo dieron señales de vida (para que la app muestre si el bot anda).
export async function botsDeSucursal(env, orgId, branchId) {
  const filas = (await env.DB.prepare(
    "SELECT name, last_seen FROM devices WHERE owner_org = ?1 AND branch_id = ?2 AND kind = 'bot' AND revoked = 0 ORDER BY last_seen DESC"
  ).bind(orgId, branchId).all()).results;
  return filas.map((f) => ({ nombre: f.name, ultimaSenal: f.last_seen }));
}

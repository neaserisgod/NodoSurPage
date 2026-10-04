// Avisos de Mercado Pago que no son una orden de la Point (etapa D): un cobro que entró a la cuenta, un contracargo o un reclamo.
// Llegan por el mismo webhook (`/api/mp/webhook`, firma obligatoria) con los temas opcionales `payment`, `topic_chargebacks_wh`
// y `topic_claims_integration_wh`.
//
//  * El aviso de Mercado Pago trae solo el id: acá se consulta el objeto con el token del negocio (nunca se confía en el cuerpo
//    del aviso para montos ni referencias) y solo se sigue si el cobro es de LA cuenta conectada a ese negocio.
//  * El sitio NO decide si un cobro "tiene venta": las ventas viven en la app. Guarda el aviso (30 días) y despierta a los
//    equipos; la PC lo cruza con sus ventas y muestra en la campanita solo lo que no cierra. Los que llegan con la PC apagada
//    se bajan después con `GET /api/mp/avisos`.
//  * Un contracargo o un reclamo que cambia de estado es un aviso nuevo (la firma de lo que cambia es parte de la clave);
//    un cobro se avisa una sola vez aunque Mercado Pago repita el aviso.
import { now } from './util.js';
import { ensureMpTables, mpFetch } from './mp_conexion.js';
import { hubReady, hubDeCuenta } from './sync.js';

export const TIPOS_AVISO = ['cobro', 'contracargo', 'reclamo'];
export const TEMAS_AVISO = { payment: 'cobro', topic_chargebacks_wh: 'contracargo', topic_claims_integration_wh: 'reclamo' };
export const MAX_AVISOS_POR_NEGOCIO = 300;
export const VIDA_AVISO = 30 * 24 * 3600;

const aCentavos = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 100));
const aSegundos = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? Math.floor(t / 1000) : null; };
const texto = (x, max = 80) => (x == null || x === '' ? null : String(x).slice(0, max));
const idDe = (x) => (x == null || x === '' ? null : texto(x, 64));

// Lo que se guarda y se manda a la app: solo lo que hace falta para mostrar y cruzar con una venta. Nada de quién pagó.
export function avisoDeCobro(p) {
  if (!p || p.id == null) return null;
  return { tipo: 'cobro', mpId: idDe(p.id), pagoId: idDe(p.id), montoCentavos: aCentavos(p.transaction_amount), referencia: texto(p.external_reference, 64),
    estado: texto(p.status, 40), detalle: texto(p.payment_type_id, 40), fecha: aSegundos(p.date_approved) ?? aSegundos(p.date_created) };
}
export function avisoDeContracargo(c) {
  if (!c || c.id == null) return null;
  const pagos = Array.isArray(c.payments) ? c.payments : [];
  const primero = pagos[0] && typeof pagos[0] === 'object' ? pagos[0].id : pagos[0];
  return { tipo: 'contracargo', mpId: idDe(c.id), pagoId: idDe(primero), montoCentavos: aCentavos(c.amount), referencia: null,
    estado: c.documentation_required ? 'documentacion' : 'abierto', detalle: texto(c.date_documentation_deadline, 40), fecha: aSegundos(c.date_created) };
}
export function avisoDeReclamo(r) {
  if (!r || r.id == null) return null;
  return { tipo: 'reclamo', mpId: idDe(r.id), pagoId: idDe(r.resource_id ?? (r.resource && r.resource.id)), montoCentavos: aCentavos(r.amount), referencia: null,
    estado: texto(r.status, 40), detalle: texto([r.type, r.stage, r.reason_id].filter(Boolean).join(' / '), 80), fecha: aSegundos(r.date_created) };
}
// Lo que cambia cuando "pasa algo" con el mismo contracargo o reclamo (para no repetir el aviso si Mercado Pago lo reenvía igual).
const firmaDe = (a) => `${a.estado || ''}|${a.detalle || ''}|${a.montoCentavos ?? ''}`;

const RUTAS = {
  cobro: (id) => `/v1/payments/${encodeURIComponent(id)}`,
  contracargo: (id) => `/v1/chargebacks/${encodeURIComponent(id)}`,
  reclamo: (id) => `/post-purchase/v1/claims/${encodeURIComponent(id)}`,
};
const NORMALIZAR = { cobro: avisoDeCobro, contracargo: avisoDeContracargo, reclamo: avisoDeReclamo };

// Negocios que tienen conectada la cuenta que avisa. Casi siempre uno; si dos negocios conectaran la misma cuenta, se avisa a ambos.
export async function orgsDeCuenta(env, userId) {
  if (userId == null || userId === '') return [];
  return (await env.DB.prepare('SELECT org_id FROM mp_conexiones WHERE mp_user_id = ?1').bind(String(userId)).all()).results.map((f) => f.org_id);
}

// De qué sucursal es el aviso: la de la orden si el cobro salió de una orden de este servidor; si no, null (de todas) y se despierta a las que tienen terminal.
// Un cobro de la sucursal A no tiene que aparecer como "sin venta" en la PC de la B.
export async function sucursalDeOrden(env, orgId, a) {
  if (!a.referencia) return null;
  const o = await env.DB.prepare('SELECT branch_id FROM mp_ordenes WHERE org_id = ?1 AND external_reference = ?2').bind(orgId, a.referencia).first();
  return o ? o.branch_id : null;
}
export async function sucursalesDelAviso(env, orgId, branchId) {
  if (branchId != null) return [branchId];
  return (await env.DB.prepare('SELECT branch_id FROM mp_terminales WHERE org_id = ?1').bind(orgId).all()).results.map((f) => f.branch_id);
}

// Consulta el objeto con el token del negocio y lo deja en forma de aviso. null si no corresponde (otra cuenta, rechazado, no existe).
export async function cargarAviso(env, orgId, userId, tipo, id) {
  const r = await mpFetch(env, orgId, RUTAS[tipo](id));
  if (r.status !== 200 || !r.j) return null;
  const a = NORMALIZAR[tipo](r.j);
  if (!a) return null;
  if (tipo === 'cobro') {
    const col = r.j.collector_id ?? (r.j.collector && r.j.collector.id);
    if (col != null && String(col) !== String(userId)) return null; // un pago que el negocio HACE no es un cobro
    if (r.j.status !== 'approved') return null;                    // rechazados, pendientes y cancelados no son plata
  } else if (a.pagoId && (a.montoCentavos == null || !a.referencia)) {
    // Mejor esfuerzo: el monto y la referencia del cobro afectado, para poder cruzarlo con la venta.
    const p = await mpFetch(env, orgId, RUTAS.cobro(a.pagoId));
    if (p.status === 200 && p.j) { const c = avisoDeCobro(p.j); a.montoCentavos ??= c.montoCentavos; a.referencia ??= c.referencia; a.fecha ??= c.fecha; }
  }
  return a;
}

// Guarda el aviso (una vez por firma) y devuelve la fila nueva, o null si ya estaba.
export async function guardarAviso(env, orgId, a, branchId = null, t = now()) {
  await ensureMpTables(env);
  const firma = a.tipo === 'cobro' ? '' : firmaDe(a);
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO mp_avisos (org_id, branch_id, tipo, mp_id, firma, pago_id, monto_centavos, referencia, estado, detalle, fecha, creado)
     VALUES (?1, ?12, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
  ).bind(orgId, a.tipo, a.mpId, firma, a.pagoId, a.montoCentavos, a.referencia, a.estado, a.detalle, a.fecha, t, branchId).run();
  if (!r.meta || r.meta.changes === 0) return null;
  const id = r.meta.last_row_id;
  await env.DB.prepare('DELETE FROM mp_avisos WHERE org_id = ?1 AND (creado < ?2 OR id <= (SELECT id FROM mp_avisos WHERE org_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET ?3))')
    .bind(orgId, t - VIDA_AVISO, MAX_AVISOS_POR_NEGOCIO).run();
  return { id, ...a, creado: t };
}

// Lo que se le manda a la app. El mismo formato por el aviso en vivo y por la consulta.
export const avisoParaApp = (f) => ({ id: f.id, tipo: f.tipo, mpId: f.mpId ?? f.mp_id, pagoId: f.pagoId ?? f.pago_id ?? null,
  montoCentavos: f.montoCentavos ?? f.monto_centavos ?? null, referencia: f.referencia ?? null, estado: f.estado ?? null, detalle: f.detalle ?? null,
  fecha: f.fecha ?? null, creado: f.creado });

// Nunca tira: si se pierde el aviso en vivo, la app lo baja en su próxima consulta.
export async function avisarAvisoMp(env, { orgId, branchId, aviso }) {
  if (!hubReady(env)) return false;
  try {
    const hub = await hubDeCuenta(env, `n${orgId}:${branchId ?? 0}`);
    await hub.fetch('https://hub/avisar', { method: 'POST', body: JSON.stringify({ mp: { aviso: avisoParaApp(aviso) } }) });
    return true;
  } catch (e) { console.error('mp_aviso_cobro', e && e.message); return false; }
}

export async function avisosDe(env, orgId, branchId, desde = 0, limite = 100) {
  await ensureMpTables(env);
  const filas = (await env.DB.prepare(
    `SELECT id, tipo, mp_id, pago_id, monto_centavos, referencia, estado, detalle, fecha, creado FROM mp_avisos
     WHERE org_id = ?1 AND id > ?2 AND creado >= ?3 AND (branch_id IS NULL OR branch_id = ?5) ORDER BY id LIMIT ?4`
  ).bind(orgId, Math.max(Number(desde) || 0, 0), now() - VIDA_AVISO, Math.min(Math.max(Number(limite) || 100, 1), 200), branchId).all()).results;
  return filas.map(avisoParaApp);
}

// Procesa un aviso firmado de Mercado Pago de estos temas. Devuelve { ignorado } o { guardado, avisados }.
export async function procesarAvisoMp(env, { tema, id, userId }) {
  const tipo = TEMAS_AVISO[tema];
  if (!tipo || !id || !/^[\w-]{1,64}$/.test(String(id))) return { ignorado: true };
  await ensureMpTables(env);
  let guardados = 0; let avisados = 0;
  for (const orgId of await orgsDeCuenta(env, userId)) {
    const a = await cargarAviso(env, orgId, userId, tipo, String(id));
    if (!a) continue;
    const sucursal = await sucursalDeOrden(env, orgId, a);
    const fila = await guardarAviso(env, orgId, a, sucursal);
    if (!fila) continue;
    guardados++;
    for (const b of await sucursalesDelAviso(env, orgId, sucursal)) if (await avisarAvisoMp(env, { orgId, branchId: b, aviso: fila })) avisados++;
  }
  return guardados ? { guardado: guardados, avisados } : { ignorado: true };
}

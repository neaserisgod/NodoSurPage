// Mercado Pago para Nodo Sur Servicios (El dueño, 2026-10-10, `Nodo-Sur-Pos/docs/PLAN-APP-SERVICIOS.md`): todo con la cuenta del
// negocio (la conexión OAuth de `mp_conexion.js`; el token nunca sale del servidor).
//
//  * QR EN LA PANTALLA del celular para cobrar en el local: una orden de la Orders API en modo QR dinámico. Lo lee cualquier
//    billetera o banco. Es la misma orden que la de la terminal Point (se sigue igual: consultar, cancelar, devolver, webhook),
//    solo que el QR lo dibuja la app con `qr_data`. Necesita una "caja" en la cuenta de Mercado Pago: se crea sola, una por
//    sucursal, en el primer local que tenga la cuenta (crear un local pide la ubicación exacta: eso lo hace la dueña una vez en
//    Mercado Pago, si no tiene ninguno).
//  * SEÑA POR LINK que manda el bot por WhatsApp (Checkout Pro), que vence a la media hora. Cuando Mercado Pago avisa el pago, el
//    turno se confirma solo, el bot le manda el recibo a la clienta y la dueña recibe la notificación.
//  * DEVOLVER la seña cuando la dueña lo confirma (cancelación con tiempo).
//
// La comisión la paga la emprendedora (El dueño, 2026-10-10): la clienta paga la seña justa.
import { now, once, siteUrl } from './util.js';
import { mpFetch, estadoConexion, anotarOrden, VENCIMIENTO_ORDEN } from './mp_conexion.js';
import { cifrar, descifrar } from './backups.js';
import { avisarBot } from './bot.js';
import { avisarConReintento, cuandoTexto } from './push.js';

const decimal = (centavos) => `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
export const VIDA_LINK_SENA_MS = 30 * 60 * 1000;
// El QR de la pantalla dura más que la orden de la Point (2 minutos): la clienta tiene que sacar el celular y abrir su billetera.
export const VENCIMIENTO_QR = 'PT10M';

const DDL = [
  `CREATE TABLE IF NOT EXISTS mp_cajas_qr (org_id INTEGER NOT NULL, branch_id INTEGER NOT NULL, external_pos_id TEXT NOT NULL,
     creado INTEGER NOT NULL, PRIMARY KEY (org_id, branch_id))`,
];
const ensure = (env) => once(env, 'mp_servicios', async () => { for (const sql of DDL) await env.DB.prepare(sql).run(); });

// Hasta 40 caracteres, alfanumérico: el id de la caja de Nodo Sur para esa sucursal.
export const idCajaQr = (orgId, branchId) => `NODOSUR${orgId}S${branchId}`;

// La caja de la sucursal para cobrar con QR. `{ externalPosId }` o `{ error }` ('mp_sin_local': la cuenta no tiene ningún local).
export async function cajaQrDe(env, orgId, branchId, t = now()) {
  await ensure(env);
  const ya = await env.DB.prepare('SELECT external_pos_id FROM mp_cajas_qr WHERE org_id = ?1 AND branch_id = ?2').bind(orgId, branchId).first();
  if (ya) return { externalPosId: ya.external_pos_id };
  const externalId = idCajaQr(orgId, branchId);
  const guardar = async () => {
    await env.DB.prepare('INSERT OR IGNORE INTO mp_cajas_qr (org_id, branch_id, external_pos_id, creado) VALUES (?1, ?2, ?3, ?4)').bind(orgId, branchId, externalId, t).run();
    return { externalPosId: externalId };
  };
  // Ya creada antes (se borró la fila, o la creó otra vuelta que no llegó a guardarla).
  const existente = await mpFetch(env, orgId, `/pos?external_id=${encodeURIComponent(externalId)}`);
  if (existente.status === 200 && existente.j && Array.isArray(existente.j.results) && existente.j.results.length) return guardar();
  const conexion = await estadoConexion(env, orgId);
  if (!conexion || !conexion.mpUserId) return { error: 'mp_no_conectado' };
  const locales = await mpFetch(env, orgId, `/users/${encodeURIComponent(conexion.mpUserId)}/stores/search`);
  const local = locales.status === 200 && locales.j && Array.isArray(locales.j.results) ? locales.j.results[0] : null;
  if (!local || local.id == null) return { error: 'mp_sin_local' };
  const r = await mpFetch(env, orgId, '/pos', {
    method: 'POST',
    body: JSON.stringify({ name: 'Nodo Sur', store_id: String(local.id), external_id: externalId, fixed_amount: true }),
  });
  if (r.status < 200 || r.status >= 300) return { error: 'mp_caja_rechazada', status: r.status, j: r.j };
  return guardar();
}

// La orden de cobro con QR en pantalla. Devuelve la respuesta de Mercado Pago (con `type_response.qr_data`) o `{ status: 409 }`.
export async function crearOrdenQrPantalla(env, orgId, branchId, { externalReference, idempotencyKey, montoCentavos }, t = now()) {
  const caja = await cajaQrDe(env, orgId, branchId, t);
  if (caja.error) return { status: 409, j: { error: caja.error } };
  const r = await mpFetch(env, orgId, '/v1/orders', {
    method: 'POST', headers: { 'X-Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ type: 'qr', external_reference: externalReference, expiration_time: VENCIMIENTO_QR,
      transactions: { payments: [{ amount: decimal(montoCentavos) }] },
      config: { qr: { external_pos_id: caja.externalPosId, mode: 'dynamic' } } }),
  });
  if (r.status >= 200 && r.status < 300 && r.j && r.j.id) await anotarOrden(env, { orderId: String(r.j.id), orgId, branchId, externalReference, estado: r.j.status || null }, t);
  return r;
}

// --- Seña por link ----------------------------------------------------------------------------------------------------------
// La referencia del pago dice de qué turno es: `sena-<turno_id>` (Mercado Pago acepta hasta 64 caracteres).
export const referenciaSena = (turnoId) => `sena-${turnoId}`.slice(0, 64);
const turnoDeReferencia = (ref) => (typeof ref === 'string' && ref.startsWith('sena-') ? ref.slice(5) : null);

const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const cifrarJson = async (env, v) => b64(await cifrar(env, new TextEncoder().encode(JSON.stringify(v))));
const descifrarJson = async (env, s) => JSON.parse(new TextDecoder().decode(await descifrar(env, unb64(s))));

// El link de pago de la seña de un turno del bot recién reservado. `{ url, vence }`, o null si el negocio no conectó Mercado Pago
// o Mercado Pago no lo creó (el bot sigue con el alias, como antes). Se guarda en el turno: reintentar devuelve el mismo.
export async function linkDeSena(env, orgId, branchId, turnoId, tMs = Date.now()) {
  const f = await env.DB.prepare('SELECT * FROM bot_turnos WHERE org_id = ?1 AND branch_id = ?2 AND turno_id = ?3').bind(orgId, branchId, turnoId).first();
  if (!f || f.estado !== 'esperando_sena' || !f.datos_enc) return null;
  const datos = await descifrarJson(env, f.datos_enc);
  if (datos.senaUrl) return { url: datos.senaUrl, vence: datos.senaVence };
  const monto = datos.senaPedidaCentavos;
  if (!Number.isSafeInteger(monto) || monto < 100) return null;
  const conexion = await estadoConexion(env, orgId);
  if (!conexion || !conexion.connected) return null;
  const vence = Math.min(datos.senaVence || tMs + VIDA_LINK_SENA_MS, tMs + VIDA_LINK_SENA_MS);
  const r = await mpFetch(env, orgId, '/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ id: turnoId.slice(0, 64), title: `Seña: ${datos.servicio.nombre} · ${cuandoTexto(f.inicio)}`.slice(0, 120), quantity: 1, unit_price: Number(decimal(monto)), currency_id: 'ARS' }],
      external_reference: referenciaSena(turnoId),
      notification_url: `${siteUrl(env)}/api/mp/webhook`,
      // Aprobado o rechazado al instante: una seña "pendiente" no sirve para guardar el horario.
      binary_mode: true,
      expires: true, expiration_date_from: new Date(tMs - 60_000).toISOString(), expiration_date_to: new Date(vence).toISOString(),
    }),
  });
  const url = r.status >= 200 && r.status < 300 && r.j ? r.j.init_point : null;
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  await env.DB.prepare('UPDATE bot_turnos SET datos_enc = ?4 WHERE org_id = ?1 AND branch_id = ?2 AND turno_id = ?3')
    .bind(orgId, branchId, turnoId, await cifrarJson(env, { ...datos, senaUrl: url, senaVence: vence })).run();
  return { url, vence };
}

// Mercado Pago avisó un pago aprobado con referencia de seña (`mp_avisos.js`, ya consultado con el token del negocio y verificado que
// es de su cuenta). Confirma el turno si seguía esperando la seña, guarda el pago y despierta al bot (manda el recibo) y a la app
// (la seña entra a la caja). Si el turno ya no la esperaba (venció, lo cancelaron), queda anotado como "pagó tarde" para que la
// dueña decida. Una vez por pago. Devuelve `{ branchId, tarde }`, o null si no es de un turno de este negocio.
export async function senaPagada(env, orgId, { referencia, pagoId, montoCentavos }, tMs = Date.now()) {
  const turnoId = turnoDeReferencia(referencia);
  if (!turnoId) return null;
  const f = await env.DB.prepare('SELECT * FROM bot_turnos WHERE org_id = ?1 AND turno_id = ?2').bind(orgId, turnoId).first();
  if (!f || !f.datos_enc) return null;
  const datos = await descifrarJson(env, f.datos_enc);
  if (datos.senaPagada && datos.senaPagada.pagoId === String(pagoId)) return { branchId: f.branch_id, repetido: true };
  const tarde = f.estado !== 'esperando_sena' && f.estado !== 'confirmado';
  const estado = f.estado === 'esperando_sena' ? 'confirmado' : f.estado;
  const nuevos = { ...datos, senaPagada: { centavos: montoCentavos, pagoId: String(pagoId), fecha: tMs, ...(tarde ? { tarde: true } : {}) } };
  await env.DB.prepare('UPDATE bot_turnos SET estado = ?3, datos_enc = ?4, actualizado = MAX(?5, actualizado + 1) WHERE org_id = ?1 AND turno_id = ?2')
    .bind(orgId, turnoId, estado, await cifrarJson(env, nuevos), tMs).run();
  await avisarBot(env, orgId, f.branch_id, { para: 'bots', aviso: { turno: turnoId } });
  await avisarBot(env, orgId, f.branch_id, { para: 'equipos', aviso: { turno: turnoId } });
  const plata = `$${Math.round((montoCentavos || 0) / 100).toLocaleString('es-AR')}`;
  await avisarConReintento(env, orgId, f.branch_id, `sena:${turnoId}`, tarde
    ? { titulo: '⚠️ Seña pagada tarde', cuerpo: `${datos.cliente.nombre} pagó ${plata} de un turno que ya no estaba (${cuandoTexto(f.inicio)}). Devolvela o dale otro horario.`, datos: { tipo: 'turno', id: turnoId } }
    : { titulo: '💸 Seña pagada', cuerpo: `${datos.cliente.nombre} pagó la seña (${plata}) · ${datos.servicio.nombre} · ${cuandoTexto(f.inicio)}`, datos: { tipo: 'turno', id: turnoId } });
  return { branchId: f.branch_id, tarde };
}

// Devolver la seña de un turno (la dueña lo confirmó en la app). Idempotente: la clave es fija por turno, así que reintentar no
// devuelve dos veces. `{ ok, centavos }` o `{ error }`.
export async function devolverSena(env, orgId, branchId, turnoId, tMs = Date.now()) {
  const f = await env.DB.prepare('SELECT * FROM bot_turnos WHERE org_id = ?1 AND branch_id = ?2 AND turno_id = ?3').bind(orgId, branchId, turnoId).first();
  if (!f || !f.datos_enc) return { error: 'no_existe' };
  const datos = await descifrarJson(env, f.datos_enc);
  const pago = datos.senaPagada;
  if (!pago || !pago.pagoId) return { error: 'sin_sena_mp' };
  if (datos.senaDevuelta) return { ok: true, centavos: pago.centavos, repetido: true };
  const r = await mpFetch(env, orgId, `/v1/payments/${encodeURIComponent(pago.pagoId)}/refunds`, {
    method: 'POST', headers: { 'X-Idempotency-Key': `devolver-sena-${turnoId}`.slice(0, 64) }, body: '{}',
  });
  if (r.status < 200 || r.status >= 300) return { error: r.status >= 500 ? 'mp_sin_respuesta' : 'mp_rechazo', status: r.status };
  await env.DB.prepare('UPDATE bot_turnos SET datos_enc = ?4, actualizado = MAX(?5, actualizado + 1) WHERE org_id = ?1 AND branch_id = ?2 AND turno_id = ?3')
    .bind(orgId, branchId, turnoId, await cifrarJson(env, { ...datos, senaDevuelta: { fecha: tMs } }), tMs).run();
  return { ok: true, centavos: pago.centavos };
}

export { turnoDeReferencia };

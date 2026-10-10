import { json, now } from '../../_lib/util.js';
import { avisosDe } from '../../_lib/mp_avisos.js';
import { crearOrdenQrPantalla, devolverSena } from '../../_lib/mp_servicios.js';
import { pedirSaldo, estadoSaldo, MAX_RANGO_SALDO } from '../../_lib/mp_saldo.js';
import { actorOf } from '../../_lib/actor.js';
import { hasDB } from '../../_lib/db.js';
import { readJson } from '../../_lib/miembros.js';
import { syncAccess } from '../../_lib/sync.js';
import { getMembership } from '../../_lib/orgs.js';
import { puede } from '../../_lib/permisos.js';
import { CANALES, mpConfigurado, ensureMpTables, crearOrden, consultarOrden, cancelarOrden, devolverOrden, imprimirTicket, registrarActividad, MAX_CONTENIDO_TICKET, detalleError, cobrosDe } from '../../_lib/mp_conexion.js';

// Cobrar con la terminal Point DESDE EL SERVIDOR: la PC o el celular piden la orden acá y el sitio la crea con el token del
// negocio (que nunca sale del servidor). Pueden quienes operan la sucursal del dispositivo con el negocio al día.
async function quien(request, env) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return { error: json({ error: 'no_device' }, 401) };
  if (!hasDB(env) || !mpConfigurado(env)) return { error: json({ error: 'mp_no_configurado' }, 503) };
  if (!a.device.owner_org || a.device.branch_id == null) return { error: json({ error: 'sin_negocio' }, 409) };
  const acc = await syncAccess(env, a); // mismo control que subir datos: miembro activo que opera la sucursal y negocio al día
  if (acc.error) return { error: json({ error: acc.error }, 503) };
  if (!acc.subir) return { error: json({ error: 'forbidden' }, 403) };
  await ensureMpTables(env);
  return { orgId: a.device.owner_org, branchId: a.device.branch_id, deviceId: a.device.id, deviceName: a.device.name, sub: a.sub };
}
// Una orden de OTRA sucursal del mismo negocio no se toca desde este equipo: el cobro de una caja no lo cancela ni lo devuelve
// otra caja. Solo se sabe de las que creó este servidor (30 días); de una desconocida no hay nada que comparar.
async function esDeOtraSucursal(env, w, id) {
  const f = await env.DB.prepare('SELECT org_id, branch_id FROM mp_ordenes WHERE order_id = ?1').bind(id).first();
  return Boolean(f) && (f.org_id !== w.orgId || f.branch_id !== w.branchId);
}
// Lo que se le devuelve a la app: solo lo que necesita para seguir la orden; nada del token ni de la cuenta.
const salida = (r) => {
  if (r.status === 409 || !r.j) return json({ error: (r.j && r.j.error) || 'mp_error' }, r.status === 409 ? 409 : 502);
  // Un 5xx de Mercado Pago, o que no haya contestado a tiempo (504 propio), no dice si la orden se creó o no. Se distingue de un
  // rechazo (4xx: Mercado Pago NO la creó) para que la app sepa si puede dar el cobro por fallido o tiene que reintentar con la
  // MISMA clave de idempotencia.
  if (r.status >= 500) return json({ error: 'mp_sin_respuesta', status: r.status, mensaje: detalleError(r.j) }, 504);
  if (r.status < 200 || r.status >= 300) return json({ error: 'mp_rechazo', status: r.status, mensaje: detalleError(r.j) }, r.status === 404 ? 404 : 502);
  // QR en la pantalla (Nodo Sur Servicios): la trama EMVCo que la app dibuja como QR.
  const qrData = r.j.type_response && typeof r.j.type_response.qr_data === 'string' ? r.j.type_response.qr_data : null;
  return json({ id: r.j.id ? String(r.j.id) : null, status: r.j.status || null, statusDetail: r.j.status_detail || null, ...(qrData ? { qrData } : {}) });
};

// Crear la orden. Cuerpo: { externalReference, idempotencyKey, montoCentavos, canal: 'qr' | 'debit_card' | 'credit_card' (1 pago)
// | 'qr_pantalla' (QR dinámico para mostrar en el celular: la respuesta trae `qrData`) }.
export async function onRequestPost({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const b = await readJson(request);
  if (!b || typeof b.externalReference !== 'string' || !/^[\w-]{1,64}$/.test(b.externalReference) || typeof b.idempotencyKey !== 'string' || !/^[\w-]{8,64}$/.test(b.idempotencyKey)
    || !Number.isInteger(b.montoCentavos) || b.montoCentavos < 100 || b.montoCentavos > 1e10 || !(CANALES.includes(b.canal) || b.canal === 'qr_pantalla')) return json({ error: 'bad_request' }, 400);
  // 'qr_pantalla': el QR lo muestra el celular (Nodo Sur Servicios, sin terminal), no la Point.
  const r = b.canal === 'qr_pantalla' ? await crearOrdenQrPantalla(env, w.orgId, w.branchId, b) : await crearOrden(env, w.orgId, w.branchId, b);
  await registrarActividad(env, w, { accion: 'orden', canal: b.canal, montoCentavos: b.montoCentavos, referencia: b.externalReference, r });
  return salida(r);
}

// Consultar el resultado. ?id=<orden de Mercado Pago>
export async function onRequestGet({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[\w-]{1,64}$/.test(id)) return json({ error: 'bad_request' }, 400);
  return salida(await consultarOrden(env, w.orgId, id));
}

// Cancelar una orden que todavía no se pagó. Cuerpo: { id }.
export async function onRequestCancelar({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const b = await readJson(request);
  if (!b || typeof b.id !== 'string' || !/^[\w-]{1,64}$/.test(b.id)) return json({ error: 'bad_request' }, 400);
  if (await esDeOtraSucursal(env, w, b.id)) return json({ error: 'orden_de_otra_sucursal' }, 403);
  const r = await cancelarOrden(env, w.orgId, b.id);
  await registrarActividad(env, w, { accion: 'cancelar', referencia: b.id, r });
  return salida(r);
}

// Devolverle al cliente lo cobrado por una orden (etapa B: al anular una venta, preguntando cada vez). Cuerpo: { id, idempotencyKey }.
// Blindaje:
//  * Solo quien puede `devolver` en esa sucursal (dueño y encargado): lo decide el sitio con la cuenta que vinculó el equipo,
//    nunca la app.
//  * Solo una orden cobrada (`processed`) de la cuenta de ESTE negocio: se consulta con su token antes (una orden de otra
//    cuenta da 404 y no se toca). Una ya devuelta contesta `ya_devuelta` en vez de intentar de nuevo.
//  * Devolución total: el monto lo sabe Mercado Pago, la app no lo manda (no se puede devolver de más).
export async function onRequestDevolver({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const m = await getMembership(env, w.orgId, w.sub);
  if (!m || m.status !== 'active' || !puede(m, 'devolver', w.branchId)) return json({ error: 'sin_permiso_devolver' }, 403);
  const b = await readJson(request);
  if (!b || typeof b.id !== 'string' || !/^[\w-]{1,64}$/.test(b.id) || typeof b.idempotencyKey !== 'string' || !/^[\w-]{8,64}$/.test(b.idempotencyKey)) return json({ error: 'bad_request' }, 400);
  if (await esDeOtraSucursal(env, w, b.id)) return json({ error: 'orden_de_otra_sucursal' }, 403);
  const actual = await consultarOrden(env, w.orgId, b.id);
  if (actual.status !== 200 || !actual.j) return salida(actual);
  if (actual.j.status === 'refunded') return json({ error: 'ya_devuelta', id: b.id, status: 'refunded' }, 409);
  if (actual.j.status !== 'processed') return json({ error: 'no_cobrada', id: b.id, status: actual.j.status || null }, 409);
  const r = await devolverOrden(env, w.orgId, b.id, b.idempotencyKey);
  const total = actual.j.total_amount != null ? Math.round(Number(actual.j.total_amount) * 100) : null;
  await registrarActividad(env, w, { accion: 'devolver', montoCentavos: Number.isFinite(total) ? total : null, referencia: b.id, r });
  return salida(r);
}

// Imprimir un ticket en la terminal de la sucursal. Cuerpo: { externalReference, idempotencyKey, contenido }.
export async function onRequestImprimir({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const b = await readJson(request);
  if (!b || typeof b.externalReference !== 'string' || !/^[\w-]{1,64}$/.test(b.externalReference) || typeof b.idempotencyKey !== 'string' || !/^[\w-]{8,64}$/.test(b.idempotencyKey)
    || typeof b.contenido !== 'string' || !b.contenido || b.contenido.length > MAX_CONTENIDO_TICKET) return json({ error: 'bad_request' }, 400);
  const r = await imprimirTicket(env, w.orgId, w.branchId, b);
  await registrarActividad(env, w, { accion: 'imprimir', referencia: b.externalReference, r });
  if (r.status === 409 || !r.j && !(r.status >= 200 && r.status < 300)) return json({ error: (r.j && r.j.error) || 'mp_error' }, r.status === 409 ? 409 : 502);
  if (r.status < 200 || r.status >= 300) return json({ error: 'mp_rechazo', status: r.status, mensaje: detalleError(r.j) }, 502);
  return json({ ok: true });
}

// Los cobros reales de la cuenta del negocio en un rango, para el cierre de caja. ?desde=<seg>&hasta=<seg>, hasta 31 días.
// Solo lo que hace falta para conciliar: ni datos de quien pagó ni nada de la cuenta.
export const MAX_RANGO_COBROS = 31 * 24 * 3600;
export async function onRequestCobros({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const sp = new URL(request.url).searchParams;
  const desde = Number(sp.get('desde')); const hasta = Number(sp.get('hasta'));
  if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde <= 0 || hasta <= desde || hasta - desde > MAX_RANGO_COBROS) return json({ error: 'bad_request' }, 400);
  const r = await cobrosDe(env, w.orgId, { desde, hasta });
  if (r.error) return json({ error: r.error, status: r.status ?? null, mensaje: r.detalle ?? null }, r.error === 'mp_no_conectado' ? 409 : 502);
  return json({ desde, hasta, ...r });
}

// Avisos de cobros, contracargos y reclamos que llegaron desde la última vez (etapa D). ?desde=<último id que la app ya tiene>.
// Lo usa la PC al arrancar: lo que pasó con ella apagada no tiene aviso en vivo.
export async function onRequestAvisos({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const desde = Number(new URL(request.url).searchParams.get('desde') || 0);
  if (!Number.isInteger(desde) || desde < 0) return json({ error: 'bad_request' }, 400);
  return json({ avisos: await avisosDe(env, w.orgId, w.branchId, desde) });
}

// Saldo real de la cuenta para el cierre (etapa E). Es asíncrono: se pide y después se pregunta por el id.
//   POST /api/mp/saldo  { desde }   → { id }   (desde = segundos; el reporte va de ahí hasta ahora, hasta 60 días)
//   GET  /api/mp/saldo?id=N         → { estado: 'pendiente' | 'error' | 'listo', … }
// Lo pueden usar los mismos equipos que ven los cobros del cierre (`quien`). Ni datos de quien pagó ni nada de la cuenta.
export async function onRequestSaldoPedir({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const b = await readJson(request);
  const hasta = now();
  if (!b || !Number.isInteger(b.desde) || b.desde <= 0 || b.desde >= hasta || hasta - b.desde > MAX_RANGO_SALDO) return json({ error: 'bad_request' }, 400);
  const r = await pedirSaldo(env, w.orgId, w.branchId, { desde: b.desde, hasta });
  if (r.error) return json({ error: r.error, status: r.http ?? null }, r.status);
  await registrarActividad(env, w, { accion: 'saldo', referencia: String(r.id), r: { status: 200, j: { id: r.id, status: r.reutilizado ? 'reutilizado' : 'pedido' } } });
  return json({ id: r.id });
}
export async function onRequestSaldo({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_request' }, 400);
  const r = await estadoSaldo(env, w.orgId, id);
  if (r.error) return json({ error: r.error, status: r.http ?? null }, r.status);
  return json(r);
}

// POST /api/mp/sena/devolver (Nodo Sur Servicios): `{ turnoId }`. Devuelve por Mercado Pago la seña que la clienta pagó con el link
// del bot; la dueña lo confirmó en la app. Reintentar no devuelve dos veces.
export async function onRequestDevolverSena({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const b = await readJson(request);
  if (!b || typeof b.turnoId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(b.turnoId)) return json({ error: 'bad_request' }, 400);
  const r = await devolverSena(env, w.orgId, w.branchId, b.turnoId);
  await registrarActividad(env, w, { accion: 'devolver_sena', referencia: b.turnoId, montoCentavos: r.centavos ?? null, r: { status: r.ok ? 200 : (r.status || 409), j: r } });
  if (r.ok) return json({ ok: true, centavos: r.centavos });
  const codigos = { no_existe: 404, sin_sena_mp: 409, mp_sin_respuesta: 504, mp_rechazo: 502 };
  return json({ error: r.error }, codigos[r.error] || 502);
}

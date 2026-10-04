import { json } from '../../_lib/util.js';
import { hasDB } from '../../_lib/db.js';
import { avisarOrdenMp } from '../../_lib/sync.js';
import { ensureMpTables, firmaWebhookValida, ordenDelAviso, registrarActividad } from '../../_lib/mp_conexion.js';

// Avisos de Mercado Pago sobre las órdenes de cobro de la Point (webhook "Order (Mercado Pago)", configurado UNA vez en el
// panel de la aplicación de Nodo Sur con la URL https://horsepos.com/api/mp/webhook; la clave secreta que genera Mercado Pago
// va en el secreto `MP_WEBHOOK_SECRET` del Worker). Con esto la PC y el celular se enteran del cobro al instante en vez de
// esperar su próxima consulta.
//
// Blindaje:
//  * Firma obligatoria: sin secreto configurado se contesta 503 (Mercado Pago lo muestra como fallido en su panel y reintenta),
//    y una firma que no cierra es 401. Nunca se actúa sobre un aviso sin firma.
//  * El aviso solo DESPIERTA a los equipos con el id de la orden: no aprueba ni rechaza nada. Cada equipo consulta la orden con
//    Mercado Pago antes de grabar la venta, así que un aviso repetido, tardío o fuera de orden no cambia ningún resultado.
//  * Solo órdenes que creó este servidor y de la cuenta conectada a ese negocio (`ordenDelAviso`).
//  * Se contesta rápido (Mercado Pago espera 22 s y reintenta): lo único que se hace es buscar la orden y avisar.
const ACCIONES = new Set(['order.processed', 'order.canceled', 'order.refunded', 'order.action_required', 'order.failed', 'order.expired']);

export async function onRequestPost({ request, env }) {
  if (!env.MP_WEBHOOK_SECRET) return json({ error: 'webhook_no_configurado' }, 503);
  const url = new URL(request.url);
  let cuerpo = null;
  try { cuerpo = await request.json(); } catch { /* cuerpo roto: se rechaza abajo */ }
  const dataId = url.searchParams.get('data.id') ?? (cuerpo && cuerpo.data && cuerpo.data.id != null ? String(cuerpo.data.id) : null);
  const valida = await firmaWebhookValida(env.MP_WEBHOOK_SECRET, {
    xSignature: request.headers.get('x-signature'), xRequestId: request.headers.get('x-request-id'), dataId,
  });
  if (!valida) return json({ error: 'firma_invalida' }, 401);
  if (!cuerpo || cuerpo.type !== 'order' || !ACCIONES.has(cuerpo.action) || !dataId || !/^[\w-]{1,64}$/.test(dataId)) return json({ ok: true, ignorado: true });
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  await ensureMpTables(env);

  const estado = cuerpo.data && cuerpo.data.status ? String(cuerpo.data.status) : null;
  const orden = await ordenDelAviso(env, { orderId: dataId, userId: cuerpo.user_id, estado });
  if (!orden) return json({ ok: true, ignorado: true });
  const accion = cuerpo.action.slice('order.'.length);
  const avisado = await avisarOrdenMp(env, { orgId: orden.orgId, branchId: orden.branchId, orden: dataId, accion });
  await registrarActividad(env, { orgId: orden.orgId, branchId: orden.branchId, deviceId: null, deviceName: 'Mercado Pago' }, {
    accion: 'aviso', referencia: dataId, r: { status: 200, j: { id: dataId, status: estado || accion } },
  });
  return json({ ok: true, avisado });
}

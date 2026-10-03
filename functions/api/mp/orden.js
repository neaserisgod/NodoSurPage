import { json } from '../../_lib/util.js';
import { actorOf } from '../../_lib/actor.js';
import { hasDB } from '../../_lib/db.js';
import { readJson } from '../../_lib/miembros.js';
import { syncAccess } from '../../_lib/sync.js';
import { mpConfigurado, ensureMpTables, crearOrden, consultarOrden, cancelarOrden, imprimirTicket, registrarActividad, MAX_CONTENIDO_TICKET, detalleError } from '../../_lib/mp_conexion.js';

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
  return { orgId: a.device.owner_org, branchId: a.device.branch_id, deviceId: a.device.id, deviceName: a.device.name };
}
// Lo que se le devuelve a la app: solo lo que necesita para seguir la orden; nada del token ni de la cuenta.
const salida = (r) => {
  if (r.status === 409 || !r.j) return json({ error: (r.j && r.j.error) || 'mp_error' }, r.status === 409 ? 409 : 502);
  if (r.status < 200 || r.status >= 300) return json({ error: 'mp_rechazo', status: r.status, mensaje: detalleError(r.j) }, r.status === 404 ? 404 : 502);
  return json({ id: r.j.id ? String(r.j.id) : null, status: r.j.status || null, statusDetail: r.j.status_detail || null });
};

// Crear la orden. Cuerpo: { externalReference, idempotencyKey, montoCentavos, canal: 'qr' | 'debit_card' }.
export async function onRequestPost({ request, env }) {
  const w = await quien(request, env); if (w.error) return w.error;
  const b = await readJson(request);
  if (!b || typeof b.externalReference !== 'string' || !/^[\w-]{1,64}$/.test(b.externalReference) || typeof b.idempotencyKey !== 'string' || !/^[\w-]{8,64}$/.test(b.idempotencyKey)
    || !Number.isInteger(b.montoCentavos) || b.montoCentavos < 100 || b.montoCentavos > 1e10 || !['qr', 'debit_card'].includes(b.canal)) return json({ error: 'bad_request' }, 400);
  const r = await crearOrden(env, w.orgId, w.branchId, b);
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
  const r = await cancelarOrden(env, w.orgId, b.id);
  await registrarActividad(env, w, { accion: 'cancelar', referencia: b.id, r });
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

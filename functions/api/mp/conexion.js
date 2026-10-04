import { json, siteUrl } from '../../_lib/util.js';
import { actorOf } from '../../_lib/actor.js';
import { currentUser } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { guard, readJson } from '../../_lib/miembros.js';
import { listBranches, getMembership } from '../../_lib/orgs.js';
import { puede } from '../../_lib/permisos.js';
import { mpConfigurado, ensureMpTables, iniciarConexion, completarConexion, estadoConexion, desconectar, terminalesDe, terminalDeSucursal, elegirTerminal, crearOrden, cancelarOrden, actividadDe, detalleError } from '../../_lib/mp_conexion.js';
import { randomHex } from '../../_lib/util.js';

const noConfig = () => json({ error: 'mp_no_configurado' }, 503);
const orgDe = (request) => Number(new URL(request.url).searchParams.get('org'));

// Estado de la conexión. Sesión web (solo el dueño, `?org=ID`): estado completo y la terminal de cada sucursal.
// Dispositivo (POS o celular): solo si el negocio puede cobrar y si su sucursal ya tiene terminal — nunca el token.
export async function onRequestGet({ request, env }) {
  if (request.headers.get('Authorization')) {
    const a = await actorOf(request, env);
    if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
    if (!hasDB(env) || !a.device.owner_org) return json({ connected: false, terminalConfigured: false });
    await ensureMpTables(env);
    const e = await estadoConexion(env, a.device.owner_org);
    // `canRefund`: si la persona que vinculó este equipo puede devolver por Mercado Pago en su sucursal (dueño y encargado). La
    // app lo usa solo para ofrecer o no la devolución; quien decide es `POST /api/mp/orden/devolver`.
    const m = await getMembership(env, a.device.owner_org, a.sub);
    return json({ connected: e.connected, needsReconnect: Boolean(e.needsReconnect), terminalConfigured: Boolean(await terminalDeSucursal(env, a.device.owner_org, a.device.branch_id)),
      canRefund: Boolean(m && m.status === 'active' && puede(m, 'devolver', a.device.branch_id)) });
  }
  const g = await guard(request, env, { orgId: orgDe(request), accion: 'mercadopago' });
  if (g.error) return g.error;
  if (!mpConfigurado(env)) return noConfig();
  const e = await estadoConexion(env, g.org.id);
  const sucursales = [];
  for (const b of (await listBranches(env, g.org.id)).filter((x) => x.active)) sucursales.push({ id: b.id, name: b.name, terminalId: await terminalDeSucursal(env, g.org.id, b.id) });
  return json({ ...e, branches: sucursales });
}

// Paso 1: devuelve la dirección de Mercado Pago a la que mandar al dueño. Cuerpo: { orgId }.
export async function onRequestConnect({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'mercadopago' });
  if (g.error) return g.error;
  if (!mpConfigurado(env)) return noConfig();
  await ensureMpTables(env);
  return json({ url: await iniciarConexion(env, { orgId: g.org.id, sub: g.a.sub }) });
}

// Paso 2: Mercado Pago vuelve acá con `code` y `state`. Es una navegación del navegador (GET): se necesita la sesión.
export async function onRequestCallback({ request, env }) {
  const volver = (r) => Response.redirect(`${siteUrl(env)}/negocio/?mp=${r}`, 302);
  const q = new URL(request.url).searchParams;
  if (q.get('error')) return volver('cancelado'); // el vendedor rechazó la autorización
  if (!hasDB(env) || !mpConfigurado(env)) return volver('no_configurado');
  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return volver('sin_sesion');
  const r = await completarConexion(env, { state: q.get('state'), code: q.get('code'), sub: cu.session.sub });
  return volver(r.ok ? 'ok' : r.error === 'sin_offline_access' ? 'sin_permiso' : 'error');
}

// Desconectar (borra el token y las terminales elegidas). Cuerpo: { orgId }.
export async function onRequestDisconnect({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'mercadopago' });
  if (g.error) return g.error;
  await desconectar(env, g.org.id);
  return json({ ok: true });
}

// Terminales Point de la cuenta conectada (`?org=ID`) para elegir cuál usa cada sucursal.
export async function onRequestTerminales({ request, env }) {
  const g = await guard(request, env, { orgId: orgDe(request), accion: 'mercadopago' });
  if (g.error) return g.error;
  if (!mpConfigurado(env)) return noConfig();
  const r = await terminalesDe(env, g.org.id);
  return r.error ? json({ error: r.error }, r.error === 'mp_no_conectado' ? 409 : 502) : json({ terminals: r.terminals });
}

// Elegir la terminal de una sucursal y pasarla a modo PDV. Cuerpo: { orgId, branchId, terminalId }.
export async function onRequestElegirTerminal({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'mercadopago' });
  if (g.error) return g.error;
  if (!mpConfigurado(env)) return noConfig();
  if (!Number.isInteger(b.branchId) || typeof b.terminalId !== 'string' || !b.terminalId) return json({ error: 'bad_request' }, 400);
  if (!(await listBranches(env, g.org.id)).some((x) => x.id === b.branchId && x.active)) return json({ error: 'bad_branch' }, 400);
  const r = await elegirTerminal(env, g.org.id, b.branchId, b.terminalId);
  if (r.ok) return json({ ok: true });
  return json({ error: r.error, detalle: r.detalle }, r.error === 'terminal_desconocida' ? 400 : r.error === 'mp_no_conectado' ? 409 : 502);
}

// $1 queda por debajo del mínimo que acepta la terminal Point: la prueba cobra $100 (se puede cancelar sin pagar).
const MONTO_PRUEBA_CENTAVOS = 10000;

// Prueba de punta a punta (solo el dueño): manda UN cobro de $100 a la terminal de una sucursal para comprobar que la conexión y la
// terminal andan, sin esperar a la app. Cuerpo: { orgId, branchId }. Queda como una orden común: se paga o se cancela con el botón
// "Cancelar la prueba" (`/api/mp/probar/cancelar`).
export async function onRequestProbar({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'mercadopago' });
  if (g.error) return g.error;
  if (!mpConfigurado(env)) return noConfig();
  if (!Number.isInteger(b.branchId) || !(await listBranches(env, g.org.id)).some((x) => x.id === b.branchId && x.active)) return json({ error: 'bad_branch' }, 400);
  const r = await crearOrden(env, g.org.id, b.branchId, { externalReference: `prueba-${randomHex(8)}`, idempotencyKey: randomHex(16), montoCentavos: MONTO_PRUEBA_CENTAVOS, canal: 'qr' });
  if (r.status === 409) return json({ error: r.j.error }, 409);
  if (r.status < 200 || r.status >= 300 || !r.j || !r.j.id) return json({ error: 'mp_rechazo', status: r.status, mensaje: detalleError(r.j) }, 502);
  return json({ ok: true, id: String(r.j.id), status: r.j.status || null });
}
export async function onRequestProbarCancelar({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'mercadopago' });
  if (g.error) return g.error;
  if (!mpConfigurado(env)) return noConfig();
  if (typeof b.id !== 'string' || !/^[\w-]{1,64}$/.test(b.id)) return json({ error: 'bad_request' }, 400);
  const r = await cancelarOrden(env, g.org.id, b.id);
  return r.status >= 200 && r.status < 300 ? json({ ok: true, status: (r.j && r.j.status) || null }) : json({ error: 'mp_rechazo', status: r.status, mensaje: detalleError(r.j) }, 502);
}

// Lo que el servidor hizo por el negocio con la terminal (cobros, cancelaciones, impresiones): para comprobar de dónde salió cada
// cobro. Solo el dueño (`?org=ID`, `?limit=`); sin secretos.
export async function onRequestActividad({ request, env }) {
  const g = await guard(request, env, { orgId: orgDe(request), accion: 'mercadopago' });
  if (g.error) return g.error;
  await ensureMpTables(env);
  const filas = await actividadDe(env, g.org.id, new URL(request.url).searchParams.get('limit'));
  const ramas = new Map((await listBranches(env, g.org.id)).map((b) => [b.id, b.name]));
  return json({ items: filas.map((f) => ({ id: f.id, at: f.creado, action: f.accion, channel: f.canal, amountCents: f.monto_centavos, reference: f.referencia, mpId: f.mp_id,
    httpStatus: f.http_status, result: f.resultado, detail: f.detalle, device: f.device_name, branch: ramas.get(f.branch_id) || null })) });
}

// Lo que comparten las dos formas de vincular un dispositivo: por el navegador (/vincular/ → authorize → token) y entrando
// con Google desde la app del celular (`POST /api/device/google`, 2026-10-13). Una sola regla de a qué negocio y sucursal
// queda el equipo, y una sola forma de registrarlo y darle su token.
import { now } from './util.js';
import { upsertDevice, signDeviceToken, getDevice, DEVICE_TTL } from './devices.js';
import { ensureOrgTables, ensurePersonalOrg, adoptarLegado, orgsWith, membershipsOf, listBranches, mainBranch } from './orgs.js';
import { puede } from './permisos.js';

const accionDe = (tipo) => (tipo === 'bot' ? 'configurar_bot' : tipo === 'celular' ? 'vincular_celular' : 'vincular_pc');

// El negocio y la sucursal donde queda el equipo. `orgId` y `branchId` son opcionales: sin ellos, el primer negocio de la
// persona y su sucursal principal (o la primera donde trabaja). Quien todavía no tiene negocio recibe el suyo. Un encargado o
// un empleado no vinculan PC; un celular lo vincula cada miembro en una de SUS sucursales; el bot, dueño o encargado.
// Devuelve { org, branch } o { error, status }.
export async function destinoDelDispositivo(env, { sub, email, name }, { tipo, orgId, branchId }) {
  await ensureOrgTables(env);
  const accion = accionDe(tipo);
  const porSucursal = tipo === 'celular' || tipo === 'bot';
  const propios = await orgsWith(env, sub, accion);
  let org;
  if (orgId != null) {
    if (!Number.isInteger(orgId)) return { error: 'bad_request', status: 400 };
    const elegido = propios.find((o) => o.org.id === orgId);
    if (!elegido) return { error: 'forbidden', status: 403 };
    org = elegido.org;
  } else if (propios.length) org = propios[0].org;
  else if (tipo === 'bot' || (await membershipsOf(env, sub)).length) return { error: 'forbidden', status: 403 }; // es miembro de otro negocio, no dueña
  else {
    const personal = await ensurePersonalOrg(env, { sub, email, name });
    org = personal.org;
    // Sus PC y copias de antes del modelo de negocios pasan a este negocio ya, para que no queden invisibles hasta el cron.
    if (personal.created) await adoptarLegado(env, sub, org.id, personal.branch.id);
  }
  const m = (propios.find((o) => o.org.id === org.id) || {}).membership;
  let branch;
  if (branchId != null) {
    if (!Number.isInteger(branchId)) return { error: 'bad_request', status: 400 };
    branch = (await listBranches(env, org.id)).find((x) => x.id === branchId && x.active);
    if (!branch) return { error: 'bad_request', status: 400 };
  } else if (porSucursal) {
    // Sin sucursal indicada: la primera activa de las suyas (el dueño, la principal).
    branch = m ? (await listBranches(env, org.id)).find((x) => x.active && puede(m, accion, x.id)) : await mainBranch(env, org.id);
    if (!branch) return { error: 'forbidden', status: 403 };
  } else branch = await mainBranch(env, org.id);
  // Un celular (o el bot) solo se vincula a una sucursal donde la persona trabaja (el dueño, a cualquiera).
  if (porSucursal && m && !puede(m, accion, branch.id)) return { error: 'forbidden', status: 403 };
  return { org, branch };
}

// Registra el equipo y le da su token. El id lo elige el equipo: sin el control de `device_ajeno`, alguien que conociera el id
// de un equipo ajeno lo podía "vincular" a su cuenta y dejar sin servicio al verdadero (la fila se pisaba). Volver a vincular el
// propio equipo sigue andando: misma persona, o el mismo negocio (por ejemplo, la PC del local después de transferir la
// propiedad). Un equipo dado de baja, o cuyo dueño anterior ya no trabaja en ese negocio, se puede vincular de nuevo.
// Devuelve { token, email, deviceId, expiresAt } o { error, status }.
export async function emitirTokenDeDispositivo(env, { sub, email, deviceId, name, orgId, branchId, personName, kind }) {
  const previo = await getDevice(env, deviceId);
  if (previo && !previo.revoked && previo.owner_sub !== sub && (previo.owner_org == null || previo.owner_org !== orgId)
    && await sigueVigente(env, previo)) return { error: 'device_ajeno', status: 409 };
  const t = now();
  await upsertDevice(env, { id: deviceId, sub, email, name, orgId, branchId, personName, kind }, t);
  return { token: await signDeviceToken(env, { sub, email, deviceId }, t), email, deviceId, expiresAt: t + DEVICE_TTL };
}

async function sigueVigente(env, d) {
  if (d.owner_org == null) return true;
  let m = null;
  try { m = await env.DB.prepare('SELECT status FROM memberships WHERE org_id = ?1 AND user_sub = ?2').bind(d.owner_org, d.owner_sub).first(); }
  catch (e) { if (!/no such table/i.test(String(e && e.message))) throw e; }
  return Boolean(m && m.status === 'active');
}

import { json, sameOriginPost } from '../../_lib/util.js';
import { currentUser } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { createDeviceCode, validPort, validState, validChallenge, validDeviceId, cleanName } from '../../_lib/devices.js';
import { ensureOrgTables, ensurePersonalOrg, adoptarLegado, orgsWith, membershipsOf, listBranches, mainBranch } from '../../_lib/orgs.js';
import { puede } from '../../_lib/permisos.js';

// Paso 2-3 de la vinculación: la persona, ya con sesión y tras confirmar en /vincular/, pide el código de
// un solo uso. Se devuelve a dónde redirigir el navegador: el servidor local que escucha la app (127.0.0.1).
// La PC queda en un negocio y una sucursal: opcionalmente `orgId` y `branchId` (solo el dueño de ese negocio puede
// vincular PC); sin ellos, el primer negocio de la persona y su sucursal principal. Quien todavía no tiene negocio
// recibe el suyo, con su "Sucursal principal". Un encargado o un empleado no vinculan PC.
// Un CELULAR (`tipo: 'celular'`) lo vincula cada miembro con SU cuenta, en una de SUS sucursales: así el celular sabe quién es
// (no hay selector de perfil) y sincroniza la sucursal donde trabaja.
export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return json({ error: 'no_session' }, 401);
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (!validPort(b.port) || !validState(b.state) || !validChallenge(b.challenge) || !validDeviceId(b.deviceId)) return json({ error: 'bad_request' }, 400);
  const sub = cu.session.sub;
  await ensureOrgTables(env);
  const celular = b.tipo === 'celular';
  const propios = await orgsWith(env, sub, celular ? 'vincular_celular' : 'vincular_pc');
  let org;
  if (b.orgId != null) {
    if (!Number.isInteger(b.orgId)) return json({ error: 'bad_request' }, 400);
    const elegido = propios.find((o) => o.org.id === b.orgId);
    if (!elegido) return json({ error: 'forbidden' }, 403);
    org = elegido.org;
  } else if (propios.length) org = propios[0].org;
  else if ((await membershipsOf(env, sub)).length) return json({ error: 'forbidden' }, 403); // es miembro de otro negocio, no dueña
  else {
    const personal = await ensurePersonalOrg(env, { sub, email: cu.session.email, name: cu.session.name });
    org = personal.org;
    // Sus PC y copias de antes del modelo de negocios pasan a este negocio ya, para que no queden invisibles hasta el cron.
    if (personal.created) await adoptarLegado(env, sub, org.id, personal.branch.id);
  }
  let branch;
  if (b.branchId != null) {
    if (!Number.isInteger(b.branchId)) return json({ error: 'bad_request' }, 400);
    branch = (await listBranches(env, org.id)).find((x) => x.id === b.branchId && x.active);
    if (!branch) return json({ error: 'bad_request' }, 400);
  } else if (celular) {
    // Sin sucursal indicada: la primera activa de las suyas (el dueño, la principal).
    const m = (propios.find((o) => o.org.id === org.id) || {}).membership;
    branch = m ? (await listBranches(env, org.id)).find((x) => x.active && puede(m, 'vincular_celular', x.id)) : await mainBranch(env, org.id);
    if (!branch) return json({ error: 'forbidden' }, 403);
  } else branch = await mainBranch(env, org.id);
  // Un celular solo se vincula a una sucursal donde la persona trabaja (el dueño, a cualquiera).
  if (celular) {
    const m = (propios.find((o) => o.org.id === org.id) || {}).membership;
    if (m && !puede(m, 'vincular_celular', branch.id)) return json({ error: 'forbidden' }, 403);
  }
  const code = await createDeviceCode(env, {
    sub, email: cu.session.email, deviceId: b.deviceId, name: cleanName(b.name), challenge: b.challenge, orgId: org.id, branchId: branch.id, personName: cu.session.name,
  });
  return json({ redirect: `http://127.0.0.1:${b.port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(b.state)}` });
}

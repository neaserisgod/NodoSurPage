import { json, sha256b64u, now } from '../../_lib/util.js';
import { hasDB } from '../../_lib/db.js';
import { readDeviceCode, consumeDeviceCode, upsertDevice, signDeviceToken, validDeviceId, getDevice, DEVICE_TTL } from '../../_lib/devices.js';

// Paso 4: la app canjea el código por el token de dispositivo demostrando que es la misma que lo pidió
// (PKCE: el verificador tiene que dar el desafío que viajó en el código).
export async function onRequestPost({ request, env }) {
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (typeof b.code !== 'string' || typeof b.verifier !== 'string' || b.verifier.length < 43 || b.verifier.length > 128) return json({ error: 'bad_request' }, 400);
  const c = await readDeviceCode(env, b.code);
  if (!c || !validDeviceId(c.did)) return json({ error: 'invalid_code' }, 400);
  if ((await sha256b64u(b.verifier)) !== c.challenge) return json({ error: 'invalid_code' }, 400);
  if (!(await consumeDeviceCode(env, c.jti))) return json({ error: 'invalid_code' }, 400); // ya usado
  // El id lo elige el equipo: sin esto, alguien que conociera el id de un equipo ajeno lo podía "vincular" a su cuenta y dejar
  // sin servicio al verdadero (la fila se pisaba). Volver a vincular el propio equipo sigue andando: misma persona, o el mismo
  // negocio (por ejemplo, la PC del local después de transferir la propiedad). Mismo criterio que `POST /api/bot/token`.
  // Un equipo dado de baja, o cuyo dueño anterior ya no trabaja en ese negocio (su token ya no vale), se puede vincular de nuevo.
  const previo = await getDevice(env, c.did);
  if (previo && !previo.revoked && previo.owner_sub !== c.sub && (previo.owner_org == null || previo.owner_org !== c.org)
    && await sigueVigente(env, previo)) return json({ error: 'device_ajeno' }, 409);
  const t = now();
  await upsertDevice(env, { id: c.did, sub: c.sub, email: c.email, name: c.name, orgId: c.org, branchId: c.branch, personName: c.pname, kind: c.kind }, t);
  return json({ token: await signDeviceToken(env, { sub: c.sub, email: c.email, deviceId: c.did }, t),
    email: c.email, deviceId: c.did, expiresAt: t + DEVICE_TTL });
}

async function sigueVigente(env, d) {
  if (d.owner_org == null) return true;
  let m = null;
  try { m = await env.DB.prepare('SELECT status FROM memberships WHERE org_id = ?1 AND user_sub = ?2').bind(d.owner_org, d.owner_sub).first(); }
  catch (e) { if (!/no such table/i.test(String(e && e.message))) throw e; }
  return Boolean(m && m.status === 'active');
}

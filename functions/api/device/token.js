import { json, sha256b64u } from '../../_lib/util.js';
import { hasDB } from '../../_lib/db.js';
import { readDeviceCode, consumeDeviceCode, validDeviceId } from '../../_lib/devices.js';
import { emitirTokenDeDispositivo } from '../../_lib/vincular.js';

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
  const r = await emitirTokenDeDispositivo(env, {
    sub: c.sub, email: c.email, deviceId: c.did, name: c.name, orgId: c.org, branchId: c.branch, personName: c.pname, kind: c.kind,
  });
  return r.error ? json({ error: r.error }, r.status) : json(r);
}

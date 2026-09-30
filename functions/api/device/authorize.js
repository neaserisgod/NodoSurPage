import { json, sameOriginPost } from '../../_lib/util.js';
import { currentUser } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { createDeviceCode, validPort, validState, validChallenge, validDeviceId, cleanName } from '../../_lib/devices.js';

// Paso 2-3 de la vinculación: la persona, ya con sesión y tras confirmar en /vincular/, pide el código de
// un solo uso. Se devuelve a dónde redirigir el navegador: el servidor local que escucha la app (127.0.0.1).
export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return json({ error: 'no_session' }, 401);
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (!validPort(b.port) || !validState(b.state) || !validChallenge(b.challenge) || !validDeviceId(b.deviceId)) return json({ error: 'bad_request' }, 400);
  const code = await createDeviceCode(env, {
    sub: cu.session.sub, email: cu.session.email, deviceId: b.deviceId, name: cleanName(b.name), challenge: b.challenge,
  });
  return json({ redirect: `http://127.0.0.1:${b.port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(b.state)}` });
}

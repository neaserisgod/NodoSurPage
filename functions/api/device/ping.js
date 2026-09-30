import { json, now } from '../../_lib/util.js';
import { actorOf } from '../../_lib/actor.js';
import { touchDevice, isPrivilegedSub, signDeviceToken } from '../../_lib/devices.js';

const cleanVersion = (v) => (typeof v === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(v) ? v : undefined);

// La app avisa que está viva: versión, sistema y su id de instalación (`cid`, el mismo del feed de
// actualizaciones). Con eso el panel ve las PC, y el feed sabe que esta PC es de pruebas (canal beta).
export async function onRequestPost({ request, env }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  let b = {}; try { b = await request.json(); } catch { /* ping vacío */ }
  const cid = typeof b.cid === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.cid) ? b.cid : undefined;
  const os = typeof b.os === 'string' ? b.os.replace(/[^\w .()-]/g, '').slice(0, 40) : undefined;
  const t = now();
  await touchDevice(env, a.device.id, { version: cleanVersion(b.version), os, cid }, t);
  const out = { ok: true, channel: (await isPrivilegedSub(env, a.sub, a.email)) ? 'beta' : 'stable' };
  // Renovación: si al token le queda menos de 60 días, se entrega uno nuevo.
  if (a.exp - t < 60 * 24 * 3600) out.token = await signDeviceToken(env, { sub: a.sub, email: a.email, deviceId: a.device.id }, t);
  return json(out);
}

import { sameOriginPost, json } from './util.js';
import { currentUser } from './auth.js';
import { deviceFromRequest } from './devices.js';

// Quién llama: un dispositivo (Authorization: Bearer) o la sesión web del sitio. null si ninguno.
// Las acciones que cambian algo y llegan por la sesión web exigen mismo origen y pedido "fetch"
// (defensa CSRF); con token de dispositivo no hay cookies, así que no aplica.
export async function actorOf(request, env) {
  if (request.headers.get('Authorization')) {
    const d = await deviceFromRequest(request, env);
    return d ? { via: 'device', sub: d.sub, email: d.email, device: d.device, exp: d.exp } : null;
  }
  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return null;
  return { via: 'session', sub: cu.session.sub, email: cu.session.email, name: cu.session.name };
}
export const csrfOk = (request, env, actor) =>
  actor.via === 'device' || (sameOriginPost(request, env) && request.headers.get('X-Requested-With') === 'fetch');
export const forbidden = () => json({ error: 'forbidden' }, 403);

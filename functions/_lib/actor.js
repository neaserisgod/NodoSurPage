import { sameOriginPost, json } from './util.js';
import { currentUser } from './auth.js';
import { deviceFromRequest } from './devices.js';

// Lo único que puede usar el token del bot de WhatsApp (`devices.kind = 'bot'`): lo suyo, escuchar avisos y saber quién es. El bot
// corre en un celular con librerías de terceros y lo vincula el dueño o un encargado: con su token sin este límite se podía cobrar,
// devolver por Mercado Pago o bajar la sync entera de la sucursal (revisión 2026-10-12). Una ruta nueva queda cerrada al bot salvo
// que se sume acá.
const RUTAS_DEL_BOT = new Set(['/api/sync/escuchar', '/api/device/me', '/api/device/ping']);
export const rutaDelBot = (path) => path.startsWith('/api/bot/') || RUTAS_DEL_BOT.has(path);

// Quién llama: un dispositivo (Authorization: Bearer) o la sesión web del sitio. null si ninguno.
// Las acciones que cambian algo y llegan por la sesión web exigen mismo origen y pedido "fetch"
// (defensa CSRF); con token de dispositivo no hay cookies, así que no aplica.
export async function actorOf(request, env) {
  if (request.headers.get('Authorization')) {
    const d = await deviceFromRequest(request, env);
    if (d && d.device.kind === 'bot' && !rutaDelBot(new URL(request.url).pathname)) return null;
    return d ? { via: 'device', sub: d.sub, email: d.email, device: d.device, exp: d.exp } : null;
  }
  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return null;
  return { via: 'session', sub: cu.session.sub, email: cu.session.email, name: cu.session.name };
}
export const csrfOk = (request, env, actor) =>
  actor.via === 'device' || (sameOriginPost(request, env) && request.headers.get('X-Requested-With') === 'fetch');
export const forbidden = () => json({ error: 'forbidden' }, 403);

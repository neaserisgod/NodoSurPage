// POST /api/soporte (la burbuja de ayuda de la página, `/soporte.js`): `{ mensajes: [{ rol: 'yo' | 'asistente', texto }], pagina }`.
// Contesta `{ texto, plan, persona }` con la IA (`_lib/soporte.js`). Sin IA configurada, pasado el tope del día o si la IA no
// contesta: 503 `{ error }` y el navegador ofrece seguir por WhatsApp. Sin sesión: lo usa cualquiera que mira la página, por eso
// pide mismo origen y tiene tope.
import { json, sameOriginPost } from '../_lib/util.js';
import { soporteConIa, charlaValida, usarCupo, contestarConIa } from '../_lib/soporte.js';

const MAX_CUERPO = 16 * 1024;

export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  if (!soporteConIa(env)) return json({ error: 'sin_ia' }, 503);
  const texto = await request.text();
  if (texto.length > MAX_CUERPO) return json({ error: 'too_large' }, 413);
  let b;
  try { b = JSON.parse(texto); } catch { return json({ error: 'bad_request' }, 400); }
  const mensajes = charlaValida(b && b.mensajes);
  if (!mensajes) return json({ error: 'bad_request' }, 400);
  if (!(await usarCupo(env, request.headers.get('CF-Connecting-IP')))) return json({ error: 'tope' }, 429);
  let r = null;
  try { r = await contestarConIa(env, { mensajes, pagina: b.pagina }); } catch (e) { console.error('soporte_ia', e && e.message); }
  if (!r) return json({ error: 'ia_no_contesto' }, 503);
  return json(r);
}

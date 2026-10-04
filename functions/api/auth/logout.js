import { cookie, sameOriginPost, siteUrl, getSession, cerrarSesion } from '../../_lib/util.js';

export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env)) return new Response('Forbidden', { status: 403 });
  // Además de borrar la cookie, la sesión queda cerrada en el servidor: una copia de la cookie ya no entra.
  await cerrarSesion(env, await getSession(request, env));
  const h = new Headers({ Location: `${siteUrl(env)}/`, 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', cookie('ns_session', '', { maxAge: 0 }));
  for (const n of ['ns_hint', 'ns_sub', 'ns_plan']) h.append('Set-Cookie', cookie(n, '', { maxAge: 0, httpOnly: false }));
  return new Response(null, { status: 303, headers: h });
}

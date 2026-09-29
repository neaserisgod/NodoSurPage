import { cookie, sameOriginPost, siteUrl } from '../../_lib/util.js';

export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env)) return new Response('Forbidden', { status: 403 });
  const h = new Headers({ Location: `${siteUrl(env)}/`, 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', cookie('ns_session', '', { maxAge: 0 }));
  h.append('Set-Cookie', cookie('ns_hint', '', { maxAge: 0, httpOnly: false }));
  return new Response(null, { status: 303, headers: h });
}

import { verify, sign, parseCookies, cookie, now, siteUrl, unb64u, safeNext, randomHex } from '../../_lib/util.js';
import { hasDB, upsertLogin, setIntent } from '../../_lib/db.js';
import { isPlan } from '../../_lib/plans.js';

const back = (site, err) => {
  const h = new Headers({ Location: `${site}/ingresar/?error=${err}`, 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', cookie('ns_oauth', '', { maxAge: 0, path: '/api/auth' }));
  return new Response(null, { status: 302, headers: h });
};

export async function onRequestGet({ request, env }) {
  const site = siteUrl(env);
  const url = new URL(request.url);
  if (url.searchParams.get('error')) return back(site, 'cancelado');

  const flow = await verify(parseCookies(request.headers.get('Cookie')).ns_oauth, env.SESSION_SECRET);
  const code = url.searchParams.get('code');
  if (!flow || !code || url.searchParams.get('state') !== flow.state) return back(site, 'sesion');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${site}/api/auth/callback`,
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
    }),
  });
  if (!tokenRes.ok) return back(site, 'google');
  const { id_token } = await tokenRes.json();

  // El id_token llega directo de Google por TLS: se validan los claims.
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(unb64u(String(id_token).split('.')[1]))); }
  catch { return back(site, 'google'); }
  const okIss = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!okIss || claims.aud !== env.GOOGLE_CLIENT_ID || claims.exp < now() || claims.nonce !== flow.nonce
      || claims.email_verified !== true || !claims.email || !claims.sub) {
    return back(site, 'google');
  }

  const iat = now();
  const plan = isPlan(flow.plan) ? flow.plan : null;
  if (hasDB(env)) {
    try {
      const u = await upsertLogin(env, { sub: claims.sub, email: String(claims.email).toLowerCase(), name: claims.name || claims.email }, iat);
      if (plan && u) await setIntent(env, u.id, plan, Boolean(flow.promo), iat).catch(() => {});
    } catch { return back(site, 'servidor'); }
  }
  const session = await sign({
    sub: claims.sub,
    email: String(claims.email).toLowerCase(),
    name: claims.name || claims.email,
    iat, exp: iat + 30 * 24 * 3600,
    jti: randomHex(16), // para poder cerrarla de verdad (`cerrarSesion`)
  }, env.SESSION_SECRET);
  const first = encodeURIComponent(String(claims.given_name || claims.name || claims.email).split(' ')[0]);
  // Con plan elegido se vuelve al pago con ese plan ya seleccionado; si no, a Mi cuenta.
  const volver = safeNext(flow.next); // p. ej. la vinculación de la app: se vuelve ahí
  const next = plan ? `${site}/pagar/?plan=${plan}${flow.promo ? '&promo=1' : ''}` : volver ? `${site}${volver}` : `${site}/cuenta/`;
  const h = new Headers({ Location: next, 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', cookie('ns_oauth', '', { maxAge: 0, path: '/api/auth' }));
  h.append('Set-Cookie', cookie('ns_session', session, { maxAge: 30 * 24 * 3600 }));
  h.append('Set-Cookie', cookie('ns_hint', first, { maxAge: 30 * 24 * 3600, httpOnly: false }));
  if (plan) h.append('Set-Cookie', cookie('ns_plan', plan, { maxAge: 30 * 24 * 3600, httpOnly: false }));
  return new Response(null, { status: 302, headers: h });
}

import { isPlan } from '../../_lib/plans.js';
import { randomHex, sha256b64u, sign, cookie, now, siteUrl, json, missingConfig, safeNext } from '../../_lib/util.js';

// Inicia el login: guarda state/nonce/PKCE en una cookie firmada y redirige a Google.
export async function onRequestGet({ request, env }) {
  const missing = missingConfig(env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET']);
  if (missing.length) return json({ error: 'login_no_configurado', faltan: missing }, 500);
  const site = siteUrl(env);
  const state = randomHex(16), nonce = randomHex(16), verifier = randomHex(32);
  // Plan elegido antes de ingresar (viaja firmado dentro del flujo; después se guarda en la base).
  const q0 = request ? new URL(request.url).searchParams : new URLSearchParams();
  const plan = isPlan(q0.get('plan')) ? q0.get('plan') : null;
  const promo = Boolean(plan) && q0.get('promo') === '1';
  const next = safeNext(q0.get('next'));
  const flow = await sign({ state, nonce, verifier, plan, promo, next, exp: now() + 600 }, env.SESSION_SECRET);
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${site}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state, nonce,
    code_challenge: await sha256b64u(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`,
      'Set-Cookie': cookie('ns_oauth', flow, { maxAge: 600, path: '/api/auth' }),
      'Cache-Control': 'no-store',
    },
  });
}

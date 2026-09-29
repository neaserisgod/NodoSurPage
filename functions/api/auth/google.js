import { randomHex, sha256b64u, sign, cookie, now, siteUrl } from '../../_lib/util.js';

// Inicia el login: guarda state/nonce/PKCE en una cookie firmada y redirige a Google.
export async function onRequestGet({ env }) {
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) {
    return new Response('Login no configurado', { status: 500 });
  }
  const site = siteUrl(env);
  const state = randomHex(16), nonce = randomHex(16), verifier = randomHex(32);
  const flow = await sign({ state, nonce, verifier, exp: now() + 600 }, env.SESSION_SECRET);
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

import assert from 'node:assert/strict';
import { sign, verify, parseCookies, getSession } from '../functions/_lib/util.js';
import { mkEnv } from './helpers-nube.mjs';
import * as google from '../functions/api/auth/google.js';
import * as callback from '../functions/api/auth/callback.js';
import * as me from '../functions/api/me.js';
import * as cancel from '../functions/api/subscription/cancel.js';
import * as logout from '../functions/api/auth/logout.js';

const env = { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'gs', SESSION_SECRET: 'x'.repeat(48), SITE_URL: 'https://horsepos.com', MP_ACCESS_TOKEN: 'APP_USR-test' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const ck = (res) => Object.fromEntries(res.headers.getSetCookie().map((c) => [c.split('=')[0], c.slice(c.indexOf('=') + 1).split(';')[0]]));
let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };

// --- sign/verify
await t('sign/verify roundtrip, manipulado y vencido', async () => {
  const tok = await sign({ a: 1, exp: now() + 60 }, 's');
  assert.equal((await verify(tok, 's')).a, 1);
  assert.equal(await verify(tok, 'otro'), null);
  const [b, s] = tok.split('.'); const forged = Buffer.from(JSON.stringify({ a: 2, exp: now() + 60 })).toString('base64url');
  assert.equal(await verify(`${forged}.${s}`, 's'), null);
  assert.equal(await verify(await sign({ exp: now() - 1 }, 's'), 's'), null);
  assert.equal(await verify('a.b.c', 's'), null); assert.equal(await verify(undefined, 's'), null);
});

// --- inicio de login
let flowCookie, flowState, flowNonce;
await t('google: redirige con PKCE, state y nonce', async () => {
  const r = await google.onRequestGet({ env });
  assert.equal(r.status, 302);
  const u = new URL(r.headers.get('Location'));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://horsepos.com/api/auth/callback');
  flowState = u.searchParams.get('state'); flowNonce = u.searchParams.get('nonce');
  flowCookie = ck(r).ns_oauth; assert.ok(flowCookie);
  const setc = r.headers.get('Set-Cookie'); assert.match(setc, /HttpOnly/); assert.match(setc, /Secure/); assert.match(setc, /SameSite=Lax/);
});
await t('google: sin configuración devuelve 500', async () => {
  const r0 = await google.onRequestGet({ env: {} }); assert.equal(r0.status, 500); assert.deepEqual((await r0.json()).faltan, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET']);
  const r1 = await google.onRequestGet({ env: { GOOGLE_CLIENT_ID: 'a', SESSION_SECRET: ' ' } }); assert.deepEqual((await r1.json()).faltan, ['GOOGLE_CLIENT_SECRET', 'SESSION_SECRET']);
});

// --- callback
const cbReq = (state, cookie) => new Request(`https://horsepos.com/api/auth/callback?code=abc&state=${state}`, { headers: { Cookie: `ns_oauth=${cookie}` } });
const mockGoogle = (claims) => { globalThis.fetch = async (url, init) => {
  assert.equal(url, 'https://oauth2.googleapis.com/token'); assert.ok(String(init.body).includes('code_verifier='));
  return new Response(JSON.stringify({ id_token: `h.${b64(claims)}.s` }), { status: 200 }); }; };
const good = () => ({ iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, exp: now() + 300, nonce: flowNonce, email_verified: true, email: 'Cliente@Gmail.com', sub: '123', name: 'Ana Pérez', given_name: 'Ana' });

let sessionCookie;
await t('callback: éxito crea sesión HttpOnly + hint y borra el flujo', async () => {
  mockGoogle(good());
  const r = await callback.onRequestGet({ request: cbReq(flowState, flowCookie), env });
  assert.equal(r.status, 302); assert.equal(r.headers.get('Location'), 'https://horsepos.com/cuenta/');
  const c = ck(r); sessionCookie = c.ns_session; assert.ok(sessionCookie); assert.equal(c.ns_hint, 'Ana');
  const raw = r.headers.getSetCookie();
  assert.match(raw.find((x) => x.startsWith('ns_session')), /HttpOnly/);
  assert.doesNotMatch(raw.find((x) => x.startsWith('ns_hint')), /HttpOnly/);
  const s = await verify(sessionCookie, env.SESSION_SECRET); assert.equal(s.email, 'cliente@gmail.com');
});
for (const [name, mut, expect] of [
  ['aud ajeno', { aud: 'otro' }, 'google'], ['nonce distinto', { nonce: 'zz' }, 'google'], ['mail sin verificar', { email_verified: false }, 'google'],
  ['iss falso', { iss: 'https://evil.com' }, 'google'], ['token vencido', { exp: now() - 5 }, 'google'],
]) await t(`callback: rechaza ${name}`, async () => {
  mockGoogle({ ...good(), ...mut });
  const r = await callback.onRequestGet({ request: cbReq(flowState, flowCookie), env });
  assert.match(r.headers.get('Location'), new RegExp(`error=${expect}`)); assert.ok(!ck(r).ns_session);
});
await t('callback: state falso, sin cookie o cancelado por el usuario', async () => {
  assert.match((await callback.onRequestGet({ request: cbReq('otro', flowCookie), env })).headers.get('Location'), /error=sesion/);
  assert.match((await callback.onRequestGet({ request: new Request('https://horsepos.com/api/auth/callback?code=a&state=b'), env })).headers.get('Location'), /error=sesion/);
  assert.match((await callback.onRequestGet({ request: new Request('https://horsepos.com/api/auth/callback?error=access_denied'), env })).headers.get('Location'), /error=cancelado/);
});

// --- MP simulado
const plan = { pos: '6fe282d944ef4c018cb7904ce9e122f8' };
let mpCalls = [], cancelResponses = [200];
const mockMP = () => { mpCalls = []; globalThis.fetch = async (url, init = {}) => {
  mpCalls.push({ url: String(url), method: init.method || 'GET', body: init.body, auth: init.headers && init.headers.Authorization });
  const u = new URL(url);
  if (u.pathname === '/preapproval/search') return new Response(JSON.stringify({ results: [
    { id: 'sub_mine_1', status: 'authorized', reason: 'Sistema Pos', payer_email: 'Cliente@gmail.com', preapproval_plan_id: plan.pos, next_payment_date: '2026-10-06T10:00:00.000-04:00', date_created: '2026-09-29T10:00:00.000-04:00', auto_recurring: { transaction_amount: 35000, currency_id: 'ARS', frequency: 1, frequency_type: 'months' } },
    { id: 'sub_other_2', status: 'authorized', reason: 'Sistema Pos', payer_email: 'otro@gmail.com', preapproval_plan_id: plan.pos, auto_recurring: { transaction_amount: 35000 } },
    { id: 'sub_foreign_3', status: 'authorized', reason: 'Otra cosa', payer_email: 'cliente@gmail.com', preapproval_plan_id: 'zzz', auto_recurring: { transaction_amount: 1 } },
  ] }), { status: 200 });
  if (u.pathname === '/authorized_payments/search') return new Response(JSON.stringify({ results: [{ debit_date: '2026-09-29T10:00:00Z', transaction_amount: 35000, status: 'processed' }] }), { status: 200 });
  if (init.method === 'PUT') { const code = cancelResponses.shift() ?? 200; return new Response('{}', { status: code }); }
  return new Response('{}', { status: 404 }); }; };
const authed = (extra = {}, method = 'GET', body) => new Request('https://horsepos.com/api/x', { method, body, headers: { Cookie: `ns_session=${sessionCookie}`, Origin: 'https://horsepos.com', 'X-Requested-With': 'fetch', ...extra } });

await t('me: 401 sin sesión y con cookie falsa', async () => {
  assert.equal((await me.onRequestGet({ request: new Request('https://horsepos.com/api/me'), env })).status, 401);
  assert.equal((await me.onRequestGet({ request: new Request('https://horsepos.com/api/me', { headers: { Cookie: 'ns_session=x.y' } }), env })).status, 401);
});
await t('me: solo devuelve suscripciones propias de nuestros planes', async () => {
  mockMP(); const r = await me.onRequestGet({ request: authed(), env }); const d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.user.email, 'cliente@gmail.com'); assert.equal(d.subscriptions.length, 1);
  assert.equal(d.subscriptions[0].id, 'sub_mine_1'); assert.equal(d.subscriptions[0].plan, 'Sistema POS'); assert.equal(d.subscriptions[0].payments.length, 1);
  assert.equal(r.headers.get('Cache-Control'), 'no-store'); assert.ok(mpCalls[0].auth.startsWith('Bearer '));
});
await t('me: si MP falla, avisa sin romper', async () => {
  globalThis.fetch = async () => new Response('x', { status: 500 });
  const d = await (await me.onRequestGet({ request: authed(), env })).json(); assert.equal(d.mpError, true); assert.equal(d.user.email, 'cliente@gmail.com');
});
await t('me: sin token de MP funciona igual (solo identidad)', async () => {
  const d = await (await me.onRequestGet({ request: authed(), env: { ...env, MP_ACCESS_TOKEN: undefined } })).json(); assert.equal(d.mpConfigured, false); assert.equal(d.subscriptions, null);
});

// --- cancelar
const body = (id) => JSON.stringify({ id });
await t('cancel: rechaza sin cabecera, otro origen o sin sesión', async () => {
  mockMP();
  assert.equal((await cancel.onRequestPost({ request: authed({ 'X-Requested-With': '' }, 'POST', body('sub_mine_1')), env })).status, 403);
  assert.equal((await cancel.onRequestPost({ request: authed({ Origin: 'https://evil.com' }, 'POST', body('sub_mine_1')), env })).status, 403);
  assert.equal((await cancel.onRequestPost({ request: new Request('https://horsepos.com/api/x', { method: 'POST', body: body('sub_mine_1'), headers: { Origin: 'https://horsepos.com', 'X-Requested-With': 'fetch' } }), env })).status, 401);
  assert.equal(mpCalls.filter((c) => c.method === 'PUT').length, 0);
});
await t('cancel: NO permite cancelar la suscripción de otro cliente', async () => {
  mockMP(); const r = await cancel.onRequestPost({ request: authed({}, 'POST', body('sub_other_2')), env });
  assert.equal(r.status, 403); assert.equal(mpCalls.filter((c) => c.method === 'PUT').length, 0);
  assert.equal((await cancel.onRequestPost({ request: authed({}, 'POST', body('../../x')), env })).status, 400);
});
await t('cancel: cancela la propia (PUT status cancelled)', async () => {
  mockMP(); cancelResponses = [200]; const r = await cancel.onRequestPost({ request: authed({}, 'POST', body('sub_mine_1')), env });
  assert.equal(r.status, 200); const put = mpCalls.find((c) => c.method === 'PUT');
  assert.ok(put.url.endsWith('/preapproval/sub_mine_1')); assert.equal(JSON.parse(put.body).status, 'cancelled');
});
await t('cancel: si MP pide "canceled" reintenta con esa grafía', async () => {
  mockMP(); cancelResponses = [400, 200]; const r = await cancel.onRequestPost({ request: authed({}, 'POST', body('sub_mine_1')), env });
  assert.equal(r.status, 200); assert.deepEqual(mpCalls.filter((c) => c.method === 'PUT').map((c) => JSON.parse(c.body).status), ['cancelled', 'canceled']);
});
await t('cancel: error de MP se informa como 502', async () => {
  mockMP(); cancelResponses = [500]; assert.equal((await cancel.onRequestPost({ request: authed({}, 'POST', body('sub_mine_1')), env })).status, 502);
});

// --- logout
await t('logout: borra cookies y exige mismo origen', async () => {
  const r = await logout.onRequestPost({ request: new Request('https://horsepos.com/api/auth/logout', { method: 'POST', headers: { Origin: 'https://horsepos.com' } }), env });
  assert.equal(r.status, 303); assert.ok(r.headers.getSetCookie().every((c) => /Max-Age=0/.test(c)));
  assert.equal((await logout.onRequestPost({ request: new Request('https://horsepos.com/api/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.com' } }), env })).status, 403);
});
await t('logout: la sesión queda cerrada en el servidor (una copia de la cookie ya no entra); las demás siguen', async () => {
  const envDb = mkEnv();
  const ahora = Math.floor(Date.now() / 1000);
  const cookieDe = async (jti) => `ns_session=${await sign({ sub: 's1', email: 'ana@x.com', name: 'Ana', iat: ahora, exp: ahora + 999, jti }, envDb.SESSION_SECRET)}`;
  const esta = await cookieDe('sesion-a'), otra = await cookieDe('sesion-b');
  const con = (cookie) => new Request('https://horsepos.com/api/me', { headers: { Cookie: cookie } });
  assert.ok(await getSession(con(esta), envDb));
  const r = await logout.onRequestPost({ request: new Request('https://horsepos.com/api/auth/logout', { method: 'POST', headers: { Origin: 'https://horsepos.com', Cookie: esta } }), env: envDb });
  assert.equal(r.status, 303);
  assert.equal(await getSession(con(esta), envDb), null, 'la cookie copiada ya no vale');
  assert.ok(await getSession(con(otra), envDb), 'la sesión de otro navegador sigue');
});
console.log(`\n${pass} pruebas OK`);

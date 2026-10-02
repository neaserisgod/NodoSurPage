import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sign, verify } from '../functions/_lib/util.js';
import * as checkout from '../functions/api/checkout.js';
import * as google from '../functions/api/auth/google.js';
import * as callback from '../functions/api/auth/callback.js';
import * as me from '../functions/api/me.js';
import * as overview from '../functions/api/admin/overview.js';
import { setPromo } from '../functions/_lib/db.js';
import { clearMpCache } from '../functions/_lib/mp.js';
import { PLAN_CATALOG, ALTA_URL } from '../functions/_lib/plans.js';

const nowS = () => Math.floor(Date.now() / 1000);
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_users.sql', import.meta.url), 'utf8')); // sin las columnas de plan a propósito
  return { raw: db, prepare(sql) { let a = []; const st = db.prepare(sql); const o = { bind(...x) { a = x; return o }, first() { return st.get(...a) ?? null }, all() { return { results: st.all(...a) } }, run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } } } }; return o } };
}
const mkEnv = (extra = {}) => (clearMpCache(), { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'gs', SESSION_SECRET: 'x'.repeat(48), SITE_URL: 'https://horsepos.com', MP_ACCESS_TOKEN: 'tok', DB: fakeD1(), ...extra });
let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const sess = async (env, email, sub, name = 'Ana') => `ns_session=${await sign({ sub, email, name, iat: nowS(), exp: nowS() + 999 }, env.SESSION_SECRET)}`;
const addUser = (env, email, sub) => env.DB.raw.prepare('INSERT INTO users (sub,email,name,created_at,last_seen,login_count) VALUES (?,?,?,?,?,1)').run(sub, email, 'Ana', nowS(), nowS());
const row = (env, email) => env.DB.raw.prepare('SELECT * FROM users WHERE email=?').get(email);
const go = (env, qs, cookie) => checkout.onRequestGet({ request: new Request('https://horsepos.com/api/checkout?' + qs, { headers: cookie ? { Cookie: cookie } : {} }), env });
const ck = (res) => Object.fromEntries(res.headers.getSetCookie().map((c) => [c.split('=')[0], c.slice(c.indexOf('=') + 1).split(';')[0]]));

// ---------- sin sesión: no se puede pagar, y el plan se recuerda
await t('checkout sin sesión manda a ingresar recordando plan y precio de fundador', async () => {
  const env = mkEnv();
  for (const [qs, want] of [
    ['plan=pos', '/ingresar/?plan=pos'],
    ['plan=pos-bot&promo=1', '/ingresar/?plan=pos-bot&promo=1'],
    ['plan=bot&item=alta', '/ingresar/?plan=bot&item=alta'],
  ]) {
    const r = await go(env, qs);
    assert.equal(r.status, 302); assert.equal(r.headers.get('Location'), 'https://horsepos.com' + want);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
  }
});
await t('checkout con sesión inexistente (cuenta eliminada) también exige ingresar', async () => {
  const env = mkEnv(); // hay sesión firmada pero el usuario no está en la base
  const r = await go(env, 'plan=pos', await sess(env, 'x@x.com', 's-gone'));
  assert.equal(r.headers.get('Location'), 'https://horsepos.com/ingresar/?plan=pos');
});
await t('checkout: plan inválido o alta de un plan sin alta vuelven a /pagar/ (nunca redirige afuera)', async () => {
  const env = mkEnv();
  for (const qs of ['plan=hack', 'plan=', '', 'plan=pos&item=alta', 'plan=__proto__', 'plan=constructor']) {
    const r = await go(env, qs, await sess(env, 'a@b.com', 's1'));
    assert.equal(r.headers.get('Location'), 'https://horsepos.com/pagar/', qs);
  }
});

// ---------- con sesión: redirige a Mercado Pago y guarda el plan en la base
await t('checkout con sesión: va a Mercado Pago y guarda el plan (crea las columnas solas)', async () => {
  const env = mkEnv(); addUser(env, 'ana@gmail.com', 's1');
  const c = await sess(env, 'ana@gmail.com', 's1');
  let r = await go(env, 'plan=pos-bot', c);
  assert.equal(r.headers.get('Location'), PLAN_CATALOG['pos-bot'].href);
  let u = row(env, 'ana@gmail.com'); assert.equal(u.plan_interest, 'pos-bot'); assert.equal(u.promo_interest, 0); assert.ok(u.plan_chosen_at > 0);
  r = await go(env, 'item=alta&plan=bot', c);
  assert.equal(r.headers.get('Location'), ALTA_URL); assert.equal(row(env, 'ana@gmail.com').plan_interest, 'bot');
});
await t('checkout con precio de fundador: WhatsApp con el plan; si la promo está apagada, precio normal', async () => {
  const env = mkEnv(); addUser(env, 'ana@gmail.com', 's1'); const c = await sess(env, 'ana@gmail.com', 's1');
  let r = await go(env, 'plan=pos&promo=1', c);
  const loc = new URL(r.headers.get('Location')); assert.equal(loc.origin + loc.pathname, 'https://wa.me/5492944796044');
  assert.match(loc.searchParams.get('text'), /precio de fundador con el plan Sistema POS/); assert.equal(row(env, 'ana@gmail.com').promo_interest, 1);
  await setPromo(env, false, nowS());
  r = await go(env, 'plan=pos&promo=1', c);
  assert.equal(r.headers.get('Location'), PLAN_CATALOG.pos.href); assert.equal(row(env, 'ana@gmail.com').promo_interest, 0);
});
await t('checkout sin base de datos: igual exige sesión y redirige', async () => {
  const env = mkEnv({ DB: undefined });
  assert.equal((await go(env, 'plan=pos')).headers.get('Location'), 'https://horsepos.com/ingresar/?plan=pos');
  const r = await go(env, 'plan=pos', await sess(env, 'a@b.com', 's1'));
  assert.equal(r.headers.get('Location'), PLAN_CATALOG.pos.href);
});
await t('checkout: si no se puede guardar el plan, igual deja pagar', async () => {
  const env = mkEnv(); addUser(env, 'ana@gmail.com', 's1');
  const real = env.DB.prepare.bind(env.DB); env.DB.prepare = (sql) => { if (/UPDATE users SET plan_interest/.test(sql)) throw new Error('boom'); return real(sql); };
  const r = await go(env, 'plan=pos', await sess(env, 'ana@gmail.com', 's1'));
  assert.equal(r.headers.get('Location'), PLAN_CATALOG.pos.href);
});

// ---------- registro con plan elegido
const idt = (nonce, email, sub) => 'h.' + Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'cid', exp: nowS() + 99, nonce, email_verified: true, email, sub, name: 'Ana Pérez', given_name: 'Ana' })).toString('base64url') + '.s';
async function login(env, qs, email = 'ana@gmail.com', sub = 's1') {
  const r0 = await google.onRequestGet({ request: new Request('https://horsepos.com/api/auth/google' + qs), env });
  const u = new URL(r0.headers.get('Location'));
  const flow = ck(r0).ns_oauth;
  globalThis.fetch = async () => new Response(JSON.stringify({ id_token: idt(u.searchParams.get('nonce'), email, sub) }), { status: 200 });
  const res = await callback.onRequestGet({ request: new Request(`https://horsepos.com/api/auth/callback?code=c&state=${u.searchParams.get('state')}`, { headers: { Cookie: `ns_oauth=${flow}` } }), env });
  return { res, flow: await verify(flow, env.SESSION_SECRET) };
}
await t('registro con plan elegido: vuelve al pago con el plan, lo guarda en la base y en cookie', async () => {
  const env = mkEnv();
  const { res, flow } = await login(env, '?plan=bot&promo=1');
  assert.equal(flow.plan, 'bot'); assert.equal(flow.promo, true);
  assert.equal(res.headers.get('Location'), 'https://horsepos.com/pagar/?plan=bot&promo=1');
  const u = row(env, 'ana@gmail.com'); assert.equal(u.plan_interest, 'bot'); assert.equal(u.promo_interest, 1);
  assert.equal(ck(res).ns_plan, 'bot'); assert.ok(ck(res).ns_session);
});
await t('registro sin plan o con plan inválido: va a Mi cuenta y no guarda nada', async () => {
  for (const qs of ['', '?plan=hack', '?promo=1']) {
    const env = mkEnv(); const { res, flow } = await login(env, qs);
    assert.equal(flow.plan ?? null, null, qs); assert.equal(res.headers.get('Location'), 'https://horsepos.com/cuenta/', qs);
    assert.ok(!('ns_plan' in ck(res)), qs);
  }
});
await t('el plan elegido no se pierde si vuelve a ingresar sin plan', async () => {
  const env = mkEnv(); await login(env, '?plan=pos');
  await login(env, ''); assert.equal(row(env, 'ana@gmail.com').plan_interest, 'pos');
});

// ---------- Mi cuenta: plan recordado + cookies para el aviso
let SUBS = [], mpFail = false;
const mockMP = () => { globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === '/preapproval/search') { if (mpFail) return new Response('x', { status: 500 });
    const email = u.searchParams.get('payer_email');
    return new Response(JSON.stringify({ results: SUBS.filter((s) => !email || s.payer_email === email) }), { status: 200 }); }
  if (u.pathname === '/authorized_payments/search') return new Response('{"results":[]}', { status: 200 });
  return new Response('{}', { status: 404 }); }; };
const P = '6fe282d944ef4c018cb7904ce9e122f8';
const mpSub = (email, status) => ({ id: 'id_' + email, status, reason: 'x', payer_email: email, preapproval_plan_id: P, auto_recurring: { transaction_amount: 35000, currency_id: 'ARS', frequency: 1, frequency_type: 'months' }, next_payment_date: '2027-01-01T00:00:00Z', date_created: '2026-09-01T00:00:00Z' });
const meCall = async (env, cookie) => me.onRequestGet({ request: new Request('https://horsepos.com/api/me', { headers: { Cookie: cookie } }), env });

await t('/api/me: devuelve el plan elegido y marca "sin suscripción" para el aviso del sitio', async () => {
  const env = mkEnv(); await login(env, '?plan=pos-bot'); SUBS = []; mockMP();
  const r = await meCall(env, await sess(env, 'ana@gmail.com', 's1')); const j = await r.json();
  assert.deepEqual(j.intent, { plan: 'pos-bot', promo: false }); assert.equal(j.promoActive, true); assert.deepEqual(j.subscriptions, []);
  const c = ck(r); assert.equal(c.ns_sub, '0'); assert.equal(c.ns_plan, 'pos-bot');
  assert.doesNotMatch(r.headers.getSetCookie().find((x) => x.startsWith('ns_sub')), /HttpOnly/);
});
await t('/api/me: con suscripción vigente el aviso se apaga (ns_sub=1)', async () => {
  const env = mkEnv(); await login(env, ''); SUBS = [mpSub('ana@gmail.com', 'authorized')]; mockMP();
  assert.equal(ck(await meCall(env, await sess(env, 'ana@gmail.com', 's1'))).ns_sub, '1');
  SUBS = [mpSub('ana@gmail.com', 'cancelled')]; assert.equal(ck(await meCall(env, await sess(env, 'ana@gmail.com', 's1'))).ns_sub, '0');
});
await t('/api/me: si Mercado Pago falla no se afirma nada (sin ns_sub); admin siempre 1', async () => {
  const env = mkEnv(); await login(env, ''); SUBS = []; mpFail = true; mockMP();
  const r = await meCall(env, await sess(env, 'ana@gmail.com', 's1')); assert.equal((await r.json()).mpError, true); assert.ok(!('ns_sub' in ck(r)));
  mpFail = false; mockMP();
  const env2 = mkEnv({ ADMIN_EMAILS: 'ana@gmail.com' }); await login(env2, ''); mockMP();
  assert.equal(ck(await meCall(env2, await sess(env2, 'ana@gmail.com', 's1'))).ns_sub, '1');
});
await t('/api/me: una cuenta eximida no paga: devuelve exempt y ns_sub=1 aunque no tenga suscripción', async () => {
  const env = mkEnv(); await login(env, ''); SUBS = []; mockMP();
  let j = await (await meCall(env, await sess(env, 'ana@gmail.com', 's1'))).json(); assert.equal(j.exempt, false);
  env.DB.raw.prepare("UPDATE users SET exempt = 1 WHERE sub = 's1'").run();
  const r = await meCall(env, await sess(env, 'ana@gmail.com', 's1')); j = await r.json();
  assert.equal(j.exempt, true); assert.equal(ck(r).ns_sub, '1');
});
await t('/api/me: plan elegido inexistente en la base se ignora', async () => {
  const env = mkEnv(); await login(env, ''); env.DB.raw.exec("ALTER TABLE users ADD COLUMN plan_interest TEXT; ALTER TABLE users ADD COLUMN promo_interest INTEGER DEFAULT 0; ALTER TABLE users ADD COLUMN plan_chosen_at INTEGER;");
  env.DB.raw.prepare("UPDATE users SET plan_interest='<script>'").run(); SUBS = []; mockMP();
  assert.equal((await (await meCall(env, await sess(env, 'ana@gmail.com', 's1'))).json()).intent, null);
});

// ---------- panel de administración
await t('admin: muestra el plan elegido y cuántos se registraron sin pagar', async () => {
  const env = mkEnv({ ADMIN_EMAILS: 'admin@x.com' });
  await login(env, '?plan=pos&promo=1', 'ana@gmail.com', 's1'); await login(env, '', 'luis@gmail.com', 's2'); await login(env, '', 'admin@x.com', 's3');
  SUBS = [mpSub('luis@gmail.com', 'authorized')]; mockMP();
  const r = await overview.onRequestGet({ request: new Request('https://horsepos.com/api/admin/overview', { headers: { Cookie: await sess(env, 'admin@x.com', 's3') } }), env });
  const j = await r.json(); const by = Object.fromEntries(j.users.map((u) => [u.email, u]));
  assert.equal(by['ana@gmail.com'].plan, 'pos'); assert.equal(by['ana@gmail.com'].promo, true); assert.ok(by['ana@gmail.com'].chosenAt > 0);
  assert.equal(by['luis@gmail.com'].plan, null);
  assert.equal(j.kpis.unpaid, 1); // ana: sin suscripción; luis paga; admin no cuenta
  mpFail = true; clearMpCache(); mockMP(); const r2 = await overview.onRequestGet({ request: new Request('https://horsepos.com/api/admin/overview', { headers: { Cookie: await sess(env, 'admin@x.com', 's3') } }), env });
  assert.equal((await r2.json()).kpis.unpaid, null); mpFail = false;
});

// ---------- los links de pago ya no están en el sitio público
await t('ningún archivo público expone los links de pago de Mercado Pago', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const skip = new Set(['node_modules', '.git', 'functions', 'tests', 'migrations', 'img', 'fonts']);
  const bad = [];
  (function walk(d) {
    for (const f of readdirSync(d)) {
      if (skip.has(f) || f.startsWith('.')) continue;
      const p = join(d, f); if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(html|js|txt|xml|json|webmanifest)$/.test(f) || f === 'worker.js' || f === 'README.md') continue;
      if (/mercadopago\.com\.ar\/subscriptions|mpago\.la/.test(readFileSync(p, 'utf8'))) bad.push(p.replace(root, ''));
    }
  })(root);
  assert.deepEqual(bad, []);
});

console.log(`\n${pass} pruebas OK (checkout y plan elegido)`);

import assert from 'node:assert/strict';
import { sign } from '../functions/_lib/util.js';
import * as adminSub from '../functions/api/admin/subscription.js';
import * as cancel from '../functions/api/subscription/cancel.js';
import * as overview from '../functions/api/admin/overview.js';
import { clearMpCache } from '../functions/_lib/mp.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const nowS = () => Math.floor(Date.now() / 1000);
function fakeD1() { const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../migrations/0001_users.sql', import.meta.url), 'utf8'));
  return { raw: db, prepare(sql) { let a = []; const st = db.prepare(sql); const o = { bind(...x) { a = x; return o }, first() { return st.get(...a) ?? null }, all() { return { results: st.all(...a) } }, run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } } } }; return o } }; }
const mkEnv = (extra = {}) => (clearMpCache(), { SESSION_SECRET: 'x'.repeat(48), SITE_URL: 'https://horsepos.com', MP_ACCESS_TOKEN: 'tok', ADMIN_EMAILS: 'admin@x.com', DB: fakeD1(), ...extra });
let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const sess = async (env, email, sub) => `ns_session=${await sign({ sub, email, name: 'X', iat: nowS(), exp: nowS() + 999 }, env.SESSION_SECRET)}`;
const addUser = (env, email, sub) => env.DB.raw.prepare('INSERT INTO users (sub,email,name,created_at,last_seen,login_count) VALUES (?,?,?,?,?,1)').run(sub, email, email, nowS(), nowS());
const post = (mod, env, body, cookie, extra = {}) => mod.onRequestPost({ request: new Request('https://horsepos.com/api/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Cookie: cookie || '', Origin: 'https://horsepos.com', 'X-Requested-With': 'fetch', ...extra } }), env });

const P = '6fe282d944ef4c018cb7904ce9e122f8';
let SUBS, PUTS, putStatus;
const mockMP = () => { PUTS = []; putStatus = 200; globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.pathname === '/preapproval/search') {
    const email = u.searchParams.get('payer_email');
    return new Response(JSON.stringify({ results: SUBS.filter((s) => !email || s.payer_email === email) }), { status: 200 }); }
  if (u.pathname === '/authorized_payments/search') return new Response('{"results":[]}', { status: 200 });
  if (u.pathname.startsWith('/preapproval/') && init.method === 'PUT') {
    PUTS.push({ id: u.pathname.split('/').pop(), body: JSON.parse(init.body) });
    if (putStatus === 200) SUBS.find((s) => s.id === PUTS.at(-1).id).status = JSON.parse(init.body).status;
    return new Response('{}', { status: putStatus }); }
  return new Response('{}', { status: 404 }); }; };
const sub = (id, email, status, plan = P) => ({ id, status, reason: 'x', payer_email: email, preapproval_plan_id: plan, auto_recurring: { transaction_amount: 35000, currency_id: 'ARS', frequency: 1, frequency_type: 'months' } });

await t('admin baja: exige ser administrador, mismo origen y pedido fetch', async () => {
  const env = mkEnv(); addUser(env, 'admin@x.com', 'a'); addUser(env, 'ana@x.com', 's1'); SUBS = [sub('sub_ana1', 'ana@x.com', 'authorized')]; mockMP();
  assert.equal((await post(adminSub, env, { id: 'sub_ana1' })).status, 401);
  assert.equal((await post(adminSub, env, { id: 'sub_ana1' }, await sess(env, 'ana@x.com', 's1'))).status, 403); // un cliente no puede dar de baja a otros
  assert.equal((await post(adminSub, env, { id: 'sub_ana1' }, await sess(env, 'admin@x.com', 'a'), { Origin: 'https://evil.com' })).status, 403);
  assert.equal((await post(adminSub, env, { id: 'sub_ana1' }, await sess(env, 'admin@x.com', 'a'), { 'X-Requested-With': '' })).status, 403);
  assert.equal(PUTS.length, 0);
});
await t('admin baja: cancela la suscripción de un cliente en Mercado Pago', async () => {
  const env = mkEnv(); addUser(env, 'admin@x.com', 'a'); SUBS = [sub('sub_ana1', 'ana@x.com', 'authorized')]; mockMP();
  const r = await post(adminSub, env, { id: 'sub_ana1' }, await sess(env, 'admin@x.com', 'a'));
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.deepEqual(PUTS, [{ id: 'sub_ana1', body: { status: 'cancelled' } }]);
});
await t('admin baja: ya cancelada no vuelve a llamar a Mercado Pago; ajena a nuestros planes o inexistente => 404', async () => {
  const env = mkEnv(); addUser(env, 'admin@x.com', 'a'); SUBS = [sub('sub_old1', 'o@x.com', 'cancelled'), sub('sub_otro', 'z@x.com', 'authorized', 'otroplan')]; mockMP();
  const c = await sess(env, 'admin@x.com', 'a');
  assert.deepEqual(await (await post(adminSub, env, { id: 'sub_old1' }, c)).json(), { ok: true, already: true });
  assert.equal((await post(adminSub, env, { id: 'sub_otro' }, c)).status, 404);
  assert.equal((await post(adminSub, env, { id: 'sub_nada1' }, c)).status, 404);
  assert.equal(PUTS.length, 0);
});
await t('admin baja: entradas inválidas, sin token de Mercado Pago y error de Mercado Pago', async () => {
  const env = mkEnv(); addUser(env, 'admin@x.com', 'a'); SUBS = [sub('sub_ana1', 'ana@x.com', 'authorized')]; mockMP();
  const c = await sess(env, 'admin@x.com', 'a');
  for (const b of [{}, { id: 5 }, { id: '../x' }, { id: 'a' }, 'no-json']) assert.equal((await post(adminSub, env, b, c)).status, 400);
  assert.equal((await post(adminSub, { ...env, MP_ACCESS_TOKEN: '' }, { id: 'sub_ana1' }, c)).status, 503);
  putStatus = 500; const r = await post(adminSub, env, { id: 'sub_ana1' }, c); assert.equal(r.status, 502);
});
await t('el panel ofrece dar de baja: el resumen trae el id y el estado se actualiza al momento', async () => {
  const env = mkEnv(); addUser(env, 'admin@x.com', 'a'); addUser(env, 'ana@x.com', 's1');
  SUBS = [sub('sub_ana1', 'ana@x.com', 'authorized'), sub('sub_sin1', 'sin@x.com', 'authorized')]; mockMP();
  const c = await sess(env, 'admin@x.com', 'a'); const ov = async () => (await overview.onRequestGet({ request: new Request('https://horsepos.com/api/admin/overview', { headers: { Cookie: c } }), env })).json();
  let j = await ov(); const ana = j.users.find((u) => u.email === 'ana@x.com');
  assert.equal(ana.subscription.id, 'sub_ana1'); assert.equal(j.subscribersWithoutAccount[0].id, 'sub_sin1'); assert.equal(j.kpis.activeSubs, 2);
  await post(adminSub, env, { id: 'sub_ana1' }, c); // limpia la memoria del panel
  j = await ov(); assert.equal(j.users.find((u) => u.email === 'ana@x.com').subscription.status, 'cancelled'); assert.equal(j.kpis.activeSubs, 1);
});
await t('cliente baja: solo la suya (por mail verificado) y el panel se entera', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); addUser(env, 'luis@x.com', 's2');
  SUBS = [sub('sub_ana1', 'ana@x.com', 'authorized'), sub('sub_luis', 'luis@x.com', 'authorized')]; mockMP();
  const ca = await sess(env, 'ana@x.com', 's1');
  assert.equal((await post(cancel, env, { id: 'sub_luis' }, ca)).status, 403); assert.equal(PUTS.length, 0);
  assert.equal((await post(cancel, env, { id: 'sub_ana1' }, ca)).status, 200); assert.deepEqual(PUTS, [{ id: 'sub_ana1', body: { status: 'cancelled' } }]);
  assert.equal((await post(cancel, env, { id: 'sub_ana1' }, ca)).status, 200); assert.equal(PUTS.length, 1); // ya cancelada: no repite
});
console.log(`\n${pass} pruebas OK (baja de suscripciones)`);

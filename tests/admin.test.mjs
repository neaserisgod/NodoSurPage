import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sign, verify } from '../functions/_lib/util.js';
import * as callback from '../functions/api/auth/callback.js';
import * as google from '../functions/api/auth/google.js';
import * as me from '../functions/api/me.js';
import * as overview from '../functions/api/admin/overview.js';
import * as adminUser from '../functions/api/admin/user.js';
import * as adminSweep from '../functions/api/admin/sweep.js';
import * as promoPub from '../functions/api/promo.js';
import * as adminPromo from '../functions/api/admin/promo.js';
import { sweep } from '../functions/_lib/sweep.js';
import { clearMpCache } from '../functions/_lib/mp.js';

const DAY = 86400, nowS = () => Math.floor(Date.now() / 1000);
function fakeD1() { const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../migrations/0001_users.sql', import.meta.url), 'utf8'));
  return { raw: db, prepare(sql) { let a = []; const st = db.prepare(sql); const o = { bind(...x) { a = x; return o }, first() { return st.get(...a) ?? null }, all() { return { results: st.all(...a) } }, run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } } } }; return o } }; }
const mkEnv = (extra = {}) => (clearMpCache(), { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'gs', SESSION_SECRET: 'x'.repeat(48), SITE_URL: 'https://horsepos.com', MP_ACCESS_TOKEN: 'tok', DB: fakeD1(), ...extra });
let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const sess = async (env, email, sub, name = 'X') => `ns_session=${await sign({ sub, email, name, iat: nowS(), exp: nowS() + 999 }, env.SESSION_SECRET)}`;
const req = (cookie, method = 'GET', body, extra = {}) => new Request('https://horsepos.com/api/x', { method, body, headers: { Cookie: cookie, Origin: 'https://horsepos.com', 'X-Requested-With': 'fetch', ...extra } });
const addUser = (env, o) => env.DB.raw.prepare('INSERT INTO users (sub,email,name,created_at,last_seen,login_count,exempt,notice_sent_at,delete_after) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(o.sub, o.email, o.name || o.email, o.created, o.lastSeen, 1, o.exempt || 0, o.noticeAt ?? null, o.deleteAfter ?? null);
const row = (env, email) => env.DB.raw.prepare('SELECT * FROM users WHERE email=?').get(email);

// MP simulado: lista de suscripciones global
let SUBS = [], mpFail = false, resendOk = true, resendCalls = [];
const mockNet = () => { globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.host === 'api.resend.com') { resendCalls.push(JSON.parse(init.body)); return new Response('{}', { status: resendOk ? 200 : 500 }); }
  if (u.pathname === '/preapproval/search') { if (mpFail) return new Response('x', { status: 500 });
    const plan = u.searchParams.get('preapproval_plan_id'); const email = u.searchParams.get('payer_email');
    return new Response(JSON.stringify({ results: SUBS.filter((s) => (plan ? s.preapproval_plan_id === plan : true) && (email ? s.payer_email === email : true)) }), { status: 200 }); }
  if (u.pathname === '/authorized_payments/search') return new Response('{"results":[]}', { status: 200 });
  return new Response('{}', { status: 404 }); }; };
const P = '6fe282d944ef4c018cb7904ce9e122f8';
const sub = (email, status, amount = 35000) => ({ id: 'id_' + email, status, reason: 'x', payer_email: email, preapproval_plan_id: P, auto_recurring: { transaction_amount: amount, currency_id: 'ARS' } });

// ---------- login registra usuario
await t('callback: crea usuario, cuenta ingresos y limpia aviso', async () => {
  const env = mkEnv(); const r0 = await google.onRequestGet({ env }); const u = new URL(r0.headers.get('Location'));
  const flow = r0.headers.get('Set-Cookie').split(';')[0].split('=').slice(1).join('=');
  const idt = (extra = {}) => 'h.' + Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'cid', exp: nowS() + 99, nonce: u.searchParams.get('nonce'), email_verified: true, email: 'Ana@Gmail.com', sub: 's1', name: 'Ana P', given_name: 'Ana', ...extra })).toString('base64url') + '.s';
  const login = async () => { globalThis.fetch = async () => new Response(JSON.stringify({ id_token: idt() }), { status: 200 });
    return callback.onRequestGet({ request: new Request(`https://horsepos.com/api/auth/callback?code=c&state=${u.searchParams.get('state')}`, { headers: { Cookie: `ns_oauth=${flow}` } }), env }); };
  assert.equal((await login()).headers.get('Location'), 'https://horsepos.com/cuenta/');
  let r = row(env, 'ana@gmail.com'); assert.equal(r.login_count, 1);
  env.DB.raw.prepare('UPDATE users SET delete_after=99, notice_sent_at=98 WHERE id=?').run(r.id);
  await login(); r = row(env, 'ana@gmail.com'); assert.equal(r.login_count, 2); assert.equal(r.delete_after, null); assert.equal(r.notice_sent_at, null);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
});

// ---------- me
await t('me: registra uso, marca admin solo al dueño, informa aviso', async () => {
  const env = mkEnv(); mockNet(); const t0 = nowS();
  addUser(env, { sub: 'a', email: 'gtalovergamer@gmail.com', created: t0 - 100 * DAY, lastSeen: t0 - 5 * DAY });
  addUser(env, { sub: 'b', email: 'cli@gmail.com', created: t0 - 100 * DAY, lastSeen: t0 - 40 * DAY, deleteAfter: t0 + DAY, noticeAt: t0 - 2 * DAY });
  const adm = await (await me.onRequestGet({ request: req(await sess(env, 'gtalovergamer@gmail.com', 'a')), env })).json();
  assert.equal(adm.isAdmin, true); assert.ok(row(env, 'gtalovergamer@gmail.com').last_seen >= t0);
  const cli = await (await me.onRequestGet({ request: req(await sess(env, 'cli@gmail.com', 'b')), env })).json();
  assert.equal(cli.isAdmin, false); assert.equal(cli.notice, null); // ver "Mi cuenta" cuenta como uso y limpia el aviso
  assert.equal(row(env, 'cli@gmail.com').delete_after, null);
});
await t('me: cuenta eliminada => 401 y borra cookies', async () => {
  const env = mkEnv(); mockNet(); const r = await me.onRequestGet({ request: req(await sess(env, 'fantasma@gmail.com', 'zz')), env });
  assert.equal(r.status, 401); assert.ok(r.headers.getSetCookie().every((c) => /Max-Age=0/.test(c)));
});

// ---------- admin
await t('admin: overview solo para el dueño (401/403/200) y con datos reales', async () => {
  const env = mkEnv(); mockNet(); const t0 = nowS();
  addUser(env, { sub: 'a', email: 'gtalovergamer@gmail.com', created: t0 - 50 * DAY, lastSeen: t0 });
  addUser(env, { sub: 'b', email: 'pago@x.com', created: t0 - 20 * DAY, lastSeen: t0 - DAY });
  addUser(env, { sub: 'c', email: 'nadie@x.com', created: t0 - 60 * DAY, lastSeen: t0 - 50 * DAY });
  SUBS = [sub('pago@x.com', 'authorized', 60000), sub('sincuenta@x.com', 'authorized', 35000), sub('viejo@x.com', 'cancelled')];
  assert.equal((await overview.onRequestGet({ request: new Request('https://horsepos.com/api/admin/overview'), env })).status, 401);
  assert.equal((await overview.onRequestGet({ request: req(await sess(env, 'pago@x.com', 'b')), env })).status, 403);
  const forged = `ns_session=${await sign({ sub: 'a', email: 'gtalovergamer@gmail.com', iat: nowS(), exp: nowS() + 99 }, 'otra-clave')}`;
  assert.equal((await overview.onRequestGet({ request: req(forged), env })).status, 401);
  const r = await overview.onRequestGet({ request: req(await sess(env, 'gtalovergamer@gmail.com', 'a')), env }); assert.equal(r.status, 200);
  const d = await r.json(); assert.equal(d.kpis.users, 3); assert.equal(d.kpis.activeSubs, 2); assert.equal(d.kpis.mrr, 95000);
  assert.equal(d.users.find((u) => u.email === 'pago@x.com').subscription.status, 'authorized');
  assert.deepEqual(d.subscribersWithoutAccount.map((s) => s.email).sort(), ['sincuenta@x.com', 'viejo@x.com']);
  assert.equal(d.config.autoDelete, false);
});
await t('admin: si Mercado Pago rechaza el token, el panel muestra el motivo (sin exponer el token)', async () => {
  const env = mkEnv({ MP_ACCESS_TOKEN: 'APP_USR-SECRETO-XYZ-123' }); const t0 = nowS(); addUser(env, { sub: 'a', email: 'gtalovergamer@gmail.com', created: t0, lastSeen: t0 });
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'invalid_token', status: 401 }), { status: 401 });
  const r = await overview.onRequestGet({ request: req(await sess(env, 'gtalovergamer@gmail.com', 'a')), env }); const d = await r.json(); const raw = JSON.stringify(d);
  assert.equal(d.mpError, true); assert.equal(d.config.mp, false); assert.equal(d.mpDetail.status, 401); assert.equal(d.mpDetail.message, 'invalid_token'); assert.ok(!raw.includes('SECRETO-XYZ'));
  const env2 = mkEnv({ MP_ACCESS_TOKEN: undefined }); addUser(env2, { sub: 'a', email: 'gtalovergamer@gmail.com', created: t0, lastSeen: t0 });
  assert.equal((await (await overview.onRequestGet({ request: req(await sess(env2, 'gtalovergamer@gmail.com', 'a')), env: env2 })).json()).mpDetail.reason, 'no_token');
});
await t('mp: 429 se reintenta una vez; el panel usa datos recientes si sigue limitado; la limpieza NO', async () => {
  const env = mkEnv({ MP_RETRY_MS: 1 }); const t0 = nowS(); addUser(env, { sub: 'a', email: 'gtalovergamer@gmail.com', created: t0, lastSeen: t0 });
  addUser(env, { sub: 'x', email: 'x@x.com', created: t0 - 90 * DAY, lastSeen: t0 - 45 * DAY }); const A = await sess(env, 'gtalovergamer@gmail.com', 'a');
  let calls = 0, limited = false;
  globalThis.fetch = async (url) => { const u = new URL(url); if (u.pathname !== '/preapproval/search') return new Response('{}', { status: 404 }); calls++;
    if (limited) return new Response(JSON.stringify({ message: 'local_rate_limited' }), { status: 429 });
    return new Response(JSON.stringify({ results: [sub('x@x.com', 'authorized')] }), { status: 200 }); };
  let d = await (await overview.onRequestGet({ request: req(A), env })).json(); assert.equal(d.kpis.activeSubs, 1); const first = calls;
  await overview.onRequestGet({ request: req(A), env }); assert.equal(calls, first); // memoria de 1 minuto: no vuelve a pedir
  limited = true; clearMpCache(); // sin memoria => 429 real, con un reintento
  const bad = await (await overview.onRequestGet({ request: req(A), env })).json(); assert.equal(bad.mpDetail.status, 429); assert.equal(calls, first + 2);
  // con datos recientes en memoria y 429 => se muestran, marcados como viejos
  limited = false; clearMpCache(); await overview.onRequestGet({ request: req(A), env }); limited = true;
  const CACHE_AGE = Date.now(); const real = Date.now; Date.now = () => CACHE_AGE + 120_000;
  const stale = await (await overview.onRequestGet({ request: req(A), env })).json(); Date.now = real;
  assert.equal(stale.mpStale, true); assert.equal(stale.kpis.activeSubs, 1);
  // la limpieza automática nunca usa datos viejos: con 429 aborta
  const r = await sweep(env, { apply: true, t: t0 }); assert.equal(r.ok, false); assert.ok(row(env, 'x@x.com'));
});
await t('admin/user: eximir, quitar aviso, eliminar; protege al dueño; exige CSRF', async () => {
  const env = mkEnv(); mockNet(); const t0 = nowS(); const A = await sess(env, 'gtalovergamer@gmail.com', 'a');
  addUser(env, { sub: 'a', email: 'gtalovergamer@gmail.com', created: t0, lastSeen: t0 }); addUser(env, { sub: 'b', email: 'b@x.com', created: t0, lastSeen: t0, deleteAfter: t0 + 5 });
  const post = (cookie, body, extra) => adminUser.onRequestPost({ request: req(cookie, 'POST', JSON.stringify(body), extra), env });
  const idB = row(env, 'b@x.com').id, idA = row(env, 'gtalovergamer@gmail.com').id;
  assert.equal((await post(await sess(env, 'b@x.com', 'b'), { id: idB, action: 'delete' })).status, 403);
  assert.equal((await post(A, { id: idB, action: 'delete' }, { 'X-Requested-With': '' })).status, 403);
  assert.equal((await post(A, { id: idB, action: 'delete' }, { Origin: 'https://evil.com' })).status, 403);
  assert.equal((await post(A, { id: idB, action: 'hack' })).status, 400);
  assert.equal((await post(A, { id: idB, action: 'exempt' })).status, 200); assert.equal(row(env, 'b@x.com').exempt, 1);
  assert.equal((await post(A, { id: idB, action: 'clear_notice' })).status, 200); assert.equal(row(env, 'b@x.com').delete_after, null);
  assert.equal((await post(A, { id: idA, action: 'delete' })).status, 409); assert.ok(row(env, 'gtalovergamer@gmail.com'));
  assert.equal((await post(A, { id: idB, action: 'delete' })).status, 200); assert.equal(row(env, 'b@x.com'), undefined);
});

// ---------- limpieza
const setup = (extra = {}) => { const env = mkEnv(extra); mockNet(); resendOk = true; resendCalls = []; mpFail = false; SUBS = []; return env; };
const OLD = (t0) => ({ created: t0 - 90 * DAY, lastSeen: t0 - 45 * DAY });
await t('sweep: sin servicio de mail NO borra ni avisa: queda "pendiente de aviso"', async () => {
  const env = setup({ AUTO_DELETE: 'on' }); const t0 = nowS(); addUser(env, { sub: 'x', email: 'x@x.com', ...OLD(t0) });
  const r = await sweep(env, { apply: true, t: t0 }); assert.deepEqual(r.actions.map((a) => a.action), ['needs_notice']); assert.ok(row(env, 'x@x.com')); assert.equal(row(env, 'x@x.com').delete_after, null);
});
await t('sweep: con mail envía el aviso y agenda el borrado a 3 días', async () => {
  const env = setup({ RESEND_API_KEY: 'k', MAIL_FROM: 'Nodo Sur <hola@horsepos.com>' }); const t0 = nowS(); addUser(env, { sub: 'x', email: 'x@x.com', ...OLD(t0) });
  const dry = await sweep(env, { apply: false, t: t0 }); assert.equal(dry.actions[0].action, 'send_notice'); assert.equal(resendCalls.length, 0); assert.equal(row(env, 'x@x.com').delete_after, null);
  const r = await sweep(env, { apply: true, t: t0 }); assert.equal(r.actions[0].applied, true); assert.equal(resendCalls.length, 1);
  assert.equal(resendCalls[0].to[0], 'x@x.com'); assert.match(resendCalls[0].subject, /3 días/); assert.equal(row(env, 'x@x.com').delete_after, t0 + 3 * DAY);
});
await t('sweep: si el mail falla NO se agenda ni se borra', async () => {
  const env = setup({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c', AUTO_DELETE: 'on' }); resendOk = false; const t0 = nowS(); addUser(env, { sub: 'x', email: 'x@x.com', ...OLD(t0) });
  const r = await sweep(env, { apply: true, t: t0 }); assert.equal(r.actions[0].applied, false); assert.equal(row(env, 'x@x.com').delete_after, null); assert.ok(row(env, 'x@x.com'));
});
await t('sweep: antes de los 3 días espera; luego borra solo con AUTO_DELETE=on', async () => {
  const env = setup({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c' }); const t0 = nowS();
  addUser(env, { sub: 'x', email: 'x@x.com', ...OLD(t0), noticeAt: t0 - 3 * DAY + 60, deleteAfter: t0 + 60 });
  assert.equal((await sweep(env, { apply: true, t: t0 })).actions[0].action, 'waiting');
  const late = t0 + 3600;
  const off = await sweep(env, { apply: true, t: late }); assert.equal(off.actions[0].action, 'delete'); assert.equal(off.actions[0].applied, false); assert.ok(row(env, 'x@x.com'));
  env.AUTO_DELETE = 'on';
  assert.equal((await sweep(env, { apply: false, t: late })).actions[0].applied, false); assert.ok(row(env, 'x@x.com')); // simulación no borra
  const on = await sweep(env, { apply: true, t: late }); assert.equal(on.actions[0].applied, true); assert.equal(row(env, 'x@x.com'), undefined);
});
await t('sweep: NUNCA toca a admin, exentos, con suscripción, nuevos ni activos', async () => {
  const env = setup({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c', AUTO_DELETE: 'on' }); const t0 = nowS(); const expired = { noticeAt: t0 - 4 * DAY, deleteAfter: t0 - DAY };
  addUser(env, { sub: '1', email: 'gtalovergamer@gmail.com', ...OLD(t0), ...expired });
  addUser(env, { sub: '2', email: 'exento@x.com', ...OLD(t0), exempt: 1, ...expired });
  addUser(env, { sub: '3', email: 'paga@x.com', ...OLD(t0), ...expired });
  addUser(env, { sub: '4', email: 'prueba@x.com', ...OLD(t0), ...expired });
  addUser(env, { sub: '5', email: 'nuevo@x.com', created: t0 - 3 * DAY, lastSeen: t0 - 3 * DAY, ...expired });
  addUser(env, { sub: '6', email: 'activo@x.com', created: t0 - 90 * DAY, lastSeen: t0 - 2 * DAY, ...expired });
  addUser(env, { sub: '7', email: 'reciente@x.com', created: t0 - 90 * DAY, lastSeen: t0 - 29 * DAY });
  SUBS = [sub('paga@x.com', 'authorized'), sub('prueba@x.com', 'pending')];
  const r = await sweep(env, { apply: true, t: t0 });
  assert.equal(r.actions.filter((a) => a.action === 'delete').length, 0);
  for (const e of ['gtalovergamer@gmail.com', 'exento@x.com', 'paga@x.com', 'prueba@x.com', 'nuevo@x.com', 'activo@x.com', 'reciente@x.com']) assert.ok(row(env, e), e);
  // los que se recuperaron (pagan/activos/nuevos) pierden el aviso; el admin y exentos no se tocan
  assert.equal(row(env, 'paga@x.com').delete_after, null); assert.equal(row(env, 'activo@x.com').delete_after, null);
});
await t('sweep: cancelada/sin plan sí cuenta como "no paga"; suscripción cancelada no protege', async () => {
  const env = setup({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c' }); const t0 = nowS(); addUser(env, { sub: 'x', email: 'cancelo@x.com', ...OLD(t0) });
  SUBS = [sub('cancelo@x.com', 'cancelled')]; assert.equal((await sweep(env, { apply: false, t: t0 })).actions[0].action, 'send_notice');
});
await t('sweep: si Mercado Pago falla, aborta sin tocar nada', async () => {
  const env = setup({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c', AUTO_DELETE: 'on' }); mpFail = true; const t0 = nowS();
  addUser(env, { sub: 'x', email: 'x@x.com', ...OLD(t0), noticeAt: t0 - 5 * DAY, deleteAfter: t0 - 2 * DAY });
  const r = await sweep(env, { apply: true, t: t0 }); assert.equal(r.ok, false); assert.ok(row(env, 'x@x.com'));
});
await t('admin/sweep: solo simula, nunca aplica', async () => {
  const env = setup({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c', AUTO_DELETE: 'on' }); const t0 = nowS();
  addUser(env, { sub: 'a', email: 'gtalovergamer@gmail.com', created: t0, lastSeen: t0 });
  addUser(env, { sub: 'x', email: 'x@x.com', ...OLD(t0), noticeAt: t0 - 5 * DAY, deleteAfter: t0 - 2 * DAY });
  const r = await adminSweep.onRequestPost({ request: req(await sess(env, 'gtalovergamer@gmail.com', 'a'), 'POST', '{}'), env }); const d = await r.json();
  assert.equal(d.actions[0].action, 'delete'); assert.equal(d.actions[0].applied, false); assert.ok(row(env, 'x@x.com')); assert.equal(resendCalls.length, 0);
  assert.equal((await adminSweep.onRequestPost({ request: req(await sess(env, 'x@x.com', 'x'), 'POST', '{}'), env })).status, 403);
});
await t('promo de fundador: activa por defecto; solo el admin la apaga y se refleja en la API pública', async () => {
  const env = setup(); const t0 = nowS();
  addUser(env, { sub: 'a', email: 'gtalovergamer@gmail.com', created: t0, lastSeen: t0 });
  addUser(env, { sub: 'c', email: 'cli@x.com', created: t0, lastSeen: t0 });
  assert.equal((await (await promoPub.onRequestGet({ env })).json()).activa, true);
  const off = (c, b = '{"activa":false}', extra) => adminPromo.onRequestPost({ request: req(c, 'POST', b, extra), env });
  assert.equal((await off(await sess(env, 'cli@x.com', 'c'))).status, 403);            // un cliente no puede
  assert.equal((await off(await sess(env, 'gtalovergamer@gmail.com', 'a'), '{"activa":"no"}')).status, 400);
  assert.equal((await off(await sess(env, 'gtalovergamer@gmail.com', 'a'), '{"activa":false}', { 'X-Requested-With': '' })).status, 403); // sin cabecera anti-CSRF
  assert.equal((await off(await sess(env, 'gtalovergamer@gmail.com', 'a'))).status, 200);
  assert.equal((await (await promoPub.onRequestGet({ env })).json()).activa, false);
  const ov = await (await overview.onRequestGet({ request: req(await sess(env, 'gtalovergamer@gmail.com', 'a')), env })).json();
  assert.equal(ov.promo.activa, false);
  await off(await sess(env, 'gtalovergamer@gmail.com', 'a'), '{"activa":true}');
  assert.equal((await (await promoPub.onRequestGet({ env })).json()).activa, true);
  assert.equal((await (await promoPub.onRequestGet({ env: { ...env, DB: undefined } })).json()).activa, true); // sin base: activa
});
console.log(`\n${pass} pruebas OK (limpieza y admin)`);

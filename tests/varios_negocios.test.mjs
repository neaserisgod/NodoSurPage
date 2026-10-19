import assert from 'node:assert/strict';
import { ensureOrgTables, createOrg, MAX_NEGOCIOS_PROPIOS } from '../functions/_lib/orgs.js';
import { planDelNegocio } from '../functions/_lib/plan_por_negocio.js';
import { estadoFacturacion, usarMiSuscripcion } from '../functions/_lib/facturacion.js';
import { listSubscriptions } from '../functions/_lib/mp.js';
import { tieneBot } from '../functions/_lib/bot.js';
import * as crear from '../functions/api/org/crear.js';
import * as google from '../functions/api/device/google.js';
import * as me from '../functions/api/device/me.js';
import { getDevice } from '../functions/_lib/devices.js';
import { mkEnv, addUser, sess, req, web, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

// Una cuenta de Google con varios negocios, cada uno con su plan (2026-10-13).
let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const PLAN_CON_BOT = '7652202c076c4cc180c72ade28d52924';
const conPlanes = (email, n, { bot = 0 } = {}) => {
  mp.subs = Array.from({ length: n }, (_, i) => ({ ...mpSub(email, 'authorized'), id: `s${i}`, ...(i < bot ? { preapproval_plan_id: PLAN_CON_BOT } : {}) }));
  mp.fail = false; mockMP();
};
const tresNegocios = async (env) => {
  await ensureOrgTables(env);
  const almacen = await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana', orgName: 'Almacén' });
  const barberia = await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana', orgName: 'Barbería' });
  const belleza = await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana', orgName: 'Belleza' });
  return { almacen: almacen.org, barberia: barberia.org, belleza: belleza.org };
};

await t('un plan cubre un negocio: con 1 plan y 3 negocios, solo el más viejo; con 3, todos', async () => {
  const env = mkEnv(); const n = await tresNegocios(env);
  conPlanes('ana@x.com', 1);
  let subs = await listSubscriptions(env, 'ana@x.com');
  assert.equal((await planDelNegocio(env, n.almacen, subs)).pago, true);
  assert.equal((await planDelNegocio(env, n.barberia, subs)).pago, false);
  assert.equal((await planDelNegocio(env, n.belleza, subs)).pago, false);
  conPlanes('ana@x.com', 3); subs = await listSubscriptions(env, 'ana@x.com');
  for (const o of Object.values(n)) assert.equal((await planDelNegocio(env, o, subs)).pago, true, o.name);
});
await t('el bot va a los negocios cubiertos (viene en todos los planes desde 2026-10-19), no a los que no tienen plan', async () => {
  const env = mkEnv(); const n = await tresNegocios(env);
  conPlanes('ana@x.com', 2, { bot: 1 });
  assert.equal((await tieneBot(env, n.almacen.id)).ok, true);
  assert.equal((await tieneBot(env, n.barberia.id)).ok, true, 'Sistema POS también trae el bot');
  assert.equal((await tieneBot(env, n.belleza.id)).ok, false, 'ni plan');
});
await t('facturación: el negocio sin plan propio lo dice, y "usar mi suscripción" exige un plan libre', async () => {
  const env = mkEnv({ MP_ACCESS_TOKEN: 'tok' }); const n = await tresNegocios(env);
  conPlanes('ana@x.com', 1);
  assert.equal((await estadoFacturacion(env, n.almacen, 'ana@x.com')).status, 'authorized');
  const e = await estadoFacturacion(env, n.barberia, 'ana@x.com');
  assert.equal(e.status, 'sin_plan_propio'); assert.equal(e.planes, 1); assert.equal(e.negocios, 3);
  // Un negocio de otra persona no se puede pasar a la suscripción de Ana: ya cubre a uno de los suyos.
  const ajeno = (await createOrg(env, { sub: 's9', email: 'beto@x.com', name: 'Beto' })).org;
  assert.deepEqual(await usarMiSuscripcion(env, ajeno, 'ana@x.com'), { status: 409, error: 'sin_plan_libre' });
  conPlanes('ana@x.com', 4);
  assert.deepEqual(await usarMiSuscripcion(env, ajeno, 'ana@x.com'), { ok: true });
});
await t('crear otro negocio desde la web: exige sesión y mismo origen, valida el nombre y queda como dueña', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); const cookie = await sess(env, 'ana@x.com', 's1', 'Ana');
  const post = (body, o = { cookie, headers: web }) => crear.onRequestPost({ request: req('/api/org/crear', { method: 'POST', body, ...o }), env });
  assert.equal((await post({ name: 'Barbería' }, { headers: web })).status, 401);
  assert.equal((await post({ name: 'Barbería' }, { cookie })).status, 403);
  assert.equal((await post({ name: 'x' })).status, 400);
  const a = await (await post({ name: 'Almacén' })).json(); const b = await (await post({ name: '  Barbería  ' })).json();
  assert.notEqual(a.orgId, b.orgId);
  const org = env.DB.raw.prepare('SELECT * FROM orgs WHERE id = ?').get(b.orgId);
  assert.equal(org.name, 'Barbería'); assert.equal(org.owner_sub, 's1'); assert.equal(org.billing_email, 'ana@x.com');
  assert.equal(env.DB.raw.prepare("SELECT role FROM memberships WHERE org_id = ? AND user_sub = 's1'").get(b.orgId).role, 'owner');
});
await t('el mail de cobro se compara sin mayúsculas ni espacios: cargarlo distinto no regala un plan', async () => {
  const env = mkEnv(); const n = await tresNegocios(env);
  env.DB.raw.prepare('UPDATE orgs SET billing_email = ? WHERE id = ?').run(' ANA@x.com ', n.belleza.id);
  conPlanes('ana@x.com', 1);
  const subs = await listSubscriptions(env, 'ana@x.com');
  const belleza = env.DB.raw.prepare('SELECT * FROM orgs WHERE id = ?').get(n.belleza.id);
  assert.equal((await planDelNegocio(env, belleza, subs)).pago, false, 'sigue siendo el tercero de Ana');
  assert.equal((await planDelNegocio(env, n.almacen, subs)).pago, true);
});
await t('un negocio que no figura entre los de su mail cuenta como el último, nunca gratis', async () => {
  const env = mkEnv(); await tresNegocios(env);
  conPlanes('ana@x.com', 3);
  const fantasma = { id: 999, billing_email: 'ana@x.com', owner_sub: 's1' };
  assert.equal((await planDelNegocio(env, fantasma, await listSubscriptions(env, 'ana@x.com'))).pago, false);
});
await t('el nombre del negocio se limpia: sin saltos de línea ni caracteres de control', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); const cookie = await sess(env, 'ana@x.com', 's1');
  const r = await (await crear.onRequestPost({ request: req('/api/org/crear', { method: 'POST', cookie, headers: web, body: { name: '  Barbería\n\u0000del   Centro\t' } }), env })).json();
  assert.equal(env.DB.raw.prepare('SELECT name FROM orgs WHERE id = ?').get(r.orgId).name, 'Barbería del Centro');
  const solo = await crear.onRequestPost({ request: req('/api/org/crear', { method: 'POST', cookie, headers: web, body: { name: '\u0000\n ' } }), env });
  assert.equal(solo.status, 400);
});
await t('hay un tope de negocios por cuenta', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); await ensureOrgTables(env); const cookie = await sess(env, 'ana@x.com', 's1');
  for (let i = 0; i < MAX_NEGOCIOS_PROPIOS; i++) await createOrg(env, { sub: 's1', email: 'ana@x.com', orgName: 'N' + i });
  const r = await crear.onRequestPost({ request: req('/api/org/crear', { method: 'POST', cookie, headers: web, body: { name: 'Uno más' } }), env });
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'demasiados_negocios');
});

// --- desde el celular, con Google
const CLIENT = 'web-client'; const DID = 'android-celular-0123456789abcdef';
const mockGoogle = () => { globalThis.fetch = async (url) => {
  if (!String(url).startsWith('https://oauth2.googleapis.com/tokeninfo')) return new Response('{}', { status: 404 });
  return new Response(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 's1', email: 'ana@x.com', email_verified: 'true', name: 'Ana', exp: String(nowS() + 600) }));
}; };
const entrar = (env, body) => google.onRequestPost({ request: req('/api/device/google', { method: 'POST', body: { idToken: 'x.y.z', deviceId: DID, name: 'Celular', ...body } }), env });

await t('celular agregando un negocio: con elegirSiempre la lista sale aunque haya uno solo', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env); mockGoogle();
  await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana', orgName: 'Almacén' });
  assert.ok((await (await entrar(env, {})).json()).token, 'sin elegirSiempre entra directo');
  const r = await (await entrar(env, { elegirSiempre: true })).json();
  assert.equal(r.elegir, true); assert.deepEqual(r.orgs.map((o) => o.name), ['Almacén']);
});
await t('celular: crear un negocio nuevo lo crea y deja el celular ahí; /me dice los nombres', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env); mockGoogle();
  await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana', orgName: 'Almacén' });
  assert.equal((await entrar(env, { nuevoNegocio: 'x' })).status, 400);
  const r = await entrar(env, { nuevoNegocio: 'Barbería' }); assert.equal(r.status, 200);
  const { token } = await r.json();
  const d = await getDevice(env, DID);
  assert.equal(env.DB.raw.prepare('SELECT name FROM orgs WHERE id = ?').get(d.owner_org).name, 'Barbería');
  const yo = await (await me.onRequestGet({ request: req('/api/device/me', { headers: { Authorization: `Bearer ${token}` } }), env })).json();
  assert.equal(yo.orgName, 'Barbería'); assert.equal(yo.branchName, 'Sucursal principal'); assert.equal(yo.orgId, d.owner_org);
});

console.log(`\n${pass} pruebas OK (varios negocios por cuenta)`);

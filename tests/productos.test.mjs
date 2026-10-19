// Cada negocio es de un solo producto (Gestión, Estudio o Gastro) y cada app entra solo a los suyos (2026-10-19,
// `functions/_lib/productos.js`, `Nodo-Sur-Pos/docs/PLAN-CUENTAS.md`).
import assert from 'node:assert/strict';
import { sha256b64u } from '../functions/_lib/util.js';
import { ensureOrgTables, createOrg } from '../functions/_lib/orgs.js';
import { upsertDevice, getDevice } from '../functions/_lib/devices.js';
import { marcarGestionPorPc, productoDeEdicion } from '../functions/_lib/productos.js';
import * as google from '../functions/api/device/google.js';
import * as authorize from '../functions/api/device/authorize.js';
import * as whoami from '../functions/api/device/whoami.js';
import { mkEnv, req, sess, web, nowS, addUser } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const CLIENT = 'web-client.apps.googleusercontent.com';
const DID = 'android-celular-0123456789abcdef';
const one = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a);
const producto = (env, id) => one(env, 'SELECT producto FROM orgs WHERE id = ?', id).producto;
const claimsDe = (sub, email) => ({ iss: 'https://accounts.google.com', aud: CLIENT, sub, email, email_verified: 'true', name: 'Ana', exp: String(nowS() + 600) });
const mockGoogle = (tokens) => { globalThis.fetch = async (url) => {
  const c = tokens[new URL(url).searchParams.get('id_token').split('.')[0]];
  return c ? new Response(JSON.stringify(c), { status: 200 }) : new Response('{}', { status: 400 });
}; };
const entrar = (env, body) => google.onRequestPost({ request: req('/api/device/google', { method: 'POST', body: { deviceId: DID, name: 'Celular', ...body, idToken: `${body.idToken}.a.b` } }), env });
const empleado = (env, org, branch, sub, email) => {
  const m = env.DB.raw.prepare("INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,'employee','active',0,?)").run(org.id, sub, email, nowS());
  env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(m.lastInsertRowid, branch.id);
};
const vincularPc = async (env, cookie, extra = {}) => {
  const v = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString('base64url');
  return authorize.onRequestPost({ request: req('/api/device/authorize', { method: 'POST', cookie, headers: web,
    body: { port: 53682, state: 'estado-de-prueba-0123456789', challenge: await sha256b64u(v), deviceId: 'pc-de-prueba-0123456789abcdef', name: 'PC', ...extra } }), env });
};

await t('la edición de la app se traduce a su producto; lo desconocido no es ninguno', () => {
  assert.equal(productoDeEdicion('almacen'), 'gestion'); assert.equal(productoDeEdicion('servicios'), 'estudio');
  assert.equal(productoDeEdicion('gastronomia'), 'gastro');
  for (const x of [undefined, null, '', 'otra', 'toString', 7]) assert.equal(productoDeEdicion(x), null, String(x));
});
await t('alguien nuevo entra con Nodo Gastro: su negocio nace de Gastro', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env); mockGoogle({ ana: claimsDe('s1', 'ana@x.com') });
  assert.equal((await entrar(env, { idToken: 'ana', edicion: 'gastronomia' })).status, 200);
  assert.equal(producto(env, (await getDevice(env, DID)).owner_org), 'gastro');
});
await t('un negocio sin producto toma el de la primera app; después otra app no entra ahí', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env); mockGoogle({ ana: claimsDe('s1', 'ana@x.com'), beto: claimsDe('s2', 'beto@x.com') });
  const { org, branch } = await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana' });
  empleado(env, org, branch, 's2', 'beto@x.com');
  assert.equal(producto(env, org.id), null);
  assert.equal((await entrar(env, { idToken: 'ana', edicion: 'servicios' })).status, 200);
  assert.equal(producto(env, org.id), 'estudio');
  // Beto solo trabaja ahí: con Nodo Gastro no hay a dónde entrar, y se le dice qué app sirve.
  const r = await entrar(env, { idToken: 'beto', edicion: 'gastronomia' });
  assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: 'otro_producto', producto: 'estudio', nombre: 'Nodo Estudio' });
  assert.equal(producto(env, org.id), 'estudio', 'no cambió');
});
await t('la dueña de un almacén abre Nodo Gastro: se le arma la rotisería aparte y el almacén no se toca', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env); mockGoogle({ ana: claimsDe('s1', 'ana@x.com') });
  const almacen = await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana', orgName: 'La Plazoleta' });
  env.DB.raw.prepare("UPDATE orgs SET producto = 'gestion' WHERE id = ?").run(almacen.org.id);
  assert.equal((await entrar(env, { idToken: 'ana', edicion: 'gastronomia' })).status, 200);
  const d = await getDevice(env, DID); assert.notEqual(d.owner_org, almacen.org.id);
  assert.equal(producto(env, d.owner_org), 'gastro'); assert.equal(one(env, 'SELECT name FROM orgs WHERE id = ?', d.owner_org).name, 'Nodo Gastro de Ana');
  assert.equal(producto(env, almacen.org.id), 'gestion');
  // Elegir a mano el almacén desde Gastro: 409, no se mezcla.
  const r = await entrar(env, { idToken: 'ana', edicion: 'gastronomia', orgId: almacen.org.id, branchId: almacen.branch.id });
  assert.equal(r.status, 409); assert.equal((await r.json()).nombre, 'Nodo Gestión');
});
await t('la lista para elegir negocio muestra solo los del producto de la app (y los que todavía no tienen)', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env); mockGoogle({ ana: claimsDe('s1', 'ana@x.com') });
  for (const [nombre, p] of [['Almacén', 'gestion'], ['Uñas', 'estudio'], ['Rotisería', 'gastro'], ['Nuevo', null]]) {
    const { org } = await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana', orgName: nombre });
    env.DB.raw.prepare('UPDATE orgs SET producto = ? WHERE id = ?').run(p, org.id);
  }
  const j = await (await entrar(env, { idToken: 'ana', edicion: 'servicios', elegirSiempre: true })).json();
  assert.equal(j.elegir, true); assert.deepEqual(j.orgs.map((o) => o.name), ['Uñas', 'Nuevo']);
  // Una app vieja (sin edición) ve todo, como antes.
  assert.equal((await (await entrar(env, { idToken: 'ana', elegirSiempre: true })).json()).orgs.length, 4);
});
await t('app vieja sin edición: entra como siempre y no marca el negocio', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env); mockGoogle({ ana: claimsDe('s1', 'ana@x.com') });
  const { org } = await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana' });
  env.DB.raw.prepare("UPDATE orgs SET producto = 'estudio' WHERE id = ?").run(org.id);
  assert.equal((await entrar(env, { idToken: 'ana' })).status, 200);
  assert.equal((await getDevice(env, DID)).owner_org, org.id);
});
await t('un negocio con una PC vinculada es de Gestión (para que probar otra app no marque mal a La Plazoleta)', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  const conPc = await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana' });
  const soloCel = await createOrg(env, { sub: 's2', email: 'b@x.com', name: 'B' });
  await upsertDevice(env, { id: 'pc-0123456789abcdefgh', sub: 's1', email: 'ana@x.com', orgId: conPc.org.id, branchId: conPc.branch.id, kind: 'pc' });
  await upsertDevice(env, { id: 'cel-0123456789abcdefgh', sub: 's2', email: 'b@x.com', orgId: soloCel.org.id, branchId: soloCel.branch.id, kind: 'celular' });
  env.DB.raw.prepare('UPDATE orgs SET producto = NULL').run();
  await marcarGestionPorPc(env); // lo que corre en cada arranque
  assert.equal(producto(env, conPc.org.id), 'gestion'); assert.equal(producto(env, soloCel.org.id), null);
});
await t('PC: es siempre de Gestión; no se vincula a un negocio de Estudio, y quien solo tiene uno de Estudio recibe el de Gestión', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  addUser(env, 'ana@x.com', 's1'); const cookie = await sess(env, 'ana@x.com', 's1', 'Ana');
  const unias = await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana', orgName: 'Uñas' });
  env.DB.raw.prepare("UPDATE orgs SET producto = 'estudio' WHERE id = ?").run(unias.org.id);
  const w = await (await whoami.onRequestGet({ request: req('/api/device/whoami', { cookie }), env })).json();
  assert.equal(w.canLink, true); assert.deepEqual(w.orgs, [], 'la página no le ofrece el de Estudio');
  const mal = await vincularPc(env, cookie, { orgId: unias.org.id, branchId: unias.branch.id });
  assert.equal(mal.status, 409); assert.equal((await mal.json()).nombre, 'Nodo Estudio');
  assert.equal((await vincularPc(env, cookie)).status, 200);
  const nuevo = one(env, "SELECT id, name FROM orgs WHERE producto = 'gestion'"); assert.equal(nuevo.name, 'Nodo Gestión de Ana');
});
await t('whoami del celular filtra por la edición que abrió la página', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  addUser(env, 'ana@x.com', 's1'); const cookie = await sess(env, 'ana@x.com', 's1', 'Ana');
  for (const [n, p] of [['Almacén', 'gestion'], ['Rotisería', 'gastro']]) {
    const { org } = await createOrg(env, { sub: 's1', email: 'ana@x.com', name: 'Ana', orgName: n });
    env.DB.raw.prepare('UPDATE orgs SET producto = ? WHERE id = ?').run(p, org.id);
  }
  const w = async (qs) => (await (await whoami.onRequestGet({ request: req('/api/device/whoami' + qs, { cookie }), env })).json()).orgs.map((o) => o.name);
  assert.deepEqual(await w('?tipo=celular&edicion=gastronomia'), ['Rotisería']);
  assert.deepEqual(await w('?tipo=celular&edicion=almacen'), ['Almacén']);
  assert.deepEqual(await w('?tipo=celular'), ['Almacén', 'Rotisería']);
});

console.log(`\n${pass} pruebas OK (productos)`);

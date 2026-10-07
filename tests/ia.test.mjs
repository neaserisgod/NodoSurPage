// La clave de la IA de Google por negocio (El dueño, 2026-10-07: "la clave es por cuenta"). Google está simulado: lo que se prueba es
// lo que hace NUESTRO servidor — que guarde la clave cifrada, que solo el dueño la cambie, que todos los equipos del negocio la usen sin
// verla y que el pedido llegue a Google tal cual, con la clave.
import assert from 'node:assert/strict';
import { createOrg, ensureOrgTables } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import * as ia from '../functions/api/ia.js';
import { mkEnv, addUser, req, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const one = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a);
const CLAVE = 'AIzaSyFALSA_clave-de-prueba-0123456789';

// Google simulado: guarda cada pedido y contesta como `generateContent`.
function simular() {
  mp.subs = [mpSub('duena@x.com', 'authorized')]; mp.fail = false; mockMP();
  const g = { pedidos: [], estado: 200 };
  const sub = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host !== 'generativelanguage.googleapis.com') return sub(url, init);
    g.pedidos.push({ path: u.pathname, search: u.search, headers: init.headers, body: init.body });
    if (g.estado !== 200) return new Response(JSON.stringify({ error: { message: 'Resource has been exhausted' } }), { status: g.estado });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
  };
  return g;
}
async function negocio(env) {
  await ensureOrgTables(env); addUser(env, 'duena@x.com', 'sd');
  const r = await createOrg(env, { sub: 'sd', email: 'duena@x.com', name: 'Dueña', orgName: 'La Plazoleta' });
  return { org: r.org, a: r.branch.id };
}
function empleado(env, n, email, sub) {
  addUser(env, email, sub);
  const mm = env.DB.raw.prepare('INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,?,?,?)').run(n.org.id, sub, email, 'employee', 'active', 0, nowS());
  env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(mm.lastInsertRowid, n.a);
}
const equipo = async (env, n, sub, email, id) => { await upsertDevice(env, { id, sub, email, name: 'Equipo', orgId: n.org.id, branchId: n.a }); return { Authorization: `Bearer ${await signDeviceToken(env, { sub, email, deviceId: id })}` }; };
const post = (fn, env, path, body, headers) => fn({ request: req(path, { method: 'POST', headers, body }), env });
const get = (fn, env, path, headers) => fn({ request: req(path, { headers }), env });

await t('el dueño guarda la clave desde su equipo: queda cifrada y el estado nunca la muestra', async () => {
  const env = mkEnv(); const n = await negocio(env); simular();
  const pc = await equipo(env, n, 'sd', 'duena@x.com', 'pc-duena-0123456789abcdefgh');
  assert.deepEqual(await (await get(ia.onRequestGet, env, '/api/ia/estado', pc)).json(), { configured: false, model: null, canChange: true });
  assert.equal((await post(ia.onRequestClave, env, '/api/ia/clave', { clave: CLAVE, modelo: 'gemini-3.5-flash-lite' }, pc)).status, 200);
  const fila = one(env, 'SELECT * FROM ia_claves'); assert.equal(fila.org_id, n.org.id); assert.ok(!JSON.stringify(fila).includes(CLAVE), 'no queda en claro');
  const e = await (await get(ia.onRequestGet, env, '/api/ia/estado', pc)).json();
  assert.deepEqual(e, { configured: true, model: 'gemini-3.5-flash-lite', canChange: true }); assert.ok(!JSON.stringify(e).includes(CLAVE));
});

await t('el celular de un empleado usa la clave del negocio sin verla, y no la puede cambiar ni borrar', async () => {
  const env = mkEnv(); const n = await negocio(env); const g = simular();
  const pc = await equipo(env, n, 'sd', 'duena@x.com', 'pc-duena-0123456789abcdefgh');
  await post(ia.onRequestClave, env, '/api/ia/clave', { clave: CLAVE, modelo: 'gemini-3.5-flash-lite' }, pc);
  empleado(env, n, 'emp@x.com', 'se'); const cel = await equipo(env, n, 'se', 'emp@x.com', 'cel-emp-0123456789abcdefghij');

  assert.equal((await (await get(ia.onRequestGet, env, '/api/ia/estado', cel)).json()).canChange, false);
  const cuerpo = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Transcribí la factura' }] }] });
  const r = await post(ia.onRequestGenerar, env, '/api/ia/generar', { modelo: 'gemini-3.5-flash-lite', cuerpo }, cel);
  assert.equal(r.status, 200);
  const texto = await r.text(); assert.ok(texto.includes('candidates'), 'devuelve la respuesta de Google tal cual'); assert.ok(!texto.includes(CLAVE));
  const pedido = g.pedidos.at(-1);
  assert.equal(pedido.path, '/v1beta/models/gemini-3.5-flash-lite:generateContent'); assert.equal(pedido.headers['x-goog-api-key'], CLAVE);
  assert.equal(pedido.search, '', 'la clave no va en la URL'); assert.equal(pedido.body, cuerpo, 'el pedido llega tal cual');

  assert.equal((await post(ia.onRequestClave, env, '/api/ia/clave', { clave: 'AIzaOTRA_clave-del-empleado-000000000' }, cel)).status, 403);
  assert.equal((await post(ia.onRequestClave, env, '/api/ia/clave', { clave: null }, cel)).status, 403);
  assert.ok(one(env, 'SELECT COUNT(*) c FROM ia_claves').c === 1);
});

await t('un error de Google (sin cupo) llega con su estado para que la app lo explique', async () => {
  const env = mkEnv(); const n = await negocio(env); const g = simular();
  const pc = await equipo(env, n, 'sd', 'duena@x.com', 'pc-duena-0123456789abcdefgh');
  await post(ia.onRequestClave, env, '/api/ia/clave', { clave: CLAVE, modelo: 'gemini-3.5-flash-lite' }, pc);
  g.estado = 429;
  const r = await post(ia.onRequestGenerar, env, '/api/ia/generar', { modelo: 'gemini-3.5-flash-lite', cuerpo: '{}' }, pc);
  assert.equal(r.status, 429); assert.ok((await r.text()).includes('exhausted'));
});

await t('sin clave, sin dispositivo, con datos raros o sin suscripción se rechaza', async () => {
  const env = mkEnv(); const n = await negocio(env); simular();
  const pc = await equipo(env, n, 'sd', 'duena@x.com', 'pc-duena-0123456789abcdefgh');
  const pedido = { modelo: 'gemini-3.5-flash-lite', cuerpo: '{}' };
  assert.equal((await post(ia.onRequestGenerar, env, '/api/ia/generar', pedido, pc)).status, 409, 'el negocio todavía no cargó la clave');
  assert.equal((await post(ia.onRequestGenerar, env, '/api/ia/generar', pedido, {})).status, 401, 'sin dispositivo');
  assert.equal((await get(ia.onRequestGet, env, '/api/ia/estado', {})).status, 401);
  for (const malo of [{ clave: 'corta' }, { clave: 'con espacios y cosas raras 1234567890' }, { clave: 'AIza-con-salto\r\nX-Otra: valor-123456' }, { clave: CLAVE, modelo: '../../otra' }, {}]) {
    assert.equal((await post(ia.onRequestClave, env, '/api/ia/clave', malo, pc)).status, 400, JSON.stringify(malo));
  }
  await post(ia.onRequestClave, env, '/api/ia/clave', { clave: CLAVE }, pc);
  for (const malo of [{ modelo: 'x/../y', cuerpo: '{}' }, { modelo: 'gemini-3.5-flash-lite' }, { modelo: 'gemini-3.5-flash-lite', cuerpo: '' }]) {
    assert.equal((await post(ia.onRequestGenerar, env, '/api/ia/generar', malo, pc)).status, 400, JSON.stringify(malo));
  }
  // Otra base: la caché de la suscripción es por entorno.
  const env2 = mkEnv(); const n2 = await negocio(env2); mp.subs = [mpSub('duena@x.com', 'cancelled', 400)];
  const pc2 = await equipo(env2, n2, 'sd', 'duena@x.com', 'pc-duena-0123456789abcdefgh');
  await post(ia.onRequestClave, env2, '/api/ia/clave', { clave: CLAVE }, pc2);
  assert.notEqual((await post(ia.onRequestGenerar, env2, '/api/ia/generar', pedido, pc2)).status, 200, 'con la suscripción vencida no se usa la IA del negocio');
});

await t('acepta las claves de Google con el formato nuevo (con punto), no solo las "AIza…"', async () => {
  const env = mkEnv(); const n = await negocio(env); const g = simular();
  const pc = await equipo(env, n, 'sd', 'duena@x.com', 'pc-duena-0123456789abcdefgh');
  const nueva = 'AQ.Ab8RN6KfalsaDePrueba_0123456789-abcdefghijklmnop';
  assert.equal((await post(ia.onRequestClave, env, '/api/ia/clave', { clave: nueva, modelo: 'gemini-3.5-flash-lite' }, pc)).status, 200);
  await post(ia.onRequestGenerar, env, '/api/ia/generar', { modelo: 'gemini-3.5-flash-lite', cuerpo: '{}' }, pc);
  assert.equal(g.pedidos.at(-1).headers['x-goog-api-key'], nueva);
});

await t('el dueño la borra y deja de usarse', async () => {
  const env = mkEnv(); const n = await negocio(env); simular();
  const pc = await equipo(env, n, 'sd', 'duena@x.com', 'pc-duena-0123456789abcdefgh');
  await post(ia.onRequestClave, env, '/api/ia/clave', { clave: CLAVE }, pc);
  assert.equal((await post(ia.onRequestClave, env, '/api/ia/clave', { clave: null }, pc)).status, 200);
  assert.equal((await (await get(ia.onRequestGet, env, '/api/ia/estado', pc)).json()).configured, false);
  assert.equal((await post(ia.onRequestGenerar, env, '/api/ia/generar', { modelo: 'gemini-3.5-flash-lite', cuerpo: '{}' }, pc)).status, 409);
});

console.log(`\n${pass} pruebas OK (IA por negocio)`);

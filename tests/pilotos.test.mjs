// Links de prueba: el administrador crea uno por persona; quien lo canjea queda eximida con el plan y va a descargar.
import assert from 'node:assert/strict';
import { mkEnv, addUser, sess, req, web, nowS } from './helpers-nube.mjs';
import { safeNext } from '../functions/_lib/util.js';
import * as piloto from '../functions/api/admin/piloto.js';
import * as invitado from '../functions/api/invitado.js';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const crear = async (env, cookie, plan = 'gastro') => piloto.onRequestPost({ request: req('/api/admin/piloto', { method: 'POST', body: { plan }, cookie, headers: web }), env });
const canjear = async (env, cookie, token) => invitado.onRequestPost({ request: req('/api/invitado', { method: 'POST', body: { token }, cookie, headers: web }), env });
const fila = (env, email) => env.DB.raw.prepare('SELECT * FROM users WHERE email=?').get(email);
async function link(env) {
  addUser(env, 'admin@x.com', 'sa');
  const r = await crear(env, await sess(env, 'admin@x.com', 'sa'));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.link, /^https:\/\/horsepos\.com\/invitado\/\?t=[0-9a-f]{64}$/);
  return new URL(j.link).searchParams.get('t');
}

await t('solo el administrador crea links, y con un plan que existe', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); addUser(env, 'admin@x.com', 'sa');
  assert.equal((await crear(env, await sess(env, 'ana@x.com', 's1'))).status, 403);
  assert.equal((await crear(env, null)).status, 401);
  assert.equal((await crear(env, await sess(env, 'admin@x.com', 'sa'), 'inventado')).status, 400);
});
await t('la base guarda el hash, no el token', async () => {
  const env = mkEnv(); const tok = await link(env);
  const p = env.DB.raw.prepare('SELECT * FROM pilotos').get();
  assert.notEqual(p.token_hash, tok); assert.equal(p.plan, 'gastro');
});
await t('sin sesión pide ingresar; con sesión la cuenta queda eximida con Gastro elegido', async () => {
  const env = mkEnv(); const tok = await link(env); addUser(env, 'gladys@x.com', 'sg');
  assert.equal((await canjear(env, null, tok)).status, 401);
  const r = await canjear(env, await sess(env, 'gladys@x.com', 'sg'), tok);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, plan: 'gastro' });
  const u = fila(env, 'gladys@x.com'); assert.equal(u.exempt, 1); assert.equal(u.plan_interest, 'gastro');
});
await t('un link sirve para una sola cuenta; la misma persona lo puede volver a abrir', async () => {
  const env = mkEnv(); const tok = await link(env); addUser(env, 'gladys@x.com', 'sg'); addUser(env, 'amiga@x.com', 'sm');
  assert.equal((await canjear(env, await sess(env, 'gladys@x.com', 'sg'), tok)).status, 200);
  assert.equal((await canjear(env, await sess(env, 'gladys@x.com', 'sg'), tok)).status, 200);
  const r = await canjear(env, await sess(env, 'amiga@x.com', 'sm'), tok);
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'usado');
  assert.equal(fila(env, 'amiga@x.com').exempt, 0);
});
await t('un link vencido o inventado no exime a nadie', async () => {
  const env = mkEnv(); const tok = await link(env); addUser(env, 'gladys@x.com', 'sg');
  env.DB.raw.prepare('UPDATE pilotos SET exp = ?').run(nowS() - 1);
  const c = await sess(env, 'gladys@x.com', 'sg');
  assert.equal((await (await canjear(env, c, tok)).json()).error, 'vencido');
  assert.equal((await (await canjear(env, c, 'f'.repeat(64))).json()).error, 'no_valido');
  assert.equal((await canjear(env, c, 'corto')).status, 400);
  assert.equal(fila(env, 'gladys@x.com').exempt, 0);
});
await t('después de ingresar con Google se vuelve a la página del link', async () => {
  assert.equal(safeNext('/invitado/?t=' + 'a'.repeat(64)), '/invitado/?t=' + 'a'.repeat(64));
  assert.equal(safeNext('/invitado/?t=x&next=https://otro.com'), null);
});

console.log(`\n${pass} pruebas OK (links de prueba)`);

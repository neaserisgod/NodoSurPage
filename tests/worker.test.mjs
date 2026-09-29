import assert from 'node:assert/strict';
import worker from '../worker.js';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const env = { SESSION_SECRET: 'x'.repeat(48), GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'gs', ASSETS: { fetch: async (r) => new Response('ESTATICO ' + new URL(r.url).pathname) } };
const call = (path, method = 'GET') => worker.fetch(new Request('https://horsepos.com' + path, { method }), env, { waitUntil() {} });

await t('rutas que no son /api/ salen de los archivos estáticos', async () => {
  assert.equal(await (await call('/')).text(), 'ESTATICO /');
  assert.equal(await (await call('/sistema-pos/')).text(), 'ESTATICO /sistema-pos/');
});
await t('/api/auth/google redirige a Google', async () => {
  const r = await call('/api/auth/google'); assert.equal(r.status, 302); assert.match(r.headers.get('Location'), /^https:\/\/accounts\.google\.com\//);
});
await t('/api/me sin sesión responde 401 JSON', async () => {
  const r = await call('/api/me'); assert.equal(r.status, 401); assert.equal((await r.json()).error, 'no_session');
});
await t('método incorrecto => 405 y ruta inexistente => 404', async () => {
  assert.equal((await call('/api/me', 'POST')).status, 405);
  assert.equal((await call('/api/auth/logout', 'GET')).status, 405);
  assert.equal((await call('/api/nada')).status, 404);
});
await t('rutas de administración exigen sesión', async () => {
  assert.equal((await call('/api/admin/overview')).status, 401);
  assert.equal((await call('/api/admin/user', 'POST')).status, 403);
});
await t('un error interno devuelve 500 sin filtrar detalles', async () => {
  const bad = { ...env, DB: { prepare() { throw new Error('secreto interno') } } };
  const tok = await (await import('../functions/_lib/util.js')).sign({ sub: 's', email: 'a@b.c', name: 'A', iat: 1, exp: 9999999999 }, env.SESSION_SECRET);
  const r = await worker.fetch(new Request('https://horsepos.com/api/me', { headers: { Cookie: `ns_session=${tok}` } }), bad, { waitUntil() {} });
  assert.equal(r.status, 500); assert.ok(!(await r.text()).includes('secreto'));
});
await t('cron: sin D1 o sin token no hace nada (no falla)', async () => {
  await worker.scheduled({}, { ...env }, { waitUntil() { throw new Error('no debería'); } });
});
console.log(`\n${pass} pruebas OK (worker)`);

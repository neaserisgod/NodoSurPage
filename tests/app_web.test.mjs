// Nodo Sur Servicios en el navegador (`functions/_lib/app_web.js`): /app/ sale de R2, de la versión que marca app/actual.json,
// con sus propias cabeceras (aislamiento entre orígenes para la base en el navegador, y WebAssembly permitido).
import assert from 'node:assert/strict';
import { servirApp, rutaSegura, tipoDe, olvidarVersion } from '../functions/_lib/app_web.js';
import worker from '../worker.js';
import { mkEnv } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { olvidarVersion(); await f(); pass++; console.log('ok  ', n); };
const pedir = (env, path, init) => servirApp(new Request('https://horsepos.com' + path, init), env);
async function conVersion(version = '1.0.0+2164') {
  const env = mkEnv();
  await env.RELEASES.put('app/actual.json', Buffer.from(JSON.stringify({ version })));
  await env.RELEASES.put(`app/${version}/index.html`, Buffer.from('<!doctype html><title>Nodo Sur Servicios</title>'));
  await env.RELEASES.put(`app/${version}/main.dart.js`, Buffer.from('console.log(1)'));
  await env.RELEASES.put(`app/${version}/canvaskit/canvaskit.wasm`, Buffer.from([0, 97, 115, 109]));
  return env;
}

await t('sin versión publicada contesta 503 con un texto, no la página de otra cosa', async () => {
  const r = await pedir(mkEnv(), '/app/');
  assert.equal(r.status, 503);
});
await t('sirve la versión actual, con aislamiento entre orígenes y WebAssembly permitido', async () => {
  const env = await conVersion();
  const r = await pedir(env, '/app/');
  assert.equal(r.status, 200); assert.match(await r.text(), /Nodo Sur Servicios/);
  assert.equal(r.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.match(r.headers.get('Content-Security-Policy'), /script-src 'self' 'wasm-unsafe-eval'/);
  const scriptSrc = /script-src ([^;]*)/.exec(r.headers.get('Content-Security-Policy'))[1].split(' ');
  assert.deepEqual(scriptSrc, ["'self'", "'wasm-unsafe-eval'"], 'sin scripts en línea ni eval: solo WebAssembly');
  assert.equal(r.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(r.headers.get('Cache-Control'), 'no-cache');
  const w = await pedir(env, '/app/canvaskit/canvaskit.wasm');
  assert.equal(w.status, 200); assert.equal(w.headers.get('Content-Type'), 'application/wasm');
});
await t('/app sin barra redirige a /app/ (con la consulta: la vuelta de entrar con Google la trae)', async () => {
  const r = await pedir(await conVersion(), '/app?code=x&state=y');
  assert.equal(r.status, 301); assert.equal(r.headers.get('Location'), 'https://horsepos.com/app/?code=x&state=y');
});
await t('nada fuera de la carpeta de la versión: rutas raras, archivos que no están y métodos que no son GET', async () => {
  const env = await conVersion();
  for (const p of ['/app/../actual.json', '/app/%2e%2e/actual.json', '/app//index.html', '/app/no-existe.js', '/app/a b.js']) assert.equal((await pedir(env, p)).status, 404, p);
  assert.equal((await pedir(env, '/app/', { method: 'POST' })).status, 405);
  const h = await pedir(env, '/app/main.dart.js', { method: 'HEAD' });
  assert.equal(h.status, 200); assert.equal(await h.text(), '');
});
await t('rutaSegura y tipoDe', () => {
  assert.equal(rutaSegura(''), 'index.html'); assert.equal(rutaSegura('icons/'), 'icons/index.html'); assert.equal(rutaSegura('assets/fonts/Figtree-Regular.ttf'), 'assets/fonts/Figtree-Regular.ttf');
  for (const r of ['..', 'a/../b', 'a//b', './a', 'a\\b', 'a?b']) assert.equal(rutaSegura(r), null, r);
  assert.equal(tipoDe('x.wasm'), 'application/wasm'); assert.equal(tipoDe('flutter_bootstrap.js'), 'text/javascript; charset=utf-8'); assert.equal(tipoDe('raro.xyz'), 'application/octet-stream');
});
await t('el worker manda /app/ a la app (no a los archivos del sitio) y el resto sigue igual', async () => {
  const env = await conVersion(); let assets = 0; env.ASSETS = { fetch: async () => { assets++; return new Response('sitio'); } };
  const r = await worker.fetch(new Request('https://horsepos.com/app/'), env, { waitUntil() {} });
  assert.equal(r.status, 200); assert.equal(assets, 0);
  assert.equal(await (await worker.fetch(new Request('https://horsepos.com/aplicacion/'), env, { waitUntil() {} })).text(), 'sitio');
  assert.equal(assets, 1);
});
console.log(`\n${pass} pruebas de la app web OK`);

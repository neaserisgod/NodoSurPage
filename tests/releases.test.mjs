import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sign } from '../functions/_lib/util.js';
import { cmpVersion, validVersion, validKey } from '../functions/_lib/releases.js';
import { clearMpCache } from '../functions/_lib/mp.js';
import * as adminRel from '../functions/api/admin/releases.js';
import * as latest from '../functions/api/update/latest.js';
import * as appcast from '../functions/api/update/appcast.js';
import * as file from '../functions/api/update/file.js';
import * as download from '../functions/api/download.js';
import * as downloads from '../functions/api/downloads.js';

const nowS = () => Math.floor(Date.now() / 1000);
function fakeD1() {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../migrations/0001_users.sql', import.meta.url), 'utf8')); // sin tablas de versiones a propósito
  return { raw: db, prepare(sql) { let a = []; const st = db.prepare(sql); const o = { bind(...x) { a = x; return o }, first() { return st.get(...a) ?? null }, all() { return { results: st.all(...a) } }, run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } } } }; return o } };
}
// R2 simulado: get con Range y If-None-Match, head, y contenido en memoria.
function fakeR2() {
  const files = new Map();
  return { files, put(k, txt) { files.set(k, Buffer.from(txt)); },
    async head(k) { return files.has(k) ? { size: files.get(k).length } : null; },
    async get(k, { range, onlyIf } = {}) {
      const buf = files.get(k); if (!buf) return null;
      const etag = '"e-' + buf.length + '"', meta = { size: buf.length, httpEtag: etag, writeHttpMetadata() {} };
      if (onlyIf && onlyIf.get('If-None-Match') === etag) return meta; // sin body => 304
      const m = range && /^bytes=(\d+)-(\d*)$/.exec(range.get('Range') || '');
      const off = m ? Number(m[1]) : 0, end = m && m[2] ? Number(m[2]) : buf.length - 1, part = buf.subarray(off, end + 1);
      return { ...meta, body: new Blob([part]).stream(), range: m ? { offset: off, length: part.length } : undefined };
    } };
}
const mkEnv = (extra = {}) => (clearMpCache(), { SESSION_SECRET: 'x'.repeat(48), SITE_URL: 'https://horsepos.com', MP_ACCESS_TOKEN: 'tok', ADMIN_EMAILS: 'admin@x.com', RELEASE_TOKEN: 'r'.repeat(40), DB: fakeD1(), RELEASES: fakeR2(), ...extra });
let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const sess = async (env, email, sub) => `ns_session=${await sign({ sub, email, name: 'X', iat: nowS(), exp: nowS() + 999 }, env.SESSION_SECRET)}`;
const addUser = (env, email, sub, exempt = 0) => env.DB.raw.prepare('INSERT INTO users (sub,email,name,created_at,last_seen,login_count,exempt) VALUES (?,?,?,?,?,1,?)').run(sub, email, email, nowS(), nowS(), exempt);
const req = (path, { method = 'GET', body, cookie, headers = {} } = {}) => new Request('https://horsepos.com' + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
const adminPost = (env, body, cookie) => adminRel.onRequestPost({ request: req('/api/admin/releases', { method: 'POST', body, cookie, headers: { Origin: 'https://horsepos.com', 'X-Requested-With': 'fetch' } }), env });
const ciPost = (env, body, token = env.RELEASE_TOKEN) => adminRel.onRequestPost({ request: req('/api/admin/releases', { method: 'POST', body, headers: { Authorization: `Bearer ${token}` } }), env });
const ciGet = (env) => adminRel.onRequestGet({ request: req('/api/admin/releases', { headers: { Authorization: `Bearer ${env.RELEASE_TOKEN}` } }), env });
const HASH = 'a'.repeat(64);
const rel = (v, o = {}) => ({ platform: 'windows', channel: 'stable', version: v, key: `stable/${v}/Setup-${v}.exe`, sha256: HASH, ...o });
async function publish(env, v, o = {}, content) { env.RELEASES.put(`${o.channel || 'stable'}/${v}/Setup-${v}.exe`, content ?? `binario ${v}`); const r = await ciPost(env, rel(v, { key: `${o.channel || 'stable'}/${v}/Setup-${v}.exe`, ...o })); assert.equal(r.status, 200, await r.clone().text()); }
const P = '6fe282d944ef4c018cb7904ce9e122f8';
let SUBS = [];
const mockMP = () => { globalThis.fetch = async (url) => { const u = new URL(url);
  if (u.pathname === '/preapproval/search') { const em = u.searchParams.get('payer_email'); return new Response(JSON.stringify({ results: SUBS.filter((s) => !em || s.payer_email === em) }), { status: SUBS === 'fail' ? 500 : 200 }); }
  return new Response('{}', { status: 404 }); }; };
const sub = (email, status) => ({ id: 'id_' + email, status, reason: 'x', payer_email: email, preapproval_plan_id: P, auto_recurring: { transaction_amount: 35000, currency_id: 'ARS', frequency: 1, frequency_type: 'months' } });

await t('versiones: orden con número de build, prerelease y validación de formato', () => {
  assert.equal(cmpVersion('1.0.0+2098', '1.0.0+2097'), 1); assert.equal(cmpVersion('1.0.0+2097', '1.0.0+2098'), -1); assert.equal(cmpVersion('1.0.0+5', '1.0.0+5'), 0);
  assert.equal(cmpVersion('1.0.10+1', '1.0.9+999'), 1); assert.equal(cmpVersion('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(cmpVersion('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.ok(validVersion('1.0.0+2098') && validVersion('2.1.0') && validVersion('1.0.0-rc.1') && validVersion('1.0.0.2098'));
  // nombre.build con puntos (lo que publica tool/publicar_release.ps1) equivale a nombre+build
  assert.equal(cmpVersion('1.0.0.2098', '1.0.0+2098'), 0); assert.equal(cmpVersion('1.0.0.2099', '1.0.0+2098'), 1); assert.equal(cmpVersion('1.0.0.2097', '1.0.0+2098'), -1); assert.equal(cmpVersion('1.0.0.10000', '1.0.0.9999'), 1);
  for (const v of ['1.0', '1.0.0.', '1.0.0.x', '1.0.0.2098.1', '1.0.0+x', 'a.b.c', '1.0.0+', '../1.0.0', 5, null]) assert.ok(!validVersion(v), String(v));
  assert.ok(validKey('stable/1.0.0+2098/Setup.exe')); for (const k of ['x/1.0.0/a.exe', 'stable/../a/b.exe', 'stable/1.0.0/a b.exe', 'stable/1.0.0/../../x']) assert.ok(!validKey(k), k);
});

await t('publicar: solo CI con token o administrador con sesión (y mismo origen)', async () => {
  const env = mkEnv(); addUser(env, 'admin@x.com', 'a'); addUser(env, 'ana@x.com', 's1'); env.RELEASES.put('stable/1.0.0+1/Setup-1.0.0+1.exe', 'x');
  const body = rel('1.0.0+1');
  assert.equal((await ciPost(env, body, 'malo')).status, 401);
  assert.equal((await ciPost(env, body, 'r'.repeat(39))).status, 401);
  assert.equal((await ciPost({ ...env, RELEASE_TOKEN: '' }, body, '')).status, 401);
  assert.equal((await adminPost(env, body, await sess(env, 'ana@x.com', 's1'))).status, 403); // un cliente no publica
  assert.equal((await adminRel.onRequestPost({ request: req('/api/admin/releases', { method: 'POST', body, cookie: await sess(env, 'admin@x.com', 'a'), headers: { Origin: 'https://evil.com', 'X-Requested-With': 'fetch' } }), env })).status, 403);
  assert.equal((await ciPost(env, body)).status, 200);
  assert.equal((await adminRel.onRequestGet({ request: req('/api/admin/releases'), env })).status, 401);
});
await t('publicar: valida datos, exige que el archivo exista en R2, toma el peso de R2 y no pisa versiones', async () => {
  const env = mkEnv(); env.RELEASES.put('stable/1.0.0+1/Setup-1.0.0+1.exe', '12345');
  for (const bad of [{ platform: 'ps5' }, { channel: 'dev' }, { version: '1.0' }, { key: 'stable/9.9.9/x.exe' }, { key: '../x' }, { sha256: 'zz' }, { rollout: 101 }, { rollout: 1.5 }, { signature: 'x'.repeat(401) }, { notes: 5 }])
    assert.equal((await ciPost(env, { ...rel('1.0.0+1'), ...bad })).status, 400, JSON.stringify(bad));
  assert.equal((await ciPost(env, rel('1.0.0+2'))).status, 422); // no subido a R2
  const ok = await ciPost(env, rel('1.0.0+1')); assert.deepEqual(await ok.json(), { ok: true, size: 5 });
  assert.equal((await ciPost(env, rel('1.0.0+1'))).status, 409);
  assert.equal((await ciPost({ ...env, RELEASES: undefined }, rel('1.0.0+1'))).status, 503);
  const list = await (await ciGet(env)).json();
  assert.equal(list.releases[0].size, 5); assert.ok(!('file_key' in list.releases[0]) && !('key' in list.releases[0])); assert.equal(list.r2, true);
});

await t('actualizaciones: solo si hay algo más nuevo, por plataforma y canal', async () => {
  const env = mkEnv(); await publish(env, '1.0.0+2097'); await publish(env, '1.0.0+2098', { notes: 'Arqueos opcionales', signature: 'SIG' });
  await publish(env, '1.1.0-beta.1', { channel: 'beta' }); env.RELEASES.put('stable/1.0.0+2098/And.apk', 'apk');
  const ask = async (qs) => (await latest.onRequestGet({ request: req('/api/update/latest.json?' + qs), env })).json();
  let j = await ask('platform=windows&version=1.0.0%2B2097'); assert.equal(j.update, true); assert.equal(j.version, '1.0.0+2098'); assert.equal(j.signature, 'SIG'); assert.equal(j.notes, 'Arqueos opcionales');
  assert.match(j.url, /^https:\/\/horsepos\.com\/api\/update\/file\?id=\d+$/); assert.equal(j.size, 'binario 1.0.0+2098'.length); assert.ok(!('key' in j));
  assert.equal((await ask('platform=windows&version=1.0.0%2B2098')).update, false);
  assert.equal((await ask('platform=windows&version=1.0.0%2B9999')).update, false);
  assert.equal((await ask('platform=windows')).update, true); // sin versión actual: ofrece la más nueva
  assert.equal((await ask('platform=android&version=1.0.0%2B1')).update, false);
  assert.equal((await ask('platform=windows&channel=beta&version=1.0.0%2B1')).update, true);
  for (const qs of ['', 'platform=ps5', 'platform=windows&channel=dev', 'platform=windows&version=rara']) assert.equal((await latest.onRequestGet({ request: req('/api/update/latest.json?' + qs), env })).status, 400, qs);
  assert.deepEqual(await (await latest.onRequestGet({ request: req('/api/update/latest.json?platform=windows'), env: { ...env, RELEASES: undefined } })).json(), { update: false });
});
await t('despliegue gradual: reparto estable por instalación y sin id no se ofrece hasta el 100 %', async () => {
  const env = mkEnv(); await publish(env, '1.0.0+1'); await publish(env, '1.0.0+2', { rollout: 30 });
  const rows = await (await ciGet(env)).json(); const id2 = rows.releases.find((r) => r.version === '1.0.0+2').id;
  const ask = async (cid) => (await latest.onRequestGet({ request: req(`/api/update/latest.json?platform=windows&version=1.0.0%2B1${cid ? '&cid=' + cid : ''}`), env })).json();
  let yes = 0; for (let i = 0; i < 400; i++) { const a = (await ask('pc-' + i)).update; assert.equal(a, (await ask('pc-' + i)).update); if (a) yes++; }
  assert.ok(yes > 80 && yes < 160, `~30 % de 400, dio ${yes}`);
  assert.equal((await ask()).update, false);
  await ciPost(env, { action: 'rollout', id: id2, rollout: 100 }); assert.equal((await ask()).update, true);
  await ciPost(env, { action: 'rollout', id: id2, rollout: 0 }); assert.equal((await ask('pc-1')).update, false);
  assert.equal((await ciPost(env, { action: 'rollout', id: id2, rollout: 200 })).status, 400);
});
await t('volver atrás: retirar o bloquear una versión hace vigente la anterior', async () => {
  const env = mkEnv(); await publish(env, '1.0.0+1'); await publish(env, '1.0.0+2');
  const list = async () => (await (await ciGet(env)).json()).releases; const id2 = (await list()).find((r) => r.version === '1.0.0+2').id;
  const cur = async () => (await (await latest.onRequestGet({ request: req('/api/update/latest.json?platform=windows'), env })).json()).version;
  assert.equal(await cur(), '1.0.0+2');
  await ciPost(env, { action: 'retire', id: id2 }); assert.equal(await cur(), '1.0.0+1');
  await ciPost(env, { action: 'restore', id: id2 }); assert.equal(await cur(), '1.0.0+2');
  await ciPost(env, { action: 'block', id: id2 }); assert.equal(await cur(), '1.0.0+1');
  assert.equal((await file.onRequest({ request: req(`/api/update/file?id=${id2}`), env })).status, 404); // bloqueada: no se entrega
  await ciPost(env, { action: 'unblock', id: id2 }); assert.equal((await file.onRequest({ request: req(`/api/update/file?id=${id2}`), env })).status, 200);
  assert.equal((await ciPost(env, { action: 'block', id: 999 })).status, 404); assert.equal((await ciPost(env, { action: 'explotar', id: id2 })).status, 400);
});
await t('appcast (Sparkle/WinSparkle): versión nombre.build, firma, obligatoria y XML escapado', async () => {
  const env = mkEnv(); await publish(env, '1.0.0+2098', { notes: 'Fix <b>&</b> ]]> raro', signature: 'ABC=', mandatory: true });
  const r = await appcast.onRequestGet({ request: req('/api/update/appcast.xml?platform=windows'), env }); const x = await r.text();
  assert.match(r.headers.get('Content-Type'), /application\/xml/);
  assert.match(x, /<sparkle:version>1\.0\.0\.2098<\/sparkle:version>/); assert.match(x, /<sparkle:shortVersionString>1\.0\.0<\/sparkle:shortVersionString>/);
  assert.match(x, /sparkle:edSignature="ABC="/); assert.match(x, /sparkle:os="windows"/); assert.match(x, /<sparkle:criticalUpdate>/); assert.match(x, /length="\d+"/);
  assert.match(x, /enclosure url="https:\/\/horsepos\.com\/api\/update\/file\?id=1"/); assert.ok(!x.includes('Setup-1.0.0'));
  assert.ok(!/<b>/.test(x.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')));
  assert.equal((await (await appcast.onRequestGet({ request: req('/api/update/appcast.xml?platform=macos'), env })).text()).includes('<item>'), false);
  assert.equal((await appcast.onRequestGet({ request: req('/api/update/appcast.xml?platform=x'), env })).status, 400);
});
await t('archivo de actualización: completo, por partes (Range), condicional y HEAD', async () => {
  const env = mkEnv(); await publish(env, '1.0.0+1', {}, '0123456789');
  let r = await file.onRequest({ request: req('/api/update/file?id=1'), env }); assert.equal(r.status, 200); assert.equal(await r.text(), '0123456789'); assert.equal(r.headers.get('content-length'), '10'); assert.equal(r.headers.get('accept-ranges'), 'bytes');
  assert.ok(!r.headers.get('content-disposition'));
  r = await file.onRequest({ request: req('/api/update/file?id=1', { headers: { Range: 'bytes=2-5' } }), env }); assert.equal(r.status, 206); assert.equal(await r.text(), '2345'); assert.equal(r.headers.get('content-range'), 'bytes 2-5/10');
  const etag = (await file.onRequest({ request: req('/api/update/file?id=1'), env })).headers.get('etag');
  r = await file.onRequest({ request: req('/api/update/file?id=1', { headers: { 'If-None-Match': etag } }), env }); assert.equal(r.status, 304);
  assert.equal((await file.onRequest({ request: req('/api/update/file?id=1', { method: 'HEAD' }), env })).status, 200);
  for (const id of ['0', 'x', '999', '-1']) assert.equal((await file.onRequest({ request: req('/api/update/file?id=' + id), env })).status, 404, id);
  assert.equal((await file.onRequest({ request: req('/api/update/file?id=1', { method: 'POST' }), env })).status, 405);
});

await t('instalador: exige sesión y suscripción vigente; admin y cuentas eximidas entran siempre', async () => {
  const env = mkEnv(); addUser(env, 'admin@x.com', 'a'); addUser(env, 'ana@x.com', 's1'); addUser(env, 'demo@x.com', 's2', 1); addUser(env, 'luis@x.com', 's3');
  await publish(env, '1.0.0+2098', {}, 'INSTALADOR'); await publish(env, '1.1.0-beta.1', { channel: 'beta' }, 'BETA'); SUBS = [sub('ana@x.com', 'authorized'), sub('luis@x.com', 'cancelled')]; mockMP();
  const go = (qs, cookie, headers) => download.onRequestGet({ request: req('/api/download?' + qs, { cookie, headers }), env });
  const loc = (r) => r.headers.get('Location').replace('https://horsepos.com', '');
  assert.equal(loc(await go('platform=windows')), '/ingresar/');
  assert.equal(loc(await go('platform=ps5', await sess(env, 'ana@x.com', 's1'))), '/descargar/');
  assert.equal(loc(await go('platform=windows', await sess(env, 'luis@x.com', 's3'))), '/descargar/?e=no_subscription'); // cancelada
  assert.equal(loc(await go('platform=windows', await sess(env, 'nadie@x.com', 'zz'))), '/ingresar/'); // sesión de cuenta inexistente
  let r = await go('platform=windows', await sess(env, 'ana@x.com', 's1')); assert.equal(r.status, 200); assert.equal(await r.text(), 'INSTALADOR');
  assert.match(r.headers.get('content-disposition'), /attachment; filename="Setup-1\.0\.0\+2098\.exe"/);
  assert.equal((await go('platform=windows', await sess(env, 'admin@x.com', 'a'))).status, 200); assert.equal((await go('platform=windows', await sess(env, 'demo@x.com', 's2'))).status, 200);
  // beta solo para admin/eximidos; un cliente que la pide recibe la estable
  assert.equal(await (await go('platform=windows&channel=beta', await sess(env, 'admin@x.com', 'a'))).text(), 'BETA');
  assert.equal(await (await go('platform=windows&channel=beta', await sess(env, 'ana@x.com', 's1'))).text(), 'INSTALADOR');
  assert.equal(loc(await go('platform=android', await sess(env, 'ana@x.com', 's1'))), '/descargar/?e=no_disponible');
  const n = () => env.DB.raw.prepare('SELECT COUNT(*) c FROM downloads').get().c; const before = n();
  await go('platform=windows', await sess(env, 'ana@x.com', 's1'), { Range: 'bytes=0-3' }); assert.equal(n(), before); // continuar una descarga no cuenta
  await go('platform=windows', await sess(env, 'ana@x.com', 's1')); assert.equal(n(), before + 1);
  SUBS = 'fail'; mockMP(); clearMpCache(); assert.equal(loc(await go('platform=windows', await sess(env, 'ana@x.com', 's1'))), '/descargar/?e=mp_error'); // ante la duda, no
  assert.equal(loc(await go('platform=windows', await sess({ ...env, MP_ACCESS_TOKEN: '' }, 'ana@x.com', 's1'))).replace(/\?.*/, ''), '/descargar/');
});
await t('instalador: solo se ofrece lo ya liberado al 100 % (una versión a medias no llega a instalaciones nuevas)', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); await publish(env, '1.0.0+1', {}, 'VIEJA'); await publish(env, '1.0.0+2', { rollout: 10 }, 'NUEVA'); SUBS = [sub('ana@x.com', 'authorized')]; mockMP();
  const r = await download.onRequestGet({ request: req('/api/download?platform=windows', { cookie: await sess(env, 'ana@x.com', 's1') }), env });
  assert.equal(await r.text(), 'VIEJA');
});
await t('/api/downloads: lo que ve /descargar/ (sin claves internas) y el motivo si no puede', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); addUser(env, 'luis@x.com', 's3'); await publish(env, '1.0.0+2098', { notes: 'Novedades' }); SUBS = [sub('ana@x.com', 'authorized')]; mockMP();
  const ask = async (cookie) => downloads.onRequestGet({ request: req('/api/downloads', { cookie }), env });
  assert.equal((await ask()).status, 401);
  const ok = await (await ask(await sess(env, 'ana@x.com', 's1'))).json();
  assert.equal(ok.canDownload, true); assert.equal(ok.releases.length, 1); assert.deepEqual(Object.keys(ok.releases[0]).sort(), ['notes', 'platform', 'publishedAt', 'sha256', 'size', 'version']);
  assert.deepEqual(await (await ask(await sess(env, 'luis@x.com', 's3'))).json(), { canDownload: false, reason: 'no_subscription', releases: [] });
});
await t('/api/downloads: la beta la ve solo un administrador o una cuenta eximida; un cliente nunca', async () => {
  const env = mkEnv(); addUser(env, 'admin@x.com', 'a'); addUser(env, 'demo@x.com', 's2', 1); addUser(env, 'ana@x.com', 's1');
  await publish(env, '1.0.0+2098', {}, 'ESTABLE'); await publish(env, '1.0.0+2099', { channel: 'beta' }, 'BETA'); SUBS = [sub('ana@x.com', 'authorized')]; mockMP();
  const ask = async (cookie) => (await downloads.onRequestGet({ request: req('/api/downloads', { cookie }), env })).json();
  for (const [email, sb] of [['admin@x.com', 'a'], ['demo@x.com', 's2']]) {
    const d = await ask(await sess(env, email, sb));
    assert.equal(d.privileged, true); assert.equal(d.releases.length, 1); assert.equal(d.releases[0].version, '1.0.0+2098');
    assert.equal(d.beta.length, 1); assert.equal(d.beta[0].version, '1.0.0+2099');
    assert.deepEqual(Object.keys(d.beta[0]).sort(), ['notes', 'platform', 'publishedAt', 'sha256', 'size', 'version']); // sin claves internas
  }
  const c = await ask(await sess(env, 'ana@x.com', 's1'));
  assert.equal(c.privileged, false); assert.equal('beta' in c, false); assert.equal(c.releases.length, 1);
  // Solo beta publicada (todavía no hay estable): el administrador la ve y puede bajarla.
  const solo = mkEnv(); addUser(solo, 'admin@x.com', 'a'); await publish(solo, '1.0.0+1', { channel: 'beta' }, 'BETA');
  const d2 = await (await downloads.onRequestGet({ request: req('/api/downloads', { cookie: await sess(solo, 'admin@x.com', 'a') }), env: solo })).json();
  assert.deepEqual([d2.releases.length, d2.beta.length], [0, 1]);
  const r = await download.onRequestGet({ request: req('/api/download?platform=windows&channel=beta', { cookie: await sess(solo, 'admin@x.com', 'a') }), env: solo });
  assert.equal(await r.text(), 'BETA');
});
await t('sin ninguna versión publicada ni tablas: todo responde vacío sin fallar', async () => {
  const env = mkEnv(); addUser(env, 'admin@x.com', 'a');
  assert.deepEqual(await (await latest.onRequestGet({ request: req('/api/update/latest.json?platform=windows'), env })).json(), { update: false });
  assert.equal((await appcast.onRequestGet({ request: req('/api/update/appcast.xml?platform=windows'), env })).status, 200);
  assert.deepEqual((await (await adminRel.onRequestGet({ request: req('/api/admin/releases', { cookie: await sess(env, 'admin@x.com', 'a') }), env })).json()).releases, []);
  assert.equal((await file.onRequest({ request: req('/api/update/file?id=1'), env })).status, 404);
});

await t('tipo de firma: dsa (WinSparkle 0.8 / auto_updater 1.0) o ed, en el appcast y en el JSON', async () => {
  const env = mkEnv();
  env.RELEASES.put('stable/1.0.0+1/Setup-1.0.0+1.exe', 'a'); env.RELEASES.put('stable/1.0.0+2/Setup-1.0.0+2.exe', 'b');
  assert.equal((await ciPost(env, { ...rel('1.0.0+1'), signature: 'DSA==', signatureType: 'rsa' })).status, 400);
  assert.equal((await ciPost(env, { ...rel('1.0.0+1'), signature: 'DSA==', signatureType: 'dsa' })).status, 200);
  const feed = async () => (await (await appcast.onRequestGet({ request: req('/api/update/appcast.xml?platform=windows'), env })).text());
  let x = await feed(); assert.match(x, /sparkle:dsaSignature="DSA=="/); assert.ok(!x.includes('edSignature'));
  assert.equal((await (await latest.onRequestGet({ request: req('/api/update/latest.json?platform=windows'), env })).json()).signatureType, 'dsa');
  assert.equal((await ciPost(env, { ...rel('1.0.0+2'), signature: 'ED==' })).status, 200); // sin tipo: EdDSA
  x = await feed(); assert.match(x, /sparkle:edSignature="ED=="/); assert.ok(!x.includes('dsaSignature'));
  assert.equal((await (await ciGet(env)).json()).releases.map((r) => r.signatureType).sort().join(), 'dsa,ed');
});

await t('flujo de Windows: se publica 1.0.0.2099 y una app 1.0.0.2098 la ve (mismo build: al día)', async () => {
  const env = mkEnv(); env.RELEASES.put('stable/1.0.0.2099/LaPlazoleta-Setup-1.0.0.2099.exe', 'exe'); env.RELEASES.put('stable/1.0.0.2098/LaPlazoleta-Setup-1.0.0.2098.exe', 'exe');
  for (const v of ['1.0.0.2098', '1.0.0.2099']) assert.equal((await ciPost(env, { ...rel(v), key: `stable/${v}/LaPlazoleta-Setup-${v}.exe`, signature: 'DSA==', signatureType: 'dsa' })).status, 200, v);
  const feed = async () => (await (await appcast.onRequestGet({ request: req('/api/update/appcast.xml?platform=windows'), env })).text());
  assert.match(await feed(), /<sparkle:version>1\.0\.0\.2099<\/sparkle:version>/);
  const ask = async (v) => (await (await latest.onRequestGet({ request: req('/api/update/latest.json?platform=windows&version=' + v), env })).json()).update;
  assert.equal(await ask('1.0.0.2098'), true); assert.equal(await ask('1.0.0.2099'), false); assert.equal(await ask('1.0.0.2100'), false);
});

console.log(`\n${pass} pruebas OK (versiones y descargas)`);

import assert from 'node:assert/strict';
import { sign, sha256b64u, now } from '../functions/_lib/util.js';
import { createDeviceCode, upsertDevice, signDeviceToken, DEVICE_TTL } from '../functions/_lib/devices.js';
import * as whoami from '../functions/api/device/whoami.js';
import * as authorize from '../functions/api/device/authorize.js';
import * as token from '../functions/api/device/token.js';
import * as ping from '../functions/api/device/ping.js';
import * as devices from '../functions/api/devices.js';
import * as me from '../functions/api/me.js';
import * as google from '../functions/api/auth/google.js';
import * as callback from '../functions/api/auth/callback.js';
import * as latest from '../functions/api/update/latest.js';
import * as appcast from '../functions/api/update/appcast.js';
import * as adminRel from '../functions/api/admin/releases.js';
import { mkEnv, addUser, sess, req, web, mp, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const newVerifier = () => b64u(crypto.getRandomValues(new Uint8Array(48)));
const DID = 'pc-de-prueba-0123456789abcdef';
const STATE = b64u(crypto.getRandomValues(new Uint8Array(24)));
async function pedirCodigo(env, cookie, { verifier = newVerifier(), port = 53682, deviceId = DID, state = STATE, name = 'La PC del local' } = {}) {
  const r = await authorize.onRequestPost({ request: req('/api/device/authorize', { method: 'POST', cookie, headers: web, body: { port, state, challenge: await sha256b64u(verifier), deviceId, name } }), env });
  return { r, verifier };
}
const canjear = (env, code, verifier) => token.onRequestPost({ request: req('/api/device/token', { method: 'POST', body: { code, verifier } }), env });
const codeDe = async (r) => new URL((await r.clone().json()).redirect).searchParams.get('code');
async function vincular(env, email, sub, { deviceId = DID } = {}) {
  const { r, verifier } = await pedirCodigo(env, await sess(env, email, sub), { deviceId });
  const c = await canjear(env, await codeDe(r), verifier); assert.equal(c.status, 200);
  return (await c.json()).token;
}
const bearer = (tok) => ({ Authorization: `Bearer ${tok}` });
const doPing = (env, tok, body = {}) => ping.onRequestPost({ request: req('/api/device/ping', { method: 'POST', headers: bearer(tok), body }), env });

await t('whoami: dice con quién entró la persona, o 401', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1');
  assert.equal((await whoami.onRequestGet({ request: req('/api/device/whoami'), env })).status, 401);
  assert.equal((await (await whoami.onRequestGet({ request: req('/api/device/whoami', { cookie: await sess(env, 'ana@x.com', 's1') }), env })).json()).email, 'ana@x.com');
});
await t('authorize: exige sesión, mismo origen y datos válidos; devuelve la redirección al servidor local de la app', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); const cookie = await sess(env, 'ana@x.com', 's1');
  const body = { port: 53682, state: STATE, challenge: await sha256b64u(newVerifier()), deviceId: DID, name: 'PC' };
  const post = (o) => authorize.onRequestPost({ request: req('/api/device/authorize', { method: 'POST', body, ...o }), env });
  assert.equal((await post({ headers: web })).status, 401);
  assert.equal((await post({ cookie, headers: { Origin: 'https://evil.com', 'X-Requested-With': 'fetch' } })).status, 403);
  assert.equal((await post({ cookie, headers: { Origin: 'https://horsepos.com' } })).status, 403);
  for (const mala of [{ port: 80 }, { port: 70000 }, { port: '8080' }, { state: 'corto' }, { challenge: 'x' }, { deviceId: 'corto' }]) {
    const { r } = await pedirCodigo(env, cookie, {}); assert.equal(r.status, 200);
    const r2 = await authorize.onRequestPost({ request: req('/api/device/authorize', { method: 'POST', cookie, headers: web, body: { ...body, ...mala } }), env });
    assert.equal(r2.status, 400, JSON.stringify(mala));
  }
  const ok = await (await post({ cookie, headers: web })).json(); const u = new URL(ok.redirect);
  assert.equal(u.origin, 'http://127.0.0.1:53682'); assert.equal(u.pathname, '/callback'); assert.equal(u.searchParams.get('state'), STATE); assert.ok(u.searchParams.get('code'));
});
await t('token: el código se canjea una sola vez, con el verificador correcto, y deja la PC registrada', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1');
  const { r, verifier } = await pedirCodigo(env, await sess(env, 'ana@x.com', 's1'), { name: 'La PC del local' }); const code = await codeDe(r);
  assert.equal((await canjear(env, code, newVerifier())).status, 400); // verificador de otro: no alcanza con tener el código
  const ok = await canjear(env, code, verifier); assert.equal(ok.status, 200);
  const j = await ok.json(); assert.equal(j.email, 'ana@x.com'); assert.equal(j.deviceId, DID); assert.ok(j.token); assert.ok(j.expiresAt > nowS());
  assert.equal((await canjear(env, code, verifier)).status, 400); // ya usado
  const d = env.DB.raw.prepare('SELECT * FROM devices WHERE id=?').get(DID); assert.equal(d.owner_sub, 's1'); assert.equal(d.name, 'La PC del local'); assert.equal(d.revoked, 0);
});
await t('token: rechaza códigos vencidos, adulterados, de otro servidor y pedidos mal formados', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); const verifier = newVerifier();
  const viejo = await createDeviceCode(env, { sub: 's1', email: 'ana@x.com', deviceId: DID, name: 'x', challenge: await sha256b64u(verifier) }, nowS() - 1000);
  assert.equal((await canjear(env, viejo, verifier)).status, 400);
  const { r } = await pedirCodigo(env, await sess(env, 'ana@x.com', 's1'), { verifier }); const code = await codeDe(r);
  const [cuerpo, firma] = code.split('.'); const falso = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cuerpo, 'base64url')), sub: 'otro' })).toString('base64url');
  assert.equal((await canjear(env, `${falso}.${firma}`, verifier)).status, 400);
  const ajeno = await sign({ typ: 'devcode', sub: 'x', email: 'x@x.com', did: DID, challenge: await sha256b64u(verifier), jti: 'a'.repeat(32), exp: nowS() + 99 }, 'otro-secreto-distinto-de-48-caracteres-aaaaaaaaaaaa');
  assert.equal((await canjear(env, ajeno, verifier)).status, 400);
  // una sesión web no es un código de dispositivo
  const sesionComoCodigo = (await sess(env, 'ana@x.com', 's1')).split('=')[1];
  assert.equal((await canjear(env, sesionComoCodigo, verifier)).status, 400);
  for (const mal of [{}, { code: 5, verifier }, { code, verifier: 'corto' }]) assert.equal((await token.onRequestPost({ request: req('/api/device/token', { method: 'POST', body: mal }), env })).status, 400);
  assert.equal((await token.onRequestPost({ request: req('/api/device/token', { method: 'POST', raw: 'no-json' }), env })).status, 400);
});
await t('un token de dispositivo no sirve como sesión web, ni una sesión como token de dispositivo', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); mp.subs = []; mockMP();
  const tok = await vincular(env, 'ana@x.com', 's1');
  assert.equal((await me.onRequestGet({ request: req('/api/me', { cookie: `ns_session=${tok}` }), env })).status, 401);
  const sesion = (await sess(env, 'ana@x.com', 's1')).split('=')[1];
  assert.equal((await doPing(env, sesion)).status, 401);
  assert.equal((await doPing(env, 'basura')).status, 401);
  assert.equal((await ping.onRequestPost({ request: req('/api/device/ping', { method: 'POST', body: {} }), env })).status, 401);
});
await t('ping: actualiza versión, sistema e id de instalación; avisa el canal según la cuenta', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); addUser(env, 'admin@x.com', 'sa');
  const tokAna = await vincular(env, 'ana@x.com', 's1', { deviceId: 'pc-de-ana-0123456789abcdef' });
  const tokAdmin = await vincular(env, 'admin@x.com', 'sa', { deviceId: 'pc-del-admin-0123456789abcd' });
  const a = await (await doPing(env, tokAna, { version: '1.0.0.2098', os: 'Windows 10 (x64)', cid: 'cid-de-ana-0001' })).json();
  assert.deepEqual(a, { ok: true, channel: 'stable' });
  const d = env.DB.raw.prepare('SELECT * FROM devices WHERE id=?').get('pc-de-ana-0123456789abcdef');
  assert.equal(d.app_version, '1.0.0.2098'); assert.equal(d.os, 'Windows 10 (x64)'); assert.equal(d.cid, 'cid-de-ana-0001');
  assert.equal((await (await doPing(env, tokAdmin, { cid: 'cid-del-admin-01' })).json()).channel, 'beta');
  await doPing(env, tokAna, { version: '<script>', cid: 'x' }); // datos inválidos: se ignoran, no rompen
  assert.equal(env.DB.raw.prepare('SELECT app_version FROM devices WHERE id=?').get('pc-de-ana-0123456789abcdef').app_version, '1.0.0.2098');
});
await t('ping: renueva el token cuando le quedan menos de 60 días', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); await vincular(env, 'ana@x.com', 's1');
  const porVencer = await signDeviceToken(env, { sub: 's1', email: 'ana@x.com', deviceId: DID }, nowS() - DEVICE_TTL + 10 * 86400);
  const r = await (await doPing(env, porVencer)).json(); assert.ok(r.token);
  assert.equal((await doPing(env, r.token)).status, 200);
  const fresco = await vincular(env, 'ana@x.com', 's1'); assert.ok(!('token' in (await (await doPing(env, fresco)).json())));
  const vencido = await signDeviceToken(env, { sub: 's1', email: 'ana@x.com', deviceId: DID }, nowS() - DEVICE_TTL - 10);
  assert.equal((await doPing(env, vencido)).status, 401);
});
await t('desvincular: desde la sesión web (solo las propias) o desde la propia PC; el token deja de valer', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); addUser(env, 'luis@x.com', 's2');
  const idAna = 'pc-de-ana-0123456789abcdef', idLuis = 'pc-de-luis-0123456789abcde';
  const tokAna = await vincular(env, 'ana@x.com', 's1', { deviceId: idAna }); const tokLuis = await vincular(env, 'luis@x.com', 's2', { deviceId: idLuis });
  const revocar = (cookie, body, headers = web) => devices.onRequestRevoke({ request: req('/api/device/revoke', { method: 'POST', cookie, headers, body }), env });
  const cAna = await sess(env, 'ana@x.com', 's1');
  assert.equal((await revocar(cAna, { id: idLuis })).status, 200); assert.equal((await doPing(env, tokLuis)).status, 200); // la de otro no se toca
  assert.equal((await revocar(cAna, { id: idAna }, { Origin: 'https://evil.com', 'X-Requested-With': 'fetch' })).status, 403);
  const lista = await (await devices.onRequestGet({ request: req('/api/devices', { cookie: cAna }), env })).json();
  assert.deepEqual(lista.devices.map((d) => d.id), [idAna]);
  assert.equal((await revocar(cAna, { id: idAna })).status, 200);
  assert.equal((await doPing(env, tokAna)).status, 401);
  assert.equal((await devices.onRequestGet({ request: req('/api/devices', { cookie: cAna }), env })).status, 200);
  assert.equal((await (await devices.onRequestGet({ request: req('/api/devices', { cookie: cAna }), env })).json()).devices.length, 0);
  // la propia PC se desvincula con su token
  assert.equal((await devices.onRequestRevoke({ request: req('/api/device/revoke', { method: 'POST', headers: bearer(tokLuis), body: {} }), env })).status, 200);
  assert.equal((await doPing(env, tokLuis)).status, 401);
  // volver a vincular la misma PC la reactiva
  assert.ok(await vincular(env, 'ana@x.com', 's1', { deviceId: idAna }));
});
await t('si se borra y recrea la fila de la cuenta (barrido automático), la PC sigue vinculada: va atada al sub de Google', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); const tok = await vincular(env, 'ana@x.com', 's1');
  env.DB.raw.prepare('DELETE FROM users WHERE sub=?').run('s1');
  assert.equal((await doPing(env, tok)).status, 200);
});

// --- versiones de prueba para las PC de la cuenta administradora
const publicar = async (env, version, channel) => { const key = `${channel}/${version}/Setup-${version}.exe`; env.RELEASES.put?.(key, 'x'); await env.RELEASES.put(key, 'x');
  const r = await adminRel.onRequestPost({ request: req('/api/admin/releases', { method: 'POST', headers: { Authorization: `Bearer ${env.RELEASE_TOKEN}` }, body: { platform: 'windows', channel, version, key, sha256: 'a'.repeat(64) } }), env }); assert.equal(r.status, 200); };
await t('las PC de la cuenta administradora ven primero las betas; las de clientes y las desconocidas, solo las estables', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); addUser(env, 'admin@x.com', 'sa'); addUser(env, 'demo@x.com', 'sd', 1);
  await publicar(env, '1.0.0.2098', 'stable'); await publicar(env, '1.0.0.2099', 'beta');
  const tokAna = await vincular(env, 'ana@x.com', 's1', { deviceId: 'pc-de-ana-0123456789abcdef' });
  const tokAdmin = await vincular(env, 'admin@x.com', 'sa', { deviceId: 'pc-del-admin-0123456789abcd' });
  const tokDemo = await vincular(env, 'demo@x.com', 'sd', { deviceId: 'pc-de-demo-0123456789abcde' });
  await doPing(env, tokAna, { cid: 'cid-ana-00000001' }); await doPing(env, tokAdmin, { cid: 'cid-admin-0000001' }); await doPing(env, tokDemo, { cid: 'cid-demo-00000001' });
  const ver = async (cid) => (await (await latest.onRequestGet({ request: req(`/api/update/latest.json?platform=windows&version=1.0.0.2097${cid ? '&cid=' + cid : ''}`), env })).json()).version;
  assert.equal(await ver('cid-admin-0000001'), '1.0.0.2099'); assert.equal(await ver('cid-demo-00000001'), '1.0.0.2099'); // eximida = de pruebas
  assert.equal(await ver('cid-ana-00000001'), '1.0.0.2098'); assert.equal(await ver('cid-que-no-existe'), '1.0.0.2098'); assert.equal(await ver(), '1.0.0.2098');
  const feed = async (cid) => (await (await appcast.onRequestGet({ request: req(`/api/update/appcast.xml?platform=windows&cid=${cid}`), env })).text());
  assert.match(await feed('cid-admin-0000001'), /<sparkle:version>1\.0\.0\.2099</); assert.match(await feed('cid-ana-00000001'), /<sparkle:version>1\.0\.0\.2098</);
  // la PC del administrador desvinculada deja de ser de pruebas
  env.DB.raw.prepare('UPDATE devices SET revoked=1 WHERE id=?').run('pc-del-admin-0123456789abcd');
  assert.equal(await ver('cid-admin-0000001'), '1.0.0.2098');
});

// --- volver a /vincular/ después de ingresar con Google
await t('login: solo se vuelve a /vincular/ (lista blanca), nunca a una URL de afuera', async () => {
  const env = { ...mkEnv(), GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'gs' };
  const idt = (nonce) => 'h.' + Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'cid', exp: nowS() + 99, nonce, email_verified: true, email: 'ana@x.com', sub: 's1', name: 'Ana', given_name: 'Ana' })).toString('base64url') + '.s';
  const ir = async (next) => {
    const r0 = await google.onRequestGet({ request: req('/api/auth/google' + (next === undefined ? '' : '?next=' + encodeURIComponent(next))), env });
    const u = new URL(r0.headers.get('Location')); const flow = r0.headers.getSetCookie().find((c) => c.startsWith('ns_oauth')).split(';')[0].split('=').slice(1).join('=');
    globalThis.fetch = async () => new Response(JSON.stringify({ id_token: idt(u.searchParams.get('nonce')) }), { status: 200 });
    return (await callback.onRequestGet({ request: req(`/api/auth/callback?code=c&state=${u.searchParams.get('state')}`, { headers: { Cookie: `ns_oauth=${flow}` } }), env })).headers.get('Location');
  };
  const buena = `/vincular/?port=53682&state=${STATE}&challenge=${'a'.repeat(43)}&device=${DID}&name=La%20PC`;
  assert.equal(await ir(buena), `https://horsepos.com${buena}`);
  for (const mala of ['https://evil.com', '//evil.com', '/cuenta/', '/vincular/?x=<script>', '/vincular/', '/vincular/?a=b\\c', '/vincular/?' + 'a'.repeat(700)]) assert.equal(await ir(mala), 'https://horsepos.com/cuenta/', mala);
  assert.equal(await ir(), 'https://horsepos.com/cuenta/');
});

console.log(`\n${pass} pruebas OK (dispositivos)`);

import assert from 'node:assert/strict';
import { ensureOrgTables, createOrg } from '../functions/_lib/orgs.js';
import { getDevice } from '../functions/_lib/devices.js';
import * as google from '../functions/api/device/google.js';
import { mkEnv, req, nowS } from './helpers-nube.mjs';

// Entrar en el celular con Google desde la app, sin navegador (2026-10-13).
let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const CLIENT = 'web-client.apps.googleusercontent.com';
const DID = 'android-celular-0123456789abcdef';
const claimsDe = (sub, email, extra = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT, sub, email, email_verified: 'true', name: email.split('@')[0], exp: String(nowS() + 600), ...extra });
let pedidos = [];
// Google contesta por cada id_token lo que le diga el test; un token desconocido es inválido (400).
const mockGoogle = (tokens) => { pedidos = []; globalThis.fetch = async (url) => {
  const u = new URL(url); pedidos.push(u);
  assert.equal(u.origin + u.pathname, 'https://oauth2.googleapis.com/tokeninfo');
  const c = tokens[u.searchParams.get('id_token')];
  return c ? new Response(JSON.stringify(c), { status: 200 }) : new Response('{"error":"invalid_token"}', { status: 400 });
}; };
const entrar = (env, body) => google.onRequestPost({ request: req('/api/device/google', { method: 'POST', body: { deviceId: DID, name: 'Celular (Android)', ...body } }), env });
const conMiembro = async (env, org, sub, email, sucursales) => {
  const m = env.DB.raw.prepare("INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,?,0,?)").run(org.id, sub, email, 'employee', 'active', nowS());
  for (const b of sucursales) env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(m.lastInsertRowid, b);
};
const sucursal = (env, org, name) => Number(env.DB.raw.prepare('INSERT INTO branches (org_id, name, active, created_at) VALUES (?,?,1,?)').run(org.id, name, nowS()).lastInsertRowid);

await t('token de Google válido: devuelve el token del celular y lo registra como celular, con el mismo negocio que por el navegador', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env);
  mockGoogle({ bueno: claimsDe('s1', 'Ana@X.com') });
  const r = await entrar(env, { idToken: 'bueno' }); assert.equal(r.status, 200);
  const j = await r.json(); assert.ok(j.token); assert.equal(j.email, 'ana@x.com'); assert.equal(j.deviceId, DID);
  const d = await getDevice(env, DID); assert.equal(d.kind, 'celular'); assert.equal(d.owner_sub, 's1'); assert.ok(d.owner_org, 'quien no tenía negocio recibe el suyo');
});
await t('Google dice que no, el aud es de otra app, el mail no está verificado o venció: 401', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env);
  mockGoogle({ otraApp: claimsDe('s1', 'a@x.com', { aud: 'otra.apps.googleusercontent.com' }), sinVerificar: claimsDe('s1', 'a@x.com', { email_verified: 'false' }),
    vencido: claimsDe('s1', 'a@x.com', { exp: String(nowS() - 1) }), otroIss: claimsDe('s1', 'a@x.com', { iss: 'https://evil.com' }) });
  for (const tok of ['inventado', 'otraApp', 'sinVerificar', 'vencido', 'otroIss']) assert.equal((await entrar(env, { idToken: tok })).status, 401, tok);
  assert.equal(await getDevice(env, DID), null);
});
await t('datos inválidos: 400 sin preguntarle a Google; sin GOOGLE_CLIENT_ID: 503', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); mockGoogle({});
  assert.equal((await entrar(env, { idToken: 123 })).status, 400);
  assert.equal((await entrar(env, { idToken: 'x', deviceId: 'corto' })).status, 400);
  assert.equal(pedidos.length, 0);
  assert.equal((await entrar(mkEnv(), { idToken: 'x' })).status, 503);
});
await t('con dos sucursales posibles pide elegir; eligiendo, queda en la elegida', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env);
  const { org, branch } = await createOrg(env, { sub: 'duenia', email: 'd@x.com', name: 'Dueña', orgName: 'La Plazoleta' });
  const centro = sucursal(env, org, 'Centro');
  await conMiembro(env, org, 's2', 'beto@x.com', [branch.id, centro]);
  mockGoogle({ beto: claimsDe('s2', 'beto@x.com') });
  const r = await (await entrar(env, { idToken: 'beto' })).json();
  assert.equal(r.elegir, true); assert.equal(r.orgs.length, 1); assert.deepEqual(r.orgs[0].branches.map((b) => b.name).sort(), ['Centro', 'Sucursal principal']);
  assert.equal(await getDevice(env, DID), null, 'todavía no se vinculó nada');
  const ok = await entrar(env, { idToken: 'beto', orgId: org.id, branchId: centro }); assert.equal(ok.status, 200);
  assert.equal((await getDevice(env, DID)).branch_id, centro);
});
await t('no puede elegir una sucursal donde no trabaja, ni un negocio ajeno', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env);
  const { org, branch } = await createOrg(env, { sub: 'duenia', email: 'd@x.com', name: 'Dueña' });
  const centro = sucursal(env, org, 'Centro');
  const otro = await createOrg(env, { sub: 'otra', email: 'o@x.com', name: 'Otra' });
  await conMiembro(env, org, 's2', 'beto@x.com', [branch.id]);
  mockGoogle({ beto: claimsDe('s2', 'beto@x.com') });
  assert.equal((await entrar(env, { idToken: 'beto', orgId: org.id, branchId: centro })).status, 403);
  assert.equal((await entrar(env, { idToken: 'beto', orgId: otro.org.id, branchId: otro.branch.id })).status, 403);
  // Con una sola sucursal posible entra directo, sin elegir.
  const j = await (await entrar(env, { idToken: 'beto' })).json(); assert.ok(j.token); assert.equal((await getDevice(env, DID)).branch_id, branch.id);
});
await t('miembro de un negocio pero sin sucursal asignada: sin_sucursal (no se le crea un negocio propio)', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env);
  const { org } = await createOrg(env, { sub: 'duenia', email: 'd@x.com', name: 'Dueña' });
  await conMiembro(env, org, 's2', 'beto@x.com', []);
  mockGoogle({ beto: claimsDe('s2', 'beto@x.com') });
  const r = await entrar(env, { idToken: 'beto' }); assert.equal(r.status, 403); assert.equal((await r.json()).error, 'sin_sucursal');
});
await t('un celular ya vinculado por otra persona de otro negocio no se pisa (device_ajeno)', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: CLIENT }); await ensureOrgTables(env);
  mockGoogle({ ana: claimsDe('s1', 'ana@x.com'), beto: claimsDe('s2', 'beto@x.com') });
  assert.equal((await entrar(env, { idToken: 'ana' })).status, 200);
  const r = await entrar(env, { idToken: 'beto' }); assert.equal(r.status, 409); assert.equal((await r.json()).error, 'device_ajeno');
  assert.equal((await entrar(env, { idToken: 'ana' })).status, 200, 'la misma persona vuelve a entrar sin problema');
});

console.log(`\n${pass} pruebas OK (celular con Google)`);

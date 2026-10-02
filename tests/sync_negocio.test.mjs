// La sync por la nube (rama quirky-noether) ahora es por NEGOCIO y SUCURSAL, no por persona: la PC y el celular de una misma
// sucursal se ven; otra sucursal del mismo dueño, o otro negocio, no. Y sigue las reglas de cobro y de membresía.
import assert from 'node:assert/strict';
import { createOrg, ensureOrgTables, adoptarLegado } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import { sha256Hex } from '../functions/_lib/backups.js';
import { RETENCION_DIAS, purgarViejos, scopeDeSync } from '../functions/_lib/sync.js';
import * as sync from '../functions/api/sync.js';
import worker from '../worker.js';
import { mkEnv, addUser, req, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const enc = (s) => new TextEncoder().encode(s);
const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const bearer = (tok) => ({ Authorization: `Bearer ${tok}` });
const one = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a);
const paga = (...emails) => { mp.subs = emails.map((e) => mpSub(e, 'authorized', 1)); mp.fail = false; mockMP(); };
let n = 0;
async function negocio(env, duena = ['duena@x.com', 'sd']) {
  await ensureOrgTables(env); if (!one(env, 'SELECT 1 x FROM users WHERE sub = ?', duena[1])) addUser(env, duena[0], duena[1]);
  const r = await createOrg(env, { sub: duena[1], email: duena[0], name: 'Dueña' });
  const b2 = env.DB.raw.prepare("INSERT INTO branches (org_id, name, active, created_at) VALUES (?, 'Centro', 1, ?)").run(r.org.id, nowS());
  return { org: r.org, a: r.branch.id, b: Number(b2.lastInsertRowid), dueno: duena };
}
// un dispositivo del negocio, en una sucursal, vinculado por `quien` (por defecto la dueña)
async function disp(env, nego, branch, quien = nego.dueno, nombre = 'pc') {
  const id = `${nombre}-${++n}-0123456789abcdefghij`;
  await upsertDevice(env, { id, sub: quien[1], email: quien[0], name: nombre, orgId: nego.org.id, branchId: branch });
  return signDeviceToken(env, { sub: quien[1], email: quien[0], deviceId: id });
}
async function subir(env, tok, texto, loteId, extra = {}) {
  const bytes = enc(texto);
  return sync.onRequestPost({ request: req('/api/sync', { method: 'POST', raw: bytes, headers: { ...bearer(tok), 'X-Lote-Id': loteId, 'X-Sha256': await sha256Hex(bytes), ...extra } }), env });
}
const bajar = (env, tok, qs = 'desde=0', extra = {}) => sync.onRequestGet({ request: req(`/api/sync?${qs}`, { headers: { ...bearer(tok), ...extra } }), env });
const textos = async (r) => (await r.json()).lotes.map((l) => dec(l.datos));

await t('la PC y el celular de una misma sucursal se ven entre sí', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com'); const pc = await disp(env, g, g.a, g.dueno, 'pc'), cel = await disp(env, g, g.a, g.dueno, 'cel');
  assert.equal((await subir(env, pc, 'venta de la PC', 'lote-1001-aaaa')).status, 200);
  assert.deepEqual(await textos(await bajar(env, cel)), ['venta de la PC']);
  assert.deepEqual(await textos(await bajar(env, pc)), [], 'y la PC no recibe lo suyo');
});
await t('otra sucursal del MISMO dueño no ve nada (ni ella ve lo de la primera)', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com');
  const pcA = await disp(env, g, g.a, g.dueno, 'pcA'), pcB = await disp(env, g, g.b, g.dueno, 'pcB'), celB = await disp(env, g, g.b, g.dueno, 'celB');
  await subir(env, pcA, 'caja de la principal', 'lote-1002-aaaa'); await subir(env, pcB, 'caja del centro', 'lote-1002-bbbb');
  assert.deepEqual(await textos(await bajar(env, celB)), ['caja del centro'], 'el celular del Centro solo ve lo del Centro');
  const pcA2 = await disp(env, g, g.a, g.dueno, 'celA'); assert.deepEqual(await textos(await bajar(env, pcA2)), ['caja de la principal']);
});
await t('otro negocio no ve nada, aunque pague y aunque el seq sea un número cercano', async () => {
  const env = mkEnv(); const g = await negocio(env); const h = await negocio(env, ['otra@x.com', 'so']); paga('duena@x.com', 'otra@x.com');
  const a = await disp(env, g, g.a, g.dueno, 'a'), b = await disp(env, h, h.a, h.dueno, 'b');
  await subir(env, a, 'secreto del negocio A', 'lote-1003-aaaa');
  assert.deepEqual(await textos(await bajar(env, b)), []); assert.deepEqual(await textos(await bajar(env, b, 'desde=0&otro=1')), []);
});
await t('el alcance sale SIEMPRE del dispositivo autenticado: ni un parámetro ni una cabecera lo cambian', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com'); const pcA = await disp(env, g, g.a, g.dueno, 'pcA'), celB = await disp(env, g, g.b, g.dueno, 'celB');
  await subir(env, pcA, 'de la principal', 'lote-1004-aaaa');
  const truco = [`desde=0&scope=n${g.org.id}:${g.a}`, `desde=0&branch=${g.a}&branch_id=${g.a}&org=${g.org.id}&sucursal=${g.a}`];
  for (const qs of truco) assert.deepEqual(await textos(await bajar(env, celB, qs, { 'X-Scope': `n${g.org.id}:${g.a}`, 'X-Branch': String(g.a), 'X-Org': String(g.org.id) })), [], qs);
  // y al subir: el lote cae en la sucursal del dispositivo, aunque pida otra
  await subir(env, celB, 'del centro', 'lote-1004-bbbb', { 'X-Scope': `n${g.org.id}:${g.a}`, 'X-Branch': String(g.a) });
  assert.equal(one(env, 'SELECT scope s FROM sync_lotes WHERE lote_id = ?', 'lote-1004-bbbb').s, `n${g.org.id}:${g.b}`);
});
await t('un dispositivo anterior al modelo de negocios sigue atado a la persona, y al adoptarlo pasa a la sucursal y se ve con los demás', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com');
  const idViejo = 'vieja-0123456789abcdefghijk'; await upsertDevice(env, { id: idViejo, sub: 'sd', email: 'duena@x.com', name: 'PC vieja' }); // sin negocio
  const viejo = await signDeviceToken(env, { sub: 'sd', email: 'duena@x.com', deviceId: idViejo }); const cel = await disp(env, g, g.a, g.dueno, 'cel');
  await subir(env, viejo, 'desde la PC vieja', 'lote-1005-aaaa'); assert.equal(one(env, 'SELECT scope s FROM sync_lotes').s, 'p:sd');
  assert.deepEqual(await textos(await bajar(env, cel)), [], 'todavía en alcances distintos');
  assert.equal(await adoptarLegado(env, 'sd', g.org.id, g.a), 1, 'la PC vieja pasa a la sucursal principal');
  await subir(env, viejo, 'ya adoptada', 'lote-1005-bbbb'); assert.deepEqual(await textos(await bajar(env, cel)), ['ya adoptada']);
});
await t('lo paga el NEGOCIO: con el mail de cobro vigente sube; sin él no, aunque quien vinculó pague por su cuenta', async () => {
  const env = mkEnv(); const g = await negocio(env); env.DB.raw.prepare('UPDATE orgs SET billing_email = ? WHERE id = ?').run('quien-paga@x.com', g.org.id);
  const pc = await disp(env, g, g.a, g.dueno, 'pc');
  paga('quien-paga@x.com'); assert.equal((await subir(env, pc, 'x', 'lote-1006-aaaa')).status, 200);
  paga('duena@x.com'); assert.equal((await subir(env, pc, 'y', 'lote-1006-bbbb')).status, 403, 'la suscripción personal de quien vinculó no cubre al negocio');
  mp.subs = []; mockMP(); assert.equal((await bajar(env, pc)).status, 403);
});
await t('si quien vinculó el dispositivo deja el negocio, el dispositivo deja de sincronizar (subir, bajar y escuchar)', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com');
  const enc2 = ['enc@x.com', 'se']; addUser(env, ...enc2);
  env.DB.raw.prepare("INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,'active',1,?)").run(g.org.id, 'se', 'enc@x.com', 'manager', nowS());
  const dEnc = await disp(env, g, g.a, enc2, 'del-encargado');
  assert.equal((await subir(env, dEnc, 'a', 'lote-1007-aaaa')).status, 200, 'un encargado activo sincroniza');
  env.DB.raw.prepare("UPDATE memberships SET status = 'removed' WHERE user_sub = 'se'").run();
  assert.equal((await subir(env, dEnc, 'b', 'lote-1007-bbbb')).status, 401); assert.equal((await bajar(env, dEnc)).status, 401);
  env.SYNC_HUB = { idFromName: (x) => x, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) };
  assert.equal((await sync.onRequestEscuchar({ request: req('/api/sync/escuchar', { headers: { Upgrade: 'websocket', ...bearer(dEnc) } }), env })).status, 401);
});
await t('el aviso en vivo va a un hub por sucursal, sin datos en claro en el nombre', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com'); const avisos = [];
  env.SYNC_HUB = { idFromName: (x) => x, get: (id) => ({ fetch: async () => { avisos.push(id); return new Response(null, { status: 204 }); } }) };
  await subir(env, await disp(env, g, g.a, g.dueno, 'a'), 'x', 'lote-1008-aaaa'); await subir(env, await disp(env, g, g.b, g.dueno, 'b'), 'y', 'lote-1008-bbbb');
  assert.equal(avisos.length, 2); assert.notEqual(avisos[0], avisos[1], 'una sucursal no avisa a la otra');
  for (const id of avisos) { assert.match(id, /^cuenta:[0-9a-f]{32}$/); assert.ok(!id.includes('sd') && !id.includes(String(g.org.id) + ':'), 'nada en claro'); }
});
await t('la retención purga por sucursal: lo viejo de una no toca a la otra', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com'); const pcA = await disp(env, g, g.a, g.dueno, 'a'), pcB = await disp(env, g, g.b, g.dueno, 'b');
  await subir(env, pcA, 'viejo A', 'lote-1009-aaaa'); await subir(env, pcB, 'viejo B', 'lote-1009-bbbb');
  env.SYNC_TOPE_BYTES = 0; env.DB.raw.prepare('UPDATE sync_lotes SET created_at = ?').run(nowS() - (RETENCION_DIAS + 1) * 86400);
  await purgarViejos(env, `n${g.org.id}:${g.a}`);
  assert.equal(one(env, 'SELECT COUNT(*) c FROM sync_lotes').c, 1); assert.equal(one(env, 'SELECT scope s FROM sync_lotes').s, `n${g.org.id}:${g.b}`, 'queda el de la otra sucursal');
});
await t('scopeDeSync: negocio y sucursal si los tiene, persona si no; y no depende de nada que mande el cliente', async () => {
  assert.equal(scopeDeSync({ sub: 's1', device: { owner_org: 3, branch_id: 9 } }), 'n3:9'); assert.equal(scopeDeSync({ sub: 's1', device: {} }), 'p:s1');
  assert.equal(scopeDeSync({ sub: 's1', device: { owner_org: 3, branch_id: null } }), 'n3:0');
});
await t('rutas del Worker: /api/sync exige dispositivo, /api/sync/escuchar exige websocket, y la clase del hub se exporta', async () => {
  const w = (path, method = 'GET', h = {}) => worker.fetch(new Request('https://horsepos.com' + path, { method, headers: h }), mkEnv(), { waitUntil() {} });
  assert.equal((await w('/api/sync')).status, 401); assert.equal((await w('/api/sync', 'POST')).status, 401);
  assert.equal((await w('/api/sync/escuchar')).status, 426); assert.equal((await w('/api/sync', 'DELETE')).status, 405);
  assert.equal(typeof (await import('../worker.js')).SyncHub, 'function');
});
console.log(`\n${pass} pruebas OK (sync por negocio y sucursal)`);

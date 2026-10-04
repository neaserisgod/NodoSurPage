// Conectar el celular con la PC del local con un toque: la PC vinculada avisa dónde está en el wifi y un celular de la
// MISMA sucursal lo pide. Otra sucursal, otro negocio o alguien quitado no reciben nada; la llave se guarda cifrada.
import assert from 'node:assert/strict';
import { createOrg, ensureOrgTables } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import { ipLocalValida, VIGENCIA_PC_LOCAL } from '../functions/_lib/pc_local.js';
import * as pcLocal from '../functions/api/device/pc_local.js';
import { mkEnv, addUser, req, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const one = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a);
const bearer = (tok) => ({ Authorization: `Bearer ${tok}` });
const paga = (...emails) => { mp.subs = emails.map((e) => mpSub(e, 'authorized', 1)); mp.fail = false; mockMP(); };
let n = 0;
async function negocio(env) {
  await ensureOrgTables(env); addUser(env, 'duena@x.com', 'sd');
  const r = await createOrg(env, { sub: 'sd', email: 'duena@x.com', name: 'Dueña' });
  const b2 = env.DB.raw.prepare("INSERT INTO branches (org_id, name, active, created_at) VALUES (?, 'Centro', 1, ?)").run(r.org.id, nowS());
  return { org: r.org, a: r.branch.id, b: Number(b2.lastInsertRowid) };
}
async function disp(env, g, branch, quien = ['duena@x.com', 'sd'], nombre = 'pc', kind) {
  const id = `${nombre}-${++n}-0123456789abcdefghij`;
  await upsertDevice(env, { id, sub: quien[1], email: quien[0], name: nombre, orgId: g.org.id, branchId: branch, kind });
  return signDeviceToken(env, { sub: quien[1], email: quien[0], deviceId: id });
}
const publicar = (env, tok, body) => pcLocal.onRequestPost({ request: req('/api/device/pc-local', { method: 'POST', headers: bearer(tok), body }), env });
const pedir = (env, tok) => pcLocal.onRequestGet({ request: req('/api/device/pc-local', { headers: bearer(tok) }), env });
const DATOS = { ip: '192.168.0.23', puerto: 8099, token: 'AbCdEfGhIjKlMnOpQrStUvWxYz012345' };

await t('la PC avisa dónde está y un celular de la misma sucursal lo recibe, con la llave', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com');
  const pc = await disp(env, g, g.a, undefined, 'DESKTOP-LOCAL'), cel = await disp(env, g, g.a, undefined, 'cel');
  assert.equal((await pedir(env, cel)).status, 404, 'todavía no avisó ninguna PC');
  assert.equal((await publicar(env, pc, DATOS)).status, 200);
  const j = await (await pedir(env, cel)).json();
  assert.deepEqual({ ip: j.ip, puerto: j.puerto, token: j.token, nombre: j.nombre }, { ...DATOS, nombre: 'DESKTOP-LOCAL' });
  assert.ok(!one(env, 'SELECT token_enc FROM pc_local').token_enc.includes(DATOS.token), 'la llave se guarda cifrada');
  assert.equal((await publicar(env, pc, { ...DATOS, ip: '192.168.0.40' })).status, 200);
  assert.equal((await (await pedir(env, cel)).json()).ip, '192.168.0.40', 'si cambia de dirección, se actualiza');
});

await t('otra sucursal, un empleado quitado o sin dispositivo no reciben nada', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com');
  addUser(env, 'emp@x.com', 'sm');
  const mm = env.DB.raw.prepare("INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,'employee','active',0,?)").run(g.org.id, 'sm', 'emp@x.com', nowS());
  env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(mm.lastInsertRowid, g.a);
  const pc = await disp(env, g, g.a), otra = await disp(env, g, g.b, undefined, 'otra'), emp = await disp(env, g, g.a, ['emp@x.com', 'sm'], 'emp');
  await publicar(env, pc, DATOS);
  assert.equal((await pedir(env, otra)).status, 404, 'la PC de una sucursal no se ofrece en otra');
  assert.equal((await pedir(env, emp)).status, 200, 'el celular de un empleado de esa sucursal sí');
  env.DB.raw.prepare("UPDATE memberships SET status = 'removed' WHERE user_sub = 'sm'").run();
  assert.notEqual((await pedir(env, emp)).status, 200, 'quitado del negocio: nada');
  assert.equal((await pcLocal.onRequestGet({ request: req('/api/device/pc-local'), env })).status, 401);
});

await t('solo direcciones del wifi local y datos bien formados; una PC vieja deja de ofrecerse', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com');
  const pc = await disp(env, g, g.a), cel = await disp(env, g, g.a, undefined, 'cel');
  for (const malo of [{ ...DATOS, ip: '8.8.8.8' }, { ...DATOS, ip: '192.168.0.300' }, { ...DATOS, puerto: 0 }, { ...DATOS, token: 'corto' }, { ...DATOS, token: 'con espacios y cosas raras!!' }]) {
    assert.equal((await publicar(env, pc, malo)).status, 400, JSON.stringify(malo));
  }
  assert.ok(ipLocalValida('10.0.0.5') && ipLocalValida('172.20.1.1') && !ipLocalValida('172.32.0.1'));
  await publicar(env, pc, DATOS);
  env.DB.raw.prepare('UPDATE pc_local SET actualizado = ?').run(nowS() - VIGENCIA_PC_LOCAL - 10);
  assert.equal((await pedir(env, cel)).status, 404);
});
await t('solo una PC publica su dirección: un celular no puede hacerse pasar por ella', async () => {
  const env = mkEnv(); const g = await negocio(env); paga('duena@x.com');
  addUser(env, 'emp@x.com', 'sm');
  const mm = env.DB.raw.prepare("INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,'employee','active',0,?)").run(g.org.id, 'sm', 'emp@x.com', nowS());
  env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(mm.lastInsertRowid, g.a);
  const celEmpleado = await disp(env, g, g.a, ['emp@x.com', 'sm'], 'cel-emp', 'celular');
  const celEmpleadoViejo = await disp(env, g, g.a, ['emp@x.com', 'sm'], 'cel-emp-viejo'); // vinculado antes de guardar el tipo
  const celDuena = await disp(env, g, g.a, undefined, 'cel-duena', 'celular');
  const pc = await disp(env, g, g.a, undefined, 'PC-LOCAL', 'pc');
  for (const tok of [celEmpleado, celEmpleadoViejo, celDuena]) assert.equal((await publicar(env, tok, DATOS)).status, 403);
  assert.equal((await pedir(env, celEmpleado)).status, 404, 'nada quedó publicado');
  assert.equal((await publicar(env, pc, DATOS)).status, 200);
  assert.equal((await (await pedir(env, celEmpleado)).json()).nombre, 'PC-LOCAL');
});
console.log(`\n${pass} pruebas OK (PC del local)`);

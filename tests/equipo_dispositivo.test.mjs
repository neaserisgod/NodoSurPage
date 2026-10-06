// /api/device/team: la PC lee su sucursal y (si la vinculó el dueño) el equipo del negocio. Solo lectura, con el token de dispositivo.
import assert from 'node:assert/strict';
import { createOrg, ensureOrgTables } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import * as team from '../functions/api/device/team.js';
import { mkEnv, addUser, sess, req, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const bearer = (tok) => ({ Authorization: `Bearer ${tok}` });

async function negocio(env) {
  await ensureOrgTables(env); addUser(env, 'duena@x.com', 'sd');
  const r = await createOrg(env, { sub: 'sd', email: 'duena@x.com', name: 'Dueña', orgName: 'La Plazoleta' });
  const b2 = env.DB.raw.prepare("INSERT INTO branches (org_id, name, active, created_at) VALUES (?, 'Centro', 1, ?)").run(r.org.id, nowS());
  return { org: r.org, a: r.branch.id, b: Number(b2.lastInsertRowid) };
}
function miembro(env, n, email, sub, role, { all = 0, branches = [], status = 'active' } = {}) {
  addUser(env, email, sub);
  const m = env.DB.raw.prepare('INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,?,?,?)').run(n.org.id, sub, email, role, status, all, nowS());
  for (const b of branches) env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(m.lastInsertRowid, b);
}
async function pc(env, n, branch, sub, email, id) {
  await upsertDevice(env, { id, sub, email, name: 'PC', orgId: n.org.id, branchId: branch });
  return signDeviceToken(env, { sub, email, deviceId: id });
}
const pedir = (env, tok) => team.onRequestGet({ request: req('/api/device/team', { headers: tok ? bearer(tok) : {} }), env });
const ID = (c) => `pc-${c}-0123456789abcdefghij`;

await t('la PC de la dueña ve su sucursal y todo el equipo con rol y sucursales', async () => {
  const env = mkEnv(); const n = await negocio(env);
  miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 }); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.b] });
  const tok = await pc(env, n, n.b, 'sd', 'duena@x.com', ID('a'));
  const j = await (await pedir(env, tok)).json();
  assert.deepEqual(j.org, { id: n.org.id, name: 'La Plazoleta' });
  assert.deepEqual(j.branch, { id: n.b, name: 'Centro' });
  assert.equal(j.role, 'owner');
  assert.deepEqual(j.members.map((m) => [m.email, m.role, m.allBranches, m.branches]), [
    ['duena@x.com', 'owner', true, []],
    ['enc@x.com', 'manager', true, []],
    ['emp@x.com', 'employee', false, ['Centro']],
  ]);
});
await t('un miembro quitado no aparece, y la invitación pendiente tampoco', async () => {
  const env = mkEnv(); const n = await negocio(env);
  miembro(env, n, 'fuera@x.com', 'sf', 'manager', { all: 1, status: 'removed' });
  const tok = await pc(env, n, n.a, 'sd', 'duena@x.com', ID('a'));
  const j = await (await pedir(env, tok)).json();
  assert.deepEqual(j.members.map((m) => m.email), ['duena@x.com']);
});
await t('un encargado ve su sucursal pero NO la lista del equipo', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'enc@x.com', 'se', 'manager', { branches: [n.a] });
  const tok = await pc(env, n, n.a, 'se', 'enc@x.com', ID('e'));
  const j = await (await pedir(env, tok)).json();
  assert.equal(j.role, 'manager'); assert.equal(j.members, null); assert.equal(j.branch.name, 'Sucursal principal');
});
await t('sin token de dispositivo, con token roto o con la sesión web: 401', async () => {
  const env = mkEnv(); await negocio(env);
  assert.equal((await pedir(env, null)).status, 401);
  assert.equal((await pedir(env, 'basura')).status, 401);
  assert.equal((await team.onRequestGet({ request: req('/api/device/team', { cookie: await sess(env, 'duena@x.com', 'sd') }), env })).status, 401, 'es solo para la PC');
});
await t('quitada del negocio, la PC deja de valer', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 });
  const tok = await pc(env, n, n.a, 'se', 'enc@x.com', ID('e'));
  env.DB.raw.prepare("UPDATE memberships SET status = 'removed' WHERE user_sub = 'se'").run();
  assert.equal((await pedir(env, tok)).status, 401);
});
console.log(`\n${pass} pruebas OK (equipo desde la PC)`);

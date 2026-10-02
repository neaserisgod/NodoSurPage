import assert from 'node:assert/strict';
import { ensureOrgTables, createOrg, ensurePersonalOrg, getMembership, listOrgsForSub, listBranches, backfillOrgs } from '../functions/_lib/orgs.js';
import { ensureDeviceTables } from '../functions/_lib/devices.js';
import { ensureBackupTables } from '../functions/_lib/backups.js';
import { mkEnv, addUser, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const q = (env, sql, ...a) => env.DB.raw.prepare(sql).all(...a);
const one = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a);
const addDevice = (env, id, sub, email) => env.DB.raw.prepare(
  'INSERT INTO devices (id, owner_sub, owner_email, name, created_at, last_seen) VALUES (?,?,?,?,?,?)').run(id, sub, email, 'PC', nowS(), nowS());
const addBackup = (env, sub, email, key) => env.DB.raw.prepare(
  'INSERT INTO backups (owner_sub, owner_email, file_key, size, sha256, created_at) VALUES (?,?,?,?,?,?)').run(sub, email, key, 10, 'h', nowS());

await t('ensureOrgTables se puede correr dos veces y deja las columnas nuevas en devices y backups', async () => {
  const env = mkEnv();
  await ensureOrgTables(env); await ensureOrgTables(env);
  const cols = (tabla) => q(env, `PRAGMA table_info(${tabla})`).map((c) => c.name);
  for (const tabla of ['devices', 'backups']) { assert.ok(cols(tabla).includes('owner_org'), tabla); assert.ok(cols(tabla).includes('branch_id'), tabla); }
});
await t('createOrg crea el negocio, su "Sucursal principal" y la membresía de dueño con todas las sucursales', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  const { org, branch, membership } = await createOrg(env, { sub: 's1', email: 'Dueña@X.com', name: 'Ana', orgName: 'La Plazoleta' }, nowS());
  assert.equal(org.name, 'La Plazoleta'); assert.equal(org.owner_sub, 's1');
  assert.equal(org.billing_email, 'dueña@x.com', 'el mail de cobro queda aparte del dueño y en minúsculas');
  assert.equal(branch.name, 'Sucursal principal'); assert.equal(branch.org_id, org.id);
  assert.equal(membership.role, 'owner'); assert.equal(membership.all_branches, 1); assert.equal(membership.status, 'active');
});
await t('ensurePersonalOrg es idempotente: la segunda vez devuelve el mismo negocio', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  const a = await ensurePersonalOrg(env, { sub: 's1', email: 'a@x.com', name: 'Ana' });
  const b = await ensurePersonalOrg(env, { sub: 's1', email: 'a@x.com', name: 'Ana' });
  assert.equal(a.org.id, b.org.id);
  assert.equal(q(env, 'SELECT * FROM orgs').length, 1); assert.equal(q(env, 'SELECT * FROM branches').length, 1);
});
await t('una persona no puede tener dos membresías en el mismo negocio (UNIQUE org+persona)', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  const { org } = await createOrg(env, { sub: 's1', email: 'a@x.com', name: 'Ana' });
  assert.throws(() => env.DB.raw.prepare(
    "INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,?,?,?)").run(org.id, 's1', 'a@x.com', 'employee', 'active', 0, nowS()), /UNIQUE/i);
});
await t('listOrgsForSub devuelve solo membresías activas, y getMembership trae la lista de sucursales', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  const a = await createOrg(env, { sub: 's1', email: 'a@x.com', name: 'Ana', orgName: 'A' });
  const b = await createOrg(env, { sub: 's2', email: 'b@x.com', name: 'Beto', orgName: 'B' });
  const suc2 = env.DB.raw.prepare('INSERT INTO branches (org_id, name, active, created_at) VALUES (?,?,1,?)').run(b.org.id, 'Centro', nowS());
  const mem = env.DB.raw.prepare("INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,?,0,?)").run(b.org.id, 's1', 'a@x.com', 'employee', 'active', nowS());
  env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(mem.lastInsertRowid, suc2.lastInsertRowid);
  assert.deepEqual((await listOrgsForSub(env, 's1')).map((o) => o.name).sort(), ['A', 'B']);
  const m = await getMembership(env, b.org.id, 's1');
  assert.equal(m.role, 'employee'); assert.deepEqual(m.branches, [Number(suc2.lastInsertRowid)]);
  env.DB.raw.prepare("UPDATE memberships SET status = 'removed' WHERE id = ?").run(mem.lastInsertRowid);
  assert.deepEqual((await listOrgsForSub(env, 's1')).map((o) => o.name), ['A'], 'quitado: ya no figura');
  assert.equal((await listBranches(env, b.org.id)).length, 2);
});
await t('backfill: cada dueño con dispositivos o copias recibe su negocio y todo cuelga de la sucursal principal', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1');
  await ensureDeviceTables(env); await ensureBackupTables(env); await ensureOrgTables(env);
  addDevice(env, 'dev-1', 's1', 'ana@x.com'); addDevice(env, 'dev-2', 's1', 'ana@x.com'); addBackup(env, 's1', 'ana@x.com', 'cuentas/h/1');
  const r = await backfillOrgs(env);
  assert.equal(r.orgsCreadas, 1);
  const org = one(env, 'SELECT * FROM orgs'); const suc = one(env, 'SELECT * FROM branches WHERE org_id = ?', org.id);
  for (const d of q(env, 'SELECT * FROM devices')) { assert.equal(d.owner_org, org.id); assert.equal(d.branch_id, suc.id); }
  assert.equal(one(env, 'SELECT * FROM backups').branch_id, suc.id);
});
await t('backfill es idempotente y no toca lo que ya tiene negocio', async () => {
  const env = mkEnv(); await ensureDeviceTables(env); await ensureBackupTables(env); await ensureOrgTables(env);
  addDevice(env, 'dev-1', 's1', 'ana@x.com');
  await backfillOrgs(env); const antes = JSON.stringify(q(env, 'SELECT * FROM devices'));
  const r2 = await backfillOrgs(env);
  assert.equal(r2.orgsCreadas, 0); assert.equal(r2.filasActualizadas, 0);
  assert.equal(JSON.stringify(q(env, 'SELECT * FROM devices')), antes);
  assert.equal(q(env, 'SELECT * FROM orgs').length, 1);
});
await t('backfill: dos dueños distintos → dos negocios; un dueño sin fila en users usa el mail guardado en el dispositivo', async () => {
  const env = mkEnv(); await ensureDeviceTables(env); await ensureBackupTables(env); await ensureOrgTables(env);
  addDevice(env, 'dev-1', 's1', 'ana@x.com'); addDevice(env, 'dev-2', 's2', 'beto@x.com');
  await backfillOrgs(env);
  assert.deepEqual(q(env, 'SELECT billing_email FROM orgs ORDER BY id').map((o) => o.billing_email), ['ana@x.com', 'beto@x.com']);
  assert.notEqual(one(env, "SELECT owner_org o FROM devices WHERE id='dev-1'").o, one(env, "SELECT owner_org o FROM devices WHERE id='dev-2'").o);
});
console.log(`${pass} pruebas de negocios ok`);

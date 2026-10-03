// Fase 2: el acceso (descargas, dispositivos, copias, barrido) se calcula por NEGOCIO y sucursal, no por persona.
import assert from 'node:assert/strict';
import { sha256b64u } from '../functions/_lib/util.js';
import { createOrg, ensureOrgTables } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import { downloadAccess } from '../functions/_lib/access.js';
import { sha256Hex, purgeBackups } from '../functions/_lib/backups.js';
import { listAllSubscribers } from '../functions/_lib/mp.js';
import { sweep } from '../functions/_lib/sweep.js';
import { estadoFacturacion } from '../functions/_lib/facturacion.js';
import * as authorize from '../functions/api/device/authorize.js';
import * as token from '../functions/api/device/token.js';
import * as deviceMe from '../functions/api/device/me.js';
import * as whoami from '../functions/api/device/whoami.js';
import * as backup from '../functions/api/backup.js';
import * as backups from '../functions/api/backups.js';
import * as devices from '../functions/api/devices.js';
import { addRelease } from '../functions/_lib/releases.js';
import * as ping from '../functions/api/device/ping.js';
import * as latest from '../functions/api/update/latest.js';
import { mkEnv, addUser, sess, req, web, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const q = (env, sql, ...a) => env.DB.raw.prepare(sql).all(...a);
const one = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a);
const bearer = (tok) => ({ Authorization: `Bearer ${tok}` });
const enc = (s) => new TextEncoder().encode(s);
const paga = (...emails) => { mp.subs = emails.map((e) => mpSub(e, 'authorized')); mp.fail = false; mockMP(); };

// Un negocio con dos sucursales y miembros ya cargados (la API de miembros llega en la fase 3).
async function negocio(env, { duena = ['duena@x.com', 'sd'], billing } = {}) {
  await ensureOrgTables(env); addUser(env, duena[0], duena[1]);
  const r = await createOrg(env, { sub: duena[1], email: duena[0], name: 'Dueña', orgName: 'La Plazoleta' });
  if (billing) env.DB.raw.prepare('UPDATE orgs SET billing_email = ? WHERE id = ?').run(billing, r.org.id);
  const b2 = env.DB.raw.prepare("INSERT INTO branches (org_id, name, active, created_at) VALUES (?, 'Centro', 1, ?)").run(r.org.id, nowS());
  return { org: r.org, a: r.branch.id, b: Number(b2.lastInsertRowid) };
}
function miembro(env, n, email, sub, role, { all = 0, branches = [], status = 'active' } = {}) {
  addUser(env, email, sub);
  const m = env.DB.raw.prepare('INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,?,?,?)').run(n.org.id, sub, email, role, status, all, nowS());
  for (const b of branches) env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(m.lastInsertRowid, b);
  return Number(m.lastInsertRowid);
}
const cu = (email, sub) => ({ session: { sub, email }, user: null });
async function pc(env, n, branch, sub, email, id) {
  await upsertDevice(env, { id, sub, email, name: 'PC ' + id.slice(0, 4), orgId: n.org.id, branchId: branch });
  return signDeviceToken(env, { sub, email, deviceId: id });
}
const ID = (c) => `pc-${c}-0123456789abcdefghij`;
async function subir(env, tok, contenido) {
  const bytes = enc(contenido);
  return backup.onRequestPut({ request: req('/api/backup', { method: 'PUT', raw: bytes, headers: { ...bearer(tok), 'X-Sha256': await sha256Hex(bytes), 'X-Schema-Version': '44' } }), env });
}
const listarDev = async (env, tok) => (await (await backups.onRequestGet({ request: req('/api/backups', { headers: bearer(tok) }), env })).json());
const listarWeb = async (env, email, sub, qs = '') => backups.onRequestGet({ request: req('/api/backups' + qs, { cookie: await sess(env, email, sub) }), env });

// ───────── descargas
await t('descargas: un encargado accede por la suscripción del negocio (mail de cobro), sin pagar él', async () => {
  const env = mkEnv(); const n = await negocio(env); paga('duena@x.com');
  miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 });
  assert.deepEqual(await downloadAccess(env, cu('enc@x.com', 'se')), { ok: true, privileged: false });
});
await t('descargas: un empleado no descarga aunque el negocio pague (solo opera)', async () => {
  const env = mkEnv(); const n = await negocio(env); paga('duena@x.com');
  miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] });
  const r = await downloadAccess(env, cu('emp@x.com', 'sm')); assert.equal(r.ok, false); assert.equal(r.reason, 'no_subscription');
});
await t('descargas: negocio sin suscripción vigente, o Mercado Pago caído → no habilita', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 });
  mp.subs = []; mp.fail = false; mockMP();
  assert.equal((await downloadAccess(env, cu('enc@x.com', 'se'))).reason, 'no_subscription');
  mp.fail = true; mockMP(); assert.equal((await downloadAccess(env, cu('enc@x.com', 'se'))).reason, 'mp_error');
});
await t('descargas: un encargado sin sucursales asignadas no descarga; uno quitado tampoco', async () => {
  const env = mkEnv(); const n = await negocio(env); paga('duena@x.com');
  miembro(env, n, 'sin@x.com', 'sx', 'manager', { branches: [] });
  miembro(env, n, 'fuera@x.com', 'sf', 'manager', { all: 1, status: 'removed' });
  assert.equal((await downloadAccess(env, cu('sin@x.com', 'sx'))).ok, false);
  assert.equal((await downloadAccess(env, cu('fuera@x.com', 'sf'))).ok, false);
});
await t('descargas: quien paga con su propio mail sin negocio sigue entrando (compatibilidad)', async () => {
  const env = mkEnv(); paga('solo@x.com'); addUser(env, 'solo@x.com', 'ss');
  assert.equal((await downloadAccess(env, cu('solo@x.com', 'ss'))).ok, true);
});
await t('descargas: tras transferir, el nuevo dueño entra por el mail de cobro del negocio aunque su mail no pague', async () => {
  const env = mkEnv(); const n = await negocio(env, { billing: 'quien-pago@x.com' }); paga('quien-pago@x.com');
  env.DB.raw.prepare("UPDATE memberships SET role='manager' WHERE user_sub='sd'").run();
  miembro(env, n, 'nuevo@x.com', 'sn', 'owner', { all: 1 });
  assert.equal((await downloadAccess(env, cu('nuevo@x.com', 'sn'))).ok, true);
  assert.equal((await downloadAccess(env, cu('duena@x.com', 'sd'))).ok, true, 'la dueña anterior (ahora encargada) también');
});

// ───────── vincular una PC
const DID = 'pc-de-prueba-0123456789abcdef';
const STATE = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
const newVerifier = () => Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString('base64url');
async function vincular(env, cookie, extra = {}, deviceId = DID) {
  const verifier = newVerifier();
  const r = await authorize.onRequestPost({ request: req('/api/device/authorize', { method: 'POST', cookie, headers: web, body: { port: 53682, state: STATE, challenge: await sha256b64u(verifier), deviceId, name: 'PC', ...extra } }), env });
  if (r.status !== 200) return { r };
  const code = new URL((await r.json()).redirect).searchParams.get('code');
  const c = await token.onRequestPost({ request: req('/api/device/token', { method: 'POST', body: { code, verifier } }), env });
  return { r, c, tok: c.status === 200 ? (await c.json()).token : null };
}
await t('vincular: la primera vez crea el negocio personal y deja la PC en su "Sucursal principal"', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); await ensureOrgTables(env);
  const { tok } = await vincular(env, await sess(env, 'ana@x.com', 's1')); assert.ok(tok);
  const org = one(env, 'SELECT * FROM orgs'); const suc = one(env, 'SELECT * FROM branches WHERE org_id = ?', org.id);
  const d = one(env, 'SELECT * FROM devices'); assert.equal(d.owner_org, org.id); assert.equal(d.branch_id, suc.id);
  assert.equal(d.kind, 'pc', 'el sitio guarda que es una PC');
  assert.equal(org.billing_email, 'ana@x.com'); assert.equal(one(env, 'SELECT role FROM memberships').role, 'owner');
});
await t('vincular: una segunda PC de la misma persona reutiliza el negocio (no crea otro)', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); const cookie = await sess(env, 'ana@x.com', 's1');
  await vincular(env, cookie); await vincular(env, cookie, {}, 'otra-pc-0123456789abcdefgh');
  assert.equal(q(env, 'SELECT * FROM orgs').length, 1); assert.equal(q(env, 'SELECT * FROM devices').length, 2);
});
await t('vincular: la dueña elige la sucursal; una sucursal de otro negocio, o inexistente, se rechaza', async () => {
  const env = mkEnv(); const n = await negocio(env); const ajeno = await negocio(env, { duena: ['otro@x.com', 'so'] });
  const cookie = await sess(env, 'duena@x.com', 'sd');
  const ok = await vincular(env, cookie, { orgId: n.org.id, branchId: n.b }); assert.ok(ok.tok);
  assert.equal(one(env, 'SELECT branch_id b FROM devices').b, n.b);
  assert.equal((await vincular(env, cookie, { orgId: n.org.id, branchId: ajeno.a }, 'x-pc-0123456789abcdefghij')).r.status, 400);
  assert.equal((await vincular(env, cookie, { orgId: n.org.id, branchId: 99999 }, 'y-pc-0123456789abcdefghij')).r.status, 400);
});
await t('vincular: solo el dueño vincula PC; un encargado o un empleado no, ni a un negocio donde no son miembros', async () => {
  const env = mkEnv(); const n = await negocio(env); const ajeno = await negocio(env, { duena: ['otro@x.com', 'so'] });
  miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 }); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] });
  for (const [e, s] of [['enc@x.com', 'se'], ['emp@x.com', 'sm']]) {
    assert.equal((await vincular(env, await sess(env, e, s), { orgId: n.org.id, branchId: n.a })).r.status, 403, e);
  }
  assert.equal((await vincular(env, await sess(env, 'duena@x.com', 'sd'), { orgId: ajeno.org.id })).r.status, 403);
});

await t('vincular un CELULAR: el empleado y el encargado lo vinculan con su cuenta, solo en sus sucursales; la PC sigue siendo del dueño', async () => {
  const env = mkEnv(); const n = await negocio(env); const ajeno = await negocio(env, { duena: ['otro@x.com', 'so'] });
  miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.b] }); miembro(env, n, 'enc@x.com', 'se', 'manager', { branches: [n.a] });
  const emp = await sess(env, 'emp@x.com', 'sm');
  // Sin sucursal indicada: la suya (no la principal).
  const ok = await vincular(env, emp, { tipo: 'celular', orgId: n.org.id }, 'cel-emp-0123456789abcdefgh'); assert.ok(ok.tok);
  assert.equal(one(env, "SELECT branch_id b, owner_org o FROM devices WHERE id = 'cel-emp-0123456789abcdefgh'").b, n.b);
  assert.equal(one(env, "SELECT kind FROM devices WHERE id = 'cel-emp-0123456789abcdefgh'").kind, 'celular', 'el sitio guarda que es un celular');
  // Una sucursal donde no trabaja, o de otro negocio, no.
  assert.equal((await vincular(env, emp, { tipo: 'celular', orgId: n.org.id, branchId: n.a }, 'cel-emp2-0123456789abcdefg')).r.status, 403);
  assert.equal((await vincular(env, emp, { tipo: 'celular', orgId: ajeno.org.id }, 'cel-emp3-0123456789abcdefg')).r.status, 403);
  // El encargado también, en la suya. Y como PC (sin `tipo`) ninguno de los dos.
  assert.ok((await vincular(env, await sess(env, 'enc@x.com', 'se'), { tipo: 'celular', orgId: n.org.id, branchId: n.a }, 'cel-enc-0123456789abcdefgh')).tok);
  assert.equal((await vincular(env, emp, { orgId: n.org.id, branchId: n.b }, 'pc-emp-0123456789abcdefghi')).r.status, 403, 'la PC es del dueño');
});
await t('/api/device/me: el celular sabe quién es (nombre, rol, sucursal) con su token; una PC sin nombre cae al mail', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.b] });
  const { tok } = await vincular(env, await sess(env, 'emp@x.com', 'sm', 'Marta Gómez'), { tipo: 'celular', orgId: n.org.id }, 'cel-me-0123456789abcdefghi'); assert.ok(tok);
  const yo = async (token) => deviceMe.onRequestGet({ request: req('/api/device/me', { headers: token ? { Authorization: 'Bearer ' + token } : {} }), env });
  const j = await (await yo(tok)).json();
  assert.deepEqual(j, { email: 'emp@x.com', name: 'Marta Gómez', role: 'employee', orgId: n.org.id, branchId: n.b });
  assert.equal((await yo(null)).status, 401);
  env.DB.raw.prepare("UPDATE devices SET person_name = NULL").run();
  assert.equal((await (await yo(tok)).json()).name, 'emp', 'sin nombre guardado: la parte del mail antes de la @');
  // Quitado del negocio: el token deja de valer.
  env.DB.raw.prepare("UPDATE memberships SET status = 'removed' WHERE user_sub = 'sm'").run();
  assert.equal((await yo(tok)).status, 401);
});
await t('/api/device/whoami?tipo=celular: ofrece al empleado SUS sucursales; sin el parámetro (PC) no puede vincular', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.b] });
  const w = async (qs) => (await whoami.onRequestGet({ request: req('/api/device/whoami' + qs, { cookie: await sess(env, 'emp@x.com', 'sm') }), env })).json();
  const cel = await w('?tipo=celular'); assert.equal(cel.canLink, true); assert.deepEqual(cel.orgs.map((o) => o.branches.map((b) => b.name)), [['Centro']]);
  assert.equal((await w('')).canLink, false);
});
await t('vincular por primera vez adopta de inmediato las PC y copias viejas de la persona (no esperan al cron)', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); paga('ana@x.com');
  await upsertDevice(env, { id: 'vieja-pc-0123456789abcdefgh', sub: 's1', email: 'ana@x.com', name: 'PC vieja' }); // sin negocio
  const tokViejo = await signDeviceToken(env, { sub: 's1', email: 'ana@x.com', deviceId: 'vieja-pc-0123456789abcdefgh' });
  assert.equal((await subir(env, tokViejo, 'copia vieja')).status, 200);
  assert.equal(one(env, 'SELECT owner_org o FROM backups').o, null);
  await vincular(env, await sess(env, 'ana@x.com', 's1'));
  const org = one(env, 'SELECT * FROM orgs'); const suc = one(env, 'SELECT * FROM branches WHERE org_id = ?', org.id);
  for (const tabla of ['devices', 'backups']) for (const f of q(env, `SELECT owner_org, branch_id FROM ${tabla}`)) { assert.equal(f.owner_org, org.id, tabla); assert.equal(f.branch_id, suc.id, tabla); }
  const lista = await (await listarWeb(env, 'ana@x.com', 's1')).json(); assert.equal(lista.backups.length, 1, 'la copia vieja se ve en la web');
});
await t('descargas sin base D1: no explota, cae al pago por mail propio', async () => {
  const env = mkEnv(); delete env.DB; paga('solo@x.com');
  assert.equal((await downloadAccess(env, cu('solo@x.com', 'ss'))).ok, true);
});

// ───────── dispositivos
await t('una PC deja de valer si quien la vinculó ya no es miembro activo del negocio', async () => {
  const env = mkEnv(); const n = await negocio(env); paga('duena@x.com');
  const tok = await pc(env, n, n.a, 'sd', 'duena@x.com', ID('1'));
  assert.equal((await backups.onRequestGet({ request: req('/api/backups', { headers: bearer(tok) }), env })).status, 200);
  env.DB.raw.prepare("UPDATE memberships SET status='removed' WHERE user_sub='sd'").run();
  assert.equal((await backups.onRequestGet({ request: req('/api/backups', { headers: bearer(tok) }), env })).status, 401);
});
await t('lista de PCs: la dueña ve las de todo el negocio; un encargado solo las que él vinculó (antes del traspaso)', async () => {
  const env = mkEnv(); const n = await negocio(env); paga('duena@x.com');
  miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 });
  const tokD = await pc(env, n, n.a, 'sd', 'duena@x.com', ID('d1')); await pc(env, n, n.b, 'se', 'enc@x.com', ID('e1'));
  const dueña = await (await devices.onRequestGet({ request: req('/api/devices', { cookie: await sess(env, 'duena@x.com', 'sd') }), env })).json();
  assert.equal(dueña.devices.length, 2);
  const enc = await (await devices.onRequestGet({ request: req('/api/devices', { cookie: await sess(env, 'enc@x.com', 'se') }), env })).json();
  assert.deepEqual(enc.devices.map((d) => d.id), [ID('e1')]);
  assert.ok(tokD);
});
await t('desvincular: la dueña puede quitar la PC de cualquier sucursal; otro miembro no puede quitar la ajena', async () => {
  const env = mkEnv(); const n = await negocio(env); paga('duena@x.com'); miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 });
  await pc(env, n, n.b, 'se', 'enc@x.com', ID('e1')); await pc(env, n, n.a, 'sd', 'duena@x.com', ID('d1'));
  const revocar = async (e, s, id) => devices.onRequestRevoke({ request: req('/api/device/revoke', { method: 'POST', cookie: await sess(env, e, s), headers: web, body: { id } }), env });
  await revocar('enc@x.com', 'se', ID('d1')); assert.equal(one(env, "SELECT revoked r FROM devices WHERE id=?", ID('d1')).r, 0);
  await revocar('duena@x.com', 'sd', ID('e1')); assert.equal(one(env, "SELECT revoked r FROM devices WHERE id=?", ID('e1')).r, 1);
});

// ───────── copias
await t('copias: se guardan en la sucursal de la PC y se pagan con el mail de cobro del negocio', async () => {
  const env = mkEnv(); const n = await negocio(env, { billing: 'quien-pago@x.com' }); paga('quien-pago@x.com');
  const tok = await pc(env, n, n.b, 'sd', 'duena@x.com', ID('1'));
  const r = await subir(env, tok, 'copia centro'); assert.equal(r.status, 200);
  const b = one(env, 'SELECT * FROM backups'); assert.equal(b.owner_org, n.org.id); assert.equal(b.branch_id, n.b);
});
await t('copias: sin suscripción del negocio no se sube, aunque la persona pague por su cuenta con otro mail', async () => {
  const env = mkEnv(); const n = await negocio(env, { billing: 'quien-pago@x.com' }); paga('duena@x.com');
  assert.equal((await subir(env, await pc(env, n, n.a, 'sd', 'duena@x.com', ID('1')), 'x')).status, 403);
});
await t('copias: solo quedan las últimas 5 POR SUCURSAL (la otra sucursal no se pisa)', async () => {
  const env = mkEnv(); const n = await negocio(env); paga('duena@x.com');
  const ta = await pc(env, n, n.a, 'sd', 'duena@x.com', ID('a')), tb = await pc(env, n, n.b, 'sd', 'duena@x.com', ID('b'));
  for (let i = 0; i < 7; i++) await subir(env, ta, 'a' + i);
  await subir(env, tb, 'b0');
  assert.equal(one(env, 'SELECT COUNT(*) c FROM backups WHERE branch_id = ?', n.a).c, 5);
  assert.equal(one(env, 'SELECT COUNT(*) c FROM backups WHERE branch_id = ?', n.b).c, 1);
});
await t('copias: una PC solo lista y baja las de SU sucursal', async () => {
  const env = mkEnv(); const n = await negocio(env); paga('duena@x.com');
  const ta = await pc(env, n, n.a, 'sd', 'duena@x.com', ID('a')), tb = await pc(env, n, n.b, 'sd', 'duena@x.com', ID('b'));
  const ia = (await (await subir(env, ta, 'de a')).json()).id; const ib = (await (await subir(env, tb, 'de b')).json()).id;
  assert.deepEqual((await listarDev(env, ta)).backups.map((b) => b.id), [ia]);
  const baja = (tok, id) => backup.onRequestGet({ request: req(`/api/backup?id=${id}`, { headers: bearer(tok) }), env });
  assert.equal((await baja(ta, ia)).status, 200); assert.equal((await baja(ta, ib)).status, 404);
});
await t('copias por la web: la dueña ve todas las sucursales; un encargado solo las asignadas; un empleado ninguna', async () => {
  const env = mkEnv(); const n = await negocio(env); paga('duena@x.com');
  miembro(env, n, 'enc@x.com', 'se', 'manager', { branches: [n.b] }); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] });
  const ta = await pc(env, n, n.a, 'sd', 'duena@x.com', ID('a')), tb = await pc(env, n, n.b, 'sd', 'duena@x.com', ID('b'));
  await subir(env, ta, 'a'); await subir(env, tb, 'b');
  assert.equal((await (await listarWeb(env, 'duena@x.com', 'sd')).json()).backups.length, 2);
  const enc = await (await listarWeb(env, 'enc@x.com', 'se')).json(); assert.equal(enc.backups.length, 1);
  assert.equal(enc.backups[0].deviceName.startsWith('PC pc-b'), true);
  const emp = await listarWeb(env, 'emp@x.com', 'sm'); const j = await emp.json();
  assert.ok(emp.status === 403 || (j.backups || []).length === 0, 'un empleado no ve copias');
});
await t('copias: no se puede bajar ni borrar la copia de otro negocio con un id adivinado', async () => {
  const env = mkEnv(); const n = await negocio(env); const m = await negocio(env, { duena: ['otro@x.com', 'so'] }); paga('duena@x.com', 'otro@x.com');
  const idOtro = (await (await subir(env, await pc(env, m, m.a, 'so', 'otro@x.com', ID('o')), 'secreto ajeno')).json()).id;
  const tok = await pc(env, n, n.a, 'sd', 'duena@x.com', ID('a'));
  assert.equal((await backup.onRequestGet({ request: req(`/api/backup?id=${idOtro}`, { headers: bearer(tok) }), env })).status, 404);
  const del = await backup.onRequestDelete({ request: req('/api/backup', { method: 'DELETE', headers: { ...bearer(tok) }, body: { id: idOtro } }), env });
  assert.equal(del.status, 404); assert.equal(one(env, 'SELECT COUNT(*) c FROM backups').c, 1);
});
await t('limpieza de copias por negocio: se borran las de un negocio sin pagar (90 días); se conservan las pagas y las de dueño eximido', async () => {
  const env = mkEnv(); const paga1 = await negocio(env, { duena: ['paga@x.com', 'sp'] }); const vieja = await negocio(env, { duena: ['vieja@x.com', 'sv'] });
  const eximida = await negocio(env, { duena: ['ex@x.com', 'sx'] }); env.DB.raw.prepare("UPDATE users SET exempt = 1 WHERE sub = 'sx'").run();
  mp.subs = [mpSub('paga@x.com', 'authorized'), mpSub('vieja@x.com', 'authorized'), mpSub('ex@x.com', 'authorized')]; mockMP();
  const ids = {};
  for (const [k, nn, e, s] of [['paga', paga1, 'paga@x.com', 'sp'], ['vieja', vieja, 'vieja@x.com', 'sv'], ['ex', eximida, 'ex@x.com', 'sx']])
    ids[k] = (await (await subir(env, await pc(env, nn, nn.a, s, e, ID(k)), 'copia ' + k)).json()).id;
  mp.subs = [mpSub('paga@x.com', 'authorized'), mpSub('vieja@x.com', 'cancelled', 200)]; mockMP();
  const borradas = await purgeBackups(env, await listAllSubscribers(env, { fresh: true }));
  assert.deepEqual(borradas, [ids.vieja]); assert.equal(env.RELEASES.files.size, 2);
});

// ───────── barrido de cuentas inactivas
const DAY = 86400;
await t('barrido: un miembro de un negocio que paga no se marca para borrar aunque no tenga suscripción propia', async () => {
  const env = mkEnv({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c', AVISOS_BORRADO: 'on' }); const n = await negocio(env, { billing: 'quien-pago@x.com' }); // avisos de borrado: opt-in
  miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] }); addUser(env, 'suelto@x.com', 'sl');
  const viejo = nowS() - 90 * DAY; env.DB.raw.prepare('UPDATE users SET created_at = ?, last_seen = ?').run(viejo, viejo);
  mp.subs = [mpSub('quien-pago@x.com', 'authorized')]; mockMP();
  const r = await sweep(env, { apply: false }); const por = Object.fromEntries(r.actions.map((a) => [a.email, a.action]));
  assert.equal(por['emp@x.com'], undefined, 'el empleado está cubierto por el negocio'); assert.equal(por['duena@x.com'], undefined, 'la dueña también (el negocio paga)');
  assert.equal(por['suelto@x.com'], 'send_notice', 'una cuenta suelta inactiva sí califica');
});
await t('barrido: si el negocio NO paga, sus miembros inactivos califican como cualquier cuenta', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] });
  const viejo = nowS() - 90 * DAY; env.DB.raw.prepare('UPDATE users SET created_at = ?, last_seen = ?').run(viejo, viejo);
  mp.subs = [mpSub('otra@x.com', 'authorized')]; mockMP();
  const r = await sweep(env, { apply: false }); assert.deepEqual(r.actions.map((a) => a.email).sort(), ['duena@x.com', 'emp@x.com']);
});
// ───────── herencia: quien trabaja en un negocio hereda lo del dueño
await t('herencia: la PC de un empleado de un negocio eximido recibe las betas y ping le dice beta; sin eximir, stable', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] });
  const tok = await pc(env, n, n.a, 'sm', 'emp@x.com', ID('emp1'));
  const doPing = (cid) => ping.onRequestPost({ request: req('/api/device/ping', { method: 'POST', headers: bearer(tok), body: { cid } }), env });
  assert.equal((await (await doPing('cid-emp-0000001')).json()).channel, 'stable');
  env.DB.raw.prepare("UPDATE users SET exempt = 1 WHERE sub = 'sd'").run(); // se exime a la dueña
  assert.equal((await (await doPing('cid-emp-0000001')).json()).channel, 'beta'); // hereda: ni su cuenta ni su mail están eximidos
  await addRelease(env, { channel: 'beta', platform: 'windows', version: '1.0.0.2099', file_key: 'beta/1.0.0.2099/S.exe', size: 1, sha256: 'a'.repeat(64), rollout: 100 }, nowS());
  const ver = async () => (await (await latest.onRequestGet({ request: req('/api/update/latest.json?platform=windows&version=1.0.0.2000&cid=cid-emp-0000001'), env })).json()).version;
  assert.equal(await ver(), '1.0.0.2099');
});
await t('herencia: el barrido no borra a un empleado de un negocio eximido, pero sí al de uno común', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] });
  const viejo = nowS() - 90 * DAY; env.DB.raw.prepare('UPDATE users SET created_at = ?, last_seen = ?').run(viejo, viejo);
  mp.subs = [mpSub('otra@x.com', 'authorized')]; mp.fail = false; mockMP();
  assert.deepEqual((await sweep(env, { apply: false })).actions.map((a) => a.email).sort(), ['duena@x.com', 'emp@x.com']);
  env.DB.raw.prepare("UPDATE users SET exempt = 1 WHERE sub = 'sd'").run();
  assert.deepEqual((await sweep(env, { apply: false })).actions, []); // ni la dueña ni su gente
});
await t('copias: a un empleado el negocio al día no le dice "sin suscripción": le dice que no administra copias', async () => {
  const env = mkEnv(); const n = await negocio(env); paga('duena@x.com'); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] });
  const tok = await pc(env, n, n.a, 'sm', 'emp@x.com', ID('emp2'));
  const r = await listarDev(env, tok);
  assert.equal(r.noPermission, true); assert.equal(r.upload, false); assert.deepEqual(r.backups, []);
  const dueno = await listarDev(env, await pc(env, n, n.a, 'sd', 'duena@x.com', ID('due2')));
  assert.equal(dueno.noPermission, undefined); assert.equal(dueno.upload, true);
});
await t('facturación: el negocio de una cuenta eximida figura pago y sin vencimiento, sin tocar Mercado Pago', async () => {
  const env = mkEnv(); const n = await negocio(env); paga(); // nadie paga en Mercado Pago
  assert.equal((await estadoFacturacion(env, n.org, 'duena@x.com')).status, 'none');
  env.DB.raw.prepare("UPDATE users SET exempt = 1 WHERE sub = 'sd'").run();
  assert.equal((await estadoFacturacion(env, n.org, 'duena@x.com')).status, 'authorized');
});
console.log(`\n${pass} pruebas OK (acceso por negocio y sucursal)`);

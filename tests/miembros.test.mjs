// Fase 3: miembros, invitaciones y sucursales del negocio (API). Solo el dueño administra; todo por sesión web.
import assert from 'node:assert/strict';
import { sha256b64u } from '../functions/_lib/util.js';
import { createOrg, ensureOrgTables, listOrgsForSub } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import * as inv from '../functions/api/org/invitations.js';
import * as mem from '../functions/api/org/members.js';
import * as br from '../functions/api/org/branches.js';
import * as ping from '../functions/api/device/ping.js';
import * as authorize from '../functions/api/device/authorize.js';
import worker from '../worker.js';
import { mkEnv, addUser, sess, req, web, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const q = (env, sql, ...a) => env.DB.raw.prepare(sql).all(...a);
const one = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a);
const mails = [];
const mockResend = (ok = true) => { mails.length = 0; globalThis.fetch = async (url, init = {}) => { if (new URL(url).host === 'api.resend.com') { mails.push(JSON.parse(init.body)); return new Response('{}', { status: ok ? 200 : 500 }); } return new Response('{}', { status: 404 }); }; };

async function negocio(env, duena = ['duena@x.com', 'sd'], orgName = 'La Plazoleta') {
  await ensureOrgTables(env); addUser(env, duena[0], duena[1]);
  const r = await createOrg(env, { sub: duena[1], email: duena[0], name: 'Dueña', orgName });
  const b2 = env.DB.raw.prepare("INSERT INTO branches (org_id, name, active, created_at) VALUES (?, 'Centro', 1, ?)").run(r.org.id, nowS());
  return { org: r.org, a: r.branch.id, b: Number(b2.lastInsertRowid), dueno: duena };
}
function miembro(env, n, email, sub, role, { all = 0, branches = [] } = {}) {
  addUser(env, email, sub);
  const m = env.DB.raw.prepare('INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,?,?,?)').run(n.org.id, sub, email, role, 'active', all, nowS());
  for (const b of branches) env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(m.lastInsertRowid, b);
  return Number(m.lastInsertRowid);
}
// llama a un manejador como lo haría el navegador (sesión, mismo origen, fetch)
const call = async (env, h, path, { as, body, method = 'POST', headers = web } = {}) =>
  h({ request: req(path, { method, cookie: as ? await sess(env, as[0], as[1]) : undefined, headers: method === 'GET' ? {} : headers, body }), env });
const D = ['duena@x.com', 'sd'];
const invitar = (env, n, extra = {}, as = n.dueno) => call(env, inv.onRequestPost, '/api/org/invite', { as, body: { orgId: n.org.id, email: 'emp@x.com', role: 'employee', branchIds: [n.a], ...extra } });
const tokenDe = async (r) => new URL((await r.json()).link).searchParams.get('t');
const aceptar = (env, token, as) => call(env, inv.onRequestAccept, '/api/org/accept', { as, body: { token } });

// ───────── invitar
await t('invitar: el dueño crea la invitación; el link lleva un token y en la base solo queda su huella', async () => {
  const env = mkEnv(); const n = await negocio(env); mockResend();
  const r = await invitar(env, n); assert.equal(r.status, 200); const j = await r.clone().json();
  assert.equal(j.emailed, false, 'sin Resend configurado se devuelve el link para copiar'); assert.equal(j.invitation.email, 'emp@x.com'); assert.equal(j.invitation.role, 'employee');
  const token = await tokenDe(r); assert.match(token, /^[0-9a-f]{64}$/); assert.match(j.link, /^https:\/\/horsepos\.com\/unirse\/\?t=/);
  const fila = one(env, 'SELECT * FROM invitations'); assert.equal(fila.token_hash, await sha256b64u(token)); assert.ok(!JSON.stringify(fila).includes(token));
  assert.ok(fila.exp - nowS() > 6.9 * 86400 && fila.exp - nowS() <= 7 * 86400);
});
await t('invitar: con Resend configurado se manda el mail con el link; si el envío falla, igual se devuelve el link', async () => {
  const env = mkEnv({ RESEND_API_KEY: 'k', MAIL_FROM: 'hola@horsepos.com' }); const n = await negocio(env);
  mockResend(true); let j = await (await invitar(env, n)).json(); assert.equal(j.emailed, true); assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['emp@x.com']); assert.ok(mails[0].text.includes(j.link)); assert.ok(mails[0].text.includes('La Plazoleta'));
  mockResend(false); j = await (await invitar(env, n)).json(); assert.equal(j.emailed, false); assert.ok(j.link);
});
await t('invitar: solo el dueño; encargado, empleado, ajeno y sin sesión no pueden', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 }); miembro(env, n, 'emp2@x.com', 'sm', 'employee', { branches: [n.a] }); addUser(env, 'ajeno@x.com', 'sj');
  for (const as of [['enc@x.com', 'se'], ['emp2@x.com', 'sm'], ['ajeno@x.com', 'sj']]) assert.equal((await invitar(env, n, {}, as)).status, 403, as[0]);
  assert.equal((await call(env, inv.onRequestPost, '/api/org/invite', { body: { orgId: n.org.id, email: 'a@b.com', role: 'employee', branchIds: [n.a] } })).status, 401);
  assert.equal((await call(env, inv.onRequestPost, '/api/org/invite', { as: D, headers: { Origin: 'https://evil.com', 'X-Requested-With': 'fetch' }, body: { orgId: n.org.id, email: 'a@b.com', role: 'employee', branchIds: [n.a] } })).status, 403, 'otro origen');
  assert.equal(q(env, 'SELECT * FROM invitations').length, 0);
});
await t('invitar: valida mail, rol (nunca "owner") y sucursales (del negocio y activas)', async () => {
  const env = mkEnv(); const n = await negocio(env); const ajeno = await negocio(env, ['otro@x.com', 'so'], 'Otro');
  env.DB.raw.prepare('UPDATE branches SET active = 0 WHERE id = ?').run(n.b);
  for (const mala of [{ email: 'no-es-un-mail' }, { email: '' }, { email: 'a@b.com ' + 'x'.repeat(300) }, { role: 'owner' }, { role: 'jefe' }, { branchIds: [] }, { branchIds: undefined },
    { branchIds: [ajeno.a] }, { branchIds: [n.b] }, { branchIds: [99999] }, { branchIds: ['1'] }, { orgId: 'x' }])
    assert.equal((await invitar(env, n, mala)).status, 400, JSON.stringify(mala));
  assert.equal((await invitar(env, n, { allBranches: true, branchIds: undefined })).status, 200, 'todas las sucursales no necesita lista');
});
await t('invitar: el mail se normaliza; no se invita a un miembro activo; reinvitar reemplaza la invitación anterior', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'ya@x.com', 'sy', 'employee', { branches: [n.a] });
  assert.equal((await invitar(env, n, { email: 'YA@x.com' })).status, 409);
  assert.equal((await invitar(env, n, { email: 'duena@x.com' })).status, 409, 'ni a la dueña a sí misma');
  const r1 = await invitar(env, n, { email: '  Emp@X.com ' }); const t1 = await tokenDe(r1); assert.equal(one(env, 'SELECT email e FROM invitations').e, 'emp@x.com');
  const t2 = await tokenDe(await invitar(env, n)); assert.equal(q(env, 'SELECT * FROM invitations').length, 1);
  addUser(env, 'emp@x.com', 'sn'); assert.equal((await aceptar(env, t1, ['emp@x.com', 'sn'])).status, 404, 'el link viejo ya no sirve');
  assert.equal((await aceptar(env, t2, ['emp@x.com', 'sn'])).status, 200);
});
await t('invitar: las invitaciones vencidas hace más de 30 días se limpian solas; las recientes y las aceptadas quedan', async () => {
  const env = mkEnv(); const n = await negocio(env); const ins = (email, exp, acc) => env.DB.raw.prepare('INSERT INTO invitations (org_id,email,role,all_branches,branch_ids,token_hash,exp,created_at,accepted_at) VALUES (?,?,?,?,?,?,?,?,?)').run(n.org.id, email, 'employee', 1, null, 'h' + email, exp, nowS(), acc);
  ins('vieja@x.com', nowS() - 40 * 86400, null); ins('reciente@x.com', nowS() - 2 * 86400, null); ins('aceptada@x.com', nowS() - 40 * 86400, nowS() - 50 * 86400);
  assert.equal((await invitar(env, n)).status, 200);
  assert.deepEqual(q(env, 'SELECT email FROM invitations ORDER BY email').map((r) => r.email), ['aceptada@x.com', 'emp@x.com', 'reciente@x.com']);
});
await t('invitar: hay un tope de invitaciones pendientes por negocio', async () => {
  const env = mkEnv(); const n = await negocio(env);
  for (let i = 0; i < 100; i++) env.DB.raw.prepare('INSERT INTO invitations (org_id,email,role,all_branches,branch_ids,token_hash,exp,created_at) VALUES (?,?,?,?,?,?,?,?)').run(n.org.id, `p${i}@x.com`, 'employee', 1, null, 'h' + i, nowS() + 999, nowS());
  assert.equal((await invitar(env, n)).status, 429);
});

// ───────── aceptar
await t('aceptar: con el Google cuyo mail coincide se crea la membresía con sus sucursales, y el link sirve una sola vez', async () => {
  const env = mkEnv(); const n = await negocio(env); const token = await tokenDe(await invitar(env, n, { role: 'manager', branchIds: [n.a, n.b] })); addUser(env, 'emp@x.com', 'sn');
  const r = await aceptar(env, token, ['emp@x.com', 'sn']); assert.equal(r.status, 200); const j = await r.json();
  assert.equal(j.orgId, n.org.id); assert.equal(j.orgName, 'La Plazoleta'); assert.equal(j.role, 'manager');
  const m = one(env, "SELECT * FROM memberships WHERE user_sub = 'sn'"); assert.equal(m.role, 'manager'); assert.equal(m.status, 'active'); assert.equal(m.all_branches, 0);
  assert.deepEqual(q(env, 'SELECT branch_id FROM membership_branches WHERE membership_id = ? ORDER BY branch_id', m.id).map((x) => x.branch_id), [n.a, n.b]);
  assert.equal((await aceptar(env, token, ['emp@x.com', 'sn'])).status, 410, 'ya usada');
  assert.equal(q(env, "SELECT * FROM memberships WHERE user_sub = 'sn'").length, 1);
});
await t('aceptar: con otro mail → 403 y la invitación sigue pendiente; sin sesión → 401; token inventado → 404; vencida → 410', async () => {
  const env = mkEnv(); const n = await negocio(env); const token = await tokenDe(await invitar(env, n)); addUser(env, 'otra@x.com', 'so'); addUser(env, 'emp@x.com', 'sn');
  assert.equal((await aceptar(env, token, ['otra@x.com', 'so'])).status, 403);
  assert.equal(one(env, 'SELECT accepted_at a FROM invitations').a, null); assert.equal(q(env, "SELECT * FROM memberships WHERE user_sub = 'so'").length, 0);
  assert.equal((await aceptar(env, token)).status, 401);
  assert.equal((await aceptar(env, 'f'.repeat(64), ['emp@x.com', 'sn'])).status, 404); assert.equal((await aceptar(env, 'corto', ['emp@x.com', 'sn'])).status, 400);
  env.DB.raw.prepare('UPDATE invitations SET exp = ?').run(nowS() - 1); assert.equal((await aceptar(env, token, ['emp@x.com', 'sn'])).status, 410);
  assert.equal(q(env, "SELECT * FROM memberships WHERE user_sub = 'sn'").length, 0);
});
await t('aceptar: la vista previa muestra negocio y rol solo a quien tiene el mail invitado', async () => {
  const env = mkEnv(); const n = await negocio(env); const token = await tokenDe(await invitar(env, n)); addUser(env, 'otra@x.com', 'so'); addUser(env, 'emp@x.com', 'sn');
  const ver = (as) => call(env, inv.onRequestGet, `/api/org/invitation?t=${token}`, { as, method: 'GET' });
  const ok = await (await ver(['emp@x.com', 'sn'])).json(); assert.equal(ok.org.name, 'La Plazoleta'); assert.equal(ok.role, 'employee'); assert.deepEqual(ok.branches, ['Sucursal principal']);
  const mal = await ver(['otra@x.com', 'so']); assert.equal(mal.status, 403); const txt = JSON.stringify(await mal.json()); assert.ok(!txt.includes('Plazoleta'), 'no se filtra el negocio'); assert.ok(!txt.includes('emp@x.com'), 'ni el mail completo');
  assert.equal((await ver(undefined)).status, 401);
});
await t('aceptar: quien ya fue quitado se reactiva con el rol y las sucursales de la nueva invitación', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, 'emp@x.com', 'sn', 'employee', { branches: [n.a] });
  env.DB.raw.prepare("UPDATE memberships SET status = 'removed' WHERE id = ?").run(id);
  const token = await tokenDe(await invitar(env, n, { role: 'manager', branchIds: [n.b] })); assert.equal((await aceptar(env, token, ['emp@x.com', 'sn'])).status, 200);
  const m = one(env, "SELECT * FROM memberships WHERE user_sub = 'sn'"); assert.equal(m.status, 'active'); assert.equal(m.role, 'manager'); assert.equal(q(env, "SELECT * FROM memberships WHERE user_sub = 'sn'").length, 1);
  assert.deepEqual(q(env, 'SELECT branch_id FROM membership_branches WHERE membership_id = ?', m.id).map((x) => x.branch_id), [n.b]);
});
await t('aceptar: una persona puede ser miembro de varios negocios', async () => {
  const env = mkEnv(); const n1 = await negocio(env); const n2 = await negocio(env, ['otro@x.com', 'so'], 'Otro'); addUser(env, 'emp@x.com', 'sn');
  assert.equal((await aceptar(env, await tokenDe(await invitar(env, n1)), ['emp@x.com', 'sn'])).status, 200);
  assert.equal((await aceptar(env, await tokenDe(await invitar(env, n2, { branchIds: [n2.a] }, n2.dueno)), ['emp@x.com', 'sn'])).status, 200);
  assert.deepEqual((await listOrgsForSub(env, 'sn')).map((o) => o.name), ['La Plazoleta', 'Otro']);
});
await t('aceptar: un dueño que ya es dueño del negocio no se degrada aceptando una invitación', async () => {
  const env = mkEnv(); const n = await negocio(env);
  env.DB.raw.prepare('INSERT INTO invitations (org_id,email,role,all_branches,branch_ids,token_hash,exp,created_at) VALUES (?,?,?,?,?,?,?,?)').run(n.org.id, 'duena@x.com', 'employee', 1, null, await sha256b64u('a'.repeat(64)), nowS() + 99, nowS());
  assert.equal((await aceptar(env, 'a'.repeat(64), D)).status, 409); assert.equal(one(env, "SELECT role r FROM memberships WHERE user_sub = 'sd'").r, 'owner');
});
await t('revocar: el dueño cancela una invitación pendiente y el link deja de servir', async () => {
  const env = mkEnv(); const n = await negocio(env); const r = await invitar(env, n); const id = (await r.clone().json()).invitation.id; const token = await tokenDe(r); addUser(env, 'emp@x.com', 'sn');
  miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 });
  const rev = (as) => call(env, inv.onRequestRevoke, '/api/org/invite/revoke', { as, body: { orgId: n.org.id, invitationId: id } });
  assert.equal((await rev(['enc@x.com', 'se'])).status, 403); assert.equal((await rev(D)).status, 200);
  assert.equal((await aceptar(env, token, ['emp@x.com', 'sn'])).status, 404); assert.equal((await rev(D)).status, 404);
});

// ───────── listar, cambiar y quitar miembros
await t('lista de miembros: solo el dueño; trae nombre, rol, sucursales e invitaciones pendientes, sin datos internos', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'enc@x.com', 'se', 'manager', { branches: [n.b] }); await invitar(env, n);
  env.DB.raw.prepare("UPDATE users SET name = 'Elena' WHERE sub = 'se'").run();
  const r = await call(env, mem.onRequestGet, `/api/org/members?org=${n.org.id}`, { as: D, method: 'GET' }); assert.equal(r.status, 200); const j = await r.json();
  assert.deepEqual(j.members.map((m) => m.role), ['owner', 'manager']); const enc = j.members[1];
  assert.equal(enc.email, 'enc@x.com'); assert.equal(enc.name, 'Elena'); assert.deepEqual(enc.branchIds, [n.b]); assert.equal(enc.allBranches, false); assert.ok(enc.id);
  assert.equal(j.members[0].isYou, true); assert.equal(j.invitations.length, 1); assert.equal(j.invitations[0].email, 'emp@x.com');
  assert.deepEqual(j.branches.map((b) => b.name), ['Sucursal principal', 'Centro']); assert.equal(j.count, 2); assert.equal(j.softCap, 50);
  const txt = JSON.stringify(j); assert.ok(!/"sd"|"se"|token|pin/i.test(txt), 'no se exponen subs de Google, tokens ni PIN');
  assert.equal((await call(env, mem.onRequestGet, `/api/org/members?org=${n.org.id}`, { as: ['enc@x.com', 'se'], method: 'GET' })).status, 403);
  assert.equal((await call(env, mem.onRequestGet, '/api/org/members', { as: D, method: 'GET' })).status, 400);
});
await t('lista de miembros: el tope blando es configurable y solo avisa (no bloquea)', async () => {
  const env = mkEnv({ MAX_MIEMBROS_SIN_COSTO: '2' }); const n = await negocio(env);
  miembro(env, n, 'a@x.com', 's1', 'employee', { branches: [n.a] }); miembro(env, n, 'b@x.com', 's2', 'employee', { branches: [n.a] });
  const j = await (await call(env, mem.onRequestGet, `/api/org/members?org=${n.org.id}`, { as: D, method: 'GET' })).json(); assert.equal(j.softCap, 2); assert.equal(j.overSoftCap, true);
  assert.equal((await invitar(env, n)).status, 200);
});
await t('cambiar un miembro: rol y sucursales; nunca al dueño, nunca a "owner", nunca de otro negocio', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, 'emp@x.com', 'sn', 'employee', { branches: [n.a] }); const ajeno = await negocio(env, ['otro@x.com', 'so'], 'Otro'); const idAjeno = miembro(env, ajeno, 'x@x.com', 'sx', 'employee', { branches: [ajeno.a] });
  const upd = (body, as = D) => call(env, mem.onRequestUpdate, '/api/org/member/update', { as, body: { orgId: n.org.id, memberId: id, ...body } });
  assert.equal((await upd({ role: 'manager', branchIds: [n.a, n.b] })).status, 200);
  let m = one(env, 'SELECT * FROM memberships WHERE id = ?', id); assert.equal(m.role, 'manager'); assert.deepEqual(q(env, 'SELECT branch_id FROM membership_branches WHERE membership_id = ? ORDER BY branch_id', id).map((x) => x.branch_id), [n.a, n.b]);
  assert.equal((await upd({ allBranches: true })).status, 200); m = one(env, 'SELECT * FROM memberships WHERE id = ?', id); assert.equal(m.all_branches, 1); assert.equal(q(env, 'SELECT * FROM membership_branches WHERE membership_id = ?', id).length, 0);
  assert.equal((await upd({ role: 'owner' })).status, 400); assert.equal((await upd({ role: 'jefe' })).status, 400);
  assert.equal((await upd({ allBranches: false, branchIds: [] })).status, 400, 'sin sucursales no queda en ningún lado');
  assert.equal((await upd({ allBranches: false, branchIds: [ajeno.a] })).status, 400);
  assert.equal((await call(env, mem.onRequestUpdate, '/api/org/member/update', { as: D, body: { orgId: n.org.id, memberId: one(env, "SELECT id FROM memberships WHERE user_sub='sd'").id, role: 'employee' } })).status, 403, 'el dueño no se toca');
  assert.equal((await call(env, mem.onRequestUpdate, '/api/org/member/update', { as: D, body: { orgId: n.org.id, memberId: idAjeno, role: 'manager' } })).status, 404, 'miembro de otro negocio');
  assert.equal((await upd({ role: 'employee' }, ['emp@x.com', 'sn'])).status, 403, 'nadie se cambia a sí mismo el rol');
});
await t('quitar a un miembro: queda inactivo, pierde el negocio y las PC que vinculó dejan de valer; al dueño no se lo puede quitar', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 });
  await upsertDevice(env, { id: 'pc-enc-0123456789abcdefghij', sub: 'se', email: 'enc@x.com', orgId: n.org.id, branchId: n.a });
  const tok = await signDeviceToken(env, { sub: 'se', email: 'enc@x.com', deviceId: 'pc-enc-0123456789abcdefghij' });
  const viva = async () => (await ping.onRequestPost({ request: req('/api/device/ping', { method: 'POST', body: {}, headers: { Authorization: `Bearer ${tok}` } }), env })).status;
  assert.equal(await viva(), 200);
  const rem = (memberId, as = D) => call(env, mem.onRequestRemove, '/api/org/member/remove', { as, body: { orgId: n.org.id, memberId } });
  assert.equal((await rem(id, ['enc@x.com', 'se'])).status, 403, 'un encargado no quita gente');
  assert.equal((await rem(id)).status, 200); assert.equal(one(env, 'SELECT status s FROM memberships WHERE id = ?', id).s, 'removed');
  assert.equal(q(env, 'SELECT * FROM membership_branches WHERE membership_id = ?', id).length, 0); assert.equal(await viva(), 401);
  assert.deepEqual(await listOrgsForSub(env, 'se'), []); assert.equal((await rem(id)).status, 404, 'ya estaba quitado');
  assert.equal((await rem(one(env, "SELECT id FROM memberships WHERE user_sub='sd'").id)).status, 403, 'el dueño no se quita');
  const j = await (await call(env, mem.onRequestGet, `/api/org/members?org=${n.org.id}`, { as: D, method: 'GET' })).json(); assert.deepEqual(j.members.map((m) => m.email), ['duena@x.com']);
});

// ───────── sucursales
await t('sucursales: el dueño crea, renombra y lista; un encargado no', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 });
  const crear = (body, as = D) => call(env, br.onRequestPost, '/api/org/branch', { as, body: { orgId: n.org.id, ...body } });
  const r = await crear({ name: '  Barrio Norte ' }); assert.equal(r.status, 200); const b = (await r.json()).branch; assert.equal(b.name, 'Barrio Norte'); assert.equal(b.active, true);
  assert.equal((await crear({ name: 'barrio norte' })).status, 409, 'mismo nombre (sin importar mayúsculas)'); assert.equal((await crear({ name: '   ' })).status, 400); assert.equal((await crear({ name: 'x'.repeat(100) })).status, 200, 'se recorta a 60');
  assert.equal(one(env, "SELECT length(name) l FROM branches WHERE name LIKE 'xxx%'").l, 60);
  assert.equal((await crear({ name: 'Otra' }, ['enc@x.com', 'se'])).status, 403);
  const upd = (body, as = D) => call(env, br.onRequestUpdate, '/api/org/branch/update', { as, body: { orgId: n.org.id, branchId: b.id, ...body } });
  assert.equal((await upd({ name: 'Norte' })).status, 200); assert.equal(one(env, 'SELECT name n FROM branches WHERE id = ?', b.id).n, 'Norte');
  assert.equal((await upd({ name: 'Centro' })).status, 409, 'ya existe otra con ese nombre');
  const lista = await (await call(env, br.onRequestGet, `/api/org/branches?org=${n.org.id}`, { as: D, method: 'GET' })).json(); assert.deepEqual(lista.branches.map((x) => x.name).slice(0, 3), ['Sucursal principal', 'Centro', 'Norte']);
});
await t('sucursales: no se puede dejar el negocio sin ninguna activa, ni cerrar una con PC vinculadas; una cerrada no recibe PC nuevas', async () => {
  const env = mkEnv(); const n = await negocio(env);
  const upd = (branchId, body) => call(env, br.onRequestUpdate, '/api/org/branch/update', { as: D, body: { orgId: n.org.id, branchId, ...body } });
  await upsertDevice(env, { id: 'pc-a-0123456789abcdefghijk', sub: 'sd', email: 'duena@x.com', orgId: n.org.id, branchId: n.b });
  assert.equal((await upd(n.b, { active: false })).status, 409, 'tiene una PC: primero se desvincula');
  env.DB.raw.prepare("UPDATE devices SET revoked = 1").run(); assert.equal((await upd(n.b, { active: false })).status, 200);
  assert.equal((await upd(n.a, { active: false })).status, 409, 'es la última activa');
  const STATE = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
  const vincular = async () => authorize.onRequestPost({ request: req('/api/device/authorize', { method: 'POST', cookie: await sess(env, ...D), headers: web, body: { port: 53682, state: STATE, challenge: await sha256b64u('v'.repeat(50)), deviceId: 'nueva-pc-0123456789abcdefg', name: 'PC', orgId: n.org.id, branchId: n.b } }), env });
  assert.equal((await vincular()).status, 400, 'sucursal cerrada');
  assert.equal((await upd(n.b, { active: true })).status, 200); assert.equal((await vincular()).status, 200, 'reabierta');
});
await t('sucursales: una cerrada no se puede asignar a un miembro; los datos de otra sucursal no se mezclan', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, 'emp@x.com', 'sn', 'employee', { branches: [n.a] });
  env.DB.raw.prepare('UPDATE branches SET active = 0 WHERE id = ?').run(n.b);
  assert.equal((await call(env, mem.onRequestUpdate, '/api/org/member/update', { as: D, body: { orgId: n.org.id, memberId: id, branchIds: [n.b] } })).status, 400);
});

// ───────── rutas del Worker
await t('rutas del Worker: existen, exigen sesión y no aceptan otros métodos', async () => {
  const w = (path, method = 'GET') => worker.fetch(new Request('https://horsepos.com' + path, { method, headers: method === 'POST' ? web : {} }), mkEnv(), { waitUntil() {} });
  for (const [m, p] of [['GET', '/api/org/members'], ['POST', '/api/org/member/update'], ['POST', '/api/org/member/remove'], ['POST', '/api/org/invite'], ['GET', '/api/org/invitation'],
    ['POST', '/api/org/invite/revoke'], ['POST', '/api/org/accept'], ['GET', '/api/org/branches'], ['POST', '/api/org/branch'], ['POST', '/api/org/branch/update']]) {
    assert.equal((await w(p, m)).status, 401, `${m} ${p}`);
    assert.equal((await w(p, m === 'GET' ? 'POST' : 'GET')).status, 405, `${p} con otro método`);
  }
});
console.log(`\n${pass} pruebas OK (miembros, invitaciones y sucursales)`);

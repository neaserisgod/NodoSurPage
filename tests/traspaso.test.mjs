// Fase 5: transferencia de propiedad y facturación del negocio.
// Reglas de fondo: (1) el dueño anterior queda como encargado; (2) el mail de cobro NO cambia solo ni a cualquier mail:
// solo a tu propio mail verificado, y solo si ese mail tiene una suscripción vigente; (3) nadie cancela la suscripción
// de otra persona (puede cubrir otros negocios suyos): cancela quien paga.
import assert from 'node:assert/strict';
import { createOrg, ensureOrgTables, membershipsOf } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import { downloadAccess } from '../functions/_lib/access.js';
import { sweep } from '../functions/_lib/sweep.js';
import * as tr from '../functions/api/org/transfer.js';
import * as bill from '../functions/api/org/billing.js';
import * as adminOrg from '../functions/api/admin/org.js';
import * as inv from '../functions/api/org/invitations.js';
import * as devices from '../functions/api/devices.js';
import * as ping from '../functions/api/device/ping.js';
import * as cancel from '../functions/api/subscription/cancel.js';
import * as me from '../functions/api/me.js';
import worker from '../worker.js';
import { puede } from '../functions/_lib/permisos.js';
import { mkEnv, addUser, sess, req, web, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const q = (env, sql, ...a) => env.DB.raw.prepare(sql).all(...a);
const one = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a);
const mails = [];
const mockMail = (ok = true) => { mails.length = 0; const base = globalThis.fetch; globalThis.fetch = async (url, init = {}) => { if (new URL(url).host === 'api.resend.com') { mails.push(JSON.parse(init.body)); return new Response('{}', { status: ok ? 200 : 500 }); } return base(url, init); }; };
const paga = (...emails) => { mp.subs = emails.map((e) => mpSub(e, 'authorized')); mp.fail = false; mockMP(); };

async function negocio(env, duena = ['duena@x.com', 'sd'], orgName = 'La Plazoleta') {
  await ensureOrgTables(env); if (!one(env, 'SELECT 1 x FROM users WHERE sub = ?', duena[1])) addUser(env, duena[0], duena[1]);
  const r = await createOrg(env, { sub: duena[1], email: duena[0], name: 'Dueña', orgName });
  const b2 = env.DB.raw.prepare("INSERT INTO branches (org_id, name, active, created_at) VALUES (?, 'Centro', 1, ?)").run(r.org.id, nowS());
  return { org: r.org, a: r.branch.id, b: Number(b2.lastInsertRowid), dueno: duena };
}
function miembro(env, n, email, sub, role, { all = 0, branches = [] } = {}) {
  if (!one(env, 'SELECT 1 x FROM users WHERE sub = ?', sub)) addUser(env, email, sub);
  const m = env.DB.raw.prepare("INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,'active',?,?)").run(n.org.id, sub, email, role, all, nowS());
  for (const b of branches) env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(m.lastInsertRowid, b);
  return Number(m.lastInsertRowid);
}
const call = async (env, h, path, { as, body, method = 'POST', headers = web } = {}) =>
  h({ request: req(path, { method, cookie: as ? await sess(env, as[0], as[1]) : undefined, headers: method === 'GET' ? {} : headers, body }), env });
const D = ['duena@x.com', 'sd'], N = ['nuevo@x.com', 'sn'];
const iniciar = (env, n, memberId, as = D) => call(env, tr.onRequestPost, '/api/org/transfer', { as, body: { orgId: n.org.id, memberId } });
const aceptar = (env, transferId, as = N) => call(env, tr.onRequestAccept, '/api/org/transfer/accept', { as, body: { transferId } });
const lista = async (env, as) => (await call(env, tr.onRequestGet, '/api/org/transfer', { as, method: 'GET' })).json();
const rol = (env, sub) => one(env, 'SELECT role, all_branches a, status FROM memberships WHERE user_sub = ?', sub);

// ───────── iniciar
await t('iniciar: el dueño elige a un miembro; queda pendiente 7 días y el dueño sigue siéndolo hasta que acepte', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, N[0], N[1], 'manager', { all: 1 });
  const r = await iniciar(env, n, id); assert.equal(r.status, 200); const j = await r.json();
  assert.equal(j.transfer.toEmail, 'nuevo@x.com'); assert.ok(j.transfer.exp - nowS() > 6.9 * 86400 && j.transfer.exp - nowS() <= 7 * 86400);
  assert.equal(one(env, 'SELECT owner_sub o FROM orgs').o, 'sd'); assert.equal(rol(env, 'sd').role, 'owner'); assert.equal(one(env, 'SELECT status s FROM org_transfers').s, 'pending');
});
await t('iniciar: solo el dueño; no a uno mismo, ni a un no-miembro, ni a un miembro quitado, ni de otro negocio', async () => {
  const env = mkEnv(); const n = await negocio(env); const otro = await negocio(env, ['otro@x.com', 'so'], 'Otro');
  const idM = miembro(env, n, N[0], N[1], 'manager', { all: 1 }); const idE = miembro(env, n, 'emp@x.com', 'se', 'employee', { branches: [n.a] });
  const idOtro = miembro(env, otro, 'x@x.com', 'sx', 'employee', { branches: [otro.a] }); const idFuera = miembro(env, n, 'fuera@x.com', 'sf', 'employee', { branches: [n.a] });
  env.DB.raw.prepare("UPDATE memberships SET status = 'removed' WHERE id = ?").run(idFuera);
  assert.equal((await iniciar(env, n, idM, N)).status, 403, 'un encargado no transfiere'); assert.equal((await iniciar(env, n, idE, ['emp@x.com', 'se'])).status, 403);
  const idDueno = one(env, "SELECT id FROM memberships WHERE user_sub = 'sd'").id;
  assert.equal((await iniciar(env, n, idDueno)).status, 400, 'a uno mismo'); assert.equal((await iniciar(env, n, idOtro)).status, 404, 'miembro de otro negocio');
  assert.equal((await iniciar(env, n, idFuera)).status, 404, 'quitado'); assert.equal((await iniciar(env, n, 99999)).status, 404); assert.equal((await iniciar(env, n, 'x')).status, 404);
  assert.equal((await call(env, tr.onRequestPost, '/api/org/transfer', { body: { orgId: n.org.id, memberId: idM } })).status, 401);
  assert.equal((await call(env, tr.onRequestPost, '/api/org/transfer', { as: D, headers: { Origin: 'https://evil.com', 'X-Requested-With': 'fetch' }, body: { orgId: n.org.id, memberId: idM } })).status, 403);
  assert.equal(q(env, 'SELECT * FROM org_transfers').length, 0);
});
await t('iniciar: solo hay una transferencia pendiente por negocio; la nueva reemplaza a la anterior', async () => {
  const env = mkEnv(); const n = await negocio(env); const a = miembro(env, n, N[0], N[1], 'manager', { all: 1 }); const b = miembro(env, n, 'otra@x.com', 'so', 'employee', { branches: [n.a] });
  const t1 = (await (await iniciar(env, n, a)).json()).transfer; const t2 = (await (await iniciar(env, n, b)).json()).transfer;
  assert.equal(one(env, 'SELECT status s FROM org_transfers WHERE id = ?', t1.id).s, 'cancelled'); assert.equal(one(env, 'SELECT status s FROM org_transfers WHERE id = ?', t2.id).s, 'pending');
  assert.equal((await aceptar(env, t1.id)).status, 410, 'la vieja ya no sirve');
  assert.throws(() => env.DB.raw.prepare("INSERT INTO org_transfers (org_id, from_sub, from_email, to_sub, to_email, status, created_at, exp) VALUES (?,?,?,?,?,'pending',?,?)").run(n.org.id, 'sd', 'd', 'x', 'x', 1, 2), /UNIQUE/i);
});
await t('iniciar: se avisa por mail a quien recibe (si está configurado) y el aviso no bloquea nada si falla', async () => {
  const env = mkEnv({ RESEND_API_KEY: 'k', MAIL_FROM: 'hola@horsepos.com' }); const n = await negocio(env); const id = miembro(env, n, N[0], N[1], 'manager', { all: 1 });
  mockMail(true); assert.equal((await iniciar(env, n, id)).status, 200); assert.equal(mails.length, 1); assert.deepEqual(mails[0].to, ['nuevo@x.com']); assert.ok(mails[0].text.includes('La Plazoleta') && mails[0].text.includes('/negocio/'));
  mockMail(false); assert.equal((await iniciar(env, n, id)).status, 200);
});

// ───────── ver pendientes
await t('ver: el dueño ve la que mandó; quien la recibe ve la suya (con el nombre del negocio); nadie más ve nada', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, N[0], N[1], 'manager', { all: 1 }); miembro(env, n, 'emp@x.com', 'se', 'employee', { branches: [n.a] });
  await iniciar(env, n, id);
  const d = await lista(env, D); assert.equal(d.outgoing.length, 1); assert.equal(d.outgoing[0].toEmail, 'nuevo@x.com'); assert.equal(d.outgoing[0].orgId, n.org.id); assert.equal(d.incoming.length, 0);
  const nu = await lista(env, N); assert.equal(nu.incoming.length, 1); assert.equal(nu.incoming[0].orgName, 'La Plazoleta'); assert.equal(nu.incoming[0].fromEmail, 'duena@x.com'); assert.equal(nu.outgoing.length, 0); assert.ok(nu.incoming[0].id);
  const otro = await lista(env, ['emp@x.com', 'se']); assert.deepEqual([otro.incoming.length, otro.outgoing.length], [0, 0]);
  env.DB.raw.prepare('UPDATE org_transfers SET exp = ?').run(nowS() - 1); assert.equal((await lista(env, N)).incoming.length, 0, 'vencida: no se muestra');
  assert.equal((await call(env, tr.onRequestGet, '/api/org/transfer', { method: 'GET' })).status, 401);
  assert.ok(!/"sd"|"sn"/.test(JSON.stringify(nu)), 'sin subs de Google');
});

// ───────── aceptar
await t('aceptar: el nuevo dueño pasa a "owner" con todas las sucursales; el anterior queda de encargado con todas; el mail de cobro no cambia', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, N[0], N[1], 'employee', { branches: [n.a] });
  const tid = (await (await iniciar(env, n, id)).json()).transfer.id; const r = await aceptar(env, tid); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.orgId, n.org.id); assert.equal(j.orgName, 'La Plazoleta');
  assert.equal(one(env, 'SELECT owner_sub o, billing_email b FROM orgs').o, 'sn'); assert.equal(one(env, 'SELECT billing_email b FROM orgs').b, 'duena@x.com', 'el cobro sigue a nombre de quien pagó');
  assert.deepEqual([rol(env, 'sn').role, rol(env, 'sn').a, rol(env, 'sn').status], ['owner', 1, 'active']); assert.equal(q(env, 'SELECT * FROM membership_branches WHERE membership_id = ?', id).length, 0, 'ya no depende de una lista');
  assert.deepEqual([rol(env, 'sd').role, rol(env, 'sd').a, rol(env, 'sd').status], ['manager', 1, 'active']);
  assert.equal(q(env, "SELECT * FROM memberships WHERE role = 'owner'").length, 1, 'un solo dueño');
  assert.equal(one(env, 'SELECT status s FROM org_transfers').s, 'accepted'); assert.equal((await aceptar(env, tid)).status, 410, 'no se acepta dos veces');
});
await t('aceptar: solo quien la recibe; no vencida; ni si el dueño ya cambió, ni si dejó de ser miembro', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, N[0], N[1], 'manager', { all: 1 }); addUser(env, 'otra@x.com', 'so');
  const tid = (await (await iniciar(env, n, id)).json()).transfer.id;
  assert.equal((await aceptar(env, tid, ['otra@x.com', 'so'])).status, 403); assert.equal((await aceptar(env, tid, D)).status, 403, 'ni el dueño que la mandó'); assert.equal((await aceptar(env, tid, null)).status, 401);
  assert.equal((await aceptar(env, 99999)).status, 404); assert.equal((await aceptar(env, 'x')).status, 400);
  env.DB.raw.prepare('UPDATE org_transfers SET exp = ?').run(nowS() - 1); assert.equal((await aceptar(env, tid)).status, 410);
  env.DB.raw.prepare("UPDATE org_transfers SET exp = ?, status = 'pending'").run(nowS() + 999); env.DB.raw.prepare("UPDATE memberships SET status = 'removed' WHERE user_sub = 'sn'").run(); assert.equal((await aceptar(env, tid)).status, 409, 'dejó de ser miembro');
  env.DB.raw.prepare("UPDATE memberships SET status = 'active' WHERE user_sub = 'sn'").run(); env.DB.raw.prepare("UPDATE orgs SET owner_sub = 'otro'").run(); assert.equal((await aceptar(env, tid)).status, 409, 'el dueño ya no es el que la mandó');
  assert.equal(rol(env, 'sd').role, 'owner'); assert.equal(rol(env, 'sn').role, 'manager', 'nada cambió');
});
await t('rechazar y cancelar: quien la recibe la rechaza, el dueño la cancela; ninguna toca los roles', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, N[0], N[1], 'manager', { all: 1 });
  let tid = (await (await iniciar(env, n, id)).json()).transfer.id;
  const rechazar = (as, transferId) => call(env, tr.onRequestDecline, '/api/org/transfer/decline', { as, body: { transferId } });
  assert.equal((await rechazar(D, tid)).status, 403); assert.equal((await rechazar(N, tid)).status, 200); assert.equal(one(env, 'SELECT status s FROM org_transfers WHERE id = ?', tid).s, 'declined'); assert.equal((await rechazar(N, tid)).status, 410);
  tid = (await (await iniciar(env, n, id)).json()).transfer.id;
  const cancelar = (as, orgId = n.org.id) => call(env, tr.onRequestCancel, '/api/org/transfer/cancel', { as, body: { orgId } });
  assert.equal((await cancelar(N)).status, 403); assert.equal((await cancelar(D)).status, 200); assert.equal(one(env, 'SELECT status s FROM org_transfers WHERE id = ?', tid).s, 'cancelled'); assert.equal((await cancelar(D)).status, 404, 'ya no hay nada pendiente');
  assert.equal((await aceptar(env, tid)).status, 410); assert.equal(rol(env, 'sd').role, 'owner');
});

await t('quitar a alguien retira la propuesta de transferencia que tenía pendiente (no queda colgada)', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, N[0], N[1], 'manager', { all: 1 }); const tid = (await (await iniciar(env, n, id)).json()).transfer.id;
  const quitar = await call(env, (await import('../functions/api/org/members.js')).onRequestRemove, '/api/org/member/remove', { as: D, body: { orgId: n.org.id, memberId: id } }); assert.equal(quitar.status, 200);
  assert.equal(one(env, 'SELECT status s FROM org_transfers WHERE id = ?', tid).s, 'cancelled'); assert.equal((await lista(env, N)).incoming.length, 0); assert.equal((await lista(env, D)).outgoing.length, 0);
});

// ───────── después de transferir
await t('después: el nuevo dueño administra (invita, ve las PC del negocio); el anterior ya no; las PC que vinculó el anterior siguen andando', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, N[0], N[1], 'manager', { all: 1 });
  await upsertDevice(env, { id: 'pc-vieja-0123456789abcdefghi', sub: 'sd', email: 'duena@x.com', orgId: n.org.id, branchId: n.a });
  const tok = await signDeviceToken(env, { sub: 'sd', email: 'duena@x.com', deviceId: 'pc-vieja-0123456789abcdefghi' });
  const viva = async () => (await ping.onRequestPost({ request: req('/api/device/ping', { method: 'POST', body: {}, headers: { Authorization: `Bearer ${tok}` } }), env })).status;
  assert.equal(await viva(), 200);
  await aceptar(env, (await (await iniciar(env, n, id)).json()).transfer.id);
  assert.equal(await viva(), 200, 'el negocio no se queda sin caja el día de la transferencia');
  const invitar = (as) => call(env, inv.onRequestPost, '/api/org/invite', { as, body: { orgId: n.org.id, email: 'nueva@x.com', role: 'employee', allBranches: true } });
  assert.equal((await invitar(N)).status, 200); assert.equal((await invitar(D)).status, 403, 'la dueña anterior ya no invita');
  const ver = async (as) => (await (await call(env, devices.onRequestGet, '/api/devices', { as, method: 'GET' })).json()).devices.map((d) => d.id);
  assert.deepEqual(await ver(N), ['pc-vieja-0123456789abcdefghi'], 'el nuevo dueño ve las PC del negocio'); assert.deepEqual(await ver(D), ['pc-vieja-0123456789abcdefghi'], 'y el anterior ve la suya');
  const m = (await membershipsOf(env, 'sd'))[0]; assert.equal(puede(m, 'transferir'), false); assert.equal(puede((await membershipsOf(env, 'sn'))[0], 'transferir'), true);
  assert.equal((await iniciar(env, n, one(env, "SELECT id FROM memberships WHERE user_sub = 'sd'").id, N)).status, 200, 'el nuevo dueño puede, a su vez, transferir de vuelta');
});
await t('después: si el nuevo dueño quita a la dueña anterior, las PC que ella vinculó dejan de funcionar (se avisa en pantalla)', async () => {
  const env = mkEnv(); const n = await negocio(env); const id = miembro(env, n, N[0], N[1], 'manager', { all: 1 });
  await upsertDevice(env, { id: 'pc-vieja-0123456789abcdefghi', sub: 'sd', email: 'duena@x.com', orgId: n.org.id, branchId: n.a });
  const tok = await signDeviceToken(env, { sub: 'sd', email: 'duena@x.com', deviceId: 'pc-vieja-0123456789abcdefghi' });
  await aceptar(env, (await (await iniciar(env, n, id)).json()).transfer.id);
  env.DB.raw.prepare("UPDATE memberships SET status = 'removed' WHERE user_sub = 'sd'").run();
  assert.equal((await ping.onRequestPost({ request: req('/api/device/ping', { method: 'POST', body: {}, headers: { Authorization: `Bearer ${tok}` } }), env })).status, 401);
});

// ───────── facturación
const verFact = (env, n, as) => call(env, bill.onRequestGet, `/api/org/billing?org=${n.org.id}`, { as, method: 'GET' });
const usarMia = (env, n, as, extra = {}) => call(env, bill.onRequestPost, '/api/org/billing', { as, body: { orgId: n.org.id, action: 'use_mine', ...extra } });
async function traspasado(env) { const n = await negocio(env); const id = miembro(env, n, N[0], N[1], 'manager', { all: 1 }); await aceptar(env, (await (await iniciar(env, n, id)).json()).transfer.id); return n; }

await t('facturación: el dueño ve quién paga (enmascarado si no es él) y el estado; un encargado o empleado no la ve', async () => {
  const env = mkEnv(); const n = await traspasado(env); paga('duena@x.com'); miembro(env, n, 'emp@x.com', 'se', 'employee', { branches: [n.a] });
  const j = await (await verFact(env, n, N)).json(); assert.equal(j.mine, false); assert.equal(j.billingEmail, 'd***@x.com'); assert.equal(j.status, 'authorized'); assert.equal(j.ownHasSubscription, false);
  assert.ok(!JSON.stringify(j).includes('duena@x.com'), 'el mail de la persona anterior no se muestra completo'); assert.ok(j.subscriptions.every((s) => !('id' in s)), 'ni ids de suscripción');
  assert.equal((await verFact(env, n, D)).status, 403, 'la dueña anterior (ahora encargada) no ve facturación'); assert.equal((await verFact(env, n, ['emp@x.com', 'se'])).status, 403);
  assert.equal((await call(env, bill.onRequestGet, `/api/org/billing?org=${n.org.id}`, { method: 'GET' })).status, 401);
});
await t('facturación: si el negocio no tiene suscripción vigente, o Mercado Pago falla, lo dice', async () => {
  const env = mkEnv(); const n = await traspasado(env); mp.subs = []; mp.fail = false; mockMP();
  assert.equal((await (await verFact(env, n, N)).json()).status, 'none'); mp.fail = true; mockMP(); const j = await (await verFact(env, n, N)).json(); assert.equal(j.mpError, true); assert.equal(j.status, 'unknown');
});
await t('facturación: pasar el cobro a la suscripción propia exige que SEA propia y esté vigente; no se puede apuntar a otro mail', async () => {
  const env = mkEnv(); const n = await traspasado(env); paga('duena@x.com');
  assert.equal((await usarMia(env, n, N)).status, 409, 'sin suscripción propia no se suelta la que cubre al negocio'); assert.equal(one(env, 'SELECT billing_email b FROM orgs').b, 'duena@x.com');
  paga('duena@x.com', 'victima@x.com'); assert.equal((await usarMia(env, n, N, { email: 'victima@x.com', billingEmail: 'victima@x.com' })).status, 409, 'un mail ajeno no se acepta: "victima" paga, pero el dueño no es victima');
  assert.notEqual(one(env, 'SELECT billing_email b FROM orgs').b, 'victima@x.com');
  paga('duena@x.com', 'nuevo@x.com'); assert.equal((await usarMia(env, n, N, { email: 'victima@x.com' })).status, 200); assert.equal(one(env, 'SELECT billing_email b FROM orgs').b, 'nuevo@x.com', 'siempre el mail de SU sesión, nunca el del cuerpo');
  assert.equal((await usarMia(env, n, N)).status, 200, 'repetirlo no rompe nada');
  assert.equal((await usarMia(env, n, N, { action: 'otra' })).status, 400); assert.equal((await usarMia(env, n, D)).status, 403); assert.equal((await usarMia(env, n, undefined)).status, 401);
  assert.equal((await call(env, bill.onRequestPost, '/api/org/billing', { as: N, headers: { Origin: 'https://evil.com', 'X-Requested-With': 'fetch' }, body: { orgId: n.org.id, action: 'use_mine' } })).status, 403);
});
await t('facturación: sin Mercado Pago configurado o caído no se cambia nada', async () => {
  const env = mkEnv(); const n = await traspasado(env); paga('nuevo@x.com'); mp.fail = true; mockMP();
  assert.equal((await usarMia(env, n, N)).status, 502); assert.equal(one(env, 'SELECT billing_email b FROM orgs').b, 'duena@x.com');
  const sinMP = mkEnv({ MP_ACCESS_TOKEN: '' }); const n2 = await traspasado(sinMP); assert.equal((await usarMia(sinMP, n2, N)).status, 503);
});
await t('facturación: después de pasar el cobro, el acceso del negocio sigue a la suscripción nueva (aunque la anterior se cancele)', async () => {
  const env = mkEnv(); const n = await traspasado(env); paga('duena@x.com', 'nuevo@x.com'); await usarMia(env, n, N);
  paga('nuevo@x.com'); // la dueña anterior canceló la suya
  assert.equal((await downloadAccess(env, { session: { sub: 'sn', email: 'nuevo@x.com' }, user: null })).ok, true);
  mp.subs = []; mockMP(); assert.equal((await downloadAccess(env, { session: { sub: 'sn', email: 'nuevo@x.com' }, user: null })).ok, false, 'y si cancela la nueva, se corta');
  assert.ok(n);
});
await t('cancelar una suscripción: solo quien paga; el nuevo dueño NO puede cancelar la de la dueña anterior (puede cubrir otros negocios suyos)', async () => {
  const env = mkEnv(); const n = await traspasado(env); paga('duena@x.com'); mp.subs = mp.subs.map((x) => ({ ...x, id: 'sub_duena_1' })); // ids reales de Mercado Pago: sin @ ni puntos
  const base = globalThis.fetch; globalThis.fetch = async (url, init = {}) => (new URL(url).pathname.startsWith('/preapproval/') && init.method === 'PUT' ? new Response('{}', { status: 200 }) : base(url, init));
  const cancelar = async (as) => cancel.onRequestPost({ request: req('/api/subscription/cancel', { method: 'POST', cookie: await sess(env, as[0], as[1]), headers: web, body: { id: 'sub_duena_1' } }), env });
  assert.equal((await cancelar(N)).status, 403); assert.equal((await cancelar(D)).status, 200, 'quien paga, sí'); assert.ok(n);
});
await t('/api/me: el nuevo dueño no es molestado con "elegí tu sistema" mientras el negocio esté cubierto por otra persona', async () => {
  const env = mkEnv(); const n = await traspasado(env); paga('duena@x.com');
  const ver = async () => { const r = await me.onRequestGet({ request: req('/api/me', { cookie: await sess(env, ...N) }), env }); return { j: await r.json(), c: r.headers.getSetCookie().join('|') }; };
  let r = await ver(); assert.equal(r.j.covered, true); assert.match(r.c, /ns_sub=1/);
  mp.subs = []; mockMP(); r = await ver(); assert.equal(r.j.covered, false); assert.match(r.c, /ns_sub=0/, 'sin cobertura, vuelve el aviso');
  paga('nuevo@x.com'); r = await ver(); assert.equal(r.j.covered, false, 'con suscripción propia no hace falta'); assert.ok(r.j.subscriptions.length === 1); assert.ok(n);
});
await t('barrido: tras la transferencia, el nuevo dueño queda cubierto por el negocio mientras alguien lo pague', async () => {
  const env = mkEnv(); const n = await traspasado(env); const viejo = nowS() - 90 * 86400; env.DB.raw.prepare('UPDATE users SET created_at = ?, last_seen = ?').run(viejo, viejo);
  paga('duena@x.com'); const r = await sweep(env, { apply: false }); assert.deepEqual(r.actions, []); assert.ok(n);
});

// ───────── el administrador de la plataforma ajusta el mail de cobro (caso de soporte)
await t('administrador: puede ajustar el mail de cobro de un negocio; nadie más; con un mail válido y un negocio que exista', async () => {
  const env = mkEnv(); const n = await negocio(env); addUser(env, 'admin@x.com', 'sa');
  const ajustar = (as, body) => call(env, adminOrg.onRequestPost, '/api/admin/org', { as, body });
  assert.equal((await ajustar(D, { orgId: n.org.id, billingEmail: 'x@x.com' })).status, 403); assert.equal((await ajustar(undefined, { orgId: n.org.id, billingEmail: 'x@x.com' })).status, 401);
  const A = ['admin@x.com', 'sa'];
  assert.equal((await ajustar(A, { orgId: n.org.id, billingEmail: ' Pago@X.com ' })).status, 200); assert.equal(one(env, 'SELECT billing_email b FROM orgs').b, 'pago@x.com');
  for (const mala of [{ billingEmail: 'no' }, { billingEmail: '' }, { billingEmail: 'a b@x.com' }]) assert.equal((await ajustar(A, { orgId: n.org.id, ...mala })).status, 400, JSON.stringify(mala));
  assert.equal((await ajustar(A, { orgId: 999, billingEmail: 'x@x.com' })).status, 404); assert.equal((await ajustar(A, { orgId: 'x', billingEmail: 'x@x.com' })).status, 400);
  assert.equal((await call(env, adminOrg.onRequestPost, '/api/admin/org', { as: A, headers: { Origin: 'https://evil.com', 'X-Requested-With': 'fetch' }, body: { orgId: n.org.id, billingEmail: 'x@x.com' } })).status, 403);
});

await t('rutas del Worker: existen, exigen sesión y no aceptan otros métodos', async () => {
  const w = (path, method = 'GET') => worker.fetch(new Request('https://horsepos.com' + path, { method, headers: method === 'POST' ? web : {} }), mkEnv(), { waitUntil() {} });
  for (const [m, p] of [['GET', '/api/org/transfer'], ['POST', '/api/org/transfer'], ['POST', '/api/org/transfer/accept'], ['POST', '/api/org/transfer/decline'], ['POST', '/api/org/transfer/cancel'], ['GET', '/api/org/billing'], ['POST', '/api/org/billing'], ['POST', '/api/admin/org']]) {
    assert.equal((await w(p, m)).status, 401, `${m} ${p}`);
    assert.equal((await w(p, 'DELETE')).status, 405, `${p} con otro método`);
  }
});
console.log(`\n${pass} pruebas OK (transferencia de propiedad y facturación)`);

// Cada plan cubre su producto, y el de Gestión trae incluido un negocio de Estudio o de Gastro con bot (2026-10-19,
// `functions/_lib/plan_por_negocio.js`, `Nodo-Sur-Pos/docs/PLAN-CUENTAS.md`).
import assert from 'node:assert/strict';
import { ensureOrgTables, createOrg } from '../functions/_lib/orgs.js';
import { planDelNegocio, planCubreProducto, repartir } from '../functions/_lib/plan_por_negocio.js';
import { usarMiSuscripcion, estadoFacturacion } from '../functions/_lib/facturacion.js';
import { downloadAccess } from '../functions/_lib/access.js';
import { listSubscriptions } from '../functions/_lib/mp.js';
import { mkEnv, mp, mpSub, mockMP } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const ID = { pos: '6fe282d944ef4c018cb7904ce9e122f8', posBot: '7652202c076c4cc180c72ade28d52924', bot: 'e37aac4650334685873aa8e3920de4c0', estudio: 'd28fa6d60f614b8c9a16bfc78ac31f0c' };
const paga = (email, ...planes) => { mp.subs = planes.map((p, i) => ({ ...mpSub(email, 'authorized'), id: `${email}-${i}`, preapproval_plan_id: ID[p] })); mp.fail = false; mockMP(); };
const negocio = async (env, nombre, producto, email = 'ana@x.com') => {
  const { org } = await createOrg(env, { sub: 's1', email, name: 'Ana', orgName: nombre });
  env.DB.raw.prepare('UPDATE orgs SET producto = ? WHERE id = ?').run(producto, org.id);
  return env.DB.raw.prepare('SELECT * FROM orgs WHERE id = ?').get(org.id);
};
const cubre = async (env, org) => planDelNegocio(env, org, await listSubscriptions(env, org.billing_email));

await t('plan de Gestión: cubre el almacén (sin bot) y, incluida, la rotisería (con bot)', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  const almacen = await negocio(env, 'Almacén', 'gestion'); const roti = await negocio(env, 'Rotisería', 'gastro');
  paga('ana@x.com', 'pos');
  assert.deepEqual(await cubre(env, almacen), { pago: true, bot: false, incluido: false, planes: 1, negocios: 2 });
  assert.deepEqual(await cubre(env, roti), { pago: true, bot: true, incluido: true, planes: 1, negocios: 2 });
});
await t('el incluido es uno solo: Estudio o Gastro, no los dos', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  await negocio(env, 'Almacén', 'gestion'); const unias = await negocio(env, 'Uñas', 'estudio'); const roti = await negocio(env, 'Rotisería', 'gastro');
  paga('ana@x.com', 'pos');
  assert.equal((await cubre(env, unias)).pago, true, 'el más viejo de los dos');
  assert.equal((await cubre(env, roti)).pago, false);
});
await t('pagando Nodo Estudio no se cubre una caja de Gestión', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  const almacen = await negocio(env, 'Almacén', 'gestion'); const unias = await negocio(env, 'Uñas', 'estudio');
  paga('ana@x.com', 'estudio');
  assert.equal((await cubre(env, almacen)).pago, false);
  assert.deepEqual(await cubre(env, unias), { pago: true, bot: true, incluido: false, planes: 1, negocios: 2 });
});
await t('cada negocio toma el lugar más justo: Estudio usa su plan y deja el incluido para la rotisería', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  const unias = await negocio(env, 'Uñas', 'estudio'); const almacen = await negocio(env, 'Almacén', 'gestion'); const roti = await negocio(env, 'Rotisería', 'gastro');
  paga('ana@x.com', 'estudio', 'pos');
  for (const o of [unias, almacen, roti]) assert.equal((await cubre(env, o)).pago, true, o.name);
  assert.equal((await cubre(env, unias)).incluido, false); assert.equal((await cubre(env, roti)).incluido, true);
});
await t('negocios sin producto todavía: como siempre (un plan, un negocio), y no usan el incluido', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  const a = await negocio(env, 'Viejo 1', null); const b = await negocio(env, 'Viejo 2', null);
  paga('ana@x.com', 'pos');
  assert.equal((await cubre(env, a)).pago, true); assert.equal((await cubre(env, b)).pago, false);
});
await t('Sistema + Bot: el bot va al de Gestión, y el incluido también lo tiene', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  const almacen = await negocio(env, 'Almacén', 'gestion'); const unias = await negocio(env, 'Uñas', 'estudio');
  paga('ana@x.com', 'posBot');
  assert.equal((await cubre(env, almacen)).bot, true); assert.equal((await cubre(env, unias)).bot, true);
});
await t('un plan viejo que no es de ningún producto (Solo el bot) sigue cubriendo cualquiera', () => {
  const m = repartir([{ id: 1, producto: 'gastro' }], [{ status: 'authorized', plan: 'Solo el bot' }]);
  assert.equal(m.get(1).bot, true);
  assert.equal(planCubreProducto('Solo el bot', 'gestion'), true);
  assert.equal(planCubreProducto('Emprendedor', 'gestion'), false); assert.equal(planCubreProducto('Emprendedor', 'estudio'), true);
  assert.equal(planCubreProducto('Sistema POS', 'gastro'), true, 'por el incluido');
  assert.equal(planCubreProducto('Nodo Gastro', 'estudio'), false);
});
await t('descargas: con Nodo Estudio se baja su app pero no la caja; con Gestión, las tres', async () => {
  const env = mkEnv({ MP_ACCESS_TOKEN: 'tok' }); await ensureOrgTables(env);
  const cu = { session: { sub: 's1', email: 'ana@x.com' }, user: null };
  paga('ana@x.com', 'estudio');
  assert.equal((await downloadAccess(env, cu, 'estudio')).ok, true);
  const no = await downloadAccess(env, cu, 'gestion'); assert.equal(no.ok, false); assert.equal(no.reason, 'no_subscription');
  assert.equal((await downloadAccess(env, cu)).ok, true, 'sin producto (la lista de descargas), como antes');
  paga('ana@x.com', 'pos');
  for (const p of ['gestion', 'estudio', 'gastro']) assert.equal((await downloadAccess(env, cu, p)).ok, true, p);
});
await t('"usar mi suscripción" mira el producto: el incluido libre sirve para Estudio, no para otro Gestión', async () => {
  const env = mkEnv(); await ensureOrgTables(env);
  await negocio(env, 'Almacén', 'gestion');
  const unias = await negocio(env, 'Uñas de Beto', 'estudio', 'beto@x.com');
  const otraCaja = await negocio(env, 'Kiosco de Beto', 'gestion', 'beto@x.com');
  paga('ana@x.com', 'pos');
  assert.deepEqual(await usarMiSuscripcion(env, otraCaja, 'ana@x.com'), { status: 409, error: 'sin_plan_libre' });
  assert.deepEqual(await usarMiSuscripcion(env, unias, 'ana@x.com'), { ok: true });
});
await t('Mi negocio dice cuándo el negocio viene incluido en el plan de Gestión', async () => {
  const env = mkEnv({ MP_ACCESS_TOKEN: 'tok' }); await ensureOrgTables(env);
  const almacen = await negocio(env, 'Almacén', 'gestion'); const roti = await negocio(env, 'Rotisería', 'gastro');
  paga('ana@x.com', 'pos');
  const e = await estadoFacturacion(env, roti, 'ana@x.com'); assert.equal(e.status, 'authorized'); assert.equal(e.incluido, true);
  assert.equal((await estadoFacturacion(env, almacen, 'ana@x.com')).incluido, false);
});

console.log(`\n${pass} pruebas OK (cobro por producto)`);

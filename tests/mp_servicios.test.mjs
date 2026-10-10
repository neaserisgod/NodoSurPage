// Mercado Pago para Nodo Sur Servicios (`functions/_lib/mp_servicios.js`): el QR en la pantalla del celular, la seña por link que
// manda el bot, su confirmación cuando Mercado Pago avisa el pago y la devolución. Mercado Pago está simulado.
import assert from 'node:assert/strict';
import { createOrg, ensureOrgTables } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import * as conexion from '../functions/api/mp/conexion.js';
import * as orden from '../functions/api/mp/orden.js';
import * as bot from '../functions/api/bot.js';
import { procesarAvisoMp } from '../functions/_lib/mp_avisos.js';
import { idCajaQr, referenciaSena } from '../functions/_lib/mp_servicios.js';
import { mkEnv, addUser, sess, req, web, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const MP_ENV = { MP_CLIENT_ID: '7309232869105658', MP_CLIENT_SECRET: 'secreto-falso' };
const PLAN_SOLO_BOT = 'e37aac4650334685873aa8e3920de4c0';
const CUENTA = 241983636;

function simular() {
  const m = { llamadas: [], cajas: [], locales: [{ id: 555, name: 'Local' }], pagos: {}, devoluciones: [] };
  mp.subs = [{ ...mpSub('duena@x.com', 'authorized'), preapproval_plan_id: PLAN_SOLO_BOT }]; mp.fail = false; mockMP();
  const sub = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host !== 'api.mercadopago.com' || u.pathname.startsWith('/preapproval')) return sub(url, init);
    const cuerpo = init.body ? JSON.parse(init.body) : null;
    m.llamadas.push({ path: u.pathname + u.search, metodo: init.method || 'GET', cuerpo, headers: init.headers || {} });
    const r = (j, status = 200) => new Response(JSON.stringify(j), { status });
    if (u.pathname === '/oauth/token') return r({ access_token: 'token-falso', refresh_token: 'refresh-falso', expires_in: 15552000, scope: 'read write offline_access', user_id: CUENTA, live_mode: true });
    if (u.pathname === '/pos' && (init.method || 'GET') === 'GET') return r({ results: m.cajas.filter((c) => c.external_id === u.searchParams.get('external_id')) });
    if (u.pathname === '/pos' && init.method === 'POST') { m.cajas.push(cuerpo); return r({ id: m.cajas.length, ...cuerpo }, 201); }
    if (u.pathname === `/users/${CUENTA}/stores/search`) return r({ results: m.locales });
    if (u.pathname === '/v1/orders' && init.method === 'POST') return r({ id: 'ORDQR1', status: 'created', type_response: { qr_data: '00020101021243650016COM.MERCADOLIBRE0201306' } }, 201);
    if (u.pathname === '/checkout/preferences' && init.method === 'POST') return r({ id: 'PREF1', init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=PREF1' }, 201);
    const pago = /^\/v1\/payments\/(\w+)$/.exec(u.pathname);
    if (pago && m.pagos[pago[1]]) return r(m.pagos[pago[1]]);
    const dev = /^\/v1\/payments\/(\w+)\/refunds$/.exec(u.pathname);
    if (dev) { m.devoluciones.push({ id: dev[1], clave: (init.headers || {})['X-Idempotency-Key'] }); return r({ id: 9, status: 'approved' }, 201); }
    return r({ message: 'not found' }, 404);
  };
  return m;
}

async function armar({ conectar = true } = {}) {
  const env = mkEnv(MP_ENV); const m = simular();
  env.SYNC_HUB = { idFromName: (x) => x, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) };
  await ensureOrgTables(env); addUser(env, 'duena@x.com', 'sd');
  const n = await createOrg(env, { sub: 'sd', email: 'duena@x.com', name: 'Caro', orgName: 'Caro Uñas' });
  if (conectar) {
    const cookie = await sess(env, 'duena@x.com', 'sd');
    const { url } = await (await conexion.onRequestConnect({ request: req('/api/mp/conectar', { method: 'POST', cookie, headers: web, body: { orgId: n.org.id } }), env })).json();
    const state = new URL(url).searchParams.get('state');
    await conexion.onRequestCallback({ request: req(`/api/mp/callback?code=codigo-falso&state=${state}`, { cookie }), env });
  }
  const equipo = async (id, kind) => {
    await upsertDevice(env, { id, sub: 'sd', email: 'duena@x.com', name: kind, orgId: n.org.id, branchId: n.branch.id, kind });
    return { Authorization: `Bearer ${await signDeviceToken(env, { sub: 'sd', email: 'duena@x.com', deviceId: id })}` };
  };
  return { env, m, n, app: await equipo('cel-caro-0123456789abcdefgh', 'celular'), robot: await equipo('bot-caro-0123456789abcdefgh', 'bot') };
}
const post = (fn, env, path, body, headers) => fn({ request: req(path, { method: 'POST', headers, body }), env });

const H = 3600 * 1000;
const manana10 = (() => { const d = new Date(Date.now() + 24 * H); d.setHours(10, 0, 0, 0); return d.getTime(); })();
const turno = (id, extra = {}) => ({
  id, inicio: manana10, fin: manana10 + H, estado: 'esperando_sena', senaPedidaCentavos: 500000,
  cliente: { nombre: 'Ana', telefono: '5492944111111' }, servicio: { gid: 'g-semi', nombre: 'Semipermanente' }, ...extra,
});

await t('QR en pantalla: crea la caja la primera vez (en el local que ya tiene la cuenta) y devuelve la trama para dibujar', async () => {
  const { env, m, n, app } = await armar();
  const pedir = (ref) => post(orden.onRequestPost, env, '/api/mp/orden', { externalReference: ref, idempotencyKey: `clave-${ref}`, montoCentavos: 1500000, canal: 'qr_pantalla' }, app);
  const r = await pedir('venta-0001');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.id, 'ORDQR1'); assert.match(j.qrData, /^000201/);
  assert.deepEqual(m.cajas, [{ name: 'Nodo Sur', store_id: '555', external_id: idCajaQr(n.org.id, n.branch.id), fixed_amount: true }]);
  const ordenQr = m.llamadas.find((x) => x.path === '/v1/orders');
  assert.equal(ordenQr.cuerpo.type, 'qr');
  assert.deepEqual(ordenQr.cuerpo.config.qr, { external_pos_id: idCajaQr(n.org.id, n.branch.id), mode: 'dynamic' });
  assert.deepEqual(ordenQr.cuerpo.transactions.payments, [{ amount: '15000.00' }]);
  await pedir('venta-0002');
  assert.equal(m.cajas.length, 1, 'la caja se crea una sola vez');
});

await t('QR en pantalla sin ningún local en la cuenta: avisa (409 mp_sin_local) en vez de inventar una ubicación', async () => {
  const { env, m, app } = await armar();
  m.locales = [];
  const r = await post(orden.onRequestPost, env, '/api/mp/orden', { externalReference: 'venta-0001', idempotencyKey: 'clave-0001', montoCentavos: 1500000, canal: 'qr_pantalla' }, app);
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'mp_sin_local');
});

await t('la seña: al reservar, el bot recibe el link (vence a la media hora); reintentar da el mismo; el pago confirma el turno', async () => {
  const { env, m, n, robot } = await armar();
  const r = await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-sena-0001'), robot);
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.match(j.sena.url, /^https:\/\/www\.mercadopago\.com\.ar\//);
  assert.ok(j.sena.vence - Date.now() <= 30 * 60 * 1000 + 1000);
  const pref = m.llamadas.find((x) => x.path === '/checkout/preferences').cuerpo;
  assert.equal(pref.external_reference, referenciaSena('turno-sena-0001'));
  assert.equal(pref.items[0].unit_price, 5000); assert.equal(pref.binary_mode, true); assert.equal(pref.expires, true);
  assert.equal(pref.notification_url, 'https://horsepos.com/api/mp/webhook');
  assert.equal((await (await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-sena-0001'), robot)).json()).sena.url, j.sena.url);
  assert.equal(m.llamadas.filter((x) => x.path === '/checkout/preferences').length, 1);

  // Mercado Pago avisa el pago.
  m.pagos['77001'] = { id: 77001, status: 'approved', transaction_amount: 5000, external_reference: referenciaSena('turno-sena-0001'), collector_id: CUENTA, payment_type_id: 'account_money', date_approved: new Date().toISOString() };
  const aviso = await procesarAvisoMp(env, { tema: 'payment', id: '77001', userId: CUENTA });
  assert.ok(!aviso.ignorado);
  const cambios = await (await bot.onRequestTurnosGet({ request: req('/api/bot/turnos?desde=0', { headers: robot }), env })).json();
  const x = cambios.turnos.find((y) => y.id === 'turno-sena-0001');
  assert.equal(x.estado, 'confirmado');
  assert.deepEqual({ centavos: x.senaPagada.centavos, pagoId: x.senaPagada.pagoId }, { centavos: 500000, pagoId: '77001' });
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM mp_avisos').get().n, 0, 'no queda como "cobro sin venta"');
  // El mismo aviso otra vez no cambia nada.
  await procesarAvisoMp(env, { tema: 'payment', id: '77001', userId: CUENTA });
  assert.equal(env.DB.raw.prepare("SELECT estado FROM bot_turnos WHERE turno_id = 'turno-sena-0001'").get().estado, 'confirmado');
  void n;
});

await t('sin Mercado Pago conectado no hay link: el bot sigue con el alias', async () => {
  const { env, robot } = await armar({ conectar: false });
  const j = await (await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-sena-0002'), robot)).json();
  assert.equal(j.sena, undefined);
});

await t('pagó después de que se liberó el horario: queda como "pagó tarde" para que la dueña decida, sin revivir el turno', async () => {
  const { env, m, robot } = await armar();
  await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-sena-0003'), robot);
  await post(bot.onRequestTurnoCambio, env, '/api/bot/turno/cambio', { id: 'turno-sena-0003', estado: 'cancelado' }, robot);
  m.pagos['77003'] = { id: 77003, status: 'approved', transaction_amount: 5000, external_reference: referenciaSena('turno-sena-0003'), collector_id: CUENTA };
  await procesarAvisoMp(env, { tema: 'payment', id: '77003', userId: CUENTA });
  const x = (await (await bot.onRequestTurnosGet({ request: req('/api/bot/turnos?desde=0', { headers: robot }), env })).json()).turnos.find((y) => y.id === 'turno-sena-0003');
  assert.equal(x.estado, 'cancelado');
  assert.equal(x.senaPagada.tarde, true);
});

await t('devolver la seña: una sola vez aunque se repita; sin seña por Mercado Pago no hay qué devolver', async () => {
  const { env, m, app, robot } = await armar();
  await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-sena-0004'), robot);
  const devolver = (id) => post(orden.onRequestDevolverSena, env, '/api/mp/sena/devolver', { turnoId: id }, app);
  assert.equal((await devolver('turno-sena-0004')).status, 409, 'todavía no pagó');
  m.pagos['77004'] = { id: 77004, status: 'approved', transaction_amount: 5000, external_reference: referenciaSena('turno-sena-0004'), collector_id: CUENTA };
  await procesarAvisoMp(env, { tema: 'payment', id: '77004', userId: CUENTA });
  const r = await devolver('turno-sena-0004');
  assert.equal(r.status, 200); assert.equal((await r.json()).centavos, 500000);
  assert.equal((await devolver('turno-sena-0004')).status, 200);
  assert.deepEqual(m.devoluciones, [{ id: '77004', clave: 'devolver-sena-turno-sena-0004' }]);
  assert.equal((await devolver('turno-no-existe-01')).status, 404);
});

console.log(`${pass} pruebas de Mercado Pago para servicios OK`);

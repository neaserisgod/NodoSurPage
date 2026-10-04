// Conexión de cada negocio con SU cuenta de Mercado Pago (OAuth + PKCE) y cobros Point a través del servidor.
// Mercado Pago está simulado: lo que se prueba es lo que hace NUESTRO servidor con lo que responde.
import assert from 'node:assert/strict';
import { createOrg, ensureOrgTables } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import { sha256b64u } from '../functions/_lib/util.js';
import * as conexion from '../functions/api/mp/conexion.js';
import * as orden from '../functions/api/mp/orden.js';
import * as mpSaldo from '../functions/api/admin/mp_saldo.js';
import * as mpReporte from '../functions/api/admin/mp_reporte.js';
import * as mpWebhook from '../functions/api/mp/webhook.js';
import { createHmac } from 'node:crypto';
import { tokenDe, detalleError, registrarActividad, ensureMpTables } from '../functions/_lib/mp_conexion.js';
import { mkEnv, addUser, sess, req, web, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const one = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a);
const MP_ENV = { MP_CLIENT_ID: '7309232869105658', MP_CLIENT_SECRET: 'secreto-falso' };

// Mercado Pago simulado. `m.llamadas` guarda cada pedido; `m.refresh` cuenta las renovaciones y entrega tokens nuevos cada vez.
function simular() {
  const m = { llamadas: [], refresh: 0, tokenRechazado: false, terminales: [{ id: 'PAX_A910__SERIE1', operating_mode: 'STANDALONE' }, { id: 'PAX_A910__SERIE2', operating_mode: 'PDV' }], respuesta401Una: false, ordenes: new Map() };
  mp.subs = [mpSub('duena@x.com', 'authorized')]; mp.fail = false; mockMP();
  const sub = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host !== 'api.mercadopago.com' || u.pathname.startsWith('/preapproval')) return sub(url, init); // suscripciones: el simulador de siempre
    const cuerpo = init.body ? JSON.parse(init.body) : null;
    m.llamadas.push({ path: u.pathname, metodo: init.method || 'GET', auth: (init.headers || {}).Authorization, cuerpo, headers: init.headers });
    const r = (j, status = 200) => new Response(JSON.stringify(j), { status });
    if (u.pathname === '/oauth/token') {
      if (cuerpo.grant_type === 'authorization_code') {
        if (m.tokenRechazado) return r({ message: 'invalid_grant' }, 400);
        return r({ access_token: 'token-falso-acceso-1', refresh_token: 'token-falso-refresh-1', expires_in: 15552000, scope: m.scope ?? 'read write offline_access', user_id: 241983636, live_mode: true });
      }
      if (m.tokenRechazado) return r({ message: 'invalid_grant' }, 400);
      m.refresh++; return r({ access_token: `token-falso-acceso-${m.refresh + 1}`, refresh_token: `token-falso-refresh-${m.refresh + 1}`, expires_in: 15552000, scope: 'read write offline_access', user_id: 241983636 });
    }
    if (m.respuesta401Una && u.pathname.startsWith('/v1/orders')) { m.respuesta401Una = false; return r({ message: 'invalid access token' }, 401); }
    if (u.pathname === '/terminals/v1/list') return r({ data: { terminals: m.terminales }, paging: { total: m.terminales.length } });
    if (u.pathname === '/terminals/v1/setup') { for (const x of cuerpo.terminals) { const tt = m.terminales.find((y) => y.id === x.id); if (tt) tt.operating_mode = x.operating_mode; } return r({ terminals: cuerpo.terminals.map((x) => ({ id: x.id, operating_mode: x.operating_mode })) }); }
    if (u.pathname === '/v1/orders' && init.method === 'POST' && m.rechazarOrden) return r(m.rechazarOrden, 400);
    if (u.pathname === '/v1/orders' && init.method === 'POST') { const id = 'ORD' + (m.ordenes.size + 1); m.ordenes.set(id, 'created'); return r({ id, status: 'created', secreto_interno: 'no-se-filtra' }, 201); }
    if (u.pathname === '/terminals/v1/actions' && init.method === 'POST') return m.rechazarImpresion ? r({ errors: [{ code: 'property_value', message: 'Invalid value for property', details: ["'$.config.point.terminal_id' - does not match pattern"] }] }, 400) : r({ id: 'ACT1', status: 'created' }, 201);
    if (m.objetos && m.objetos[u.pathname]) return r(m.objetos[u.pathname]);
    if (u.pathname === '/v1/payments/search') {
      m.busquedas = m.busquedas || []; m.busquedas.push(Object.fromEntries(u.searchParams));
      const off = Number(u.searchParams.get('offset') || 0); const todos = m.pagos || [];
      return r({ paging: { total: todos.length, limit: 50, offset: off }, results: todos.slice(off, off + 50) });
    }
    if (u.pathname === '/users/me') return r({ id: m.cuentaNodoSur ?? 111 });
    if (/^\/users\/[^/]+\/mercadopago_account\/balance$/.test(u.pathname)) return m.saldoNegado ? r({ message: 'Public access not allowed', error: 'forbidden' }, 403) : r({ available_balance: 1344.21, total_amount: 2000, unavailable_balance: 655.79 });
    if (u.pathname === '/v1/account/release_report/list') return r([{ file_name: 'liq-2026-10-03.csv', status: 'processed' }]);
    if (u.pathname === '/v1/account/release_report/config' && init.method === 'POST') {
      if (cuerpo.columns.some((c) => c.key === 'BALANCE_AMOUNT') && m.rechazarBalance) return r({ message: 'invalid column' }, 400);
      m.config = cuerpo; return r(cuerpo, 201);
    }
    if (u.pathname === '/v1/account/release_report/config') return m.sinConfig && !m.config ? r({ message: 'Configuration not found for user', error: 'config_not_found_for_user' }, 404) : r(m.config || { file_name_prefix: 'liq', columns: [{ key: 'BALANCE_AMOUNT' }] });
    if (u.pathname === '/v1/account/release_report' && init.method === 'POST') { m.pedidos = (m.pedidos || []).concat([cuerpo]); return r({ id: 77, status: 'pending' }, 202); }
    if (u.pathname === '/v1/account/release_report/liq-2026-10-03.csv') return new Response('DATE;RECORD_TYPE;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;BALANCE_AMOUNT\n2026-10-03T00:00:00;initial_available_balance;;286149.00;0.00;286149.00\n2026-10-03T11:13:00;release;payout;0.00;201016.00;85133.00\n', { status: 200 });
    const dev = /^\/v1\/orders\/([^/]+)\/refund$/.exec(u.pathname);
    if (dev && m.ordenes.has(dev[1])) { m.devoluciones = (m.devoluciones || []).concat([{ id: dev[1], clave: (init.headers || {})['X-Idempotency-Key'], cuerpo: init.body }]); m.ordenes.set(dev[1], 'refunded'); return r({ id: dev[1], status: 'refunded' }); }
    const g = /^\/v1\/orders\/([^/]+)(\/cancel)?$/.exec(u.pathname);
    if (g && m.ordenes.has(g[1])) { if (g[2]) m.ordenes.set(g[1], 'canceled'); return r({ id: g[1], status: m.ordenes.get(g[1]), status_detail: g[2] ? 'canceled' : 'created' }); }
    return r({ message: 'not found' }, 404);
  };
  return m;
}
async function negocio(env, duena = ['duena@x.com', 'sd']) {
  await ensureOrgTables(env); addUser(env, duena[0], duena[1]);
  const r = await createOrg(env, { sub: duena[1], email: duena[0], name: 'Dueña', orgName: 'La Plazoleta' });
  const b2 = env.DB.raw.prepare("INSERT INTO branches (org_id, name, active, created_at) VALUES (?, 'Centro', 1, ?)").run(r.org.id, nowS());
  return { org: r.org, a: r.branch.id, b: Number(b2.lastInsertRowid) };
}
function miembro(env, n, email, sub, role, { all = 0, branches = [] } = {}) {
  addUser(env, email, sub);
  const mm = env.DB.raw.prepare('INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,?,?,?)').run(n.org.id, sub, email, role, 'active', all, nowS());
  for (const b of branches) env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(mm.lastInsertRowid, b);
}
const celular = async (env, n, branch, sub, email, id) => { await upsertDevice(env, { id, sub, email, name: 'Cel', orgId: n.org.id, branchId: branch }); return { Authorization: `Bearer ${await signDeviceToken(env, { sub, email, deviceId: id })}` }; };
const post = (fn, env, path, cookie, body, headers = {}) => fn({ request: req(path, { method: 'POST', cookie, headers: cookie ? web : headers, body }), env });
const get = (fn, env, path, { cookie, headers } = {}) => fn({ request: req(path, { cookie, headers }), env });

// Conecta el negocio de punta a punta: pide la dirección, "autoriza" y vuelve con el code.
async function conectar(env, n, m, cookie, sub) {
  const { url } = await (await post(conexion.onRequestConnect, env, '/api/mp/conectar', cookie, { orgId: n.org.id })).json();
  const state = new URL(url).searchParams.get('state');
  const r = await get(conexion.onRequestCallback, env, `/api/mp/callback?code=codigo-falso&state=${state}`, { cookie });
  return { url, state, r };
}

await t('conectar: la dirección de Mercado Pago lleva PKCE, el state y nuestra dirección de retorno; solo el dueño', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); simular(); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] });
  const { url } = await (await post(conexion.onRequestConnect, env, '/api/mp/conectar', await sess(env, 'duena@x.com', 'sd'), { orgId: n.org.id })).json();
  const u = new URL(url); assert.equal(u.origin + u.pathname, 'https://auth.mercadopago.com/authorization');
  assert.equal(u.searchParams.get('client_id'), '7309232869105658'); assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://horsepos.com/api/mp/callback'); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  const pendiente = one(env, 'SELECT * FROM mp_oauth_pendientes');
  assert.equal(u.searchParams.get('code_challenge'), await sha256b64u(pendiente.verifier), 'el desafío sale del verificador que se queda en el servidor');
  assert.equal(u.searchParams.get('state'), pendiente.nonce); assert.ok(!url.includes(pendiente.verifier), 'el verificador no viaja por el navegador');
  for (const [email, sub] of [['emp@x.com', 'sm']]) assert.equal((await post(conexion.onRequestConnect, env, '/api/mp/conectar', await sess(env, email, sub), { orgId: n.org.id })).status, 403);
  assert.equal((await post(conexion.onRequestConnect, env, '/api/mp/conectar', null, { orgId: n.org.id })).status, 401);
});
await t('conectar sin configurar (falta el secreto) avisa en vez de tirar', async () => {
  const env = mkEnv(); const n = await negocio(env);
  assert.equal((await post(conexion.onRequestConnect, env, '/api/mp/conectar', await sess(env, 'duena@x.com', 'sd'), { orgId: n.org.id })).status, 503);
});
await t('callback: canjea el code con el verificador, guarda el token CIFRADO y vuelve a /negocio', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd');
  const { r } = await conectar(env, n, m, cookie);
  assert.equal(r.status, 302); assert.equal(r.headers.get('Location'), 'https://horsepos.com/negocio/?mp=ok');
  const canje = m.llamadas.find((x) => x.path === '/oauth/token').cuerpo;
  assert.equal(canje.grant_type, 'authorization_code'); assert.equal(canje.code, 'codigo-falso'); assert.equal(canje.client_secret, 'secreto-falso');
  assert.equal(canje.redirect_uri, 'https://horsepos.com/api/mp/callback'); assert.ok(canje.code_verifier.length >= 43);
  const fila = one(env, 'SELECT * FROM mp_conexiones'); assert.equal(fila.mp_user_id, '241983636'); assert.equal(fila.org_id, n.org.id);
  assert.ok(!JSON.stringify(fila).includes('token-falso-acceso') && !JSON.stringify(fila).includes('token-falso-refresh'), 'ni el token ni el refresh quedan en claro');
  assert.equal(await tokenDe(env, n.org.id), 'token-falso-acceso-1', 'el servidor sí lo puede usar');
});
await t('callback: el state es de un solo uso, vence a los 10 minutos y tiene que ser de la misma sesión', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); addUser(env, 'otro@x.com', 'so');
  const a = await conectar(env, n, m, cookie); assert.match(a.r.headers.get('Location'), /mp=ok/);
  assert.match((await get(conexion.onRequestCallback, env, `/api/mp/callback?code=X&state=${a.state}`, { cookie })).headers.get('Location'), /mp=error/, 'reusar el mismo state');
  const b = await post(conexion.onRequestConnect, env, '/api/mp/conectar', cookie, { orgId: n.org.id }); const s2 = new URL((await b.json()).url).searchParams.get('state');
  assert.match((await get(conexion.onRequestCallback, env, `/api/mp/callback?code=X&state=${s2}`, { cookie: await sess(env, 'otro@x.com', 'so') })).headers.get('Location'), /mp=error/, 'otra persona no puede completar la conexión de la dueña');
  const c = await post(conexion.onRequestConnect, env, '/api/mp/conectar', cookie, { orgId: n.org.id }); const s3 = new URL((await c.json()).url).searchParams.get('state');
  env.DB.raw.prepare('UPDATE mp_oauth_pendientes SET exp = ?').run(nowS() - 1);
  assert.match((await get(conexion.onRequestCallback, env, `/api/mp/callback?code=X&state=${s3}`, { cookie })).headers.get('Location'), /mp=error/, 'vencido');
  assert.match((await get(conexion.onRequestCallback, env, '/api/mp/callback?error=access_denied&state=x', { cookie })).headers.get('Location'), /mp=cancelado/);
  assert.match((await get(conexion.onRequestCallback, env, '/api/mp/callback?code=X&state=y')).headers.get('Location'), /mp=sin_sesion/);
});
await t('callback: si Mercado Pago no entrega refresh_token (falta offline_access) no se conecta a medias', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); m.scope = 'read write';
  const { r } = await conectar(env, n, m, await sess(env, 'duena@x.com', 'sd'));
  assert.match(r.headers.get('Location'), /mp=sin_permiso/); assert.equal(one(env, 'SELECT COUNT(*) c FROM mp_conexiones').c, 0);
});
await t('renovación: cerca del vencimiento se renueva y se guarda el refresh_token NUEVO; no se renueva antes de tiempo', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); await conectar(env, n, m, await sess(env, 'duena@x.com', 'sd'));
  assert.equal(await tokenDe(env, n.org.id), 'token-falso-acceso-1'); assert.equal(m.refresh, 0, 'lejos del vencimiento no renueva');
  env.DB.raw.prepare('UPDATE mp_conexiones SET expires_at = ?').run(nowS() + 3600);
  assert.equal(await tokenDe(env, n.org.id), 'token-falso-acceso-2'); assert.equal(m.refresh, 1);
  const pidio = m.llamadas.filter((x) => x.path === '/oauth/token').at(-1).cuerpo; assert.equal(pidio.grant_type, 'refresh_token'); assert.equal(pidio.refresh_token, 'token-falso-refresh-1');
  assert.equal(await tokenDe(env, n.org.id), 'token-falso-acceso-2', 'ya renovado: no vuelve a pedir'); assert.equal(m.refresh, 1);
  env.DB.raw.prepare('UPDATE mp_conexiones SET expires_at = ?').run(nowS() + 3600); await tokenDe(env, n.org.id);
  assert.equal(m.llamadas.filter((x) => x.path === '/oauth/token').at(-1).cuerpo.refresh_token, 'token-falso-refresh-2', 'usa el refresh que guardó la vez anterior');
});
await t('renovación: dos pedidos a la vez no gastan dos veces el mismo refresh_token', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); await conectar(env, n, m, await sess(env, 'duena@x.com', 'sd'));
  env.DB.raw.prepare('UPDATE mp_conexiones SET expires_at = ?').run(nowS() + 3600);
  const [a, b] = await Promise.all([tokenDe(env, n.org.id), tokenDe(env, n.org.id)]);
  assert.ok(a && b); const guardado = await tokenDe(env, n.org.id);
  assert.ok(guardado.startsWith('token-falso-acceso-')); assert.equal(one(env, 'SELECT needs_reconnect n FROM mp_conexiones').n, 0, 'no se marcó como cortada');
});
await t('renovación: si Mercado Pago rechaza el refresh_token la conexión queda marcada para reconectar (no reintenta para siempre)', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  env.DB.raw.prepare('UPDATE mp_conexiones SET expires_at = ?').run(nowS() + 3600); m.tokenRechazado = true;
  assert.equal(await tokenDe(env, n.org.id), null);
  const e = await (await get(conexion.onRequestGet, env, `/api/mp/estado?org=${n.org.id}`, { cookie })).json(); assert.equal(e.connected, false); assert.equal(e.needsReconnect, true);
  const antes = m.llamadas.length; assert.equal(await tokenDe(env, n.org.id), null); assert.equal(m.llamadas.length, antes, 'ya no insiste');
});
await t('estado: el dueño ve sus sucursales y terminales; el dispositivo solo ve si puede cobrar, nunca el token', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  const d = await (await get(conexion.onRequestGet, env, `/api/mp/estado?org=${n.org.id}`, { cookie })).json();
  assert.equal(d.connected, true); assert.deepEqual(d.branches.map((b) => b.name), ['Sucursal principal', 'Centro']); assert.ok(!JSON.stringify(d).includes('token-falso'));
  const cel = await celular(env, n, n.a, 'sd', 'duena@x.com', 'cel-dueno-0123456789abcdefg');
  const v = await (await get(conexion.onRequestGet, env, '/api/mp/estado', { headers: cel })).json();
  assert.deepEqual(v, { connected: true, needsReconnect: false, terminalConfigured: false, canRefund: true }, 'la dueña puede devolver');
  assert.equal((await get(conexion.onRequestGet, env, `/api/mp/estado?org=${n.org.id}`, { cookie: await sess(env, 'emp@x.com', 'sm') })).status, 401);
});
await t('terminales: el dueño las lista, elige la de una sucursal y se pasa a modo PDV', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  const l = await (await get(conexion.onRequestTerminales, env, `/api/mp/terminales?org=${n.org.id}`, { cookie })).json(); assert.deepEqual(l.terminals.map((x) => x.id), ['PAX_A910__SERIE1', 'PAX_A910__SERIE2']);
  assert.equal(m.llamadas.find((x) => x.path === '/terminals/v1/list').auth, 'Bearer token-falso-acceso-1', 'usa el token del negocio');
  const ok = await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.a, terminalId: 'PAX_A910__SERIE1' }); assert.equal(ok.status, 200);
  const setup = m.llamadas.find((x) => x.path === '/terminals/v1/setup'); assert.equal(setup.metodo, 'PATCH'); assert.deepEqual(setup.cuerpo, { terminals: [{ id: 'PAX_A910__SERIE1', operating_mode: 'PDV' }] });
  assert.equal(one(env, 'SELECT terminal_id t FROM mp_terminales WHERE branch_id = ?', n.a).t, 'PAX_A910__SERIE1');
  // La terminal que YA estaba en PDV (la que venía en uso con otra integración) se elige sin tocarle el modo.
  const antes = m.llamadas.filter((x) => x.path === '/terminals/v1/setup').length;
  assert.equal((await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.b, terminalId: 'PAX_A910__SERIE2' })).status, 200);
  assert.equal(m.llamadas.filter((x) => x.path === '/terminals/v1/setup').length, antes, 'no se le cambió el modo a una terminal ya en PDV');
  assert.equal(one(env, 'SELECT terminal_id t FROM mp_terminales WHERE branch_id = ?', n.b).t, 'PAX_A910__SERIE2');
  assert.equal((await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.a, terminalId: 'AJENA' })).status, 400, 'una terminal que no es de la cuenta no se elige');
  assert.equal((await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: 99999, terminalId: 'PAX_A910__SERIE1' })).status, 400, 'ni una sucursal que no existe');
});
await t('órdenes: el celular de quien opera la sucursal crea, consulta y cancela con el token del negocio, sin que el token salga', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.b, terminalId: 'PAX_A910__SERIE1' });
  miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.b] }); const cel = await celular(env, n, n.b, 'sm', 'emp@x.com', 'cel-emp-0123456789abcdefghi');
  const crear = await post(orden.onRequestPost, env, '/api/mp/orden', null, { externalReference: 'venta-1', idempotencyKey: 'clave-idem-0001', montoCentavos: 123450, canal: 'qr' }, cel);
  assert.equal(crear.status, 200); const j = await crear.json(); assert.deepEqual(j, { id: 'ORD1', status: 'created', statusDetail: null }, 'solo lo que la app necesita');
  const pedido = m.llamadas.find((x) => x.path === '/v1/orders' && x.metodo === 'POST');
  assert.equal(pedido.auth, 'Bearer token-falso-acceso-1'); assert.equal(pedido.headers['X-Idempotency-Key'], 'clave-idem-0001');
  assert.equal(pedido.cuerpo.type, 'point'); assert.equal(pedido.cuerpo.transactions.payments[0].amount, '1234.50', 'decimal, nunca centavos');
  assert.deepEqual(pedido.cuerpo.config, { point: { terminal_id: 'PAX_A910__SERIE1', print_on_terminal: 'no_ticket' }, payment_method: { default_type: 'qr' } });
  assert.equal(pedido.cuerpo.expiration_time, 'PT2M', 'la orden vence sola si nadie la paga');
  assert.deepEqual({ ...one(env, 'SELECT org_id, branch_id, external_reference, estado FROM mp_ordenes WHERE order_id = ?', 'ORD1') }, { org_id: n.org.id, branch_id: n.b, external_reference: 'venta-1', estado: 'created' }, 'queda anotada de qué sucursal es');
  assert.deepEqual(await (await get(orden.onRequestGet, env, '/api/mp/orden?id=ORD1', { headers: cel })).json(), { id: 'ORD1', status: 'created', statusDetail: 'created' });
  assert.equal((await (await post(orden.onRequestCancelar, env, '/api/mp/orden/cancelar', null, { id: 'ORD1' }, cel)).json()).status, 'canceled');
});
await t('órdenes: una sucursal sin terminal, un negocio sin conectar, un dispositivo ajeno o datos raros se rechazan', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd');
  const cuerpo = { externalReference: 'venta-1', idempotencyKey: 'clave-idem-0001', montoCentavos: 5000, canal: 'qr' };
  const cel = await celular(env, n, n.a, 'sd', 'duena@x.com', 'cel-dueno-0123456789abcdefg');
  assert.equal((await post(orden.onRequestPost, env, '/api/mp/orden', null, cuerpo, cel)).status, 409, 'sin conectar');
  await conectar(env, n, m, cookie);
  assert.equal((await post(orden.onRequestPost, env, '/api/mp/orden', null, cuerpo, cel)).status, 409, 'sin terminal en la sucursal');
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.a, terminalId: 'PAX_A910__SERIE1' });
  for (const malo of [{ ...cuerpo, canal: 'cuotas' }, { ...cuerpo, montoCentavos: 12.5 }, { ...cuerpo, montoCentavos: 0 }, { ...cuerpo, idempotencyKey: 'x' }, { ...cuerpo, externalReference: '../..' }]) {
    assert.equal((await post(orden.onRequestPost, env, '/api/mp/orden', null, malo, cel)).status, 400, JSON.stringify(malo));
  }
  assert.equal((await post(orden.onRequestPost, env, '/api/mp/orden', null, cuerpo, {})).status, 401, 'sin dispositivo');
  assert.equal((await post(orden.onRequestPost, env, '/api/mp/orden', cookie, cuerpo)).status, 401, 'la sesión web no cobra: solo un dispositivo vinculado');
  assert.equal((await post(orden.onRequestPost, env, '/api/mp/orden', null, cuerpo, cel)).status, 200);
});
await t('órdenes: un miembro quitado del negocio pierde el cobro; otro negocio no usa el token de este', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.a, terminalId: 'PAX_A910__SERIE1' });
  miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] }); const cel = await celular(env, n, n.a, 'sm', 'emp@x.com', 'cel-emp-0123456789abcdefghi');
  const cuerpo = { externalReference: 'venta-1', idempotencyKey: 'clave-idem-0001', montoCentavos: 5000, canal: 'debit_card' };
  assert.equal((await post(orden.onRequestPost, env, '/api/mp/orden', null, cuerpo, cel)).status, 200);
  env.DB.raw.prepare("UPDATE memberships SET status = 'removed' WHERE user_sub = 'sm'").run();
  assert.equal((await post(orden.onRequestPost, env, '/api/mp/orden', null, cuerpo, cel)).status, 401);
  const otro = await negocio(env, ['otra@x.com', 'so']); mp.subs.push(mpSub('otra@x.com', 'authorized'));
  const celOtro = await celular(env, otro, otro.a, 'so', 'otra@x.com', 'cel-otro-0123456789abcdefgh');
  assert.equal((await post(orden.onRequestPost, env, '/api/mp/orden', null, cuerpo, celOtro)).status, 409, 'el otro negocio no está conectado: no usa el token del primero');
});
await t('órdenes: si Mercado Pago responde 401 se renueva el token una vez y se reintenta', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.a, terminalId: 'PAX_A910__SERIE1' });
  const cel = await celular(env, n, n.a, 'sd', 'duena@x.com', 'cel-dueno-0123456789abcdefg'); m.respuesta401Una = true;
  const r = await post(orden.onRequestPost, env, '/api/mp/orden', null, { externalReference: 'venta-1', idempotencyKey: 'clave-idem-0001', montoCentavos: 5000, canal: 'qr' }, cel);
  assert.equal(r.status, 200); assert.equal(m.refresh, 1); assert.equal(m.llamadas.filter((x) => x.path === '/v1/orders' && x.metodo === 'POST').at(-1).auth, 'Bearer token-falso-acceso-2');
});
await t('desconectar: borra el token y las terminales elegidas, y los celulares dejan de poder cobrar', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.a, terminalId: 'PAX_A910__SERIE1' });
  assert.equal((await post(conexion.onRequestDisconnect, env, '/api/mp/desconectar', cookie, { orgId: n.org.id })).status, 200);
  assert.equal(one(env, 'SELECT COUNT(*) c FROM mp_conexiones').c, 0); assert.equal(one(env, 'SELECT COUNT(*) c FROM mp_terminales').c, 0);
  const cel = await celular(env, n, n.a, 'sd', 'duena@x.com', 'cel-dueno-0123456789abcdefg');
  assert.equal((await post(orden.onRequestPost, env, '/api/mp/orden', null, { externalReference: 'v-1', idempotencyKey: 'clave-idem-0001', montoCentavos: 5000, canal: 'qr' }, cel)).status, 409);
});
await t('probar: el dueño manda un cobro de $100 a la terminal de una sucursal y lo puede cancelar; nadie más', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  assert.equal((await post(conexion.onRequestProbar, env, '/api/mp/probar', cookie, { orgId: n.org.id, branchId: n.a })).status, 409, 'sin terminal elegida');
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.a, terminalId: 'PAX_A910__SERIE2' });
  const r = await post(conexion.onRequestProbar, env, '/api/mp/probar', cookie, { orgId: n.org.id, branchId: n.a }); assert.equal(r.status, 200); const j = await r.json();
  const pedido = m.llamadas.filter((x) => x.path === '/v1/orders' && x.metodo === 'POST').at(-1);
  assert.equal(pedido.cuerpo.transactions.payments[0].amount, '100.00'); assert.match(pedido.cuerpo.external_reference, /^prueba-/); assert.equal(pedido.cuerpo.config.point.terminal_id, 'PAX_A910__SERIE2');
  assert.equal((await (await post(conexion.onRequestProbarCancelar, env, '/api/mp/probar/cancelar', cookie, { orgId: n.org.id, id: j.id })).json()).status, 'canceled');
  miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] });
  assert.equal((await post(conexion.onRequestProbar, env, '/api/mp/probar', await sess(env, 'emp@x.com', 'sm'), { orgId: n.org.id, branchId: n.a })).status, 403, 'un empleado no manda cobros de prueba');
  assert.equal((await post(conexion.onRequestProbar, env, '/api/mp/probar', cookie, { orgId: n.org.id, branchId: 99999 })).status, 400);
});
await t('un rechazo de Mercado Pago llega con su código y su motivo, en cualquiera de sus formatos (no un "no se pudo" mudo)', async () => {
  assert.equal(detalleError({ errors: [{ code: 'terminal_not_found', message: 'Terminal not found', details: ['terminal_id: x'] }] }), 'terminal_not_found · Terminal not found · terminal_id: x');
  assert.equal(detalleError({ message: 'invalid access token' }), 'invalid access token');
  assert.equal(detalleError({ cause: [{ code: 2000, description: 'Falta algo' }] }), '2000 · Falta algo');
  assert.equal(detalleError({}), null); assert.equal(detalleError(null), null);
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.a, terminalId: 'PAX_A910__SERIE2' });
  m.rechazarOrden = { errors: [{ code: 'terminal_not_found', message: 'Terminal not found for this user' }] };
  const r = await post(conexion.onRequestProbar, env, '/api/mp/probar', cookie, { orgId: n.org.id, branchId: n.a });
  assert.equal(r.status, 502); const j = await r.json(); assert.equal(j.error, 'mp_rechazo'); assert.equal(j.status, 400); assert.equal(j.mensaje, 'terminal_not_found · Terminal not found for this user');
  const cel = await celular(env, n, n.a, 'sd', 'duena@x.com', 'cel-dueno-0123456789abcdefg');
  const o = await post(orden.onRequestPost, env, '/api/mp/orden', null, { externalReference: 'v-1', idempotencyKey: 'clave-idem-0001', montoCentavos: 5000, canal: 'qr' }, cel);
  assert.equal((await o.json()).mensaje, 'terminal_not_found · Terminal not found for this user', 'también por el camino que usan la PC y el celular');
});
await t('imprimir: el celular de quien opera manda el ticket a la terminal de su sucursal con el token del negocio; datos raros y errores de Mercado Pago se tratan', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.b] }); const cel = await celular(env, n, n.b, 'sm', 'emp@x.com', 'cel-emp-0123456789abcdefghi');
  const cuerpo = { externalReference: 'ticket-1', idempotencyKey: 'clave-imp-0001', contenido: '{center}{w}La Plazoleta{/w}{/center}{br}Total $100{br}' };
  assert.equal((await post(orden.onRequestImprimir, env, '/api/mp/imprimir', null, cuerpo, cel)).status, 409, 'sin terminal elegida en la sucursal');
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.b, terminalId: 'PAX_A910__SERIE1' });
  const ok = await post(orden.onRequestImprimir, env, '/api/mp/imprimir', null, cuerpo, cel); assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { ok: true });
  const llamada = m.llamadas.find((x) => x.path === '/terminals/v1/actions');
  assert.equal(llamada.auth, 'Bearer token-falso-acceso-1'); assert.equal(llamada.headers['X-Idempotency-Key'], 'clave-imp-0001');
  assert.deepEqual(llamada.cuerpo, { type: 'print', external_reference: 'ticket-1', config: { point: { terminal_id: 'PAX_A910__SERIE1', subtype: 'custom' } }, content: cuerpo.contenido });
  for (const malo of [{ ...cuerpo, contenido: '' }, { ...cuerpo, contenido: 'x'.repeat(8001) }, { ...cuerpo, contenido: 5 }, { ...cuerpo, idempotencyKey: 'x' }, { ...cuerpo, externalReference: '../..' }])
    assert.equal((await post(orden.onRequestImprimir, env, '/api/mp/imprimir', null, malo, cel)).status, 400, JSON.stringify(malo).slice(0, 60));
  assert.equal((await post(orden.onRequestImprimir, env, '/api/mp/imprimir', cookie, cuerpo)).status, 401, 'la sesión web no imprime');
  m.rechazarImpresion = true;
  const r = await post(orden.onRequestImprimir, env, '/api/mp/imprimir', null, { ...cuerpo, idempotencyKey: 'clave-imp-0002' }, cel); const j = await r.json();
  assert.equal(r.status, 502); assert.equal(j.error, 'mp_rechazo'); assert.match(j.mensaje, /property_value/);
});
await t('registro: cada cobro, cancelación e impresión por el servidor queda anotado (sin secretos) y solo el dueño lo ve', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.b, terminalId: 'PAX_A910__SERIE1' });
  miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.b] }); const cel = await celular(env, n, n.b, 'sm', 'emp@x.com', 'cel-emp-0123456789abcdefghi');
  await post(orden.onRequestPost, env, '/api/mp/orden', null, { externalReference: 'venta-1', idempotencyKey: 'clave-idem-0001', montoCentavos: 450000, canal: 'qr' }, cel);
  await post(orden.onRequestImprimir, env, '/api/mp/imprimir', null, { externalReference: 'ticket-1', idempotencyKey: 'clave-imp-0001', contenido: 'SECRETO-DEL-TICKET' }, cel);
  await post(orden.onRequestCancelar, env, '/api/mp/orden/cancelar', null, { id: 'ORD1' }, cel);
  m.rechazarOrden = { errors: [{ code: 'bad_request', message: 'terminal no disponible' }] };
  await post(orden.onRequestPost, env, '/api/mp/orden', null, { externalReference: 'venta-2', idempotencyKey: 'clave-idem-0002', montoCentavos: 5000, canal: 'debit_card' }, cel);
  const r = await get(conexion.onRequestActividad, env, `/api/mp/actividad?org=${n.org.id}`, { cookie }); assert.equal(r.status, 200);
  const items = (await r.json()).items;
  assert.deepEqual(items.map((i) => [i.action, i.result]), [['orden', 'rechazado'], ['cancelar', 'ok'], ['imprimir', 'ok'], ['orden', 'ok']], 'lo más nuevo primero');
  const cobro = items[3]; assert.equal(cobro.amountCents, 450000); assert.equal(cobro.channel, 'qr'); assert.equal(cobro.mpId, 'ORD1'); assert.equal(cobro.device, 'Cel'); assert.equal(cobro.httpStatus, 201);
  assert.match(items[0].detail, /terminal no disponible/);
  assert.ok(!JSON.stringify(items).includes('SECRETO-DEL-TICKET') && !JSON.stringify(items).includes('token-falso'), 'ni el contenido del ticket ni el token');
  assert.equal((await get(conexion.onRequestActividad, env, `/api/mp/actividad?org=${n.org.id}`, {})).status, 401, 'sin sesión');
  const sesEmp = await sess(env, 'emp@x.com', 'sm'); assert.equal((await get(conexion.onRequestActividad, env, `/api/mp/actividad?org=${n.org.id}`, { cookie: sesEmp })).status, 403, 'un empleado no lo ve');
});
await t('registro: se guardan solo los últimos 500 por negocio y un fallo al anotar no frena el cobro', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); await ensureMpTables(env);
  for (let i = 0; i < 503; i++) await registrarActividad(env, { orgId: n.org.id, branchId: n.a }, { accion: 'orden', r: { status: 201, j: { id: 'X' + i } } });
  assert.equal(one(env, 'SELECT COUNT(*) c FROM mp_actividad').c, 500); assert.equal(one(env, 'SELECT MIN(mp_id) m FROM mp_actividad WHERE mp_id = ?', 'X0')?.m ?? null, null, 'lo más viejo se fue');
  env.DB.raw.exec('DROP TABLE mp_actividad'); await registrarActividad(env, { orgId: n.org.id }, { accion: 'orden', r: { status: 201, j: {} } }); // no tira
});

const pago = (id, monto, extra = {}) => ({ id, status: 'approved', collector_id: 241983636, transaction_amount: monto, transaction_amount_refunded: 0,
  date_created: '2026-10-01T14:00:00.000-03:00', date_approved: '2026-10-01T14:00:05.000-03:00', payment_type_id: 'account_money', payment_method_id: 'account_money',
  fee_details: [{ type: 'mercadopago_fee', amount: Math.round(monto * 2) / 100, fee_payer: 'collector' }], transaction_details: { net_received_amount: monto - Math.round(monto * 2) / 100 },
  payer: { email: 'cliente@secreto.com' }, ...extra });
await t('cobros: lo que entró a la cuenta del negocio, con comisión y neto, sin pagos hechos ni rechazados ni datos de quien pagó', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  m.pagos = [
    pago(1, 3600),
    pago(2, 13300, { payment_type_id: 'debit_card', payment_method_id: 'debvisa' }),
    pago(3, 5000, { status: 'rejected' }),
    pago(4, 100000, { collector_id: 999 }), // un pago que hizo el negocio: no es un cobro
    pago(5, 2000, { status: 'refunded', transaction_amount_refunded: 2000 }),
    pago(6, 1000, { status: 'partially_refunded', transaction_amount_refunded: 400 }),
  ];
  const cel = await celular(env, n, n.a, 'sd', 'duena@x.com', 'cel-dueno-0123456789abcdefg');
  const desde = 1790874000; const hasta = desde + 12 * 3600;
  const res = await get(orden.onRequestCobros, env, `/api/mp/cobros?desde=${desde}&hasta=${hasta}`, { headers: cel });
  assert.equal(res.status, 200); const j = await res.json();
  assert.deepEqual(j.cobros.map((c) => c.id), ['1', '2', '3', '5', '6'], 'el pago hecho por el negocio no aparece');
  assert.equal(j.totales.cantidad, 4); assert.equal(j.totales.noCobrados, 1, 'el rechazado se cuenta aparte');
  assert.equal(j.totales.brutoCentavos, (3600 + 13300 + 2000 + 1000) * 100); assert.equal(j.totales.devueltoCentavos, (2000 + 400) * 100);
  assert.equal(j.totales.comisionCentavos, 7200 + 26600 + 0 + 2000, 'el devuelto entero no cobra comisión');
  assert.equal(j.totales.netoCentavos, j.totales.brutoCentavos - j.totales.devueltoCentavos - j.totales.comisionCentavos);
  assert.equal(j.totales.porMedio.debit_card, 1330000); assert.equal(j.cobros[1].fecha, Date.parse('2026-10-01T14:00:05.000-03:00') / 1000, 'la hora en que se aprobó');
  assert.ok(!JSON.stringify(j).includes('secreto'), 'nada de quien pagó'); assert.equal(j.truncado, false);
  const b = m.busquedas[0];
  assert.equal(b['collector.id'], '241983636'); assert.equal(b.range, 'date_created');
  assert.equal(b.begin_date, new Date(desde * 1000).toISOString().replace('Z', '-00:00')); assert.equal(b.end_date, new Date(hasta * 1000).toISOString().replace('Z', '-00:00'));
  assert.equal(m.llamadas.find((x) => x.path === '/v1/payments/search').auth, 'Bearer token-falso-acceso-1');
});
await t('cobros: pagina de a 50 hasta el total, y rechaza rangos raros, sin dispositivo o sin conectar', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd');
  const cel = await celular(env, n, n.a, 'sd', 'duena@x.com', 'cel-dueno-0123456789abcdefg');
  const ok = '/api/mp/cobros?desde=1790874000&hasta=1790917200';
  assert.equal((await get(orden.onRequestCobros, env, ok, { headers: cel })).status, 409, 'sin conectar');
  await conectar(env, n, m, cookie);
  m.pagos = Array.from({ length: 120 }, (_, i) => pago(i + 1, 100));
  const j = await (await get(orden.onRequestCobros, env, ok, { headers: cel })).json();
  assert.equal(j.cobros.length, 120); assert.equal(m.busquedas.length, 3); assert.deepEqual(m.busquedas.map((x) => x.offset), ['0', '50', '100']);
  for (const q of ['', '?desde=10', '?desde=100&hasta=50', '?desde=1&hasta=99999999', '?desde=abc&hasta=200']) assert.equal((await get(orden.onRequestCobros, env, '/api/mp/cobros' + q, { headers: cel })).status, 400, q);
  assert.equal((await get(orden.onRequestCobros, env, ok, { headers: {} })).status, 401);
});
await t('prueba de saldo (admin): solo administradores, solo lecturas, y el token nunca sale en la respuesta', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd');
  await conectar(env, n, m, cookie);
  assert.equal((await get(mpSaldo.onRequestGet, env, '/api/admin/mp-saldo', { cookie })).status, 403, 'la dueña no es administradora de la plataforma');
  assert.equal((await get(mpSaldo.onRequestGet, env, '/api/admin/mp-saldo')).status, 401);
  addUser(env, 'admin@x.com', 'sa'); const admin = await sess(env, 'admin@x.com', 'sa');
  m.llamadas.length = 0;
  const res = await get(mpSaldo.onRequestGet, env, '/api/admin/mp-saldo', { cookie: admin });
  assert.equal(res.status, 200);
  const texto = await res.text(); const j = JSON.parse(texto);
  assert.equal(j.negocios.length, 1); const x = j.negocios[0];
  assert.equal(x.orgId, n.org.id); assert.equal(x.negocio, 'La Plazoleta'); assert.equal(x.permisos, 'read write offline_access');
  assert.equal(x.saldoDirecto.status, 200); assert.equal(x.saldoDirecto.respuesta.available_balance, 1344.21);
  assert.equal(x.esLaCuentaDeNodoSur, false); assert.deepEqual(x.acreditacion, { status: 200, cobros: 0 });
  assert.equal(x.reporteLiquidaciones.listar.cantidad, 1); assert.equal(x.reporteLiquidaciones.configuracion.status, 200);
  assert.ok(m.llamadas.some((c) => c.path === '/users/241983636/mercadopago_account/balance'));
  assert.ok(m.llamadas.every((c) => c.metodo === 'GET'), 'no genera ni cambia nada en Mercado Pago');
  assert.ok(!texto.includes('token-falso'), 'el token no sale');
  m.cuentaNodoSur = 241983636;
  assert.equal((await (await get(mpSaldo.onRequestGet, env, '/api/admin/mp-saldo', { cookie: admin })).json()).negocios[0].esLaCuentaDeNodoSur, true, 'avisa si la cuenta conectada es la de Nodo Sur');
  assert.deepEqual(mpSaldo.acreditacionDe({ status: 200, j: { results: [
    { date_approved: '2026-10-03T12:37:14.000-04:00', money_release_date: '2026-10-03T12:37:14.000-04:00' },
    { date_approved: '2026-10-03T12:37:14.000-04:00', money_release_date: '2026-10-13T12:37:14.000-04:00' }] } }),
  { status: 200, cobros: 2, alInstante: 1, aDias: 1, demoraMaximaHoras: 240 });
  m.saldoNegado = true;
  const negado = await (await get(mpSaldo.onRequestGet, env, '/api/admin/mp-saldo?orgId=' + n.org.id, { cookie: admin })).json();
  assert.equal(negado.negocios[0].saldoDirecto.status, 403); assert.equal(negado.negocios[0].saldoDirecto.respuesta.message, 'Public access not allowed');
  assert.equal((await (await get(mpSaldo.onRequestGet, env, '/api/admin/mp-saldo?orgId=999', { cookie: admin })).json()).negocios.length, 0);
});
await t('reporte de liquidaciones (admin): lista, genera el día argentino creando la configuración, y baja el CSV como filas', async () => {
  assert.deepEqual(mpReporte.rangoDelDia('2026-10-03'), { begin_date: '2026-10-03T03:00:00Z', end_date: '2026-10-04T03:00:00Z' });
  assert.equal(mpReporte.rangoDelDia('03/10/2026'), null);
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); m.sinConfig = true; m.rechazarBalance = true;
  await conectar(env, n, m, await sess(env, 'duena@x.com', 'sd'));
  assert.equal((await get(mpReporte.onRequestGet, env, `/api/admin/mp-reporte?orgId=${n.org.id}`, { cookie: await sess(env, 'duena@x.com', 'sd') })).status, 403);
  addUser(env, 'admin@x.com', 'sa'); const admin = await sess(env, 'admin@x.com', 'sa');
  m.llamadas.length = 0;
  const solo = await (await get(mpReporte.onRequestGet, env, `/api/admin/mp-reporte?orgId=${n.org.id}&dia=2026-10-03`, { cookie: admin })).json();
  assert.equal(solo.reportes.status, 200); assert.ok(m.llamadas.every((c) => c.metodo === 'GET'), 'sin generar=si solo lee');
  const gen = await (await get(mpReporte.onRequestGet, env, `/api/admin/mp-reporte?orgId=${n.org.id}&dia=2026-10-03&generar=si`, { cookie: admin })).json();
  assert.equal(gen.configuracion.creada, true); assert.ok(!m.config.columns.some((c) => c.key === 'BALANCE_AMOUNT'), 'si rechaza BALANCE_AMOUNT, la pide sin ella');
  assert.equal(gen.pedido.status, 202); assert.deepEqual(m.pedidos, [{ begin_date: '2026-10-03T03:00:00Z', end_date: '2026-10-04T03:00:00Z' }]);
  const csv = await (await get(mpReporte.onRequestGet, env, `/api/admin/mp-reporte?orgId=${n.org.id}&archivo=liq-2026-10-03.csv`, { cookie: admin })).json();
  assert.equal(csv.filas, 2); assert.equal(csv.contenido[1].DESCRIPTION, 'payout'); assert.equal(csv.contenido[1].BALANCE_AMOUNT, '85133.00');
  assert.equal((await get(mpReporte.onRequestGet, env, `/api/admin/mp-reporte?orgId=${n.org.id}&archivo=../x`, { cookie: admin })).status, 400);
  assert.equal((await get(mpReporte.onRequestGet, env, '/api/admin/mp-reporte?orgId=999', { cookie: admin })).status, 404);
});
// Lo que mandaría Mercado Pago: firma HMAC-SHA256 de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" con la clave de la app.
function avisoMp(secreto, { id, accion = 'order.processed', userId = 241983636, status = 'processed', firmaDe = id, requestId = 'req-1', ts = '1742505638683' }) {
  const v1 = createHmac('sha256', secreto).update(`id:${String(firmaDe).toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
  return req(`/api/mp/webhook?data.id=${id}&type=order`, { method: 'POST', headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    body: { action: accion, api_version: 'v1', type: 'order', user_id: userId, live_mode: true, data: { id, status } } });
}
function hubFalso() {
  const avisos = [];
  return { avisos, idFromName: (x) => x, get: (hubId) => ({ fetch: async (url, init) => { avisos.push({ hubId, url, cuerpo: JSON.parse(init.body) }); return new Response(null, { status: 204 }); } }) };
}
await t('avisos de Mercado Pago (webhook): con firma válida despiertan solo a la sucursal de la orden; sin firma, nada', async () => {
  const env = mkEnv({ ...MP_ENV, MP_WEBHOOK_SECRET: 'clave-webhook' }); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd');
  await conectar(env, n, m, cookie); env.SYNC_HUB = hubFalso();
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.b, terminalId: 'PAX_A910__SERIE1' });
  const cel = await celular(env, n, n.b, 'sd', 'duena@x.com', 'cel-dueno-0123456789abcdefg');
  const { id } = await (await post(orden.onRequestPost, env, '/api/mp/orden', null, { externalReference: 'venta-9', idempotencyKey: 'clave-idem-0009', montoCentavos: 5000, canal: 'qr' }, cel)).json();
  const enviar = (rq) => mpWebhook.onRequestPost({ request: rq, env });

  const ok = await enviar(avisoMp('clave-webhook', { id }));
  assert.equal(ok.status, 200); assert.equal((await ok.json()).avisado, true);
  assert.equal(env.SYNC_HUB.avisos.length, 1); assert.deepEqual(env.SYNC_HUB.avisos[0].cuerpo, { mp: { orden: id, accion: 'processed' } }, 'solo el id y qué pasó: la app consulta el estado real');
  assert.match(env.SYNC_HUB.avisos[0].hubId, /^cuenta:[0-9a-f]{32}$/);
  assert.equal(one(env, 'SELECT estado FROM mp_ordenes WHERE order_id = ?', id).estado, 'processed');
  assert.equal(one(env, "SELECT COUNT(*) c FROM mp_actividad WHERE accion = 'aviso'").c, 1);

  assert.equal((await enviar(avisoMp('otra-clave', { id }))).status, 401, 'firma con otra clave');
  assert.equal((await enviar(avisoMp('clave-webhook', { id, firmaDe: 'ORD999' }))).status, 401, 'firma de otro id');
  const sinFirma = req(`/api/mp/webhook?data.id=${id}`, { method: 'POST', body: { action: 'order.processed', type: 'order', user_id: 241983636, data: { id } } });
  assert.equal((await enviar(sinFirma)).status, 401, 'sin firma');
  assert.equal(env.SYNC_HUB.avisos.length, 1, 'ninguno de esos despertó a nadie');

  assert.equal((await (await enviar(avisoMp('clave-webhook', { id: 'ORDAJENA' }))).json()).ignorado, true, 'una orden que no creó el servidor');
  assert.equal((await (await enviar(avisoMp('clave-webhook', { id, userId: 999 }))).json()).ignorado, true, 'el aviso de otra cuenta con el id de esta orden');
  assert.equal((await (await enviar(avisoMp('clave-webhook', { id, accion: 'payment.created' }))).json()).ignorado, true, 'otros temas');
  assert.equal(env.SYNC_HUB.avisos.length, 1);

  const sinClave = mkEnv(MP_ENV);
  assert.equal((await mpWebhook.onRequestPost({ request: avisoMp('clave-webhook', { id }), env: sinClave })).status, 503, 'sin la clave configurada no se acepta nada');
});
await t('el hub de sync reenvía el aviso de una orden a TODOS los equipos de la sucursal, solo con id y acción', async () => {
  const { SyncHub } = await import('../functions/_lib/sync_hub.js');
  const enviados = []; const ws = (tag) => ({ tag, send: (x) => enviados.push([tag, x]) });
  const sockets = [ws('pc-1'), ws('cel-1')];
  const hub = new SyncHub({ getWebSockets: () => sockets, getTags: (w) => [w.tag], acceptWebSocket() {} }, {});
  const r = await hub.fetch(new Request('https://hub/avisar', { method: 'POST', body: JSON.stringify({ mp: { orden: 'ORD1', accion: 'processed', extra: 'no-va' } }) }));
  assert.equal(r.status, 204);
  assert.deepEqual(enviados, [['pc-1', '{"mp":{"orden":"ORD1","accion":"processed"}}'], ['cel-1', '{"mp":{"orden":"ORD1","accion":"processed"}}']]);
});
await t('devolver (etapa B): solo dueño y encargado, solo una orden cobrada de este negocio, total y con clave fija', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd');
  await conectar(env, n, m, cookie);
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.b, terminalId: 'PAX_A910__SERIE1' });
  miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.b] });
  miembro(env, n, 'enc@x.com', 'se', 'manager', { branches: [n.b] });
  const celEmp = await celular(env, n, n.b, 'sm', 'emp@x.com', 'cel-emp-0123456789abcdefghi');
  const celEnc = await celular(env, n, n.b, 'se', 'enc@x.com', 'cel-enc-0123456789abcdefghi');
  const { id } = await (await post(orden.onRequestPost, env, '/api/mp/orden', null, { externalReference: 'venta-7', idempotencyKey: 'clave-idem-0007', montoCentavos: 5000, canal: 'qr' }, celEmp)).json();
  const devolver = (cel, cuerpo) => post(orden.onRequestDevolver, env, '/api/mp/orden/devolver', null, cuerpo, cel);
  const cuerpo = { id, idempotencyKey: 'devolver-venta-7' };

  assert.equal((await (await get(conexion.onRequestGet, env, '/api/mp/estado', { headers: celEmp })).json()).canRefund, false, 'al empleado no se le ofrece');
  assert.equal((await (await get(conexion.onRequestGet, env, '/api/mp/estado', { headers: celEnc })).json()).canRefund, true);
  assert.equal((await devolver(celEmp, cuerpo)).status, 403, 'un empleado no devuelve aunque llame directo');
  assert.equal((await devolver(celEnc, cuerpo)).status, 409, 'una orden todavía sin cobrar no se devuelve');
  assert.equal(m.devoluciones, undefined);

  m.ordenes.set(id, 'processed');
  const ok = await devolver(celEnc, cuerpo);
  assert.equal(ok.status, 200); assert.equal((await ok.json()).status, 'refunded');
  assert.deepEqual(m.devoluciones, [{ id, clave: 'devolver-venta-7', cuerpo: undefined }], 'total (sin cuerpo) y con la clave de la app');
  assert.equal(one(env, "SELECT COUNT(*) c FROM mp_actividad WHERE accion = 'devolver'").c, 1);
  const otra = await devolver(celEnc, cuerpo);
  assert.equal(otra.status, 409); assert.equal((await otra.json()).error, 'ya_devuelta', 'nunca dos veces');
  assert.equal(m.devoluciones.length, 1);
  assert.equal((await devolver(celEnc, { id: 'ORDAJENA', idempotencyKey: 'devolver-venta-8' })).status, 404, 'una orden de otra cuenta');
  assert.equal((await devolver(celEnc, { id, idempotencyKey: 'x' })).status, 400);
});
await t('crédito (etapa C): siempre en 1 pago, sin pantalla de cuotas; un canal desconocido se rechaza', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.b, terminalId: 'PAX_A910__SERIE1' });
  const cel = await celular(env, n, n.b, 'sd', 'duena@x.com', 'cel-dueno-0123456789abcdefg');
  const crear = (canal, ref) => post(orden.onRequestPost, env, '/api/mp/orden', null, { externalReference: ref, idempotencyKey: `clave-${ref}`, montoCentavos: 5000, canal }, cel);
  assert.equal((await crear('credit_card', 'venta-cred')).status, 200);
  const pedido = m.llamadas.filter((x) => x.path === '/v1/orders' && x.metodo === 'POST').pop();
  assert.deepEqual(pedido.cuerpo.config.payment_method, { default_type: 'credit_card', default_installments: 1 });
  assert.equal((await crear('debit_card', 'venta-deb')).status, 200);
  assert.deepEqual(m.llamadas.filter((x) => x.path === '/v1/orders' && x.metodo === 'POST').pop().cuerpo.config.payment_method, { default_type: 'debit_card' });
  assert.equal((await crear('credit_card_12_cuotas', 'venta-x')).status, 400);
});
await t('modo de la terminal (etapa C): la dueña la pasa a autónomo y la vuelve; un empleado no; se ve en /negocio', async () => {
  const env = mkEnv(MP_ENV); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd'); await conectar(env, n, m, cookie);
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.b, terminalId: 'PAX_A910__SERIE1' });
  const modo = (c, cuerpo) => post(conexion.onRequestModoTerminal, env, '/api/mp/terminal/modo', c, cuerpo);
  const verModo = async () => (await (await get(conexion.onRequestGet, env, `/api/mp/estado?org=${n.org.id}`, { cookie })).json()).branches.find((b) => b.id === n.b).terminalMode;
  assert.equal(await verModo(), 'PDV');
  const r = await modo(cookie, { orgId: n.org.id, branchId: n.b, modo: 'STANDALONE' });
  assert.equal(r.status, 200);
  assert.deepEqual(m.llamadas.filter((x) => x.path === '/terminals/v1/setup').pop().cuerpo, { terminals: [{ id: 'PAX_A910__SERIE1', operating_mode: 'STANDALONE' }] });
  assert.equal(await verModo(), 'STANDALONE');
  assert.equal((await modo(cookie, { orgId: n.org.id, branchId: n.b, modo: 'PDV' })).status, 200);
  assert.equal(await verModo(), 'PDV');
  assert.equal((await modo(cookie, { orgId: n.org.id, branchId: n.b, modo: 'OTRO' })).status, 400);
  assert.equal((await modo(cookie, { orgId: n.org.id, branchId: n.a, modo: 'PDV' })).status, 409, 'una sucursal sin terminal');
  miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.b] });
  assert.notEqual((await modo(await sess(env, 'emp@x.com', 'sm'), { orgId: n.org.id, branchId: n.b, modo: 'STANDALONE' })).status, 200, 'un empleado no');
});

// Avisos de los temas opcionales (etapa D): mismo webhook, misma firma.
function avisoTema(secreto, { tema, id, userId = 241983636, action = 'x.created', requestId = 'req-2', ts = '1742505638684' }) {
  const v1 = createHmac('sha256', secreto).update(`id:${String(id).toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
  return req(`/api/mp/webhook?data.id=${id}&type=${tema}`, { method: 'POST', headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    body: { action, type: tema, user_id: userId, live_mode: true, data: { id } } });
}
await t('avisos de cobros, contracargos y reclamos (etapa D): se consulta el objeto, se guarda una vez, despierta a la sucursal y se baja con GET', async () => {
  const env = mkEnv({ ...MP_ENV, MP_WEBHOOK_SECRET: 'clave-webhook' }); const n = await negocio(env); const m = simular(); const cookie = await sess(env, 'duena@x.com', 'sd');
  await conectar(env, n, m, cookie); env.SYNC_HUB = hubFalso();
  await post(conexion.onRequestElegirTerminal, env, '/api/mp/terminal', cookie, { orgId: n.org.id, branchId: n.b, terminalId: 'PAX_A910__SERIE1' });
  const cel = await celular(env, n, n.b, 'sd', 'duena@x.com', 'cel-dueno-0123456789abcdefg');
  const celA = await celular(env, n, n.a, 'sd', 'duena@x.com', 'cel-dueno-a-0123456789abcdef');
  const enviar = (rq) => mpWebhook.onRequestPost({ request: rq, env });
  const A = (tema, id, extra = {}) => enviar(avisoTema('clave-webhook', { tema, id, ...extra }));
  m.objetos = {
    '/v1/payments/9001': { id: 9001, status: 'approved', transaction_amount: 1234.5, collector_id: 241983636, external_reference: null, payment_type_id: 'account_money', date_approved: '2026-10-04T15:00:00.000-03:00', payer: { email: 'no-se-guarda@x.com' } },
    '/v1/payments/9002': { id: 9002, status: 'rejected', transaction_amount: 500, collector_id: 241983636 },
    '/v1/payments/9003': { id: 9003, status: 'approved', transaction_amount: 700, collector_id: 555 },
    '/v1/chargebacks/CB1': { id: 'CB1', payments: [9001], amount: 1234.5, documentation_required: true, date_documentation_deadline: '2026-10-20T00:00:00.000-03:00', date_created: '2026-10-04T16:00:00.000-03:00' },
    '/post-purchase/v1/claims/CL1': { id: 'CL1', resource_id: 9001, status: 'opened', type: 'mediations', stage: 'dispute', reason_id: 'PNR' },
  };

  const r1 = await A('payment', '9001', { action: 'payment.created' });
  assert.equal(r1.status, 200); assert.equal((await r1.json()).guardado, 1);
  const f = one(env, "SELECT * FROM mp_avisos WHERE tipo = 'cobro'");
  assert.equal(f.monto_centavos, 123450); assert.equal(f.mp_id, '9001'); assert.equal(f.branch_id, null);
  assert.ok(!JSON.stringify(f).includes('no-se-guarda'), 'nada de quien pagó');
  assert.deepEqual(env.SYNC_HUB.avisos.map((x) => x.cuerpo.mp.aviso.tipo), ['cobro'], 'despierta a la sucursal que tiene terminal');
  assert.equal(env.SYNC_HUB.avisos[0].cuerpo.mp.aviso.montoCentavos, 123450);

  assert.equal((await (await A('payment', '9001', { action: 'payment.updated' })).json()).ignorado, true, 'el mismo cobro no se avisa dos veces');
  assert.equal((await (await A('payment', '9002')).json()).ignorado, true, 'un cobro rechazado no es plata');
  assert.equal((await (await A('payment', '9003')).json()).ignorado, true, 'un pago de otra cuenta');
  assert.equal((await (await A('payment', '9001', { userId: 999 })).json()).ignorado, true, 'el aviso de otra cuenta');
  assert.equal((await A('payment', '9001', { userId: 999 })).status, 200);
  assert.equal(one(env, 'SELECT COUNT(*) c FROM mp_avisos').c, 1);

  assert.equal((await (await A('topic_chargebacks_wh', 'CB1')).json()).guardado, 1);
  assert.equal((await (await A('topic_chargebacks_wh', 'CB1')).json()).ignorado, true, 'igual que antes: no se repite');
  m.objetos['/v1/chargebacks/CB1'] = { ...m.objetos['/v1/chargebacks/CB1'], documentation_required: false };
  assert.equal((await (await A('topic_chargebacks_wh', 'CB1')).json()).guardado, 1, 'si cambia, es un aviso nuevo');
  assert.equal((await (await A('topic_claims_integration_wh', 'CL1')).json()).guardado, 1);
  const cb = one(env, "SELECT * FROM mp_avisos WHERE tipo = 'contracargo' ORDER BY id LIMIT 1");
  assert.equal(cb.pago_id, '9001'); assert.equal(cb.monto_centavos, 123450); assert.equal(cb.estado, 'documentacion');
  const cl = one(env, "SELECT * FROM mp_avisos WHERE tipo = 'reclamo'");
  assert.equal(cl.pago_id, '9001'); assert.equal(cl.monto_centavos, 123450, 'el monto sale del cobro afectado'); assert.equal(cl.estado, 'opened');

  assert.equal((await enviar(avisoTema('otra-clave', { tema: 'payment', id: '9001' }))).status, 401, 'sin la firma, nada');
  assert.equal((await (await A('payment', 'no-valido!')).json()).ignorado, true, 'un id con caracteres raros ni se consulta');

  // La PC los baja al arrancar; cada una ve solo los de su sucursal.
  const g = async (h, desde = 0) => (await (await get(orden.onRequestAvisos, env, `/api/mp/avisos?desde=${desde}`, { headers: h })).json()).avisos;
  const todos = await g(cel);
  assert.deepEqual(todos.map((x) => x.tipo), ['cobro', 'contracargo', 'contracargo', 'reclamo']);
  assert.deepEqual(await g(cel, todos[2].id), [todos[3]], 'desde el último que ya tiene');
  assert.equal((await g(celA)).length, 4, 'sin sucursal de origen son de todas');
  env.DB.raw.prepare("UPDATE mp_avisos SET branch_id = ? WHERE tipo = 'cobro'").run(n.a);
  assert.equal((await g(cel)).filter((x) => x.tipo === 'cobro').length, 0, 'un cobro de la sucursal A no se ve en la B');
  assert.equal((await get(orden.onRequestAvisos, env, '/api/mp/avisos?desde=-1', { headers: cel })).status, 400);
  assert.equal((await get(orden.onRequestAvisos, env, '/api/mp/avisos', {})).status, 401);

  // Un cobro que salió de una orden de este servidor se avisa solo a la sucursal de esa orden.
  const antes = env.SYNC_HUB.avisos.length;
  const { id } = await (await post(orden.onRequestPost, env, '/api/mp/orden', null, { externalReference: 'venta-77', idempotencyKey: 'clave-idem-0077', montoCentavos: 5000, canal: 'qr' }, cel)).json();
  assert.ok(id);
  m.objetos['/v1/payments/9010'] = { id: 9010, status: 'approved', transaction_amount: 50, collector_id: 241983636, external_reference: 'venta-77' };
  await A('payment', '9010');
  assert.equal(one(env, "SELECT branch_id FROM mp_avisos WHERE mp_id = '9010'").branch_id, n.b);
  assert.equal(env.SYNC_HUB.avisos.length, antes + 1);

  // Tope: no crece sin límite.
  const { MAX_AVISOS_POR_NEGOCIO } = await import('../functions/_lib/mp_avisos.js');
  assert.ok(MAX_AVISOS_POR_NEGOCIO >= 100);
});
await t('el hub reenvía el aviso de un cobro a todos los equipos, sin tocarlo', async () => {
  const { SyncHub } = await import('../functions/_lib/sync_hub.js');
  const enviados = []; const sockets = [{ tag: 'pc', send: (x) => enviados.push(x) }];
  const hub = new SyncHub({ getWebSockets: () => sockets, getTags: (w) => [w.tag], acceptWebSocket() {} }, {});
  const aviso = { id: 5, tipo: 'cobro', mpId: '9', pagoId: '9', montoCentavos: 100, referencia: null, estado: 'approved', detalle: null, fecha: 1, creado: 2 };
  assert.equal((await hub.fetch(new Request('https://hub/avisar', { method: 'POST', body: JSON.stringify({ mp: { aviso } }) }))).status, 204);
  assert.deepEqual(JSON.parse(enviados[0]), { mp: { aviso } });
});

console.log(`\n${pass} pruebas OK (Mercado Pago por negocio)`);

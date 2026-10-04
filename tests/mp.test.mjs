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
    if (u.pathname === '/terminals/v1/setup') return r({ terminals: cuerpo.terminals.map((x) => ({ id: x.id, operating_mode: x.operating_mode })) });
    if (u.pathname === '/v1/orders' && init.method === 'POST' && m.rechazarOrden) return r(m.rechazarOrden, 400);
    if (u.pathname === '/v1/orders' && init.method === 'POST') { const id = 'ORD' + (m.ordenes.size + 1); m.ordenes.set(id, 'created'); return r({ id, status: 'created', secreto_interno: 'no-se-filtra' }, 201); }
    if (u.pathname === '/terminals/v1/actions' && init.method === 'POST') return m.rechazarImpresion ? r({ errors: [{ code: 'property_value', message: 'Invalid value for property', details: ["'$.config.point.terminal_id' - does not match pattern"] }] }, 400) : r({ id: 'ACT1', status: 'created' }, 201);
    if (u.pathname === '/v1/payments/search') {
      m.busquedas = m.busquedas || []; m.busquedas.push(Object.fromEntries(u.searchParams));
      const off = Number(u.searchParams.get('offset') || 0); const todos = m.pagos || [];
      return r({ paging: { total: todos.length, limit: 50, offset: off }, results: todos.slice(off, off + 50) });
    }
    if (/^\/users\/[^/]+\/mercadopago_account\/balance$/.test(u.pathname)) return m.saldoNegado ? r({ message: 'Public access not allowed', error: 'forbidden' }, 403) : r({ available_balance: 1344.21, total_amount: 2000, unavailable_balance: 655.79 });
    if (u.pathname === '/v1/account/release_report/list') return r([{ file_name: 'liq-2026-10-03.csv', status: 'processed' }]);
    if (u.pathname === '/v1/account/release_report/config' && init.method === 'POST') {
      if (cuerpo.columns.some((c) => c.key === 'BALANCE_AMOUNT') && m.rechazarBalance) return r({ message: 'invalid column' }, 400);
      m.config = cuerpo; return r(cuerpo, 201);
    }
    if (u.pathname === '/v1/account/release_report/config') return m.sinConfig && !m.config ? r({ message: 'Configuration not found for user', error: 'config_not_found_for_user' }, 404) : r(m.config || { file_name_prefix: 'liq', columns: [{ key: 'BALANCE_AMOUNT' }] });
    if (u.pathname === '/v1/account/release_report' && init.method === 'POST') { m.pedidos = (m.pedidos || []).concat([cuerpo]); return r({ id: 77, status: 'pending' }, 202); }
    if (u.pathname === '/v1/account/release_report/liq-2026-10-03.csv') return new Response('DATE;RECORD_TYPE;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;BALANCE_AMOUNT\n2026-10-03T00:00:00;initial_available_balance;;286149.00;0.00;286149.00\n2026-10-03T11:13:00;release;payout;0.00;201016.00;85133.00\n', { status: 200 });
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
  assert.deepEqual(v, { connected: true, needsReconnect: false, terminalConfigured: false });
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
  for (const malo of [{ ...cuerpo, canal: 'credit_card' }, { ...cuerpo, montoCentavos: 12.5 }, { ...cuerpo, montoCentavos: 0 }, { ...cuerpo, idempotencyKey: 'x' }, { ...cuerpo, externalReference: '../..' }]) {
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
  assert.equal(x.reporteLiquidaciones.listar.cantidad, 1); assert.equal(x.reporteLiquidaciones.configuracion.status, 200);
  assert.ok(m.llamadas.some((c) => c.path === '/users/241983636/mercadopago_account/balance'));
  assert.ok(m.llamadas.every((c) => c.metodo === 'GET'), 'no genera ni cambia nada en Mercado Pago');
  assert.ok(!texto.includes('token-falso'), 'el token no sale');
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
console.log(`\n${pass} pruebas OK (Mercado Pago por negocio)`);

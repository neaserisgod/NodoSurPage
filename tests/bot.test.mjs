// El bot de WhatsApp de un negocio (El dueño, 2026-10-09; `Nodo-Sur-Pos/docs/PLAN-BOT.md`). Mercado Pago está simulado: lo que se
// prueba es lo que hace NUESTRO servidor — que solo ande con un plan con bot, que la app configure y el bot lea, que un pedido entre
// "por confirmar" una sola vez y se resuelva una sola vez, que todo quede cifrado, que cada sucursal vea lo suyo y que cada aviso le
// llegue solo a quien le sirve.
import assert from 'node:assert/strict';
import { sha256b64u } from '../functions/_lib/util.js';
import { createOrg, ensureOrgTables } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import { SyncHub } from '../functions/_lib/sync_hub.js';
import * as bot from '../functions/api/bot.js';
import { ensureBotTables } from '../functions/_lib/bot.js';
import * as authorize from '../functions/api/device/authorize.js';
import * as token from '../functions/api/device/token.js';
import * as whoami from '../functions/api/device/whoami.js';
import { mkEnv, addUser, sess, req, web, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const one = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a);

const PLAN_POS = '6fe282d944ef4c018cb7904ce9e122f8', PLAN_POS_BOT = '7652202c076c4cc180c72ade28d52924', PLAN_SOLO_BOT = 'e37aac4650334685873aa8e3920de4c0';
function conPlan(plan, status = 'authorized') { mp.subs = [{ ...mpSub('duena@x.com', status), preapproval_plan_id: plan }]; mp.fail = false; mockMP(); }

function hubFalso() {
  const avisos = [];
  return { avisos, idFromName: (x) => x, get: (id) => ({ fetch: async (url, init) => { avisos.push({ id, cuerpo: init && init.body && JSON.parse(init.body) }); return new Response(null, { status: 204 }); } }) };
}
async function negocio(env) {
  await ensureOrgTables(env); addUser(env, 'duena@x.com', 'sd');
  const r = await createOrg(env, { sub: 'sd', email: 'duena@x.com', name: 'Dueña', orgName: 'La Plazoleta' });
  const otra = env.DB.raw.prepare('INSERT INTO branches (org_id, name, active, created_at) VALUES (?,?,1,?)').run(r.org.id, 'Centro', nowS());
  return { org: r.org, a: r.branch.id, b: Number(otra.lastInsertRowid) };
}
function miembro(env, n, rol, email, sub) {
  addUser(env, email, sub);
  const mm = env.DB.raw.prepare('INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,?,?,?)').run(n.org.id, sub, email, rol, 'active', 0, nowS());
  env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(mm.lastInsertRowid, n.a);
}
const equipo = async (env, n, { sub = 'sd', email = 'duena@x.com', id, kind = 'celular', branchId = n.a } = {}) => {
  await upsertDevice(env, { id, sub, email, name: kind === 'bot' ? 'Bot de WhatsApp' : 'Equipo', orgId: n.org.id, branchId, kind });
  return { Authorization: `Bearer ${await signDeviceToken(env, { sub, email, deviceId: id })}` };
};
const post = (fn, env, path, body, headers) => fn({ request: req(path, { method: 'POST', headers, body }), env });
const get = (fn, env, path, headers) => fn({ request: req(path, { headers }), env });
async function armar(plan = PLAN_POS_BOT) {
  const env = mkEnv(); env.SYNC_HUB = hubFalso(); conPlan(plan); const n = await negocio(env);
  const app = await equipo(env, n, { id: 'cel-duena-0123456789abcdefgh' });
  const robot = await equipo(env, n, { id: 'bot-local-0123456789abcdefgh', kind: 'bot' });
  return { env, n, app, robot };
}
const CONFIG = { rubro: 'almacen', numero_bot: '5492944111111', textos: { quien_atiende: 'Juli' }, pausa_minutos: 60 };
const PEDIDO = { id: 'pedido-0001-abcd', cliente: { nombre: 'Sofi', telefono: '5492944555555' }, items: [{ gid: 'g-coca', nombre: 'Coca 2,25 L', cantidad: 2, precioCentavos: 350000 }], nota: 'Paso a las 19' };

await t('sin un plan con bot no anda nada (y el estado lo dice); con "Sistema + Bot" o "Solo el bot", sí', async () => {
  const { env, app } = await armar(PLAN_POS);
  assert.deepEqual(await (await get(bot.onRequestEstado, env, '/api/bot/estado', app)).json(), { tieneBot: false });
  const r = await get(bot.onRequestConfigGet, env, '/api/bot/config', app);
  assert.equal(r.status, 403); assert.equal((await r.json()).error, 'sin_plan_bot');
  for (const plan of [PLAN_POS_BOT, PLAN_SOLO_BOT]) {
    const x = await armar(plan);
    const e = await (await get(bot.onRequestEstado, x.env, '/api/bot/estado', x.app)).json();
    assert.equal(e.tieneBot, true, plan); assert.equal(e.puedeConfigurar, true); assert.equal(e.version, 0);
    assert.deepEqual(e.bots.map((b) => b.nombre), ['Bot de WhatsApp']);
  }
});

await t('un negocio de pruebas (dueño eximido) tiene el bot sin pagarlo; con Mercado Pago caído, no se decide', async () => {
  const { env, app } = await armar(PLAN_POS);
  env.DB.raw.prepare('UPDATE users SET exempt = 1 WHERE sub = ?').run('sd');
  assert.equal((await (await get(bot.onRequestEstado, env, '/api/bot/estado', app)).json()).tieneBot, true);
  const x = await armar(PLAN_POS_BOT); mp.fail = true;
  assert.equal((await get(bot.onRequestConfigGet, x.env, '/api/bot/config', x.app)).status, 503);
});

await t('configuración: la app la guarda (cifrada, con versión) y el bot la baja; al bot le llega el aviso, a la app no', async () => {
  const { env, n, app, robot } = await armar();
  assert.deepEqual(await (await get(bot.onRequestConfigGet, env, '/api/bot/config', robot)).json(), { version: 0, config: null, actualizada: null });
  const r = await post(bot.onRequestConfigPost, env, '/api/bot/config', { config: CONFIG }, app);
  assert.equal(r.status, 200); assert.equal((await r.json()).version, 1);
  assert.ok(!JSON.stringify(one(env, 'SELECT * FROM bot_config')).includes('5492944111111'), 'el número no queda en claro');
  const leida = await (await get(bot.onRequestConfigGet, env, '/api/bot/config', robot)).json();
  assert.deepEqual(leida.config, CONFIG); assert.equal(leida.version, 1);
  await post(bot.onRequestConfigPost, env, '/api/bot/config', { config: { ...CONFIG, pausa_minutos: 30 } }, app);
  assert.equal((await (await get(bot.onRequestConfigGet, env, '/api/bot/config', robot)).json()).version, 2);
  assert.deepEqual(env.SYNC_HUB.avisos.map((a) => a.cuerpo), [{ bot: { para: 'bots', aviso: { config: 1 } } }, { bot: { para: 'bots', aviso: { config: 2 } } }]);
  assert.match(env.SYNC_HUB.avisos[0].id, /^cuenta:[0-9a-f]{32}$/, 'el hub de la sucursal, sin datos en claro');
  assert.equal(n.a > 0, true);
});

await t('configuración: un empleado, el bot mismo, un cuerpo raro o enorme no la cambian', async () => {
  const { env, n, robot } = await armar();
  miembro(env, n, 'employee', 'emp@x.com', 'se');
  const emp = await equipo(env, n, { sub: 'se', email: 'emp@x.com', id: 'cel-emp-0123456789abcdefghij' });
  assert.equal((await post(bot.onRequestConfigPost, env, '/api/bot/config', { config: CONFIG }, emp)).status, 403, 'un empleado no');
  assert.equal((await (await get(bot.onRequestEstado, env, '/api/bot/estado', emp)).json()).puedeConfigurar, false);
  const r = await post(bot.onRequestConfigPost, env, '/api/bot/config', { config: CONFIG }, robot);
  assert.equal(r.status, 403); assert.equal((await r.json()).error, 'solo_app');
  miembro(env, n, 'manager', 'enc@x.com', 'sm');
  const enc = await equipo(env, n, { sub: 'sm', email: 'enc@x.com', id: 'cel-enc-0123456789abcdefghij' });
  for (const malo of [{}, { config: [1, 2] }, { config: 'texto' }, { config: null }]) {
    assert.equal((await post(bot.onRequestConfigPost, env, '/api/bot/config', malo, enc)).status, 400, JSON.stringify(malo));
  }
  assert.equal((await post(bot.onRequestConfigPost, env, '/api/bot/config', { config: { x: 'a'.repeat(40 * 1024) } }, enc)).status, 413);
  assert.equal((await post(bot.onRequestConfigPost, env, '/api/bot/config', { config: CONFIG }, enc)).status, 200, 'un encargado sí');
  assert.equal((await get(bot.onRequestConfigGet, env, '/api/bot/config', {})).status, 401, 'sin equipo');
});

await t('catálogo: la app lo publica, el bot lo baja; mandarlo igual no despierta al bot; lo raro no entra', async () => {
  const { env, app, robot } = await armar();
  const items = [{ gid: 'g-coca', nombre: 'Coca 2,25 L', precioCentavos: 350000, hay: true }, { gid: 'g-pan', nombre: 'Pan lactal', precioCentavos: 280000, hay: false }];
  const r = await (await post(bot.onRequestCatalogoPost, env, '/api/bot/catalogo', { items }, app)).json();
  assert.deepEqual(r, { ok: true, cambiado: true, items: 2 });
  assert.equal((await (await post(bot.onRequestCatalogoPost, env, '/api/bot/catalogo', { items }, app)).json()).cambiado, false);
  assert.equal(env.SYNC_HUB.avisos.length, 1, 'solo el primero avisa'); assert.deepEqual(env.SYNC_HUB.avisos[0].cuerpo, { bot: { para: 'bots', aviso: { catalogo: true } } });
  assert.deepEqual((await (await get(bot.onRequestCatalogoGet, env, '/api/bot/catalogo', robot)).json()).items, items);
  for (const malo of [{ items: 'x' }, { items: [{ gid: 'g', nombre: '', precioCentavos: 1, hay: true }] }, { items: [{ gid: 'g', nombre: 'A', precioCentavos: 1.5, hay: true }] },
    { items: [{ gid: 'g', nombre: 'A', precioCentavos: 1, hay: 'si' }] }, { items: [{ gid: 'g/../x', nombre: 'A', precioCentavos: 1, hay: true }] }, { items: [{ gid: 'g', nombre: 'A', precioCentavos: 1, hay: true, costoCentavos: 5 }] }]) {
    const x = await post(bot.onRequestCatalogoPost, env, '/api/bot/catalogo', malo, app);
    if (Array.isArray(malo.items) && 'costoCentavos' in malo.items[0]) {
      assert.equal(x.status, 200); // un campo de más se descarta: nunca se guarda el costo
      assert.ok(!('costoCentavos' in (await (await get(bot.onRequestCatalogoGet, env, '/api/bot/catalogo', robot)).json()).items[0]));
    } else assert.equal(x.status, 400, JSON.stringify(malo));
  }
  assert.equal((await post(bot.onRequestCatalogoPost, env, '/api/bot/catalogo', { items }, robot)).status, 403, 'el bot no publica el catálogo');
});

await t('pedido: el bot lo manda, entra "por confirmar" una sola vez (aunque reintente) y la app se entera', async () => {
  const { env, app, robot } = await armar();
  const r = await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', PEDIDO, robot);
  assert.equal(r.status, 201); const { id } = await r.json();
  const otra = await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', PEDIDO, robot);
  assert.equal(otra.status, 200); assert.deepEqual(await otra.json(), { ok: true, id, repetido: true });
  assert.equal(one(env, 'SELECT COUNT(*) c FROM bot_pedidos').c, 1);
  assert.ok(!JSON.stringify(one(env, 'SELECT * FROM bot_pedidos')).includes('Sofi'), 'el cliente no queda en claro');
  assert.deepEqual(env.SYNC_HUB.avisos.map((a) => a.cuerpo), [{ bot: { para: 'equipos', aviso: { pedido: id } } }], 'avisa una vez, a la app');
  const lista = await (await get(bot.onRequestPedidosGet, env, '/api/bot/pedidos?desde=0', app)).json();
  assert.equal(lista.pedidos.length, 1);
  const p = lista.pedidos[0];
  assert.equal(p.estado, 'por_confirmar'); assert.equal(p.pedidoId, PEDIDO.id); assert.deepEqual(p.cliente, PEDIDO.cliente);
  assert.deepEqual(p.items, PEDIDO.items); assert.equal(p.nota, 'Paso a las 19'); assert.equal(lista.hasta, p.actualizado);
  assert.equal((await (await get(bot.onRequestPedidosGet, env, `/api/bot/pedidos?desde=${lista.hasta}`, app)).json()).pedidos.length, 0, 'desde el cursor no hay nada nuevo');
  assert.equal((await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', { ...PEDIDO, id: 'pedido-de-la-app-01' }, app)).status, 403, 'la app no manda pedidos');
});

await t('pedido: lo que el bot manda mal no entra', async () => {
  const { env, robot } = await armar();
  const malos = [
    { ...PEDIDO, id: 'corto' }, { ...PEDIDO, cliente: { nombre: '', telefono: '5492944555555' } }, { ...PEDIDO, cliente: { nombre: 'Sofi', telefono: '+54 9 2944' } },
    { ...PEDIDO, items: [] }, { ...PEDIDO, items: [{ nombre: 'Coca', cantidad: 0 }] }, { ...PEDIDO, items: [{ nombre: 'Coca', cantidad: 1.5 }] },
    { ...PEDIDO, items: Array.from({ length: 51 }, () => ({ nombre: 'Coca', cantidad: 1 })) }, { ...PEDIDO, nota: 'x'.repeat(301) },
  ];
  for (const malo of malos) assert.equal((await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', malo, robot)).status, 400, JSON.stringify(malo).slice(0, 80));
  await ensureBotTables(env);
  assert.equal(one(env, 'SELECT COUNT(*) c FROM bot_pedidos').c, 0);
});

await t('pedido con gramos: entra solo si todas las apps que leen pedidos los entienden (una vieja lo descartaría sin avisar)', async () => {
  const { env, n, app, robot } = await armar();
  const CON_GRAMOS = { ...PEDIDO, id: 'pedido-gramos-0001', items: [{ gid: 'g-jamon', nombre: 'Jamón cocido (por kg)', gramos: 250, precioCentavos: 1500000 }, PEDIDO.items[0]] };
  const mandar = (id) => post(bot.onRequestPedidoPost, env, '/api/bot/pedido', { ...CON_GRAMOS, id }, robot);
  const rechazo = async (r, por) => { assert.equal(r.status, 400, por); assert.equal((await r.json()).error, 'gramos_no_soportado', por); };
  await rechazo(await mandar('pedido-gramos-0001'), 'ninguna app leyó todavía: una vieja podría leer después');
  await get(bot.onRequestPedidosGet, env, '/api/bot/pedidos?desde=0&gramos=1', app);
  assert.equal((await mandar('pedido-gramos-0002')).status, 201, 'la única app entiende gramos');
  const pc = await equipo(env, n, { id: 'pc-local-0123456789abcdefghi', kind: 'pc' });
  await get(bot.onRequestPedidosGet, env, '/api/bot/pedidos?desde=0', pc);
  await rechazo(await mandar('pedido-gramos-0003'), 'una app vieja leyó los pedidos');
  assert.equal((await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', { ...PEDIDO, id: 'pedido-sin-gramos-1' }, robot)).status, 201, 'sin gramos entra siempre');
  env.DB.raw.prepare('UPDATE bot_lectores SET visto = visto - ? WHERE device_id = ?').run(31 * 86400, 'pc-local-0123456789abcdefghi');
  assert.equal((await mandar('pedido-gramos-0004')).status, 201, 'la app vieja no lee hace más de 30 días: ya no cuenta');
  await get(bot.onRequestPedidosGet, env, '/api/bot/pedidos?desde=0', pc);
  env.DB.raw.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run('pc-local-0123456789abcdefghi');
  assert.equal((await mandar('pedido-gramos-0005')).status, 201, 'un equipo desvinculado no cuenta');
  await get(bot.onRequestPedidosGet, env, '/api/bot/pedidos?desde=0', robot);
  assert.equal(one(env, "SELECT COUNT(*) c FROM bot_lectores WHERE device_id LIKE 'bot-%'").c, 0, 'el bot no es un lector');
  const p = (await (await get(bot.onRequestPedidosGet, env, '/api/bot/pedidos?desde=0&gramos=1', app)).json()).pedidos.find((x) => x.pedidoId === 'pedido-gramos-0002');
  assert.deepEqual(p.items, CON_GRAMOS.items, 'la app recibe los gramos tal cual, con el precio por kilo');
  const malos = [{ gramos: 0 }, { gramos: 50001 }, { gramos: 2.5 }, { gramos: 250, cantidad: 1 }, { gramos: '250' }];
  for (const m of malos) {
    assert.equal((await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', { ...PEDIDO, id: 'pedido-malo-00001', items: [{ nombre: 'Jamón', ...m }] }, robot)).status, 400, JSON.stringify(m));
  }
});

await t('resolver: la app acepta o rechaza una sola vez y el bot se entera; otra sucursal no lo ve ni lo toca', async () => {
  const { env, n, app, robot } = await armar();
  const { id } = await (await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', PEDIDO, robot)).json();
  const { id: id2 } = await (await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', { ...PEDIDO, id: 'pedido-0002-abcd' }, robot)).json();
  const appCentro = await equipo(env, n, { id: 'cel-centro-0123456789abcdefg', branchId: n.b });
  assert.equal((await (await get(bot.onRequestPedidosGet, env, '/api/bot/pedidos?desde=0', appCentro)).json()).pedidos.length, 0, 'otra sucursal no ve los pedidos');
  assert.equal((await post(bot.onRequestResolver, env, '/api/bot/pedido/resolver', { id, estado: 'aceptado' }, appCentro)).status, 404);

  const antes = (await (await get(bot.onRequestPedidosGet, env, '/api/bot/pedidos?desde=0', robot)).json()).hasta;
  env.SYNC_HUB.avisos.length = 0;
  assert.equal((await post(bot.onRequestResolver, env, '/api/bot/pedido/resolver', { id, estado: 'aceptado' }, app)).status, 200);
  const dos = await post(bot.onRequestResolver, env, '/api/bot/pedido/resolver', { id, estado: 'rechazado' }, app);
  assert.equal(dos.status, 409); assert.deepEqual(await dos.json(), { error: 'ya_resuelto', estado: 'aceptado' });
  assert.equal((await post(bot.onRequestResolver, env, '/api/bot/pedido/resolver', { id: id2, estado: 'rechazado' }, app)).status, 200);
  assert.deepEqual(env.SYNC_HUB.avisos.map((a) => a.cuerpo), [
    { bot: { para: 'bots', aviso: { pedido: id, estado: 'aceptado' } } }, { bot: { para: 'bots', aviso: { pedido: id2, estado: 'rechazado' } } }]);
  const cambios = await (await get(bot.onRequestPedidosGet, env, `/api/bot/pedidos?desde=${antes}`, robot)).json();
  assert.deepEqual(cambios.pedidos.map((p) => [p.id, p.estado]).sort(), [[id, 'aceptado'], [id2, 'rechazado']].sort(), 'el bot ve lo que se resolvió');
  for (const malo of [{ id, estado: 'cancelado' }, { id: 'x', estado: 'aceptado' }, {}]) {
    assert.equal((await post(bot.onRequestResolver, env, '/api/bot/pedido/resolver', malo, app)).status, 400, JSON.stringify(malo));
  }
  assert.equal((await post(bot.onRequestResolver, env, '/api/bot/pedido/resolver', { id: 999, estado: 'aceptado' }, app)).status, 404);
  assert.equal((await post(bot.onRequestResolver, env, '/api/bot/pedido/resolver', { id: id2, estado: 'aceptado' }, robot)).status, 403, 'el bot no resuelve');
  assert.equal((await get(bot.onRequestPedidosGet, env, '/api/bot/pedidos?desde=-1', app)).status, 400);
});

await t('los pedidos de más de 30 días se borran solos (tienen datos de clientes)', async () => {
  const { env, n, robot } = await armar(); await ensureBotTables(env);
  env.DB.raw.prepare("INSERT INTO bot_pedidos (org_id, branch_id, pedido_id, estado, datos_enc, creado, actualizado) VALUES (?,?,?,?,?,?,?)")
    .run(n.org.id, n.a, 'pedido-viejo-0001', 'aceptado', 'x', Date.now() - 31 * 86400000, Date.now() - 31 * 86400000);
  await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', PEDIDO, robot);
  assert.deepEqual(env.DB.raw.prepare('SELECT pedido_id FROM bot_pedidos').all().map((f) => f.pedido_id), [PEDIDO.id]);
});

await t('el hub manda lo del bot solo al bot, lo de la app solo a la app, y la sync y Mercado Pago nunca al bot', async () => {
  const socks = [{ tags: ['cel-1'] }, { tags: ['pc-1'] }, { tags: ['bot-1', 'tipo:bot'] }].map((s) => ({ ...s, enviados: [], ws: null }));
  for (const s of socks) s.ws = { send: (m) => s.enviados.push(JSON.parse(m)) };
  const hub = new SyncHub({ getWebSockets: () => socks.map((s) => s.ws), getTags: (ws) => socks.find((s) => s.ws === ws).tags, acceptWebSocket() {} }, {});
  const avisar = (cuerpo) => hub.fetch(new Request('https://hub/avisar', { method: 'POST', body: JSON.stringify(cuerpo) }));
  await avisar({ bot: { para: 'bots', aviso: { config: 3 } } });
  await avisar({ bot: { para: 'equipos', aviso: { pedido: 7 } } });
  await avisar({ seq: 12, de: 'pc-1' });
  await avisar({ mp: { orden: 'ORD1', accion: 'processed' } });
  const [cel, pc, robot] = socks.map((s) => s.enviados);
  assert.deepEqual(robot, [{ bot: { config: 3 } }]);
  assert.deepEqual(cel, [{ bot: { pedido: 7 } }, { seq: 12 }, { mp: { orden: 'ORD1', accion: 'processed' } }]);
  assert.deepEqual(pc, [{ bot: { pedido: 7 } }, { mp: { orden: 'ORD1', accion: 'processed' } }], 'la PC no recibe su propio lote');
});

// --- Vincular el celular del bot ----------------------------------------------------------------------------------------------
const STATE = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
const newVerifier = () => Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString('base64url');
async function vincular(env, cookie, extra, deviceId) {
  const verifier = newVerifier();
  const r = await authorize.onRequestPost({ request: req('/api/device/authorize', { method: 'POST', cookie, headers: web, body: { port: 53682, state: STATE, challenge: await sha256b64u(verifier), deviceId, name: 'Bot de WhatsApp', ...extra } }), env });
  if (r.status !== 200) return { r };
  const code = new URL((await r.json()).redirect).searchParams.get('code');
  const c = await token.onRequestPost({ request: req('/api/device/token', { method: 'POST', body: { code, verifier } }), env });
  return { r, tok: c.status === 200 ? (await c.json()).token : null };
}

await t('vincular el bot: el dueño o un encargado, en una sucursal suya; queda como equipo tipo bot y entra a lo del bot', async () => {
  const env = mkEnv(); conPlan(PLAN_POS_BOT); const n = await negocio(env);
  const { tok } = await vincular(env, await sess(env, 'duena@x.com', 'sd'), { tipo: 'bot', orgId: n.org.id, branchId: n.a }, 'bot-local-0123456789abcdefgh');
  assert.ok(tok);
  const d = one(env, 'SELECT * FROM devices WHERE id = ?', 'bot-local-0123456789abcdefgh');
  assert.equal(d.kind, 'bot'); assert.equal(d.branch_id, n.a);
  assert.equal((await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', PEDIDO, { Authorization: `Bearer ${tok}` })).status, 201);

  miembro(env, n, 'manager', 'enc@x.com', 'sm');
  assert.ok((await vincular(env, await sess(env, 'enc@x.com', 'sm'), { tipo: 'bot', orgId: n.org.id, branchId: n.a }, 'bot-enc-0123456789abcdefghi')).tok, 'un encargado, en su sucursal');
  assert.equal((await vincular(env, await sess(env, 'enc@x.com', 'sm'), { tipo: 'bot', orgId: n.org.id, branchId: n.b }, 'bot-enc2-0123456789abcdefgh')).r.status, 403, 'no en una que no es suya');
  miembro(env, n, 'employee', 'emp@x.com', 'se');
  assert.equal((await vincular(env, await sess(env, 'emp@x.com', 'se'), { tipo: 'bot', orgId: n.org.id }, 'bot-emp-0123456789abcdefghi')).r.status, 403, 'un empleado no');
  const w = await (await whoami.onRequestGet({ request: req('/api/device/whoami?tipo=bot', { cookie: await sess(env, 'emp@x.com', 'se') }), env })).json();
  assert.equal(w.canLink, false);
});

await t('vincular el bot sin tener un negocio no crea uno', async () => {
  const env = mkEnv(); conPlan(PLAN_POS_BOT); await ensureOrgTables(env); addUser(env, 'nadie@x.com', 'sn');
  assert.equal((await vincular(env, await sess(env, 'nadie@x.com', 'sn'), { tipo: 'bot' }, 'bot-nadie-0123456789abcdefg')).r.status, 403);
  assert.equal(one(env, 'SELECT COUNT(*) c FROM orgs').c, 0);
  const w = await (await whoami.onRequestGet({ request: req('/api/device/whoami?tipo=bot', { cookie: await sess(env, 'nadie@x.com', 'sn') }), env })).json();
  assert.equal(w.canLink, false);
});

console.log(`\n${pass} pruebas OK (bot de WhatsApp)`);

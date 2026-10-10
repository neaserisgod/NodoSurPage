// Turnos del bot (El dueño, 2026-10-10; `functions/_lib/bot_turnos.js`). Lo que se prueba: que dos reservas del mismo horario no
// entren las dos (ni a la vez), que el bot no pise lo que ocupa la agenda de la app, que la app sí pueda (sobreturno), que cada lado
// se entere de los cambios del otro y que los datos del cliente queden cifrados.
import assert from 'node:assert/strict';
import { createOrg, ensureOrgTables } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import * as bot from '../functions/api/bot.js';
import { mkEnv, addUser, req, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };

const PLAN_SOLO_BOT = 'e37aac4650334685873aa8e3920de4c0', PLAN_POS = '6fe282d944ef4c018cb7904ce9e122f8';
function conPlan(plan) { mp.subs = [{ ...mpSub('duena@x.com', 'authorized'), preapproval_plan_id: plan }]; mp.fail = false; mockMP(); }
function hubFalso() {
  const avisos = [];
  return { avisos, idFromName: (x) => x, get: (id) => ({ fetch: async (url, init) => { avisos.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); } }) };
}
async function armar(plan = PLAN_SOLO_BOT) {
  const env = mkEnv(); env.SYNC_HUB = hubFalso(); conPlan(plan);
  await ensureOrgTables(env); addUser(env, 'duena@x.com', 'sd');
  const r = await createOrg(env, { sub: 'sd', email: 'duena@x.com', name: 'Caro', orgName: 'Caro Uñas' });
  const otra = Number(env.DB.raw.prepare('INSERT INTO branches (org_id, name, active, created_at) VALUES (?,?,1,?)').run(r.org.id, 'Centro', nowS()).lastInsertRowid);
  const equipo = async (id, kind, branchId = r.branch.id) => {
    await upsertDevice(env, { id, sub: 'sd', email: 'duena@x.com', name: kind, orgId: r.org.id, branchId, kind });
    return { Authorization: `Bearer ${await signDeviceToken(env, { sub: 'sd', email: 'duena@x.com', deviceId: id })}` };
  };
  return {
    env,
    app: await equipo('cel-caro-0123456789abcdefgh', 'celular'),
    robot: await equipo('bot-caro-0123456789abcdefgh', 'bot'),
    otraSucursal: await equipo('bot-centro-0123456789abcdefg', 'bot', otra),
  };
}
const post = (fn, env, path, body, headers) => fn({ request: req(path, { method: 'POST', headers, body }), env });
const get = (fn, env, path, headers) => fn({ request: req(path, { headers }), env });

const H = 3600 * 1000;
const manana10 = (() => { const d = new Date(Date.now() + 24 * H); d.setHours(10, 0, 0, 0); return d.getTime(); })();
const turno = (id, inicio = manana10, extra = {}) => ({
  id, inicio, fin: inicio + H, estado: 'confirmado',
  cliente: { nombre: 'Ana', telefono: '5492944111111' }, servicio: { gid: 'g-semi', nombre: 'Semipermanente' }, ...extra,
});

await t('el bot reserva; el mismo horario otra vez da "ocupado"; reintentar el mismo turno no lo duplica', async () => {
  const { env, robot } = await armar();
  const r = await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0001-aaaa'), robot);
  assert.equal(r.status, 201);
  assert.equal((await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0001-aaaa'), robot)).status, 200, 'reintento');
  const choca = await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0002-bbbb', manana10 + H / 2), robot);
  assert.equal(choca.status, 409); assert.equal((await choca.json()).error, 'ocupado');
  // Justo a continuación sí entra.
  assert.equal((await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0003-cccc', manana10 + H), robot)).status, 201);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM bot_turnos').get().n, 2);
  const fila = env.DB.raw.prepare('SELECT * FROM bot_turnos LIMIT 1').get();
  assert.ok(!JSON.stringify(fila).includes('5492944111111'), 'el teléfono no queda en claro');
  assert.ok(!JSON.stringify(fila).includes('Ana'), 'el nombre tampoco');
});

await t('dos reservas del mismo horario a la vez: entra una sola', async () => {
  const { env, robot } = await armar();
  const rs = await Promise.all(['turno-a-00000001', 'turno-b-00000002', 'turno-c-00000003'].map((id) => post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno(id), robot)));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409]);
});

await t('lo que ocupa la agenda de la app (sin datos de clientes) frena al bot; un cancelado o uno que ya no viene, no', async () => {
  const { env, app, robot } = await armar();
  const ocupados = [{ id: 'gid-app-0000000001', inicio: manana10, fin: manana10 + H, estado: 'confirmado' }];
  const r = await (await post(bot.onRequestOcupadosPost, env, '/api/bot/ocupados', { turnos: ocupados }, app)).json();
  assert.deepEqual(r, { ok: true, cambiado: true });
  assert.equal((await (await post(bot.onRequestOcupadosPost, env, '/api/bot/ocupados', { turnos: ocupados }, app)).json()).cambiado, false, 'igual: no cambia');
  assert.deepEqual(env.SYNC_HUB.avisos.map((a) => a.bot), [{ para: 'bots', aviso: { ocupados: true } }], 'solo el primero despierta al bot');
  assert.equal((await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0001-aaaa'), robot)).status, 409);

  // La app deja de mandarlo (lo canceló): el horario se libera y el bot se entera por el cursor.
  await post(bot.onRequestOcupadosPost, env, '/api/bot/ocupados', { turnos: [] }, app);
  const cambios = await (await get(bot.onRequestTurnosGet, env, '/api/bot/turnos?desde=0', robot)).json();
  assert.equal(cambios.turnos.length, 1); assert.equal(cambios.turnos[0].estado, 'cancelado'); assert.equal(cambios.turnos[0].origen, 'app');
  assert.equal(cambios.turnos[0].cliente, undefined, 'la app no manda clientes');
  assert.equal((await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0001-aaaa'), robot)).status, 201);
});

await t('la app baja los turnos del bot con su cliente; los mueve o cancela y el bot se entera', async () => {
  const { env, app, robot } = await armar();
  await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0001-aaaa', manana10, { estado: 'esperando_sena', senaPedidaCentavos: 540000 }), robot);
  assert.deepEqual(env.SYNC_HUB.avisos.at(-1).bot, { para: 'equipos', aviso: { turno: 'turno-0001-aaaa' } });
  const r = await (await get(bot.onRequestTurnosGet, env, '/api/bot/turnos?desde=0', app)).json();
  assert.equal(r.turnos[0].cliente.nombre, 'Ana'); assert.equal(r.turnos[0].senaPedidaCentavos, 540000); assert.equal(r.turnos[0].estado, 'esperando_sena');

  // La dueña lo mueve a un horario que pisa otro: la app puede (sobreturno).
  await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0002-bbbb', manana10 + 2 * H), robot);
  const mover = await post(bot.onRequestTurnoCambio, env, '/api/bot/turno/cambio', { id: 'turno-0001-aaaa', inicio: manana10 + 2 * H, fin: manana10 + 3 * H }, app);
  assert.equal(mover.status, 200);
  assert.deepEqual(env.SYNC_HUB.avisos.at(-1).bot, { para: 'bots', aviso: { turno: 'turno-0001-aaaa' } });
  const delBot = await (await get(bot.onRequestTurnosGet, env, `/api/bot/turnos?desde=${r.hasta}`, robot)).json();
  assert.ok(delBot.turnos.some((x) => x.id === 'turno-0001-aaaa' && x.inicio === manana10 + 2 * H));

  // El bot no puede mover uno a un horario ocupado.
  const choca = await post(bot.onRequestTurnoCambio, env, '/api/bot/turno/cambio', { id: 'turno-0002-bbbb', inicio: manana10 + 2 * H, fin: manana10 + 3 * H }, robot);
  assert.equal(choca.status, 409);
  // Cancelar sí.
  assert.equal((await post(bot.onRequestTurnoCambio, env, '/api/bot/turno/cambio', { id: 'turno-0001-aaaa', estado: 'cancelado' }, app)).status, 200);
  assert.equal((await post(bot.onRequestTurnoCambio, env, '/api/bot/turno/cambio', { id: 'no-existe-000001', estado: 'cancelado' }, app)).status, 404);
});

await t('lo raro no entra; cada sucursal ve lo suyo; sin plan con bot, nada', async () => {
  const { env, app, robot, otraSucursal } = await armar();
  for (const malo of [
    turno('corto'),
    turno('turno-0001-aaaa', manana10, { fin: manana10 }),
    turno('turno-0001-aaaa', manana10, { estado: 'atendido' }),
    turno('turno-0001-aaaa', manana10, { cliente: { nombre: 'Ana', telefono: '2944' } }),
    turno('turno-0001-aaaa', manana10, { servicio: { nombre: '' } }),
    turno('turno-0001-aaaa', Date.now() + 500 * 24 * H),
  ]) {
    assert.equal((await post(bot.onRequestTurnoPost, env, '/api/bot/turno', malo, robot)).status, 400, JSON.stringify(malo));
  }
  assert.equal((await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0001-aaaa'), app)).status, 403, 'la app no reserva por acá');
  assert.equal((await post(bot.onRequestOcupadosPost, env, '/api/bot/ocupados', { turnos: [] }, robot)).status, 403, 'el bot no publica ocupados');
  await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0001-aaaa'), robot);
  assert.equal((await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0009-zzzz'), otraSucursal)).status, 201, 'otra sucursal, otra agenda');
  assert.equal((await (await get(bot.onRequestTurnosGet, env, '/api/bot/turnos?desde=0', otraSucursal)).json()).turnos.length, 1);

  const x = await armar(PLAN_POS);
  assert.equal((await post(bot.onRequestTurnoPost, x.env, '/api/bot/turno', turno('turno-0001-aaaa'), x.robot)).status, 403);
});

console.log(`\n${pass} pruebas de turnos del bot OK`);

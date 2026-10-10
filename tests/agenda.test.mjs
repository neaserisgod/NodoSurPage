// La agenda de turnos de una sucursal en el hub de la sync (Nodo Sur para servicios, etapa 5): reservar sin pisar a otro,
// también con pedidos que llegan a la vez, mover, liberar, y las rutas /api/agenda/* con el control de acceso de la sync.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import { SyncHub } from '../functions/_lib/sync_hub.js';
import * as agenda from '../functions/api/agenda.js';
import { mkEnv, addUser, req, mp, mpSub, mockMP } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };

// El SQLite de un Durable Object (`state.storage.sql.exec(consulta, ...valores)` → cursor con `toArray()`), sobre node:sqlite.
function sqlFalso() {
  const db = new DatabaseSync(':memory:');
  return { exec: (q, ...v) => { const st = db.prepare(q); return /^\s*SELECT/i.test(q) ? { toArray: () => st.all(...v) } : (st.run(...v), { toArray: () => [] }); } };
}
const hubNuevo = () => new SyncHub({ storage: { sql: sqlFalso() }, getWebSockets: () => [], getTags: () => [], acceptWebSocket() {} }, {});
const pedir = (hub, ruta, cuerpo) => hub.fetch(new Request(`https://hub${ruta}`, cuerpo === undefined ? {} : { method: 'POST', body: JSON.stringify(cuerpo) }));
const turno = (id, inicio, fin, extra = {}) => ({ id, inicio: `2026-10-12 ${inicio}`, fin: `2026-10-12 ${fin}`, ...extra });

await t('reserva un horario libre y no deja dar el mismo a otro del mismo profesional', async () => {
  const hub = hubNuevo();
  assert.equal((await pedir(hub, '/agenda/reservar', turno('t1', '10:00', '11:00', { profesional: 'vale' }))).status, 200);
  const r = await pedir(hub, '/agenda/reservar', turno('t2', '10:30', '11:00', { profesional: 'vale' }));
  assert.equal(r.status, 409);
  assert.deepEqual((await r.json()).choca, { id: 't1', profesional: 'vale', inicio: '2026-10-12 10:00', fin: '2026-10-12 11:00' });
  assert.equal((await pedir(hub, '/agenda/reservar', turno('t3', '10:30', '11:00', { profesional: 'caro' }))).status, 200, 'otra profesional sí');
  assert.equal((await pedir(hub, '/agenda/reservar', turno('t4', '11:00', '12:00', { profesional: 'vale' }))).status, 200, 'pegado no se pisa');
});

await t('sin varios profesionales la agenda es una sola', async () => {
  const hub = hubNuevo();
  await pedir(hub, '/agenda/reservar', turno('t1', '10:00', '11:00', { profesional: 'vale' }));
  assert.equal((await pedir(hub, '/agenda/reservar', turno('t2', '10:30', '11:00', { profesional: 'caro', porProfesional: false }))).status, 409);
});

await t('mover un turno (mismo id) no choca consigo mismo; liberar deja el horario libre', async () => {
  const hub = hubNuevo();
  await pedir(hub, '/agenda/reservar', turno('t1', '10:00', '11:00'));
  assert.equal((await pedir(hub, '/agenda/reservar', turno('t1', '10:30', '11:30'))).status, 200);
  assert.equal((await pedir(hub, '/agenda/reservar', turno('t2', '10:00', '10:30'))).status, 200, 'donde estaba antes quedó libre');
  assert.equal((await pedir(hub, '/agenda/liberar', { id: 't1' })).status, 200);
  assert.equal((await pedir(hub, '/agenda/reservar', turno('t3', '10:30', '11:30'))).status, 200);
  const o = await (await pedir(hub, '/agenda/ocupados?desde=2026-10-12&hasta=2026-10-12')).json();
  assert.deepEqual(o.ocupados.map((x) => x.id), ['t2', 't3']);
});

await t('veinte equipos piden el mismo horario a la vez: uno solo lo consigue', async () => {
  const hub = hubNuevo();
  const rs = await Promise.all(Array.from({ length: 20 }, (_, k) => pedir(hub, '/agenda/reservar', turno(`t${k}`, '15:00', '16:00'))));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 19);
});

await t('rechaza lo que no es una reserva', async () => {
  const hub = hubNuevo();
  for (const malo of [{}, turno('t1', '11:00', '10:00'), turno('id con espacios', '10:00', '11:00'), { id: 't1', inicio: '2026-10-12 23:00', fin: '2026-10-13 01:00' }, turno('t1', '10:00', '11:00', { profesional: 'a b' })]) {
    assert.equal((await pedir(hub, '/agenda/reservar', malo)).status, 400, JSON.stringify(malo));
  }
  assert.equal((await hub.fetch(new Request('https://hub/agenda/reservar', { method: 'POST', body: 'no es json' }))).status, 400);
  assert.equal((await pedir(hub, '/agenda/ocupados?desde=ayer&hasta=hoy')).status, 400);
});

await t('lo que terminó hace más de una semana se borra solo', async () => {
  const sql = sqlFalso();
  const hub = new SyncHub({ storage: { sql }, getWebSockets: () => [], getTags: () => [], acceptWebSocket() {} }, {});
  await pedir(hub, '/agenda/reservar', { id: 'viejo', inicio: '2020-01-01 10:00', fin: '2020-01-01 11:00' });
  await pedir(hub, '/agenda/reservar', turno('nuevo', '10:00', '11:00'));
  assert.deepEqual(sql.exec('SELECT id FROM agenda').toArray().map((x) => x.id), ['nuevo']);
});

// --- las rutas, con el control de acceso de la sync
const bearer = (tok) => ({ Authorization: `Bearer ${tok}` });
async function disp(env, email, sub, nombre) {
  const id = `${nombre}-${sub}-0123456789abcdefghij`;
  await upsertDevice(env, { id, sub, email, name: nombre });
  return signDeviceToken(env, { sub, email, deviceId: id });
}
function hubsPorSucursal() {
  const hubs = new Map();
  // Como el stub de un Durable Object: `fetch(url, init)`.
  return { hubs, idFromName: (x) => x, get: (id) => { if (!hubs.has(id)) hubs.set(id, hubNuevo()); const hub = hubs.get(id); return { fetch: (url, init) => hub.fetch(new Request(url, init)) }; } };
}
const conSuscripcion = (email) => { mp.subs = [mpSub(email, 'authorized', 1)]; mp.fail = false; mockMP(); };
const reservar = (env, tok, cuerpo) => agenda.onRequestReservar({ request: req('/api/agenda/reservar', { method: 'POST', body: cuerpo, headers: tok ? bearer(tok) : {} }), env });

await t('/api/agenda: un equipo de la sucursal reserva y otro de la misma sucursal choca', async () => {
  const env = mkEnv(); env.SYNC_HUB = hubsPorSucursal();
  addUser(env, 'ana@x.com', 's1'); conSuscripcion('ana@x.com');
  const cel = await disp(env, 'ana@x.com', 's1', 'cel'), bot = await disp(env, 'ana@x.com', 's1', 'bot');
  assert.equal((await reservar(env, cel, turno('t1', '10:00', '11:00'))).status, 200);
  const r = await reservar(env, bot, turno('t2', '10:15', '10:45'));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).choca.id, 't1');
  const o = await (await agenda.onRequestOcupados({ request: req('/api/agenda/ocupados?desde=2026-10-12&hasta=2026-10-12', { headers: bearer(bot) }), env })).json();
  assert.deepEqual(o.ocupados.map((x) => x.id), ['t1']);
  assert.equal((await agenda.onRequestLiberar({ request: req('/api/agenda/liberar', { method: 'POST', body: { id: 't1' }, headers: bearer(cel) }), env })).status, 200);
  assert.equal((await reservar(env, bot, turno('t2', '10:15', '10:45'))).status, 200);
});

await t('/api/agenda: sin dispositivo no entra, y otra cuenta tiene su propia agenda', async () => {
  const env = mkEnv(); env.SYNC_HUB = hubsPorSucursal();
  addUser(env, 'ana@x.com', 's1'); addUser(env, 'beto@x.com', 's2');
  mp.subs = [mpSub('ana@x.com', 'authorized', 1), mpSub('beto@x.com', 'authorized', 2)]; mp.fail = false; mockMP();
  assert.equal((await reservar(env, null, turno('t1', '10:00', '11:00'))).status, 401);
  const ana = await disp(env, 'ana@x.com', 's1', 'cel'), beto = await disp(env, 'beto@x.com', 's2', 'cel');
  assert.equal((await reservar(env, ana, turno('t1', '10:00', '11:00'))).status, 200);
  assert.equal((await reservar(env, beto, turno('t9', '10:00', '11:00'))).status, 200, 'otro negocio: otro hub');
  assert.equal(env.SYNC_HUB.hubs.size, 2);
});

await t('/api/agenda: sin hub configurado contesta 503', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); conSuscripcion('ana@x.com');
  const cel = await disp(env, 'ana@x.com', 's1', 'cel');
  assert.equal((await reservar(env, cel, turno('t1', '10:00', '11:00'))).status, 503);
});

console.log(`\n${pass} pruebas de agenda ok`);

import assert from 'node:assert/strict';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import { sha256Hex } from '../functions/_lib/backups.js';
import { RETENCION_DIAS, PURGA_CADA, purgarViejos } from '../functions/_lib/sync.js';
import { SyncHub } from '../functions/_lib/sync_hub.js';
import * as sync from '../functions/api/sync.js';
import { mkEnv, addUser, req, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const enc = (s) => new TextEncoder().encode(s);
const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const bearer = (tok) => ({ Authorization: `Bearer ${tok}` });
async function disp(env, email, sub, nombre, id) {
  await upsertDevice(env, { id: id || `${nombre}-${sub}-0123456789abcdefghij`, sub, email, name: nombre });
  return signDeviceToken(env, { sub, email, deviceId: id || `${nombre}-${sub}-0123456789abcdefghij` });
}
async function subir(env, tok, texto, loteId, extra = {}) {
  const bytes = enc(texto);
  return sync.onRequestPost({ request: req('/api/sync', { method: 'POST', raw: bytes, headers: { ...bearer(tok), 'X-Lote-Id': loteId, 'X-Sha256': await sha256Hex(bytes), ...extra } }), env });
}
const bajar = (env, tok, desde = 0) => sync.onRequestGet({ request: req(`/api/sync?desde=${desde}`, { headers: bearer(tok) }), env });
const conSuscripcion = (email, estado = 'authorized') => { mp.subs = [mpSub(email, estado, 1)]; mp.fail = false; mockMP(); };
const cuenta = async () => { const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); conSuscripcion('ana@x.com');
  return { env, pc: await disp(env, 'ana@x.com', 's1', 'pc'), cel: await disp(env, 'ana@x.com', 's1', 'cel') }; };

await t('un lote subido por la PC lo baja el celular, idéntico y sin que el servidor lo guarde en claro', async () => {
  const { env, pc, cel } = await cuenta();
  const r = await subir(env, pc, '{"ventas":[{"total":123456}]}', 'lote-0001-aaaa'); assert.equal(r.status, 200);
  const j = await r.json(); assert.ok(j.seq && j.repetido === false);
  const guardado = env.DB.raw.prepare('SELECT datos FROM sync_lotes').get().datos;
  assert.ok(!Buffer.from(guardado, 'base64').includes(Buffer.from('ventas')), 'cifrado en la base');
  const b = await (await bajar(env, cel)).json();
  assert.equal(b.expirado, false); assert.equal(b.lotes.length, 1);
  assert.equal(dec(b.lotes[0].datos), '{"ventas":[{"total":123456}]}'); assert.equal(b.hasta, j.seq);
});
await t('un dispositivo no recibe sus propios lotes, pero su cursor avanza sobre ellos', async () => {
  const { env, pc } = await cuenta();
  const { seq } = await (await subir(env, pc, 'mio', 'lote-0002-aaaa')).json();
  const b = await (await bajar(env, pc)).json(); assert.equal(b.lotes.length, 0); assert.equal(b.hasta, seq);
});
await t('con ?desde solo baja lo nuevo, en orden', async () => {
  const { env, pc, cel } = await cuenta();
  const a = await (await subir(env, pc, 'uno', 'lote-0003-aaaa')).json();
  await subir(env, pc, 'dos', 'lote-0003-bbbb');
  const b = await (await bajar(env, cel, a.seq)).json(); assert.deepEqual(b.lotes.map((l) => dec(l.datos)), ['dos']);
});
await t('reintentar el mismo lote no lo duplica', async () => {
  const { env, pc, cel } = await cuenta();
  const a = await (await subir(env, pc, 'x', 'lote-0004-aaaa')).json();
  const b = await (await subir(env, pc, 'x', 'lote-0004-aaaa')).json();
  assert.equal(b.repetido, true); assert.equal(b.seq, a.seq);
  assert.equal((await (await bajar(env, cel)).json()).lotes.length, 1);
});
await t('las cuentas no se ven entre sí', async () => {
  const { env, pc } = await cuenta(); addUser(env, 'bea@x.com', 's2');
  mp.subs = [mpSub('ana@x.com', 'authorized', 1), mpSub('bea@x.com', 'authorized', 1)]; mockMP();
  const otra = await disp(env, 'bea@x.com', 's2', 'pc');
  await subir(env, pc, 'secreto de ana', 'lote-0005-aaaa');
  assert.equal((await (await bajar(env, otra)).json()).lotes.length, 0);
});
await t('integridad: un hash que no coincide se rechaza, y un lote enorme también', async () => {
  const { env, pc } = await cuenta();
  assert.equal((await subir(env, pc, 'abc', 'lote-0006-aaaa', { 'X-Sha256': '0'.repeat(64) })).status, 422);
  assert.equal((await subir(env, pc, 'a'.repeat(1024 * 1024 + 1), 'lote-0006-bbbb')).status, 413);
  assert.equal((await subir(env, pc, 'abc', 'x')).status, 400); // id de lote inválido
});
await t('sin token de dispositivo (ni sesión web) no entra', async () => {
  const { env } = await cuenta();
  assert.equal((await sync.onRequestPost({ request: req('/api/sync', { method: 'POST', raw: enc('x') }), env })).status, 401);
  assert.equal((await sync.onRequestGet({ request: req('/api/sync'), env })).status, 401);
});
await t('sin suscripción no se sube; quien canceló recientemente todavía puede bajar', async () => {
  const { env, pc, cel } = await cuenta();
  await subir(env, pc, 'antes', 'lote-0007-aaaa');
  conSuscripcion('ana@x.com', 'cancelled');
  assert.equal((await subir(env, pc, 'nuevo', 'lote-0007-bbbb')).status, 403);
  assert.equal((await (await bajar(env, cel)).json()).lotes.length, 1);
  mp.subs = []; mockMP();
  assert.equal((await bajar(env, cel)).status, 403);
});
await t('si Mercado Pago no responde, no se habilita (ante la duda, no)', async () => {
  const { env, pc } = await cuenta(); mp.fail = true; mockMP();
  assert.equal((await subir(env, pc, 'x', 'lote-0008-aaaa')).status, 503);
});
await t('sin la clave de cifrado el servicio avisa que no está configurado', async () => {
  const { env, pc } = await cuenta(); delete env.BACKUP_KEY;
  assert.equal((await subir(env, pc, 'x', 'lote-0009-aaaa')).status, 503);
});
await t('retención: se borran los lotes viejos y quien se quedó atrás recibe expirado', async () => {
  const { env, pc, cel } = await cuenta();
  const viejo = await (await subir(env, pc, 'viejo', 'lote-0010-aaaa')).json();
  env.SYNC_TOPE_BYTES = 0; env.DB.raw.prepare('UPDATE sync_lotes SET created_at = ?').run(nowS() - (RETENCION_DIAS + 1) * 86400);
  const nuevo = await (await subir(env, pc, 'nuevo', 'lote-0010-bbbb')).json();
  await purgarViejos(env, 'p:s1');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sync_lotes').get().n, 1);
  const atrasado = await (await bajar(env, cel, 0)).json(); assert.equal(atrasado.expirado, true); assert.equal(atrasado.purgadoHasta, viejo.seq);
  const alDia = await (await bajar(env, cel, viejo.seq)).json(); assert.equal(alDia.expirado, false); assert.equal(dec(alDia.lotes[0].datos), 'nuevo'); assert.equal(alDia.hasta, nuevo.seq);
});
await t('retención: un local chico no purga nunca, por viejo que sea el lote (un celular nuevo baja todo)', async () => {
  const { env, pc, cel } = await cuenta();
  const viejo = await (await subir(env, pc, 'viejo', 'lote-0013-aaaa')).json();
  env.DB.raw.prepare('UPDATE sync_lotes SET created_at = ?').run(nowS() - (RETENCION_DIAS + 100) * 86400);
  await purgarViejos(env, 'p:s1');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sync_lotes').get().n, 1);
  const nuevo = await (await bajar(env, cel, 0)).json(); assert.equal(nuevo.expirado, false); assert.equal(dec(nuevo.lotes[0].datos), 'viejo'); assert.equal(nuevo.hasta, viejo.seq);
});
await t('la purga corre sola cada PURGA_CADA lotes, no en cada subida', async () => {
  const { env, pc } = await cuenta();
  await subir(env, pc, 'viejo', 'lote-0012-0000');
  env.SYNC_TOPE_BYTES = 0; env.DB.raw.prepare('UPDATE sync_lotes SET created_at = ?').run(nowS() - (RETENCION_DIAS + 1) * 86400);
  for (let i = 1; i < PURGA_CADA - 1; i++) await subir(env, pc, `n${i}`, `lote-0012-${String(i).padStart(4, '0')}x`);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sync_lotes WHERE created_at < ?").get(nowS() - 86400).n, 1, 'todavía no se purgó');
  await subir(env, pc, 'el que dispara', 'lote-0012-final');
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sync_lotes WHERE created_at < ?").get(nowS() - 86400).n, 0, 'ya se purgó');
});
await t('un lote alterado en la base no se entrega (GCM no descifra) pero no traba al resto', async () => {
  const { env, pc, cel } = await cuenta();
  const a = await (await subir(env, pc, 'sano-1', 'lote-0011-aaaa')).json();
  await subir(env, pc, 'sano-2', 'lote-0011-bbbb');
  env.DB.raw.prepare('UPDATE sync_lotes SET datos = ? WHERE seq = ?').run(Buffer.alloc(40, 1).toString('base64'), a.seq);
  const b = await (await bajar(env, cel)).json(); assert.deepEqual(b.lotes.map((l) => dec(l.datos)), ['sano-2']);
});

// --- aviso en vivo (Durable Object) y costo por pedido
function hubFalso() {
  const avisos = []; let n = 0;
  return { avisos, idFromName: (x) => x, get: (id) => ({ fetch: async (url, init) => { avisos.push({ id, url, cuerpo: init && init.body && JSON.parse(init.body) }); return new Response(null, { status: 204 }); } }) };
}
const contarConsultas = (env) => { const db = env.DB; const q = []; const orig = db.prepare.bind(db); db.prepare = (sql) => { q.push(sql.replace(/\s+/g, ' ').slice(0, 40)); return orig(sql); }; return q; };

await t('subir avisa al hub de la cuenta con el seq y quién subió; un reintento no avisa de nuevo', async () => {
  const { env, pc } = await cuenta(); env.SYNC_HUB = hubFalso();
  const a = await (await subir(env, pc, 'x', 'lote-0020-aaaa')).json();
  assert.equal(env.SYNC_HUB.avisos.length, 1);
  assert.equal(env.SYNC_HUB.avisos[0].cuerpo.seq, a.seq); assert.match(env.SYNC_HUB.avisos[0].cuerpo.de, /^pc-/);
  assert.match(env.SYNC_HUB.avisos[0].id, /^cuenta:[0-9a-f]{32}$/); assert.ok(!env.SYNC_HUB.avisos[0].id.includes('s1'), 'el sub no va en claro');
  await subir(env, pc, 'x', 'lote-0020-aaaa');
  assert.equal(env.SYNC_HUB.avisos.length, 1);
});
await t('si el aviso falla, subir igual anda (el otro se entera en su próxima consulta)', async () => {
  const { env, pc, cel } = await cuenta();
  env.SYNC_HUB = { idFromName: (x) => x, get: () => ({ fetch: async () => { throw new Error('hub caído'); } }) };
  const r = await subir(env, pc, 'x', 'lote-0021-aaaa'); assert.equal(r.status, 200);
  assert.equal((await (await bajar(env, cel)).json()).lotes.length, 1);
});
await t('sin hub configurado subir y bajar andan igual', async () => {
  const { env, pc } = await cuenta(); assert.equal(env.SYNC_HUB, undefined);
  assert.equal((await subir(env, pc, 'x', 'lote-0022-aaaa')).status, 200);
});
await t('costo por pedido: subir hace pocas consultas a D1 y las tablas se aseguran una sola vez', async () => {
  const { env, pc } = await cuenta(); const q = contarConsultas(env);
  await subir(env, pc, 'uno', 'lote-0023-aaaa'); const primera = q.length; q.length = 0;
  await subir(env, pc, 'dos', 'lote-0023-bbbb');
  assert.ok(!q.some((s) => s.startsWith('CREATE')), 'sin DDL en los pedidos siguientes: ' + q.join(' | '));
  assert.ok(q.length <= 4, `consultas por subida: ${q.length} (${q.join(' | ')})`); assert.ok(primera > q.length);
  q.length = 0; await bajar(env, pc, 0);
  assert.ok(q.length <= 4, `consultas por bajada: ${q.length} (${q.join(' | ')})`);
});
const escuchar = (env, o = {}) => sync.onRequestEscuchar({ request: req('/api/sync/escuchar', o), env });
await t('escuchar: exige websocket, dispositivo y permiso; y manda al hub solo el id del dispositivo', async () => {
  const { env, pc } = await cuenta(); env.SYNC_HUB = hubFalso();
  assert.equal((await escuchar(env, { headers: bearer(pc) })).status, 426);
  const ws = { Upgrade: 'websocket' };
  assert.equal((await escuchar(env, { headers: ws })).status, 401);
  const r = await escuchar(env, { headers: { ...ws, ...bearer(pc) } }); assert.equal(r.status, 204); // el hub falso contesta 204
  assert.equal(env.SYNC_HUB.avisos[0].url, 'https://hub/escuchar');
  conSuscripcion('ana@x.com', 'cancelled'); mp.subs = []; mockMP();
  assert.equal((await escuchar(env, { headers: { ...ws, ...bearer(pc) } })).status, 403);
  delete env.SYNC_HUB; assert.equal((await escuchar(env, { headers: { ...ws, ...bearer(pc) } })).status, 503);
});
function estadoFalso(sockets) { return { getWebSockets: () => sockets.map((s) => s.ws), getTags: (ws) => sockets.find((s) => s.ws === ws).tags, acceptWebSocket() {} }; }
const sockFalso = (tag, falla = false) => { const enviados = []; return { ws: { send: (m) => { if (falla) throw new Error('cerrado'); enviados.push(m); } }, tags: [tag], enviados }; };
await t('el hub avisa a todos los dispositivos menos al que subió, y un socket muerto no corta a los demás', async () => {
  const a = sockFalso('pc'), b = sockFalso('cel'), c = sockFalso('tablet', true), d = sockFalso('cel2');
  const hub = new SyncHub(estadoFalso([a, b, c, d]), {});
  const r = await hub.fetch(new Request('https://hub/avisar', { method: 'POST', body: JSON.stringify({ seq: 41, de: 'pc' }) }));
  assert.equal(r.status, 204);
  assert.deepEqual(a.enviados, []); assert.deepEqual(b.enviados, ['{"seq":41}']); assert.deepEqual(d.enviados, ['{"seq":41}']);
});
await t('el hub rechaza lo que no entiende', async () => {
  const hub = new SyncHub(estadoFalso([]), {});
  assert.equal((await hub.fetch(new Request('https://hub/avisar', { method: 'POST', body: 'no es json' }))).status, 400);
  assert.equal((await hub.fetch(new Request('https://hub/otra'))).status, 404);
  assert.equal((await hub.fetch(new Request('https://hub/escuchar'))).status, 404, 'sin Upgrade no acepta');
});
console.log(`\n${pass} pruebas de sync ok`);

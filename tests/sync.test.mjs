import assert from 'node:assert/strict';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import { sha256Hex } from '../functions/_lib/backups.js';
import { RETENCION_DIAS } from '../functions/_lib/sync.js';
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
  const j = await r.json(); assert.ok(j.seq && j.ahora && j.repetido === false);
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
  env.DB.raw.prepare('UPDATE sync_lotes SET created_at = ?').run(nowS() - (RETENCION_DIAS + 1) * 86400);
  const nuevo = await (await subir(env, pc, 'nuevo', 'lote-0010-bbbb')).json();
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sync_lotes').get().n, 1);
  const atrasado = await (await bajar(env, cel, 0)).json(); assert.equal(atrasado.expirado, true); assert.equal(atrasado.purgadoHasta, viejo.seq);
  const alDia = await (await bajar(env, cel, viejo.seq)).json(); assert.equal(alDia.expirado, false); assert.equal(dec(alDia.lotes[0].datos), 'nuevo'); assert.equal(alDia.hasta, nuevo.seq);
});
await t('un lote alterado en la base no se entrega (GCM no descifra) pero no traba al resto', async () => {
  const { env, pc, cel } = await cuenta();
  const a = await (await subir(env, pc, 'sano-1', 'lote-0011-aaaa')).json();
  await subir(env, pc, 'sano-2', 'lote-0011-bbbb');
  env.DB.raw.prepare('UPDATE sync_lotes SET datos = ? WHERE seq = ?').run(Buffer.alloc(40, 1).toString('base64'), a.seq);
  const b = await (await bajar(env, cel)).json(); assert.deepEqual(b.lotes.map((l) => dec(l.datos)), ['sano-2']);
});
console.log(`\n${pass} pruebas de sync ok`);

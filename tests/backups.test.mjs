import assert from 'node:assert/strict';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import { sha256Hex, purgeBackups, MAX_COPIAS } from '../functions/_lib/backups.js';
import { listAllSubscribers } from '../functions/_lib/mp.js';
import * as backup from '../functions/api/backup.js';
import * as backups from '../functions/api/backups.js';
import { mkEnv, addUser, sess, req, web, mp, mpSub, mockMP, BACKUP_KEY, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const bearer = (tok) => ({ Authorization: `Bearer ${tok}` });
async function pc(env, email, sub, id = 'pc-' + sub + '-0123456789abcdefghij') {
  await upsertDevice(env, { id, sub, email, name: 'La PC del local' });
  return signDeviceToken(env, { sub, email, deviceId: id });
}
async function subir(env, tok, contenido, extra = {}) {
  const bytes = typeof contenido === 'string' ? enc(contenido) : contenido;
  return backup.onRequestPut({ request: req('/api/backup', { method: 'PUT', raw: bytes, headers: { ...bearer(tok), 'X-Sha256': await sha256Hex(bytes), 'X-Schema-Version': '44', 'X-App-Version': '1.0.0.2098', ...extra } }), env });
}
const bajar = (env, id, o = {}) => backup.onRequestGet({ request: req(`/api/backup?id=${id}`, o), env });
const listar = (env, o) => backups.onRequestGet({ request: req('/api/backups', o), env });
const conSuscripcion = (email, estado = 'authorized', dias = 1) => { mp.subs = [mpSub(email, estado, dias)]; mp.fail = false; mockMP(); };

await t('subir una copia: queda cifrada en el servidor y se recupera idéntica', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); conSuscripcion('ana@x.com'); const tok = await pc(env, 'ana@x.com', 's1');
  const secreto = 'SELECT * FROM ventas -- datos del comercio: $ 1.234.567';
  const r = await subir(env, tok, secreto); assert.equal(r.status, 200); const j = await r.json(); assert.ok(j.id);
  const guardados = [...env.RELEASES.files.entries()]; assert.equal(guardados.length, 1);
  const [clave, crudo] = guardados[0];
  assert.match(clave, /^cuentas\/[0-9a-f]{32}\/[0-9a-f]+-[0-9a-f]{12}\.bak$/); assert.ok(!clave.includes('s1'));
  assert.ok(!Buffer.from(crudo).includes(Buffer.from('ventas')), 'el contenido no puede estar en claro en el bucket');
  assert.equal(crudo.length, 12 + enc(secreto).length + 16); // IV + datos + etiqueta GCM
  const b = await bajar(env, j.id, { headers: bearer(tok) }); assert.equal(b.status, 200);
  assert.equal(dec(new Uint8Array(await b.arrayBuffer())), secreto);
  assert.equal(b.headers.get('X-Sha256'), await sha256Hex(enc(secreto))); assert.equal(b.headers.get('X-Schema-Version'), '44');
  assert.ok(!b.headers.get('Content-Disposition')); // para la app no hace falta nombre de archivo
});
await t('dos copias iguales no se cifran igual (cada una con su propio IV)', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); conSuscripcion('ana@x.com'); const tok = await pc(env, 'ana@x.com', 's1');
  await subir(env, tok, 'igual'); await subir(env, tok, 'igual');
  const [a, b] = [...env.RELEASES.files.values()]; assert.notDeepEqual(Buffer.from(a), Buffer.from(b));
});
await t('solo quedan las últimas 5 copias de la cuenta: la más vieja se borra del bucket y de la base', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); conSuscripcion('ana@x.com'); const tok = await pc(env, 'ana@x.com', 's1');
  const ids = [];
  for (let i = 1; i <= MAX_COPIAS + 2; i++) {
    const r = await subir(env, tok, `copia ${i}`); ids.push((await r.json()).id);
    env.DB.raw.prepare('UPDATE backups SET created_at = ? WHERE id = ?').run(nowS() - (100 - i) * 60, ids.at(-1)); // orden claro en el tiempo
  }
  const lista = await (await listar(env, { headers: bearer(tok) })).json();
  assert.equal(lista.max, MAX_COPIAS); assert.equal(lista.backups.length, MAX_COPIAS);
  assert.equal(env.RELEASES.files.size, MAX_COPIAS);
  assert.ok(lista.backups.every((b) => ids.slice(2).includes(b.id)), 'quedan las 5 más nuevas');
  assert.equal((await bajar(env, ids[0], { headers: bearer(tok) })).status, 404);
});
await t('permisos: suscripción vigente sube y restaura; administrador y eximidas siempre; ante la duda, no', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); addUser(env, 'admin@x.com', 'sa'); addUser(env, 'demo@x.com', 'sd', 1);
  const tokAna = await pc(env, 'ana@x.com', 's1'), tokAdmin = await pc(env, 'admin@x.com', 'sa'), tokDemo = await pc(env, 'demo@x.com', 'sd');
  mp.subs = []; mp.fail = false; mockMP(); // nadie paga
  assert.equal((await subir(env, tokAna, 'x')).status, 403); assert.equal((await (await subir(env, tokAna, 'x')).json()).error, 'no_upload');
  assert.equal((await subir(env, tokAdmin, 'x')).status, 200); assert.equal((await subir(env, tokDemo, 'x')).status, 200);
  conSuscripcion('ana@x.com'); assert.equal((await subir(env, tokAna, 'x')).status, 200);
  mp.fail = true; clearMp(); assert.equal((await subir(env, tokAna, 'x')).status, 503); assert.equal((await (await subir(env, tokAna, 'x')).json()).error, 'mp_error');
  assert.equal((await subir(env, tokAdmin, 'x')).status, 200); // el admin no depende de Mercado Pago
});
function clearMp() { mockMP(); } // mockMP ya lee mp.fail en cada pedido; las respuestas se vuelven a consultar sin caché de listSubscriptions
await t('quien cancela conserva 90 días para RESTAURAR pero no puede subir; pasado ese tiempo, nada', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); const tok = await pc(env, 'ana@x.com', 's1');
  conSuscripcion('ana@x.com'); const id = (await (await subir(env, tok, 'mis datos')).json()).id;
  for (const [estado, dias, sube, restaura] of [['cancelled', 30, false, true], ['cancelled', 89, false, true], ['cancelled', 91, false, false], ['paused', 10, false, true], ['authorized', 400, true, true]]) {
    conSuscripcion('ana@x.com', estado, dias);
    assert.equal((await subir(env, tok, 'nueva')).status === 200, sube, `${estado} hace ${dias} días: subir`);
    assert.equal((await bajar(env, id, { headers: bearer(tok) })).status === 200, restaura, `${estado} hace ${dias} días: restaurar`);
    const l = await (await listar(env, { headers: bearer(tok) })).json(); assert.equal(l.upload, sube); assert.equal(l.restore, restaura);
    assert.equal(l.backups.length > 0, restaura, 'sin derecho a restaurar tampoco se listan');
  }
});
await t('se descarta lo inválido: sin token, sesión web, hash que no coincide, vacío y demasiado grande', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); conSuscripcion('ana@x.com'); const tok = await pc(env, 'ana@x.com', 's1');
  const sinToken = await backup.onRequestPut({ request: req('/api/backup', { method: 'PUT', raw: enc('x'), headers: { 'X-Sha256': await sha256Hex(enc('x')) } }), env }); assert.equal(sinToken.status, 401);
  const conSesion = await backup.onRequestPut({ request: req('/api/backup', { method: 'PUT', raw: enc('x'), cookie: await sess(env, 'ana@x.com', 's1'), headers: { 'X-Sha256': await sha256Hex(enc('x')) } }), env }); assert.equal(conSesion.status, 401);
  assert.equal((await subir(env, tok, 'hola', { 'X-Sha256': 'a'.repeat(64) })).status, 422);
  assert.equal((await backup.onRequestPut({ request: req('/api/backup', { method: 'PUT', raw: new Uint8Array(0), headers: { ...bearer(tok), 'X-Sha256': await sha256Hex(new Uint8Array(0)) } }), env })).status, 400);
  assert.equal((await subir(env, tok, 'hola', { 'Content-Length': String(30 * 1024 * 1024) })).status, 413);
  assert.equal(env.RELEASES.files.size, 0);
});
await t('sin la clave de cifrado (o con una mal puesta) no se sube ni se baja nada', async () => {
  const base = mkEnv(); addUser(base, 'ana@x.com', 's1'); conSuscripcion('ana@x.com'); const tok = await pc(base, 'ana@x.com', 's1');
  for (const malo of [{ BACKUP_KEY: '' }, { BACKUP_KEY: undefined }, { BACKUP_KEY: 'no-es-base64-ni-de-32-bytes' }, { BACKUP_KEY: Buffer.alloc(16).toString('base64') }]) {
    const env = { ...base, ...malo };
    const r = await subir(env, tok, 'x'); assert.equal(r.status, 503); assert.equal((await r.json()).error, 'backups_no_configurados');
    assert.equal((await listar(env, { headers: bearer(tok) })).status, 503);
  }
  assert.equal((await subir({ ...base, RELEASES: undefined, BACKUPS: undefined }, tok, 'x')).status, 503);
});
await t('integridad: una copia alterada en el bucket no se entrega como buena', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); conSuscripcion('ana@x.com'); const tok = await pc(env, 'ana@x.com', 's1');
  const id = (await (await subir(env, tok, 'datos importantes')).json()).id;
  const [clave, crudo] = [...env.RELEASES.files.entries()][0]; const roto = Buffer.from(crudo); roto[roto.length - 1] ^= 1; env.RELEASES.files.set(clave, roto);
  assert.equal((await bajar(env, id, { headers: bearer(tok) })).status, 500);
  env.RELEASES.files.delete(clave); assert.equal((await bajar(env, id, { headers: bearer(tok) })).status, 500); // falta el archivo
});
await t('cada cuenta ve y toca solo lo suyo', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); addUser(env, 'luis@x.com', 's2');
  mp.subs = [mpSub('ana@x.com', 'authorized'), mpSub('luis@x.com', 'authorized')]; mockMP();
  const tokAna = await pc(env, 'ana@x.com', 's1'), tokLuis = await pc(env, 'luis@x.com', 's2');
  const idAna = (await (await subir(env, tokAna, 'de ana')).json()).id; const idLuis = (await (await subir(env, tokLuis, 'de luis')).json()).id;
  assert.equal((await bajar(env, idAna, { headers: bearer(tokLuis) })).status, 404);
  assert.equal((await listar(env, { headers: bearer(tokLuis) }).then((r) => r.json())).backups.map((b) => b.id).join(), String(idLuis));
  const borrar = (tok, id, headers) => backup.onRequestDelete({ request: req('/api/backup', { method: 'DELETE', headers: { ...bearer(tok), ...headers }, body: { id } }), env });
  assert.equal((await borrar(tokLuis, idAna)).status, 404); assert.equal(env.RELEASES.files.size, 2);
  assert.equal((await borrar(tokAna, idAna)).status, 200); assert.equal(env.RELEASES.files.size, 1); assert.equal((await bajar(env, idAna, { headers: bearer(tokAna) })).status, 404);
});
await t('desde la web (Mi cuenta): bajar con nombre de archivo y borrar exigen mismo origen; la lista no muestra claves internas', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); conSuscripcion('ana@x.com'); const tok = await pc(env, 'ana@x.com', 's1');
  const id = (await (await subir(env, tok, 'contenido')).json()).id; const cookie = await sess(env, 'ana@x.com', 's1');
  const b = await bajar(env, id, { cookie }); assert.equal(b.status, 200); assert.match(b.headers.get('Content-Disposition'), /attachment; filename="nodosur-copia-\d{4}-\d{2}-\d{2}\.sqlite\.gz"/);
  const del = (headers) => backup.onRequestDelete({ request: req('/api/backup', { method: 'DELETE', cookie, headers, body: { id } }), env });
  assert.equal((await del({ Origin: 'https://evil.com', 'X-Requested-With': 'fetch' })).status, 403); assert.equal((await del({})).status, 403);
  const l = await (await listar(env, { cookie })).json(); assert.deepEqual(Object.keys(l.backups[0]).sort(), ['appVersion', 'createdAt', 'deviceName', 'id', 'schemaVersion', 'sha256', 'size']);
  assert.equal(l.backups[0].deviceName, 'La PC del local');
  assert.equal((await del(web)).status, 200);
  assert.equal((await bajar(env, id)).status, 401); assert.equal((await listar(env)).status, 401);
});
await t('las copias sobreviven si se borra y recrea la fila de la cuenta (van atadas al sub de Google)', async () => {
  const env = mkEnv(); addUser(env, 'ana@x.com', 's1'); conSuscripcion('ana@x.com'); const tok = await pc(env, 'ana@x.com', 's1');
  const id = (await (await subir(env, tok, 'no se pierde')).json()).id;
  env.DB.raw.prepare('DELETE FROM users WHERE sub=?').run('s1'); addUser(env, 'ana@x.com', 's1');
  assert.equal(dec(new Uint8Array(await (await bajar(env, id, { headers: bearer(tok) })).arrayBuffer())), 'no se pierde');
});
await t('limpieza: se borran las copias de quien dejó de pagar hace más de 90 días; se conservan las demás', async () => {
  const env = mkEnv(); const cuentas = { activa: ['activa@x.com', 's1'], reciente: ['reciente@x.com', 's2'], vieja: ['vieja@x.com', 's3'], nunca: ['nunca@x.com', 's4'], admin: ['admin@x.com', 'sa'] };
  for (const [e, s] of Object.values(cuentas)) addUser(env, e, s);
  mp.subs = [mpSub('activa@x.com', 'authorized'), mpSub('reciente@x.com', 'cancelled', 30), mpSub('vieja@x.com', 'cancelled', 200)]; mockMP();
  const ids = {};
  for (const [k, [e, s]] of Object.entries(cuentas)) {
    const tok = await pc(env, e, s); mp.subs.push(mpSub(e, 'authorized')); mockMP(); ids[k] = (await (await subir(env, tok, 'copia ' + k)).json()).id; mp.subs.pop();
  }
  // ahora cada cuenta tiene su estado real
  mp.subs = [mpSub('activa@x.com', 'authorized'), mpSub('reciente@x.com', 'cancelled', 30), mpSub('vieja@x.com', 'cancelled', 200)]; mockMP();
  const todas = await listAllSubscribers(env, { fresh: true });
  const borradas = await purgeBackups(env, todas);
  assert.deepEqual(borradas.sort(), [ids.vieja, ids.nunca].sort());
  assert.equal(env.RELEASES.files.size, 3);
  const quedan = env.DB.raw.prepare('SELECT owner_sub FROM backups ORDER BY owner_sub').all().map((r) => r.owner_sub); assert.deepEqual(quedan, ['s1', 's2', 'sa']);
});

console.log(`\n${pass} pruebas OK (copias de seguridad)`);

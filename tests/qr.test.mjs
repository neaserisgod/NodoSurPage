import assert from 'node:assert/strict';
import { ensureOrgTables, createOrg } from '../functions/_lib/orgs.js';
import { getDevice } from '../functions/_lib/devices.js';
import { emitirTokenDeDispositivo } from '../functions/_lib/vincular.js';
import { sha256b64u } from '../functions/_lib/util.js';
import * as qr from '../functions/api/device/qr.js';
import * as token from '../functions/api/device/token.js';
import { mkEnv, req, sess, addUser } from './helpers-nube.mjs';

// Vincular la compu con un QR desde el celular (Nodo Sur Servicios de Windows, 2026-10-15).
let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const PC = 'windows-compu-0123456789abcdef';
const VERIF = 'v'.repeat(43);
const llamar = async (fn, path, body, headers = {}, cookie) => fn({ request: req(path, { method: 'POST', body, headers, cookie }), env: llamar.env });

async function preparar() {
  const env = mkEnv(); llamar.env = env; await ensureOrgTables(env);
  const { org, branch } = await createOrg(env, { sub: 'duenia', email: 'd@x.com', name: 'Dueña', orgName: 'Estudio Lú' });
  // El celular de la dueña, ya vinculado (token de dispositivo).
  const cel = await emitirTokenDeDispositivo(env, { sub: 'duenia', email: 'd@x.com', deviceId: 'android-celular-0123456789abcdef', name: 'Celular', orgId: org.id, branchId: branch.id, personName: 'Dueña', kind: 'celular' });
  return { env, org, branch, bearer: { Authorization: `Bearer ${cel.token}` } };
}
const pedir = async () => (await llamar(qr.onRequestPost, '/api/device/qr', { deviceId: PC, name: 'Compu (windows)', challenge: await sha256b64u(VERIF) })).json();

await t('de punta a punta: la compu pide, el celular ve y aprueba, la compu recibe el código y lo canjea con su verificador', async () => {
  const { org, branch, bearer } = await preparar();
  const p = await pedir();
  assert.match(p.id, /^[0-9a-f]{32}$/); assert.equal(p.url, `https://horsepos.com/vincular/qr/?p=${p.id}`);
  assert.equal((await (await llamar(qr.onEstado, '/api/device/qr/estado', { id: p.id })).json()).estado, 'esperando');

  const ver = await (await llamar(qr.onVer, '/api/device/qr/ver', { id: p.id }, bearer)).json();
  assert.equal(ver.nombre, 'Compu (windows)'); assert.ok(ver.venceEn > 200);
  const ok = await llamar(qr.onAprobar, '/api/device/qr/aprobar', { id: p.id }, bearer);
  assert.equal(ok.status, 200);

  const e = await (await llamar(qr.onEstado, '/api/device/qr/estado', { id: p.id })).json();
  assert.equal(e.estado, 'listo'); assert.ok(e.code);
  // Se entrega una sola vez.
  assert.equal((await (await llamar(qr.onEstado, '/api/device/qr/estado', { id: p.id })).json()).estado, 'vencido');

  const r = await llamar(token.onRequestPost, '/api/device/token', { code: e.code, verifier: VERIF });
  assert.equal(r.status, 200);
  const d = await getDevice(llamar.env, PC);
  assert.equal(d.owner_sub, 'duenia'); assert.equal(d.owner_org, org.id); assert.equal(d.branch_id, branch.id); assert.equal(d.kind, 'celular');
});

await t('el código sin el verificador de la compu no sirve: quien vea el QR no se queda con el equipo', async () => {
  const { bearer } = await preparar();
  const p = await pedir();
  await llamar(qr.onAprobar, '/api/device/qr/aprobar', { id: p.id }, bearer);
  const e = await (await llamar(qr.onEstado, '/api/device/qr/estado', { id: p.id })).json();
  assert.equal((await llamar(token.onRequestPost, '/api/device/token', { code: e.code, verifier: 'x'.repeat(43) })).status, 400);
});

await t('sin token ni sesión no se ve ni se aprueba; un pedido inventado o vencido, 410', async () => {
  const { env, bearer } = await preparar();
  const p = await pedir();
  assert.equal((await llamar(qr.onVer, '/api/device/qr/ver', { id: p.id })).status, 401);
  assert.equal((await llamar(qr.onAprobar, '/api/device/qr/aprobar', { id: p.id })).status, 401);
  assert.equal((await llamar(qr.onAprobar, '/api/device/qr/aprobar', { id: '0'.repeat(32) }, bearer)).status, 410);
  env.DB.raw.prepare('UPDATE device_qr SET exp = 1 WHERE id = ?').run(p.id);
  assert.equal((await llamar(qr.onAprobar, '/api/device/qr/aprobar', { id: p.id }, bearer)).status, 410);
  assert.equal((await (await llamar(qr.onEstado, '/api/device/qr/estado', { id: p.id })).json()).estado, 'vencido');
});

await t('aprueba uno solo: el segundo que escanea el mismo QR recibe 410', async () => {
  const { bearer } = await preparar();
  const p = await pedir();
  assert.equal((await llamar(qr.onAprobar, '/api/device/qr/aprobar', { id: p.id }, bearer)).status, 200);
  assert.equal((await llamar(qr.onAprobar, '/api/device/qr/aprobar', { id: p.id }, bearer)).status, 410);
});

await t('con la sesión del sitio (escaneado con la cámara del celular): aprueba con el mismo control de origen que el resto', async () => {
  const { env } = await preparar();
  addUser(env, 'd@x.com', 'duenia');
  const cookie = await sess(env, 'd@x.com', 'duenia', 'Dueña');
  const p = await pedir();
  // Sin los encabezados de mismo origen (CSRF): no.
  assert.equal((await llamar(qr.onAprobar, '/api/device/qr/aprobar', { id: p.id }, {}, cookie)).status, 403);
  const r = await llamar(qr.onAprobar, '/api/device/qr/aprobar', { id: p.id }, { Origin: 'https://horsepos.com', 'X-Requested-With': 'fetch' }, cookie);
  assert.equal(r.status, 200);
});

await t('datos inválidos al pedir: 400', async () => {
  await preparar();
  assert.equal((await llamar(qr.onRequestPost, '/api/device/qr', { deviceId: 'corto', challenge: 'x' })).status, 400);
  assert.equal((await llamar(qr.onEstado, '/api/device/qr/estado', { id: 'nada' })).status, 400);
});

await t('después de entrar con Google se vuelve a la página del QR (y a nada parecido que no lo sea)', async () => {
  const { safeNext } = await import('../functions/_lib/util.js');
  assert.equal(safeNext('/vincular/qr/?p=' + 'a'.repeat(32)), '/vincular/qr/?p=' + 'a'.repeat(32));
  for (const malo of ['/vincular/qr/?p=xyz', '/vincular/qr/?p=' + 'a'.repeat(32) + '&x=1', '//evil.com/vincular/qr/?p=' + 'a'.repeat(32)]) assert.equal(safeNext(malo), null, malo);
});

console.log(`\n${pass} pruebas OK (vincular con QR)`);

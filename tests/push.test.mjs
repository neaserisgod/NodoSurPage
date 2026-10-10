// Notificaciones con la app cerrada (`functions/_lib/push.js`). Google está simulado: lo que se prueba es que el celular registre su
// token, que un turno o pedido nuevo del bot le llegue a los celulares de esa sucursal (no a los bots ni a otras sucursales), que el
// JWT esté bien firmado, que el token de acceso se reuse y que un token que FCM ya no reconoce se borre. Sin el secreto, nada.
import assert from 'node:assert/strict';
import { createOrg, ensureOrgTables } from '../functions/_lib/orgs.js';
import { upsertDevice, signDeviceToken } from '../functions/_lib/devices.js';
import * as push from '../functions/api/device/push.js';
import * as bot from '../functions/api/bot.js';
import { _olvidarAcceso, cuandoTexto, reintentarAvisos, esperaReintento } from '../functions/_lib/push.js';
import worker from '../worker.js';
import { mkEnv, addUser, req, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };

// Una cuenta de servicio de mentira, con una clave RSA de verdad para poder verificar la firma.
const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', par.privateKey)).toString('base64');
const CUENTA = { project_id: 'nodo-sur', client_email: 'fcm@nodo-sur.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n` };

const PLAN_SOLO_BOT = 'e37aac4650334685873aa8e3920de4c0';
let google;
function simularGoogle() {
  google = { tokens: 0, enviados: [], jwt: null, noRegistrados: new Set() };
  mp.subs = [{ ...mpSub('duena@x.com', 'authorized'), preapproval_plan_id: PLAN_SOLO_BOT }]; mp.fail = false; mockMP();
  const deMp = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.host === 'oauth2.googleapis.com') {
      google.tokens++; google.jwt = new URLSearchParams(init.body).get('assertion');
      return new Response(JSON.stringify({ access_token: 'ya29.acceso', expires_in: 3600 }), { status: 200 });
    }
    if (u.host === 'fcm.googleapis.com') {
      const m = JSON.parse(init.body).message;
      if (google.noRegistrados.has(m.token)) return new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 });
      google.enviados.push({ ruta: u.pathname, auth: init.headers.Authorization, ...m });
      return new Response('{}', { status: 200 });
    }
    return deMp(url, init);
  };
}

async function armar({ conSecreto = true } = {}) {
  _olvidarAcceso(); simularGoogle();
  const env = mkEnv(); env.SYNC_HUB = { idFromName: (x) => x, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) };
  if (conSecreto) env.FCM_SERVICE_ACCOUNT = JSON.stringify(CUENTA);
  await ensureOrgTables(env); addUser(env, 'duena@x.com', 'sd');
  const r = await createOrg(env, { sub: 'sd', email: 'duena@x.com', name: 'Caro', orgName: 'Caro Uñas' });
  const otra = Number(env.DB.raw.prepare('INSERT INTO branches (org_id, name, active, created_at) VALUES (?,?,1,?)').run(r.org.id, 'Centro', nowS()).lastInsertRowid);
  const equipo = async (id, kind, branchId = r.branch.id) => {
    await upsertDevice(env, { id, sub: 'sd', email: 'duena@x.com', name: kind, orgId: r.org.id, branchId, kind });
    return { Authorization: `Bearer ${await signDeviceToken(env, { sub: 'sd', email: 'duena@x.com', deviceId: id })}` };
  };
  return { env, cel: await equipo('cel-caro-0123456789abcdefgh', 'celular'), cel2: await equipo('cel-centro-0123456789abcdef', 'celular', otra), robot: await equipo('bot-caro-0123456789abcdefgh', 'bot') };
}
const post = (fn, env, path, body, headers) => fn({ request: req(path, { method: 'POST', headers, body }), env });
// Tokens de mentira armados acá (no son secretos): `celular-aaaa…`.
const falso = (quien) => `${quien}-${'a'.repeat(24)}`;
const TOKEN_FCM = falso('celular');
const H = 3600 * 1000;
const turno = (id) => {
  const d = new Date(Date.now() + 48 * H); d.setUTCHours(13, 0, 0, 0); // 10:00 en Argentina
  return { id, inicio: d.getTime(), fin: d.getTime() + H, estado: 'esperando_sena', cliente: { nombre: 'Ana', telefono: '5492944111111' }, servicio: { nombre: 'Semipermanente' } };
};

await t('el celular registra su token; uno raro, sin equipo o sin negocio, no', async () => {
  const { env, cel } = await armar();
  assert.equal((await post(push.onRequestPost, env, '/api/device/push', { token: TOKEN_FCM }, cel)).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT token FROM push_tokens').get().token, TOKEN_FCM);
  assert.equal((await post(push.onRequestPost, env, '/api/device/push', { token: 'corto' }, cel)).status, 400);
  assert.equal((await post(push.onRequestPost, env, '/api/device/push', { token: 'x y z'.repeat(10) }, cel)).status, 400);
  assert.equal((await post(push.onRequestPost, env, '/api/device/push', { token: TOKEN_FCM }, {})).status, 401);
});

await t('un turno nuevo del bot le llega al celular de la sucursal, firmado con la cuenta de servicio', async () => {
  const { env, cel, cel2, robot } = await armar();
  await post(push.onRequestPost, env, '/api/device/push', { token: TOKEN_FCM }, cel);
  await post(push.onRequestPost, env, '/api/device/push', { token: falso('otra-sucursal') }, cel2);
  await post(push.onRequestPost, env, '/api/device/push', { token: falso('bot') }, robot);
  assert.equal((await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0001-aaaa'), robot)).status, 201);
  assert.equal(google.enviados.length, 1, 'solo el celular de esa sucursal, no el bot ni la otra sucursal');
  const m = google.enviados[0];
  assert.equal(m.ruta, '/v1/projects/nodo-sur/messages:send');
  assert.equal(m.auth, 'Bearer ya29.acceso');
  assert.equal(m.token, TOKEN_FCM);
  assert.equal(m.notification.title, '📅 Turno por WhatsApp (espera la seña)');
  assert.match(m.notification.body, /^Ana · Semipermanente · \S+ \d+ a las 10:00$/);
  assert.deepEqual(m.data, { tipo: 'turno', id: 'turno-0001-aaaa' });
  assert.equal(m.android.notification.channel_id, 'pedidos_turnos', 'el canal que salta en pantalla');
  assert.equal(m.android.priority, 'high');
  // El JWT: firmado con la clave de la cuenta, para el alcance de FCM.
  const [enc, cuerpo, firma] = google.jwt.split('.');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', par.publicKey, Buffer.from(firma, 'base64url'), new TextEncoder().encode(`${enc}.${cuerpo}`));
  assert.ok(ok, 'la firma verifica');
  const claims = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
  assert.equal(claims.iss, CUENTA.client_email); assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');

  // Un pedido (comercio) también, y el token de acceso se reusa.
  await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', { id: 'pedido-0001-abcd', cliente: { nombre: 'Sofi', telefono: '5492944555555' }, items: [{ nombre: 'Coca', cantidad: 2 }] }, robot);
  assert.equal(google.enviados.at(-1).notification.body, 'Sofi: 2 × Coca');
  assert.equal(google.tokens, 1, 'un solo token de acceso para los dos');
});

await t('un celular vinculado antes de que los equipos tuvieran tipo (kind NULL) también recibe', async () => {
  const { env, cel, robot } = await armar();
  await post(push.onRequestPost, env, '/api/device/push', { token: TOKEN_FCM }, cel);
  env.DB.raw.prepare("UPDATE devices SET kind = NULL WHERE id = 'cel-caro-0123456789abcdefgh'").run();
  await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', { id: 'pedido-0002-abcd', cliente: { nombre: 'Sofi', telefono: '5492944555555' }, items: [{ nombre: 'Coca', cantidad: 1 }] }, robot);
  assert.equal(google.enviados.length, 1);
  assert.equal(google.enviados[0].token, TOKEN_FCM);
});

await t('un token que FCM ya no reconoce se borra; sin el secreto no se manda nada', async () => {
  const { env, cel, robot } = await armar();
  await post(push.onRequestPost, env, '/api/device/push', { token: TOKEN_FCM }, cel);
  google.noRegistrados.add(TOKEN_FCM);
  await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0001-aaaa'), robot);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_tokens').get().n, 0);

  const x = await armar({ conSecreto: false });
  await post(push.onRequestPost, x.env, '/api/device/push', { token: TOKEN_FCM }, x.cel);
  assert.equal((await post(bot.onRequestTurnoPost, x.env, '/api/bot/turno', turno('turno-0002-bbbb'), x.robot)).status, 201, 'el turno entra igual');
  assert.equal(google.enviados.length + google.tokens, 0);
});

await t('si no le llega a nadie, se reintenta cada vez más espaciado mientras siga sin resolver', async () => {
  const { env, cel, robot } = await armar();
  // Ningún celular registrado todavía: no sale, queda pendiente.
  await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0001-aaaa'), robot);
  assert.equal(google.enviados.length, 0);
  const pendiente = env.DB.raw.prepare('SELECT * FROM push_pendientes').get();
  assert.equal(pendiente.clave, 'turno:turno-0001-aaaa');
  const ahora = Math.floor(Date.now() / 1000);
  assert.equal(await reintentarAvisos(env, ahora), 0, 'todavía no es hora');
  assert.equal(await reintentarAvisos(env, ahora + esperaReintento(1)), 0, 'es hora, pero sigue sin celular');
  assert.equal(env.DB.raw.prepare('SELECT intentos FROM push_pendientes').get().intentos, 2);
  // Se registra el celular: el próximo reintento sale y deja de estar pendiente.
  await post(push.onRequestPost, env, '/api/device/push', { token: TOKEN_FCM }, cel);
  assert.equal(await reintentarAvisos(env, ahora + 3 * 3600), 1);
  assert.equal(google.enviados.at(-1).data.id, 'turno-0001-aaaa');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_pendientes').get().n, 0);
});

await t('lo que ya se resolvió no se reintenta; lo de más de un día se descarta', async () => {
  const { env, robot } = await armar();
  await post(bot.onRequestPedidoPost, env, '/api/bot/pedido', { id: 'pedido-0009-abcd', cliente: { nombre: 'Sofi', telefono: '5492944555555' }, items: [{ nombre: 'Coca', cantidad: 1 }] }, robot);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_pendientes').get().n, 1);
  env.DB.raw.prepare("UPDATE bot_pedidos SET estado = 'aceptado'").run();
  const ahora = Math.floor(Date.now() / 1000);
  assert.equal(await reintentarAvisos(env, ahora + 3600), 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_pendientes').get().n, 0, 'resuelto: se borra');
  await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0002-bbbb'), robot);
  await reintentarAvisos(env, ahora + 25 * 3600);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_pendientes').get().n, 0, 'más de un día: se descarta');
});

await t('el cron de cada 5 minutos reintenta; el diario no', async () => {
  const { env, robot } = await armar();
  await post(bot.onRequestTurnoPost, env, '/api/bot/turno', turno('turno-0003-cccc'), robot);
  env.DB.raw.prepare('UPDATE push_pendientes SET proximo = 0').run();
  const tareas = [];
  await worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil: (p) => tareas.push(p) });
  await Promise.all(tareas);
  assert.equal(tareas.length, 1, 'solo el reintento');
  assert.equal(env.DB.raw.prepare('SELECT intentos FROM push_pendientes').get().intentos, 2);
});

await t('la hora va en la de Argentina aunque el servidor esté en UTC', async () => {
  assert.match(cuandoTexto(Date.UTC(2026, 9, 15, 13, 30)), /^jueves 15 a las 10:30$/);
});

console.log(`\n${pass} pruebas de notificaciones OK`);

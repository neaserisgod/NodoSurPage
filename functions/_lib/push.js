// Notificaciones con la app cerrada (Firebase Cloud Messaging, API HTTP v1; `Nodo-Sur-Pos/docs/PLAN-BOT.md`, etapa 5). Hoy: un
// pedido o un turno nuevo del bot de WhatsApp le llega al celular del local aunque la app no esté abierta.
//
//  * Cada celular registra su token de FCM (`POST /api/device/push`): queda atado al equipo vinculado (negocio y sucursal).
//  * Para mandar, el Worker firma un JWT con la cuenta de servicio del proyecto de Firebase (secreto `FCM_SERVICE_ACCOUNT`, el JSON
//    entero) y lo cambia por un token de acceso de Google, que dura una hora y se reusa.
//  * Sin el secreto no hace nada: el resto anda igual (la app ve los pedidos al abrirse).
//  * Si un aviso no le llega a ningún celular (Google caído, ningún token, un error nuestro), queda en `push_pendientes` y el cron
//    de cada 5 minutos lo reintenta mientras el pedido o el turno sigan sin resolver, cada vez más espaciado y hasta 24 horas
//    (`avisarConReintento`, `reintentarAvisos`). El pedido o el turno en sí nunca se pierden: la app los ve al abrirse.
//
// Nunca tira: una notificación que no sale no puede frenar un pedido ni un turno.
import { now, once } from './util.js';

const DDL = [
  `CREATE TABLE IF NOT EXISTS push_tokens (device_id TEXT PRIMARY KEY, org_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
     token TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_push_tokens_sucursal ON push_tokens(org_id, branch_id)`,
  // `clave`: 'pedido:<id>' o 'turno:<turno_id>' (de qué es el aviso, para saber si sigue sin resolver). Tiempos en segundos.
  `CREATE TABLE IF NOT EXISTS push_pendientes (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
     clave TEXT NOT NULL, aviso TEXT NOT NULL, intentos INTEGER NOT NULL, creado INTEGER NOT NULL, proximo INTEGER NOT NULL,
     UNIQUE (org_id, branch_id, clave))`,
  `CREATE INDEX IF NOT EXISTS idx_push_pendientes_proximo ON push_pendientes(proximo)`,
];
export const ensurePushTables = (env) => once(env, 'push', async () => { for (const sql of DDL) await env.DB.prepare(sql).run(); });

export const tokenPushValido = (t) => typeof t === 'string' && t.length >= 20 && t.length <= 4096 && /^[\w:.-]+$/.test(t);

export async function guardarTokenPush(env, { deviceId, orgId, branchId, token }, t = now()) {
  await ensurePushTables(env);
  await env.DB.prepare(
    `INSERT INTO push_tokens (device_id, org_id, branch_id, token, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(device_id) DO UPDATE SET org_id = ?2, branch_id = ?3, token = ?4, updated_at = ?5`
  ).bind(deviceId, orgId, branchId, token, t).run();
}

export function cuentaDeServicio(env) {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  try {
    const c = JSON.parse(env.FCM_SERVICE_ACCOUNT);
    return c && c.client_email && c.private_key && c.project_id ? c : null;
  } catch { return null; }
}

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uTexto = (s) => b64u(new TextEncoder().encode(s));

async function claveFirma(pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

let acceso = null; // { token, vence, cuenta } — uno por instancia del Worker

async function tokenDeAcceso(cuenta, t = now()) {
  if (acceso && acceso.cuenta === cuenta.client_email && acceso.vence - 60 > t) return acceso.token;
  const encabezado = b64uTexto(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = b64uTexto(JSON.stringify({
    iss: cuenta.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: t, exp: t + 3600,
  }));
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await claveFirma(cuenta.private_key), new TextEncoder().encode(`${encabezado}.${cuerpo}`));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${encabezado}.${cuerpo}.${b64u(firma)}` }),
  });
  if (!r.ok) throw new Error(`google_token_${r.status}`);
  const j = await r.json();
  acceso = { token: j.access_token, vence: t + (j.expires_in || 3600), cuenta: cuenta.client_email };
  return acceso.token;
}

export const _olvidarAcceso = () => { acceso = null; }; // para las pruebas

// Manda la notificación a los celulares de la sucursal (no a los bots ni a equipos desvinculados). Un token que FCM ya no reconoce
// (desinstalaron la app) se borra. Devuelve a cuántos salió.
export async function avisarSucursal(env, orgId, branchId, { titulo, cuerpo, datos = {} }) {
  try {
    const cuenta = cuentaDeServicio(env);
    if (!cuenta) return 0;
    await ensurePushTables(env);
    const destinos = (await env.DB.prepare(
      `SELECT p.device_id, p.token FROM push_tokens p JOIN devices d ON d.id = p.device_id
       WHERE p.org_id = ?1 AND p.branch_id = ?2 AND d.revoked = 0 AND COALESCE(d.kind, '') != 'bot'`
    ).bind(orgId, branchId).all()).results;
    if (!destinos.length) return 0;
    const bearer = await tokenDeAcceso(cuenta);
    let enviados = 0;
    for (const d of destinos) {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {
          token: d.token,
          notification: { title: titulo.slice(0, 100), body: cuerpo.slice(0, 300) },
          data: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, String(v)])),
          // El canal de importancia alta que crea la app (`MainActivity.kt`): salta en pantalla con sonido, como WhatsApp. Una app
          // anterior que no lo tiene usa el canal genérico de Firebase (solo en la barra).
          android: { priority: 'high', notification: { channel_id: 'pedidos_turnos', notification_priority: 'PRIORITY_HIGH', default_sound: true, default_vibrate_timings: true } },
        } }),
      });
      if (r.ok) enviados++;
      else if (r.status === 404) { // UNREGISTERED: desinstalaron la app o el token venció
        await env.DB.prepare('DELETE FROM push_tokens WHERE device_id = ?1 AND token = ?2').bind(d.device_id, d.token).run();
      }
    }
    return enviados;
  } catch (e) {
    console.error('push', e && e.message);
    return 0;
  }
}

// "jueves 15 a las 10:30", en la hora de Argentina (el Worker corre en UTC).
export function cuandoTexto(ms) {
  const f = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} a las ${p.hour}:${p.minute}`;
}

// --- Reintentos -----------------------------------------------------------------------------------------------------------
export const VIDA_PENDIENTE = 24 * 3600;
export const MAX_INTENTOS = 30;
// Espera antes del intento n (1 = el primero que reintenta el cron): 5, 10, 15… minutos, y nunca más de una hora.
export const esperaReintento = (intentos) => Math.min(intentos * 5, 60) * 60;

// Manda el aviso y, si no le llegó a ningún celular, lo deja para reintentar. Sin el secreto no hace nada (no hay a quién reintentar).
export async function avisarConReintento(env, orgId, branchId, clave, aviso, t = now()) {
  if (!cuentaDeServicio(env)) return 0;
  const enviados = await avisarSucursal(env, orgId, branchId, aviso);
  if (enviados > 0) return enviados;
  try {
    await ensurePushTables(env);
    await env.DB.prepare(
      `INSERT INTO push_pendientes (org_id, branch_id, clave, aviso, intentos, creado, proximo) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)
       ON CONFLICT(org_id, branch_id, clave) DO NOTHING`
    ).bind(orgId, branchId, clave, JSON.stringify(aviso), t, t + esperaReintento(1)).run();
  } catch (e) { console.error('push_pendiente', e && e.message); }
  return 0;
}

// Si lo que avisa sigue sin resolver: un pedido por confirmar, o un turno que todavía ocupa su horario y no empezó.
async function sigueSinResolver(env, f, tMs) {
  const [tipo, id] = [f.clave.slice(0, f.clave.indexOf(':')), f.clave.slice(f.clave.indexOf(':') + 1)];
  if (tipo === 'pedido') {
    const p = await env.DB.prepare('SELECT estado FROM bot_pedidos WHERE id = ?1 AND org_id = ?2 AND branch_id = ?3').bind(Number(id), f.org_id, f.branch_id).first();
    return Boolean(p && p.estado === 'por_confirmar');
  }
  if (tipo === 'turno') {
    const x = await env.DB.prepare('SELECT estado, inicio FROM bot_turnos WHERE turno_id = ?1 AND org_id = ?2 AND branch_id = ?3').bind(id, f.org_id, f.branch_id).first();
    return Boolean(x && ['esperando_sena', 'confirmado'].includes(x.estado) && x.inicio > tMs);
  }
  return false;
}

// Lo corre el cron cada 5 minutos. Devuelve cuántos avisos salieron ahora.
export async function reintentarAvisos(env, t = now()) {
  if (!cuentaDeServicio(env)) return 0;
  await ensurePushTables(env);
  await env.DB.prepare('DELETE FROM push_pendientes WHERE creado < ?1 OR intentos > ?2').bind(t - VIDA_PENDIENTE, MAX_INTENTOS).run();
  const filas = (await env.DB.prepare('SELECT * FROM push_pendientes WHERE proximo <= ?1 ORDER BY proximo LIMIT 50').bind(t).all()).results;
  let enviados = 0;
  for (const f of filas) {
    if (!(await sigueSinResolver(env, f, t * 1000))) {
      await env.DB.prepare('DELETE FROM push_pendientes WHERE id = ?1').bind(f.id).run();
      continue;
    }
    const n = await avisarSucursal(env, f.org_id, f.branch_id, JSON.parse(f.aviso));
    if (n > 0) {
      enviados += n;
      await env.DB.prepare('DELETE FROM push_pendientes WHERE id = ?1').bind(f.id).run();
    } else {
      await env.DB.prepare('UPDATE push_pendientes SET intentos = intentos + 1, proximo = ?2 WHERE id = ?1').bind(f.id, t + esperaReintento(f.intentos + 1)).run();
    }
  }
  return enviados;
}

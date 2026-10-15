import { json, randomHex, now, once, siteUrl } from '../../_lib/util.js';
import { hasDB } from '../../_lib/db.js';
import { actorOf, csrfOk } from '../../_lib/actor.js';
import { createDeviceCode, validChallenge, validDeviceId, cleanName } from '../../_lib/devices.js';
import { destinoDelDispositivo } from '../../_lib/vincular.js';

// Vincular un equipo escaneando un QR (Nodo Sur Servicios de Windows, El dueño 2026-10-15: "la vinculación sigue siendo por
// navegador"). Como entrar a una tele con el celular:
//   1. La compu pide un pedido (`POST /api/device/qr`, con su id y el desafío PKCE) y muestra el QR con la dirección
//      `/vincular/qr/?p=<pedido>`.
//   2. Alguien con la app del celular ya vinculada (token de dispositivo), o con la sesión del sitio si lo escaneó con la cámara,
//      ve qué equipo es (`/ver`) y confirma (`/aprobar`): el equipo queda en SU negocio y sucursal, como un celular suyo.
//   3. La compu pregunta cada 2 segundos (`/estado`) y recibe el código de un solo uso, que canjea en `/api/device/token` con su
//      verificador: sin él el código no sirve, así que quien vea el QR o el código no puede quedarse con el equipo.
// El pedido vence a los 5 minutos y se usa una vez. El número del pedido es secreto (128 bits): es lo que el QR muestra.
const TTL = 300;
const validPedido = (p) => typeof p === 'string' && /^[0-9a-f]{32}$/.test(p);

const asegurarTabla = (env) => once(env, 'device_qr', () => env.DB.prepare(
  `CREATE TABLE IF NOT EXISTS device_qr (
     id TEXT PRIMARY KEY, device_id TEXT NOT NULL, name TEXT, challenge TEXT NOT NULL, exp INTEGER NOT NULL,
     code TEXT, aprobado_por TEXT)`,
).run());

async function leerPedido(env, id, t = now()) {
  if (!validPedido(id)) return null;
  await asegurarTabla(env);
  const r = await env.DB.prepare('SELECT * FROM device_qr WHERE id = ?1').bind(id).first();
  return r && r.exp >= t ? r : null;
}

const cuerpo = async (request) => { try { return await request.json(); } catch { return null; } };

// 1. La compu: `{ deviceId, name, challenge }` → `{ id, url, expiresAt }`.
export async function onRequestPost({ request, env }) {
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  const b = await cuerpo(request);
  if (!b || !validDeviceId(b.deviceId) || !validChallenge(b.challenge)) return json({ error: 'bad_request' }, 400);
  await asegurarTabla(env);
  const t = now();
  await env.DB.prepare('DELETE FROM device_qr WHERE exp < ?1').bind(t).run(); // limpieza oportunista
  const id = randomHex(16);
  await env.DB.prepare('INSERT INTO device_qr (id, device_id, name, challenge, exp) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(id, b.deviceId, cleanName(b.name), b.challenge, t + TTL).run();
  return json({ id, url: `${siteUrl(env)}/vincular/qr/?p=${id}`, expiresAt: t + TTL });
}

// 3. La compu pregunta: `{ id }` → `{ estado: 'esperando' | 'vencido' }` o `{ estado: 'listo', code }` (una sola vez).
export async function onEstado({ request, env }) {
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  const b = await cuerpo(request);
  if (!b || !validPedido(b.id)) return json({ error: 'bad_request' }, 400);
  const p = await leerPedido(env, b.id);
  if (!p) return json({ estado: 'vencido' });
  if (!p.code) return json({ estado: 'esperando' });
  // Se entrega una vez: el pedido se borra (el código igual vale solo con el verificador de la compu).
  const r = await env.DB.prepare('DELETE FROM device_qr WHERE id = ?1 AND code IS NOT NULL').bind(p.id).run();
  if (!r.meta || r.meta.changes !== 1) return json({ estado: 'vencido' });
  return json({ estado: 'listo', code: p.code });
}

// 2a. Quien escaneó ve qué equipo está por vincular: `{ id }` → `{ nombre, venceEn }`.
export async function onVer({ request, env }) {
  const a = await actorOf(request, env);
  if (!a) return json({ error: 'no_session' }, 401);
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  const b = await cuerpo(request);
  const p = b && await leerPedido(env, b.id);
  if (!p || p.code) return json({ error: 'vencido' }, 410);
  return json({ nombre: p.name, venceEn: Math.max(0, p.exp - now()) });
}

// 2b. Confirma: el equipo queda en el negocio y la sucursal de quien aprueba (desde la app, los de su celular).
export async function onAprobar({ request, env }) {
  const a = await actorOf(request, env);
  if (!a) return json({ error: 'no_session' }, 401);
  if (!csrfOk(request, env, a)) return json({ error: 'forbidden' }, 403);
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  const b = await cuerpo(request);
  const p = b && await leerPedido(env, b.id);
  if (!p || p.code) return json({ error: 'vencido' }, 410);
  const deApp = a.via === 'device';
  const nombrePersona = deApp ? a.device.person_name : a.name;
  const destino = await destinoDelDispositivo(env, { sub: a.sub, email: a.email, name: nombrePersona }, {
    tipo: 'celular',
    orgId: deApp ? a.device.owner_org ?? undefined : undefined,
    branchId: deApp ? a.device.branch_id ?? undefined : undefined,
  });
  if (destino.error) return json({ error: destino.error }, destino.status);
  const code = await createDeviceCode(env, {
    sub: a.sub, email: a.email, deviceId: p.device_id, name: p.name, challenge: p.challenge, orgId: destino.org.id,
    branchId: destino.branch.id, personName: nombrePersona, kind: 'celular',
  });
  // Uno solo aprueba: si dos escanean a la vez, gana el primero.
  const r = await env.DB.prepare('UPDATE device_qr SET code = ?1, aprobado_por = ?2 WHERE id = ?3 AND code IS NULL')
    .bind(code, a.email || a.sub, p.id).run();
  if (!r.meta || r.meta.changes !== 1) return json({ error: 'vencido' }, 410);
  return json({ ok: true, nombre: p.name, negocio: destino.org.name ?? null });
}

import { json } from '../../_lib/util.js';
import { actorOf } from '../../_lib/actor.js';
import { hasDB } from '../../_lib/db.js';
import { getMembership, renombrarNegocio } from '../../_lib/orgs.js';
import { puede } from '../../_lib/permisos.js';

// POST /api/device/negocio (la app): `{ name }`, el nombre del comercio que el dueño puso en "Configurá tu negocio" o en
// Configuración. Un negocio nuevo nace "Negocio de <nombre de Google>" y antes ese nombre quedaba para siempre en el sitio, en la
// lista de negocios del celular y en el cobro (2026-10-14). Solo el dueño; a un empleado se le contesta 403 y la app sigue igual.
export async function onRequestPost({ request, env }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  if (!a.device.owner_org) return json({ error: 'sin_negocio' }, 409);
  let b = null; try { b = await request.json(); } catch { /* cuerpo roto */ }
  if (!b || typeof b.name !== 'string') return json({ error: 'bad_request' }, 400);
  const m = await getMembership(env, a.device.owner_org, a.sub);
  if (!m || m.status !== 'active' || !puede(m, 'nombre_negocio')) return json({ error: 'forbidden' }, 403);
  const r = await renombrarNegocio(env, a.device.owner_org, b.name);
  return r.error ? json({ error: r.error }, r.status) : json({ ok: true });
}

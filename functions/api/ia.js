import { json } from '../_lib/util.js';
import { actorOf } from '../_lib/actor.js';
import { hasDB } from '../_lib/db.js';
import { readJson } from '../_lib/miembros.js';
import { getMembership } from '../_lib/orgs.js';
import { syncAccess } from '../_lib/sync.js';
import { iaConfigurada, estadoIa, guardarClaveIa, borrarClaveIa, generarConIa, claveConForma, modeloConForma, MAX_PEDIDO_IA } from '../_lib/ia.js';

// La IA de Google con la clave del NEGOCIO (`_lib/ia.js`). Todo desde un dispositivo vinculado (la PC o el celular): la sesión web
// no la usa. La clave la carga el dueño desde su PC o su celular; la usan todos los equipos del negocio sin verla.

async function dispositivo(request, env) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return { error: json({ error: 'no_device' }, 401) };
  if (!hasDB(env) || !iaConfigurada(env)) return { error: json({ error: 'ia_no_configurada' }, 503) };
  if (!a.device.owner_org) return { error: json({ error: 'sin_negocio' }, 409) };
  return { a, orgId: a.device.owner_org };
}

async function esDueno(env, w) {
  const m = await getMembership(env, w.orgId, w.a.sub);
  return Boolean(m && m.status === 'active' && m.role === 'owner');
}

// Estado: si el negocio tiene clave, con qué modelo se probó y si quien vinculó este equipo la puede cambiar (el dueño). Nunca la clave.
export async function onRequestGet({ request, env }) {
  const w = await dispositivo(request, env); if (w.error) return w.error;
  const e = await estadoIa(env, w.orgId);
  return json({ configured: e.configurada, model: e.modelo, canChange: await esDueno(env, w) });
}

// Guardar o borrar la clave (solo el dueño). Cuerpo: { clave, modelo } para guardar; { clave: null } para borrarla. La app la prueba
// contra Google antes de mandarla (y elige el modelo que le anda): acá no se vuelve a probar.
export async function onRequestClave({ request, env }) {
  const w = await dispositivo(request, env); if (w.error) return w.error;
  if (!(await esDueno(env, w))) return json({ error: 'solo_dueno' }, 403);
  const b = await readJson(request);
  if (!b) return json({ error: 'bad_request' }, 400);
  if (b.clave === null) {
    await borrarClaveIa(env, w.orgId);
    return json({ ok: true, configured: false });
  }
  if (!claveConForma(b.clave) || (b.modelo != null && !modeloConForma(b.modelo))) return json({ error: 'bad_request' }, 400);
  await guardarClaveIa(env, w.orgId, { clave: b.clave, modelo: b.modelo, sub: w.a.sub });
  return json({ ok: true, configured: true });
}

// Pedirle algo a la IA con la clave del negocio. Pueden quienes operan la sucursal del equipo con el negocio al día (el mismo control
// que sincronizar o cobrar por el servidor). Cuerpo: { modelo, cuerpo } — `cuerpo` es el JSON de `generateContent` como texto, que se
// reenvía tal cual. Devuelve el estado y la respuesta de Google sin tocarlas.
export async function onRequestGenerar({ request, env }) {
  const w = await dispositivo(request, env); if (w.error) return w.error;
  const acc = await syncAccess(env, w.a);
  if (acc.error) return json({ error: acc.error }, 503);
  if (!acc.subir) return json({ error: 'forbidden' }, 403);
  const declarado = Number(request.headers.get('Content-Length') || 0);
  if (declarado > MAX_PEDIDO_IA) return json({ error: 'too_large' }, 413);
  const b = await readJson(request);
  if (!b || !modeloConForma(b.modelo) || typeof b.cuerpo !== 'string' || !b.cuerpo || b.cuerpo.length > MAX_PEDIDO_IA) return json({ error: 'bad_request' }, 400);
  const r = await generarConIa(env, w.orgId, b);
  if (!r) return json({ error: 'ia_sin_clave' }, 409);
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

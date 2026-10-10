import { json } from '../_lib/util.js';
import { actorOf } from '../_lib/actor.js';
import { syncReady, syncAccess, scopeDeSync, hubReady, hubDeCuenta } from '../_lib/sync.js';

// La agenda de turnos de la sucursal (`_lib/agenda.js`): reservar, liberar y ver los horarios ocupados. La usan la app del
// celular (al anotar o mover un turno) y el bot de WhatsApp. Mismo control de acceso que la sync: un dispositivo de la
// sucursal, que puede operarla; la sucursal sale del dispositivo autenticado, nunca del pedido.
const noConfig = () => json({ error: 'agenda_no_configurada' }, 503);

async function hubDe(request, env, { escribe }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return { error: json({ error: 'no_device' }, 401) };
  if (!syncReady(env) || !hubReady(env)) return { error: noConfig() };
  const acc = await syncAccess(env, a);
  if (acc.error) return { error: json({ error: acc.error }, 503) };
  if (escribe ? !acc.subir : !acc.bajar) return { error: json({ error: escribe ? 'no_upload' : 'no_download' }, 403) };
  return { a, hub: await hubDeCuenta(env, scopeDeSync(a)) };
}

async function reenviar(request, env, ruta) {
  const r = await hubDe(request, env, { escribe: true });
  if (r.error) return r.error;
  let datos;
  try { datos = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  // Solo lo que el hub necesita, y quién lo pidió (para saber de dónde salió una reserva).
  const cuerpo = { id: datos.id, profesional: datos.profesional, inicio: datos.inicio, fin: datos.fin, porProfesional: datos.porProfesional, de: r.a.device.id };
  return r.hub.fetch(`https://hub${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) });
}

// POST {id, profesional?, inicio, fin, porProfesional?} → 200 {ok} | 409 {error:'ocupado', choca:{id, profesional, inicio, fin}}.
export const onRequestReservar = ({ request, env }) => reenviar(request, env, '/agenda/reservar');

// POST {id} → 200 {ok}.
export const onRequestLiberar = ({ request, env }) => reenviar(request, env, '/agenda/liberar');

// GET ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD → {ocupados:[{id, profesional, inicio, fin}]}.
export async function onRequestOcupados({ request, env }) {
  const r = await hubDe(request, env, { escribe: false });
  if (r.error) return r.error;
  const q = new URL(request.url).searchParams;
  return r.hub.fetch(`https://hub/agenda/ocupados?desde=${encodeURIComponent(q.get('desde') || '')}&hasta=${encodeURIComponent(q.get('hasta') || '')}`);
}

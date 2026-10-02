import { json } from '../_lib/util.js';
import { actorOf } from '../_lib/actor.js';
import { sha256Hex } from '../_lib/backups.js';
import { syncReady, syncAccess, scopeDeSync, guardarLote, leerLotes, validLoteId, avisarCambio, hubReady, hubDeCuenta, MAX_LOTE_BYTES } from '../_lib/sync.js';

const noConfig = () => json({ error: 'sync_no_configurada' }, 503);
const denied = (acc, what) => (acc.error ? json({ error: acc.error }, 503) : json({ error: what }, 403));

// Subir un lote de cambios (la app). Cuerpo: los bytes del lote (JSON comprimido, lo arma el motor de sync).
// Cabeceras: X-Lote-Id (único por lote: reintentar no duplica) y X-Sha256 (hex de lo enviado).
export async function onRequestPost({ request, env, ctx }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  if (!syncReady(env)) return noConfig();
  const acc = await syncAccess(env, a);
  if (acc.error || !acc.subir) return denied(acc, 'no_upload');

  const loteId = request.headers.get('X-Lote-Id');
  if (!validLoteId(loteId)) return json({ error: 'bad_request' }, 400);
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_LOTE_BYTES) return json({ error: 'too_large', max: MAX_LOTE_BYTES }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ error: 'bad_request' }, 400);
  if (bytes.length > MAX_LOTE_BYTES) return json({ error: 'too_large', max: MAX_LOTE_BYTES }, 413);
  if ((request.headers.get('X-Sha256') || '').toLowerCase() !== await sha256Hex(bytes)) return json({ error: 'hash_mismatch' }, 422);

  const scope = scopeDeSync(a); // la sucursal del dispositivo autenticado, nunca algo que venga en el pedido
  const r = await guardarLote(env, { scope, deviceId: a.device.id, loteId, bytes });
  // Un reintento (lote ya guardado) no avisa de nuevo: los demás ya se enteraron la primera vez.
  if (!r.repetido) {
    const aviso = avisarCambio(env, { scope, deviceId: a.device.id, seq: r.seq });
    if (ctx && ctx.waitUntil) ctx.waitUntil(aviso); else await aviso;
  }
  return json({ ok: true, seq: r.seq, repetido: r.repetido });
}

// Bajar lo que subieron los otros dispositivos DE LA MISMA SUCURSAL: ?desde=<seq>.
export async function onRequestGet({ request, env }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  if (!syncReady(env)) return noConfig();
  const acc = await syncAccess(env, a);
  if (acc.error || !acc.bajar) return denied(acc, 'no_download');

  const desde = Number(new URL(request.url).searchParams.get('desde') ?? 0);
  if (!Number.isInteger(desde) || desde < 0) return json({ error: 'bad_request' }, 400);
  const r = await leerLotes(env, { scope: scopeDeSync(a), deviceId: a.device.id, desde });
  return json(r);
}

// Escuchar avisos (WebSocket): la app se conecta una vez y queda esperando; cuando otro dispositivo sube un lote,
// llega `{"seq":N}` y recién ahí baja. Mientras no haya nada nuevo no hay ningún pedido. Pasa por el mismo control
// de acceso que bajar.
export async function onRequestEscuchar({ request, env }) {
  if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'upgrade_required' }, 426);
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  if (!syncReady(env) || !hubReady(env)) return noConfig();
  const acc = await syncAccess(env, a);
  if (acc.error || !acc.bajar) return denied(acc, 'no_download');
  const hub = await hubDeCuenta(env, scopeDeSync(a));
  // Pedido nuevo con solo lo necesario: la credencial del dispositivo no sigue viaje hacia el Durable Object.
  return hub.fetch('https://hub/escuchar', { headers: { Upgrade: 'websocket', 'X-Dispositivo': a.device.id } });
}

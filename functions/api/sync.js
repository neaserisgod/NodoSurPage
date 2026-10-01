import { json } from '../_lib/util.js';
import { actorOf } from '../_lib/actor.js';
import { sha256Hex } from '../_lib/backups.js';
import { syncReady, syncAccess, guardarLote, leerLotes, validLoteId, MAX_LOTE_BYTES } from '../_lib/sync.js';

const noConfig = () => json({ error: 'sync_no_configurada' }, 503);
const denied = (acc, what) => (acc.error ? json({ error: acc.error }, 503) : json({ error: what }, 403));

// Subir un lote de cambios (la app). Cuerpo: los bytes del lote (JSON comprimido, lo arma el motor de sync).
// Cabeceras: X-Lote-Id (único por lote: reintentar no duplica) y X-Sha256 (hex de lo enviado).
export async function onRequestPost({ request, env }) {
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

  const r = await guardarLote(env, { sub: a.sub, deviceId: a.device.id, loteId, bytes });
  return json({ ok: true, seq: r.seq, repetido: r.repetido, ahora: Date.now() });
}

// Bajar lo que subieron los otros dispositivos: ?desde=<seq>. Sin lotes nuevos igual devuelve `hasta` y `ahora`
// (sirve de latido y para corregir el reloj de la app).
export async function onRequestGet({ request, env }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  if (!syncReady(env)) return noConfig();
  const acc = await syncAccess(env, a);
  if (acc.error || !acc.bajar) return denied(acc, 'no_download');

  const desde = Number(new URL(request.url).searchParams.get('desde') ?? 0);
  if (!Number.isInteger(desde) || desde < 0) return json({ error: 'bad_request' }, 400);
  const r = await leerLotes(env, { sub: a.sub, deviceId: a.device.id, desde });
  return json({ ...r, ahora: Date.now() });
}

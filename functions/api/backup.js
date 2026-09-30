import { json } from '../_lib/util.js';
import { actorOf, csrfOk, forbidden } from '../_lib/actor.js';
import { hasDB } from '../_lib/db.js';
import {
  backupsReady, backupAccess, saveBackup, getBackup, readBackup, deleteBackup, sha256Hex, MAX_BYTES,
} from '../_lib/backups.js';

const denied = (acc, what) => (acc.error ? json({ error: acc.error }, 503) : json({ error: what }, 403));
const noConfig = () => json({ error: 'backups_no_configurados' }, 503);

// Subir una copia (la app). Cuerpo: los bytes de la base ya comprimidos. Cabeceras: X-Sha256 (hex de lo enviado),
// X-Schema-Version y X-App-Version. Se guarda cifrada y solo quedan las últimas copias de la cuenta.
export async function onRequestPut({ request, env }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return json({ error: 'no_device' }, 401);
  if (!hasDB(env) || !backupsReady(env)) return noConfig();
  const acc = await backupAccess(env, a);
  if (acc.error || !acc.upload) return denied(acc, 'no_upload');

  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES) return json({ error: 'too_large', max: MAX_BYTES }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ error: 'bad_request' }, 400);
  if (bytes.length > MAX_BYTES) return json({ error: 'too_large', max: MAX_BYTES }, 413);
  const sha256 = await sha256Hex(bytes);
  if ((request.headers.get('X-Sha256') || '').toLowerCase() !== sha256) return json({ error: 'hash_mismatch' }, 422); // se cortó o se alteró en el camino
  const schema = Number(request.headers.get('X-Schema-Version'));
  const appVersion = /^[0-9A-Za-z.+-]{1,40}$/.test(request.headers.get('X-App-Version') || '') ? request.headers.get('X-App-Version') : null;

  const r = await saveBackup(env, {
    sub: a.sub, email: a.email, deviceId: a.device.id, bytes, sha256,
    schemaVersion: Number.isInteger(schema) && schema > 0 ? schema : null, appVersion,
  });
  return json({ ok: true, id: r.id, createdAt: r.createdAt, guardadas: r.guardadas });
}

// Bajar una copia (la app al restaurar, o la persona desde Mi cuenta): ?id=. Solo las propias.
export async function onRequestGet({ request, env }) {
  const a = await actorOf(request, env);
  if (!a) return json({ error: 'no_session' }, 401);
  if (!hasDB(env) || !backupsReady(env)) return noConfig();
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return json({ error: 'bad_request' }, 400);
  const acc = await backupAccess(env, a);
  if (acc.error || !acc.restore) return denied(acc, 'no_restore');
  const b = await getBackup(env, id, a.sub);
  if (!b) return json({ error: 'not_found' }, 404);
  const bytes = await readBackup(env, b);
  if (!bytes) return json({ error: 'corrupt' }, 500);
  const h = {
    'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store',
    'X-Sha256': b.sha256, 'X-Schema-Version': String(b.schema_version ?? ''), 'X-App-Version': b.app_version ?? '',
  };
  if (a.via === 'session') h['Content-Disposition'] = `attachment; filename="nodosur-copia-${new Date(b.created_at * 1000).toISOString().slice(0, 10)}.sqlite.gz"`;
  return new Response(bytes, { status: 200, headers: h });
}

// Borrar una copia propia (la persona puede sacar sus datos del servidor).
export async function onRequestDelete({ request, env }) {
  const a = await actorOf(request, env);
  if (!a) return json({ error: 'no_session' }, 401);
  if (!csrfOk(request, env, a)) return forbidden();
  if (!hasDB(env) || !backupsReady(env)) return noConfig();
  let body; try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return json({ error: 'bad_request' }, 400);
  const b = await getBackup(env, id, a.sub);
  if (!b) return json({ error: 'not_found' }, 404);
  await deleteBackup(env, b);
  return json({ ok: true });
}

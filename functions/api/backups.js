import { json } from '../_lib/util.js';
import { actorOf } from '../_lib/actor.js';
import { hasDB } from '../_lib/db.js';
import { backupsReady, backupAccess, listBackups, publicBackup, MAX_COPIAS, MAX_BYTES, VENTANA_RESTAURAR_DIAS } from '../_lib/backups.js';

// Mis copias y qué puedo hacer con ellas (subir / restaurar). La app lo consulta antes de subir o al restaurar.
export async function onRequestGet({ request, env }) {
  const a = await actorOf(request, env);
  if (!a) return json({ error: 'no_session' }, 401);
  if (!hasDB(env) || !backupsReady(env)) return json({ error: 'backups_no_configurados' }, 503);
  const acc = await backupAccess(env, a);
  const copias = (await listBackups(env, a.sub)).map(publicBackup);
  if (acc.error) return json({ error: acc.error, backups: copias }, 503);
  return json({ upload: acc.upload, restore: acc.restore, max: MAX_COPIAS, maxBytes: MAX_BYTES, restoreDays: VENTANA_RESTAURAR_DIAS, backups: acc.restore ? copias : [] });
}

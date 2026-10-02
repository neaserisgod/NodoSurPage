import { json } from '../_lib/util.js';
import { actorOf } from '../_lib/actor.js';
import { hasDB } from '../_lib/db.js';
import { backupsReady, listBackups, publicBackup, MAX_COPIAS, MAX_BYTES, VENTANA_RESTAURAR_DIAS } from '../_lib/backups.js';
import { backupAccess, backupScope } from '../_lib/access.js';

// Las copias de mi negocio y sucursal, y qué puedo hacer con ellas (subir / restaurar). La app lo consulta antes de
// subir o al restaurar; por la web, `?org=` elige el negocio si la persona tiene más de uno.
export async function onRequestGet({ request, env }) {
  const a = await actorOf(request, env);
  if (!a) return json({ error: 'no_session' }, 401);
  if (!hasDB(env) || !backupsReady(env)) return json({ error: 'backups_no_configurados' }, 503);
  const scope = await backupScope(env, a, { orgId: Number(new URL(request.url).searchParams.get('org')) || undefined });
  // Un empleado (o quien no administra copias) no es una cuenta "sin suscripción": el negocio sí la tiene. Se lo dice aparte
  // para que la app no le diga que su suscripción no está activa.
  if (!scope.denied && scope.allowed === false) return json({ upload: false, restore: false, noPermission: true, max: MAX_COPIAS, maxBytes: MAX_BYTES, restoreDays: VENTANA_RESTAURAR_DIAS, backups: [] });
  const acc = await backupAccess(env, a, scope);
  const copias = (await listBackups(env, scope)).map(publicBackup);
  if (acc.error) return json({ error: acc.error, backups: copias }, 503);
  return json({ upload: acc.upload, restore: acc.restore, max: MAX_COPIAS, maxBytes: MAX_BYTES, restoreDays: VENTANA_RESTAURAR_DIAS, backups: acc.restore ? copias : [] });
}

import { json } from '../_lib/util.js';
import { currentUser } from '../_lib/auth.js';
import { downloadAccess } from '../_lib/access.js';
import { PLATFORMS, hasR2, latestForInstall } from '../_lib/releases.js';
import { hasDB } from '../_lib/db.js';

// Qué puede descargar esta persona (lo consulta /descargar/). Nunca expone claves internas del archivo.
export async function onRequestGet({ request, env }) {
  const cu = await currentUser(request, env);
  if (!cu.session) return json({ error: 'no_session' }, 401);
  const acc = await downloadAccess(env, cu);
  if (!acc.ok) return json({ canDownload: false, reason: acc.reason, releases: [] });
  const releases = [];
  if (hasDB(env) && hasR2(env)) {
    for (const platform of PLATFORMS) {
      const r = await latestForInstall(env, platform, 'stable');
      if (r) releases.push({ platform, version: r.version, size: r.size, sha256: r.sha256, notes: r.notes, publishedAt: r.published_at });
    }
  }
  return json({ canDownload: true, privileged: Boolean(acc.privileged), releases });
}

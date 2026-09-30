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
  const pub = (platform, r) => ({ platform, version: r.version, size: r.size, sha256: r.sha256, notes: r.notes, publishedAt: r.published_at });
  const releases = [];
  const beta = [];
  if (hasDB(env) && hasR2(env)) {
    for (const platform of PLATFORMS) {
      const r = await latestForInstall(env, platform, 'stable');
      if (r) releases.push(pub(platform, r));
      // Las versiones de prueba se ofrecen solo a administradores y cuentas eximidas (el mismo criterio que /api/download).
      if (acc.privileged) {
        const b = await latestForInstall(env, platform, 'beta');
        if (b) beta.push(pub(platform, b));
      }
    }
  }
  return json({ canDownload: true, privileged: Boolean(acc.privileged), releases, ...(acc.privileged ? { beta } : {}) });
}

import { json } from '../_lib/util.js';
import { currentUser } from '../_lib/auth.js';
import { downloadAccess } from '../_lib/access.js';
import { PLATFORMS, hasR2, historyForInstall, latestForInstall } from '../_lib/releases.js';
import { hasDB } from '../_lib/db.js';

// Qué puede descargar esta persona (lo consulta la descarga de Mi cuenta, `descargar.js`). Nunca expone claves internas del archivo.
export async function onRequestGet({ request, env }) {
  const cu = await currentUser(request, env);
  if (!cu.session) return json({ error: 'no_session' }, 401);
  const acc = await downloadAccess(env, cu);
  if (!acc.ok) return json({ canDownload: false, reason: acc.reason, releases: [] });
  const pub = (platform, r) => ({ platform, version: r.version, size: r.size, sha256: r.sha256, notes: r.notes, publishedAt: r.published_at });
  const releases = [];
  const beta = [];
  const historial = [];
  if (hasDB(env) && hasR2(env)) {
    // Todas las plataformas a la vez (antes, una consulta tras otra); el orden de la lista se mantiene.
    const porPlataforma = await Promise.all(PLATFORMS.map(async (platform) => {
      const [r, b, hs, hb] = await Promise.all([
        latestForInstall(env, platform, 'stable'),
        // Las versiones de prueba se ofrecen solo a administradores y cuentas eximidas (el mismo criterio que /api/download).
        acc.privileged ? latestForInstall(env, platform, 'beta') : null,
        // Para volver atrás: las versiones anteriores de los dos canales (la más nueva de cada uno ya está arriba).
        acc.privileged ? historyForInstall(env, platform, 'stable') : [],
        acc.privileged ? historyForInstall(env, platform, 'beta') : [],
      ]);
      return { platform, r, b, hist: [...hs.map((h) => ['stable', h]), ...hb.map((h) => ['beta', h])] };
    }));
    for (const { platform, r, b, hist } of porPlataforma) {
      if (r) releases.push(pub(platform, r));
      if (b) beta.push(pub(platform, b));
      for (const [channel, h] of hist) historial.push({ ...pub(platform, h), channel });
    }
  }
  return json({ canDownload: true, privileged: Boolean(acc.privileged), releases, ...(acc.privileged ? { beta, historial } : {}) });
}

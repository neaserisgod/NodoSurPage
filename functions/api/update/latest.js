import { json, siteUrl } from '../../_lib/util.js';
import { PLATFORMS, CHANNELS, hasR2, validVersion, latestForUpdate } from '../../_lib/releases.js';
import { hasDB } from '../../_lib/db.js';

// Público: ¿hay una versión nueva para esta instalación? Las actualizaciones no piden sesión (el archivo va firmado).
//   /api/update/latest.json?platform=android&channel=stable&version=1.2.3&cid=<id de instalación>
export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const platform = q.get('platform'), channel = q.get('channel') || 'stable', current = q.get('version');
  const cid = (q.get('cid') || '').slice(0, 64);
  if (!PLATFORMS.includes(platform) || !CHANNELS.includes(channel) || (current && !validVersion(current))) return json({ error: 'bad_request' }, 400);
  if (!hasDB(env) || !hasR2(env)) return json({ update: false });
  const r = await latestForUpdate(env, platform, channel, current, cid);
  if (!r) return json({ update: false });
  return json({
    update: true, version: r.version, mandatory: Boolean(r.mandatory), url: `${siteUrl(env)}/api/update/file?id=${r.id}`,
    sha256: r.sha256, size: r.size, signature: r.signature, notes: r.notes, publishedAt: r.published_at,
  });
}

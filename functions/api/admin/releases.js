import { json, now, sameOriginPost } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { PLATFORMS, CHANNELS, hasR2, validVersion, validKey, listReleases, getRelease, addRelease, setRollout, setBlocked, setActive } from '../../_lib/releases.js';

// Comparación en tiempo constante del token de publicación (para el flujo automático de CI).
function tokenOk(request, env) {
  const t = String(env.RELEASE_TOKEN || '');
  const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (t.length < 24 || !m) return false;
  const a = new TextEncoder().encode(m[1]), b = new TextEncoder().encode(t);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a[i] || 0) ^ (b[i] || 0);
  return d === 0;
}

export async function onRequestGet({ request, env }) {
  if (!tokenOk(request, env)) {
    if (request.headers.get('Authorization')) return json({ error: 'unauthorized' }, 401);
    const g = await requireAdmin(request, env); if (g.error) return g.error;
  }
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  return json({ r2: hasR2(env), releases: (await listReleases(env)).map(pub) });
}
const pub = (r) => ({ id: r.id, channel: r.channel, platform: r.platform, version: r.version, size: r.size, sha256: r.sha256, signed: Boolean(r.signature),
  notes: r.notes, mandatory: Boolean(r.mandatory), rollout: r.rollout, blocked: Boolean(r.blocked), active: Boolean(r.active), publishedAt: r.published_at, downloads: r.downloads || 0 });

// Publicar una versión (ya subida a R2) o cambiar su estado. Sesión de administrador o RELEASE_TOKEN (CI).
export async function onRequestPost({ request, env }) {
  const bearer = tokenOk(request, env);
  if (!bearer && request.headers.get('Authorization')) return json({ error: 'unauthorized' }, 401); // token equivocado: no se cae a la sesión
  if (!bearer) {
    if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
    const g = await requireAdmin(request, env); if (g.error) return g.error;
  }
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const action = b.action || 'create';

  if (action === 'create') {
    if (!hasR2(env)) return json({ error: 'no_r2' }, 503);
    const rollout = b.rollout === undefined ? 100 : b.rollout;
    if (!PLATFORMS.includes(b.platform) || !CHANNELS.includes(b.channel) || !validVersion(b.version) || !validKey(b.key)
        || !b.key.startsWith(`${b.channel}/${b.version}/`) || !/^[a-f0-9]{64}$/.test(String(b.sha256 || ''))
        || !Number.isInteger(rollout) || rollout < 0 || rollout > 100
        || (b.signature != null && (typeof b.signature !== 'string' || b.signature.length > 400))
        || (b.notes != null && (typeof b.notes !== 'string' || b.notes.length > 4000))) return json({ error: 'bad_request' }, 400);
    const head = await env.RELEASES.head(b.key); // el archivo tiene que estar realmente en R2
    if (!head) return json({ error: 'file_missing' }, 422);
    try {
      await addRelease(env, { channel: b.channel, platform: b.platform, version: b.version, file_key: b.key, size: head.size, sha256: b.sha256,
        signature: b.signature, notes: b.notes, mandatory: b.mandatory === true, rollout }, now());
    } catch (e) { if (/UNIQUE/i.test(String(e && e.message))) return json({ error: 'exists' }, 409); throw e; }
    return json({ ok: true, size: head.size });
  }

  const id = Number(b.id);
  if (!Number.isInteger(id) || !['rollout', 'block', 'unblock', 'retire', 'restore'].includes(action)) return json({ error: 'bad_request' }, 400);
  if (!(await getRelease(env, id))) return json({ error: 'not_found' }, 404);
  if (action === 'rollout') {
    if (!Number.isInteger(b.rollout) || b.rollout < 0 || b.rollout > 100) return json({ error: 'bad_request' }, 400);
    await setRollout(env, id, b.rollout);
  } else if (action === 'block' || action === 'unblock') await setBlocked(env, id, action === 'block');
  else await setActive(env, id, action === 'restore');
  return json({ ok: true });
}

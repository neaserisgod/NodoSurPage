import { json, now, sameOriginPost } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { PLATFORMS, CHANNELS, SIG_TYPES, hasR2, validVersion, validKey, listReleases, getRelease, addRelease, podarVersiones, setRollout, setBlocked, setActive } from '../../_lib/releases.js';

function constantTimeEqual(aStr, bStr) {
  if (!aStr || !bStr) return false;
  const a = new TextEncoder().encode(String(aStr)), b = new TextEncoder().encode(String(bStr));
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a[i] || 0) ^ (b[i] || 0);
  return d === 0;
}

// Comparación en tiempo constante del token de publicación (para el flujo automático de CI).
function tokenOk(request, env, bodyToken) {
  const t = String(env.RELEASE_TOKEN || '');
  if (t.length < 24) return false;

  const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (m && constantTimeEqual(m[1], t)) return true;

  const custom = request.headers.get('X-Release-Token');
  if (custom && constantTimeEqual(custom, t)) return true;

  const urlToken = new URL(request.url).searchParams.get('token');
  if (urlToken && constantTimeEqual(urlToken, t)) return true;

  if (bodyToken && constantTimeEqual(bodyToken, t)) return true;

  return false;
}

export async function onRequestGet({ request, env }) {
  const token = tokenOk(request, env);
  if (!token) {
    if (request.headers.get('Authorization') || request.headers.get('X-Release-Token') || new URL(request.url).searchParams.get('token')) {
      return json({ error: 'unauthorized' }, 401);
    }
    const g = await requireAdmin(request, env); if (g.error) return g.error;
  }
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  return json({ r2: hasR2(env), releases: (await listReleases(env)).map(pub) });
}
const pub = (r) => ({ id: r.id, channel: r.channel, platform: r.platform, version: r.version, size: r.size, sha256: r.sha256, signed: Boolean(r.signature), signatureType: r.sig_type || 'ed',
  notes: r.notes, mandatory: Boolean(r.mandatory), rollout: r.rollout, blocked: Boolean(r.blocked), active: Boolean(r.active), publishedAt: r.published_at, downloads: r.downloads || 0 });

// Publicar una versión (ya subida a R2) o cambiar su estado. Sesión de administrador o RELEASE_TOKEN (CI).
export async function onRequestPost({ request, env }) {
  let b; try { b = await request.json(); } catch { b = null; }
  const bodyToken = b && (b.releaseToken || b.token);
  const bearer = tokenOk(request, env, bodyToken);
  const hadAuth = Boolean(request.headers.get('Authorization') || request.headers.get('X-Release-Token') || new URL(request.url).searchParams.get('token') || bodyToken);
  if (!bearer && hadAuth) return json({ error: 'unauthorized' }, 401); // token equivocado: no se cae a la sesión
  if (!bearer) {
    if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
    const g = await requireAdmin(request, env); if (g.error) return g.error;
  }
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  if (!b) return json({ error: 'bad_request' }, 400);
  const action = b.action || 'create';

  if (action === 'create') {
    if (!hasR2(env)) return json({ error: 'no_r2' }, 503);
    const rollout = b.rollout === undefined ? 100 : b.rollout;
    if (!PLATFORMS.includes(b.platform) || !CHANNELS.includes(b.channel) || !validVersion(b.version) || !validKey(b.key)
        || !b.key.startsWith(`${b.channel}/${b.version}/`) || !/^[a-f0-9]{64}$/.test(String(b.sha256 || ''))
        || !Number.isInteger(rollout) || rollout < 0 || rollout > 100
        || (b.signature != null && (typeof b.signature !== 'string' || b.signature.length > 400))
        || (b.signatureType != null && !SIG_TYPES.includes(b.signatureType))
        || (b.notes != null && (typeof b.notes !== 'string' || b.notes.length > 4000))) return json({ error: 'bad_request' }, 400);
    const head = await env.RELEASES.head(b.key); // el archivo tiene que estar realmente en R2
    if (!head) return json({ error: 'file_missing' }, 422);
    try {
      await addRelease(env, { channel: b.channel, platform: b.platform, version: b.version, file_key: b.key, size: head.size, sha256: b.sha256,
        signature: b.signature, sigType: b.signatureType, notes: b.notes, mandatory: b.mandatory === true, rollout }, now());
    } catch (e) { if (/UNIQUE/i.test(String(e && e.message))) return json({ error: 'exists' }, 409); throw e; }
    // Cada versión nueva deja solo las 2 últimas por plataforma y canal. Si la poda falla no se pierde la publicación.
    try { await podarVersiones(env); } catch { /* la publicación ya quedó */ }
    return json({ ok: true, size: head.size });
  }
  if (action === 'prune') return json({ ok: true, ...(await podarVersiones(env)) });

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

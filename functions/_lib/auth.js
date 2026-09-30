import { getSession, isAdminEmail, json, cookie } from './util.js';
import { hasDB, getBySub } from './db.js';

// Sesión + (si hay D1) el registro del usuario. `gone` = la cuenta fue eliminada.
export async function currentUser(request, env) {
  const session = await getSession(request, env);
  if (!session) return {};
  if (!hasDB(env)) return { session, user: null };
  const user = await getBySub(env, session.sub);
  return user ? { session, user } : { session, gone: true };
}

export const clearedSession = () => {
  const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', cookie('ns_session', '', { maxAge: 0 }));
  for (const n of ['ns_hint', 'ns_sub', 'ns_plan']) h.append('Set-Cookie', cookie(n, '', { maxAge: 0, httpOnly: false }));
  return new Response(JSON.stringify({ error: 'no_session' }), { status: 401, headers: h });
};

// Devuelve {session,user} si es administrador, o una Response de error.
export async function requireAdmin(request, env) {
  const cu = await currentUser(request, env);
  if (!cu.session) return { error: json({ error: 'no_session' }, 401) };
  if (cu.gone) return { error: clearedSession() };
  if (!isAdminEmail(env, cu.session.email)) return { error: json({ error: 'forbidden' }, 403) };
  return cu;
}

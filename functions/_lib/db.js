// Acceso a D1 (binding `DB`). Si no está configurado, el sitio sigue funcionando sin registro de usuarios.
export const hasDB = (env) => Boolean(env.DB);

export async function upsertLogin(env, { sub, email, name }, t) {
  await env.DB.prepare(
    `INSERT INTO users (sub, email, name, created_at, last_seen, login_count) VALUES (?1, ?2, ?3, ?4, ?4, 1)
     ON CONFLICT(sub) DO UPDATE SET email = ?2, name = ?3, last_seen = ?4, login_count = login_count + 1,
       notice_sent_at = NULL, delete_after = NULL`
  ).bind(sub, email, name, t).run();
  return getBySub(env, sub);
}
export const getBySub = (env, sub) => env.DB.prepare('SELECT * FROM users WHERE sub = ?1').bind(sub).first();
export const getById = (env, id) => env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
export const listUsers = async (env) => (await env.DB.prepare('SELECT * FROM users ORDER BY last_seen DESC LIMIT 1000').all()).results;

// "Uso": se actualiza a lo sumo cada 10 minutos por usuario. Ver actividad limpia el aviso de borrado.
export async function touch(env, user, t) {
  if (t - user.last_seen < 600 && !user.delete_after) return user;
  await env.DB.prepare('UPDATE users SET last_seen = ?2, notice_sent_at = NULL, delete_after = NULL WHERE id = ?1').bind(user.id, t).run();
  return { ...user, last_seen: t, notice_sent_at: null, delete_after: null };
}
export const setExempt = (env, id, v) => env.DB.prepare('UPDATE users SET exempt = ?2 WHERE id = ?1').bind(id, v ? 1 : 0).run();
export const clearNotice = (env, id) => env.DB.prepare('UPDATE users SET notice_sent_at = NULL, delete_after = NULL WHERE id = ?1').bind(id).run();
export const markNotice = (env, id, sentAt, deleteAfter) =>
  env.DB.prepare('UPDATE users SET notice_sent_at = ?2, delete_after = ?3 WHERE id = ?1').bind(id, sentAt, deleteAfter).run();
export const deleteUser = (env, id) => env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(id).run();

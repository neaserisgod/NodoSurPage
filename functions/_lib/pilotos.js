// Invitaciones de prueba (El dueño, 2026-10-19): el dueño crea en el panel un link para UNA persona; quien lo abre e ingresa
// con Google queda eximida con el plan elegido y va directo a la descarga. Un link fijo para todos se descartó: reenviado,
// cualquiera quedaba eximida para siempre sin que nadie se enterara. Se guarda solo el hash del token, como las invitaciones.
import { now, randomHex, sha256b64u, once, siteUrl } from './util.js';
import { setExempt, setIntent } from './db.js';

export const VIGENCIA_PILOTO = 7 * 24 * 3600;
const DDL = `CREATE TABLE IF NOT EXISTS pilotos (token_hash TEXT PRIMARY KEY, plan TEXT NOT NULL, created_at INTEGER NOT NULL,
  exp INTEGER NOT NULL, used_by INTEGER, used_at INTEGER)`;
const asegurar = (env) => once(env, 'pilotos', () => env.DB.prepare(DDL).run());

export async function crearPiloto(env, plan) {
  await asegurar(env);
  const token = randomHex(32), t = now();
  await env.DB.prepare('INSERT INTO pilotos (token_hash, plan, created_at, exp) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256b64u(token), plan, t, t + VIGENCIA_PILOTO).run();
  return { link: `${siteUrl(env)}/invitado/?t=${token}`, exp: t + VIGENCIA_PILOTO };
}

// Canjea el token para este usuario. Un link sirve para una sola cuenta; si la misma persona lo vuelve a abrir, sigue andando.
export async function canjearPiloto(env, token, user) {
  await asegurar(env);
  const h = await sha256b64u(token), t = now();
  const p = await env.DB.prepare('SELECT * FROM pilotos WHERE token_hash = ?1').bind(h).first();
  if (!p) return { error: 'no_valido' };
  if (p.used_by != null && p.used_by !== user.id) return { error: 'usado' };
  if (p.used_by == null) {
    if (p.exp < t) return { error: 'vencido' };
    // Condicional: si dos personas lo abren a la vez, gana una sola.
    const r = await env.DB.prepare('UPDATE pilotos SET used_by = ?2, used_at = ?3 WHERE token_hash = ?1 AND used_by IS NULL')
      .bind(h, user.id, t).run();
    if (!r.meta || r.meta.changes !== 1) return { error: 'usado' };
  }
  await setExempt(env, user.id, true);
  await setIntent(env, user.id, p.plan, t);
  return { ok: true, plan: p.plan };
}

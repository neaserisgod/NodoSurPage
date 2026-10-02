import { listAllSubscribers } from './mp.js';
import { listUsers, markNotice, clearNotice, deleteUser } from './db.js';
import { billingEmailsBySub } from './orgs.js';
import { sendDeletionNotice, notifierReady } from './notify.js';
import { isAdminEmail, now as nowSec } from './util.js';

export const RULES = { graceDays: 14, inactiveDays: 30, noticeDays: 3 };
const PROTECTED = ['authorized', 'pending', 'paused'];
const DAY = 86400;

// Reglas: se elimina una cuenta solo si NO está exenta, NO es admin, NO tiene suscripción vigente (propia o del
// negocio del que es miembro: un empleado queda cubierto por lo que paga su negocio),
// tiene más de `graceDays` de antigüedad, lleva `inactiveDays` sin uso, y ya pasaron `noticeDays` desde
// un aviso que efectivamente se envió. Si no se puede verificar Mercado Pago, no se hace nada.
export async function sweep(env, { apply = false, t = nowSec() } = {}) {
  let subs;
  try { subs = await listAllSubscribers(env, { fresh: true }); } catch { return { ok: false, error: 'mp_error', actions: [], rules: RULES }; }
  const paying = new Set(subs.filter((s) => PROTECTED.includes(s.status)).map((s) => s.payerEmail));
  const cubiertas = await billingEmailsBySub(env);
  const cubierta = (u) => paying.has(u.email) || (cubiertas.get(u.sub) || []).some((e) => paying.has(e));
  const canDelete = apply && env.AUTO_DELETE === 'on';
  const actions = [];

  for (const u of await listUsers(env)) {
    if (u.exempt || isAdminEmail(env, u.email)) continue;
    const qualifies = !cubierta(u)
      && t - u.last_seen >= RULES.inactiveDays * DAY
      && t - u.created_at >= RULES.graceDays * DAY;
    const base = { id: u.id, email: u.email, name: u.name, lastSeen: u.last_seen };

    if (!qualifies) {
      if (u.delete_after) { if (apply) await clearNotice(env, u.id); actions.push({ ...base, action: 'clear_notice' }); }
      continue;
    }
    if (!u.delete_after) {
      if (!notifierReady(env)) { actions.push({ ...base, action: 'needs_notice' }); continue; }
      const deleteAt = t + RULES.noticeDays * DAY;
      let sent = false;
      if (apply) { sent = await sendDeletionNotice(env, u, deleteAt); if (sent) await markNotice(env, u.id, t, deleteAt); }
      actions.push({ ...base, action: 'send_notice', deleteAt, applied: sent });
    } else if (t >= u.delete_after && u.notice_sent_at) {
      if (canDelete) await deleteUser(env, u.id);
      actions.push({ ...base, action: 'delete', applied: canDelete, blockedBy: apply && !canDelete ? 'AUTO_DELETE_off' : undefined });
    } else {
      actions.push({ ...base, action: 'waiting', deleteAt: u.delete_after });
    }
  }
  return { ok: true, actions, rules: RULES, autoDelete: env.AUTO_DELETE === 'on', notifier: notifierReady(env) };
}

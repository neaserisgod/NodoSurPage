import { json, now, isAdminEmail } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { hasDB, listUsers, getPromo } from '../../_lib/db.js';
import { listAllSubscribers } from '../../_lib/mp.js';
import { notifierReady } from '../../_lib/notify.js';
import { RULES } from '../../_lib/sweep.js';

const RANK = { authorized: 4, pending: 3, paused: 2, cancelled: 1, canceled: 1 };
const best = (a, b) => (!a || (RANK[b.status] || 0) > (RANK[a.status] || 0) ? b : a);

export async function onRequestGet({ request, env }) {
  const g = await requireAdmin(request, env);
  if (g.error) return g.error;
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);

  const users = await listUsers(env);
  let mpStale = false;
  let subs = [], mpError = !env.MP_ACCESS_TOKEN, mpDetail = env.MP_ACCESS_TOKEN ? null : { reason: 'no_token' };
  if (env.MP_ACCESS_TOKEN) {
    try { subs = await listAllSubscribers(env); mpStale = Boolean(subs.stale); }
    catch (e) { mpError = true; mpDetail = { status: e.status || null, message: e.detail || String(e.message || '').slice(0, 120) }; }
  }

  const byEmail = new Map();
  for (const s of subs) byEmail.set(s.payerEmail, best(byEmail.get(s.payerEmail), s));

  const t = now(), DAY = 86400;
  const rows = users.map((u) => {
    const sub = byEmail.get(u.email) || null;
    return {
      id: u.id, name: u.name, email: u.email, createdAt: u.created_at, lastSeen: u.last_seen, logins: u.login_count,
      exempt: Boolean(u.exempt), isAdmin: isAdminEmail(env, u.email), deleteAfter: u.delete_after, noticeSentAt: u.notice_sent_at,
      plan: u.plan_interest || null, promo: Boolean(u.promo_interest), chosenAt: u.plan_chosen_at || null,
      subscription: sub && { plan: sub.plan, status: sub.status, amount: sub.amount, nextPayment: sub.nextPayment },
    };
  });
  const emails = new Set(users.map((u) => u.email));
  const active = subs.filter((s) => s.status === 'authorized');
  return json({
    kpis: {
      users: users.length,
      new7d: users.filter((u) => t - u.created_at < 7 * DAY).length,
      active7d: users.filter((u) => t - u.last_seen < 7 * DAY).length,
      activeSubs: active.length,
      mrr: active.reduce((a, s) => a + (Number(s.amount) || 0), 0),
      inNotice: users.filter((u) => u.delete_after).length,
      // Registrados que todavía no pagaron (solo se sabe si Mercado Pago respondió).
      unpaid: mpError ? null : rows.filter((r) => !r.subscription && !r.isAdmin).length,
    },
    users: rows,
    subscribersWithoutAccount: subs.filter((s) => !emails.has(s.payerEmail)).map((s) => ({ email: s.payerEmail, plan: s.plan, status: s.status, amount: s.amount })),
    config: { db: true, mp: !mpError, autoDelete: env.AUTO_DELETE === 'on', notifier: notifierReady(env) },
    mpError,
    mpStale,
    mpDetail,
    rules: RULES,
    promo: { activa: await getPromo(env) },
  });
}

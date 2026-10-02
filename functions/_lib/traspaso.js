// Transferencia de propiedad de un negocio, en dos pasos: el dueño propone a un miembro y esa persona acepta.
// Hasta que acepta, nada cambia. Al aceptar, el dueño anterior queda como ENCARGADO (con todas las sucursales): sus PC
// siguen funcionando y el negocio no se queda sin caja el día de la transferencia; el nuevo dueño puede quitarlo después.
//
// El mail de cobro (`billing_email`) NO cambia: Mercado Pago cobra al mail de quien pagó. Ver facturacion.js.
import { now } from './util.js';
import { getOrg } from './orgs.js';

export const TRANSFER_TTL = 7 * 24 * 3600;

// Las vencidas dejan de estar "pendientes" (el índice parcial deja una sola pendiente por negocio).
const vencer = (env, t) => env.DB.prepare("UPDATE org_transfers SET status = 'expired', resolved_at = ?1 WHERE status = 'pending' AND exp < ?1").bind(t).run();

export async function iniciarTraspaso(env, { org, fromSub, fromEmail, memberId }, t = now()) {
  const m = Number.isInteger(memberId)
    ? await env.DB.prepare("SELECT * FROM memberships WHERE id = ?1 AND org_id = ?2 AND status = 'active'").bind(memberId, org.id).first() : null;
  if (!m) return { status: 404, error: 'not_found' };
  if (m.user_sub === fromSub || m.role === 'owner') return { status: 400, error: 'self' };
  await vencer(env, t);
  await env.DB.prepare("UPDATE org_transfers SET status = 'cancelled', resolved_at = ?2 WHERE org_id = ?1 AND status = 'pending'").bind(org.id, t).run(); // la nueva reemplaza a la anterior
  await env.DB.prepare(
    `INSERT INTO org_transfers (org_id, from_sub, from_email, to_sub, to_email, status, created_at, exp) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7)`
  ).bind(org.id, fromSub, fromEmail, m.user_sub, m.email, t, t + TRANSFER_TTL).run();
  const fila = await env.DB.prepare("SELECT id FROM org_transfers WHERE org_id = ?1 AND status = 'pending'").bind(org.id).first();
  return { transfer: { id: fila.id, orgId: org.id, toEmail: m.email, exp: t + TRANSFER_TTL } };
}

// Lo pendiente que ve esta persona: lo que mandó como dueña (`ownedOrgIds`) y lo que le mandaron a ella.
export async function listarTraspasos(env, sub, ownedOrgIds, t = now()) {
  await vencer(env, t);
  const outgoing = [];
  for (const id of ownedOrgIds) {
    const o = await env.DB.prepare("SELECT t.*, g.name AS org_name FROM org_transfers t JOIN orgs g ON g.id = t.org_id WHERE t.org_id = ?1 AND t.status = 'pending'").bind(id).first();
    if (o) outgoing.push({ id: o.id, orgId: o.org_id, orgName: o.org_name, toEmail: o.to_email, exp: o.exp, createdAt: o.created_at });
  }
  const incoming = (await env.DB.prepare(
    `SELECT t.*, g.name AS org_name, u.name AS from_name FROM org_transfers t JOIN orgs g ON g.id = t.org_id LEFT JOIN users u ON u.sub = t.from_sub
     WHERE t.to_sub = ?1 AND t.status = 'pending' ORDER BY t.id`).bind(sub).all()).results
    .map((i) => ({ id: i.id, orgId: i.org_id, orgName: i.org_name, fromEmail: i.from_email, fromName: i.from_name || null, exp: i.exp, createdAt: i.created_at }));
  return { outgoing, incoming };
}

export async function aceptarTraspaso(env, { transferId, sub }, t = now()) {
  const tr = Number.isInteger(transferId) ? await env.DB.prepare('SELECT * FROM org_transfers WHERE id = ?1').bind(transferId).first() : null;
  if (!tr) return { status: 404, error: 'not_found' };
  if (tr.to_sub !== sub) return { status: 403, error: 'forbidden' };
  if (tr.status !== 'pending') return { status: 410, error: tr.status };
  if (tr.exp < t) { await vencer(env, t); return { status: 410, error: 'expired' }; }
  const org = await getOrg(env, tr.org_id);
  if (!org || org.owner_sub !== tr.from_sub) return { status: 409, error: 'stale' }; // el dueño ya no es quien la mandó
  const nueva = await env.DB.prepare("SELECT * FROM memberships WHERE org_id = ?1 AND user_sub = ?2 AND status = 'active'").bind(org.id, sub).first();
  if (!nueva) return { status: 409, error: 'not_member' };
  const reclamo = await env.DB.prepare("UPDATE org_transfers SET status = 'accepted', resolved_at = ?2 WHERE id = ?1 AND status = 'pending'").bind(tr.id, t).run();
  if (!reclamo.meta || reclamo.meta.changes !== 1) return { status: 410, error: 'used' };
  // Orden pensado para no dejar nunca un negocio sin dueño: primero se suma el nuevo, después se baja al anterior.
  await env.DB.prepare("UPDATE memberships SET role = 'owner', all_branches = 1 WHERE id = ?1").bind(nueva.id).run();
  await env.DB.prepare('DELETE FROM membership_branches WHERE membership_id = ?1').bind(nueva.id).run();
  await env.DB.prepare('UPDATE orgs SET owner_sub = ?2 WHERE id = ?1').bind(org.id, sub).run();
  await env.DB.prepare("UPDATE memberships SET role = 'manager', all_branches = 1 WHERE org_id = ?1 AND user_sub = ?2").bind(org.id, tr.from_sub).run();
  return { orgId: org.id, orgName: org.name };
}

export async function rechazarTraspaso(env, { transferId, sub }, t = now()) {
  const tr = Number.isInteger(transferId) ? await env.DB.prepare('SELECT * FROM org_transfers WHERE id = ?1').bind(transferId).first() : null;
  if (!tr) return { status: 404, error: 'not_found' };
  if (tr.to_sub !== sub) return { status: 403, error: 'forbidden' };
  if (tr.status !== 'pending') return { status: 410, error: tr.status };
  await env.DB.prepare("UPDATE org_transfers SET status = 'declined', resolved_at = ?2 WHERE id = ?1 AND status = 'pending'").bind(tr.id, t).run();
  return { ok: true };
}

export async function cancelarTraspaso(env, orgId, t = now()) {
  const r = await env.DB.prepare("UPDATE org_transfers SET status = 'cancelled', resolved_at = ?2 WHERE org_id = ?1 AND status = 'pending'").bind(orgId, t).run();
  return r.meta && r.meta.changes === 1 ? { ok: true } : { status: 404, error: 'not_found' };
}

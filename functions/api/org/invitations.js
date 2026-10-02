import { json } from '../../_lib/util.js';
import { sendInvitation } from '../../_lib/notify.js';
import {
  guard, readJson, normEmail, asignacion, crearInvitacion, verInvitacion, aceptarInvitacion, revocarInvitacion, ROLES_INVITABLES,
} from '../../_lib/miembros.js';

const fallo = (r) => json({ error: r.error, ...(r.hint ? { hint: r.hint } : {}) }, r.status);

// Invitar a alguien (solo el dueño). Cuerpo: { orgId, email, role: 'manager'|'employee', branchIds | allBranches }.
// Devuelve el link para compartir; si el mail está configurado (Resend), además se manda y `emailed` es true.
export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'miembros' });
  if (g.error) return g.error;
  const asig = await asignacion(env, g.org.id, b);
  if (asig.error) return json({ error: asig.error }, 400);
  const r = await crearInvitacion(env, { org: g.org, email: normEmail(b.email), role: b.role, all: asig.all, ids: asig.ids });
  if (r.error) return fallo(r);
  const emailed = await sendInvitation(env, { to: r.invitation.email, orgName: g.org.name, inviterName: g.a.name, link: r.link, role: r.invitation.role });
  return json({ ok: true, invitation: r.invitation, link: r.link, emailed });
}

// Vista previa de una invitación (?t=): solo para quien ingresó con el mail invitado.
export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.error) return g.error;
  const r = await verInvitacion(env, { token: new URL(request.url).searchParams.get('t') || '', email: normEmail(g.a.email) });
  return r.error ? fallo(r) : json(r);
}

// Aceptar la invitación con el Google cuyo mail coincide. Cuerpo: { token }.
export async function onRequestAccept({ request, env }) {
  const g = await guard(request, env, { write: true });
  if (g.error) return g.error;
  const b = await readJson(request);
  if (!b || typeof b.token !== 'string' || !/^[0-9a-f]{64}$/.test(b.token)) return json({ error: 'bad_request' }, 400);
  const r = await aceptarInvitacion(env, { token: b.token, sub: g.a.sub, email: normEmail(g.a.email) });
  return r.error ? fallo(r) : json({ ok: true, ...r });
}

// Cancelar una invitación pendiente (solo el dueño). Cuerpo: { orgId, invitationId }.
export async function onRequestRevoke({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'miembros' });
  if (g.error) return g.error;
  const ok = Number.isInteger(b.invitationId) && await revocarInvitacion(env, g.org.id, b.invitationId);
  return ok ? json({ ok: true }) : json({ error: 'not_found' }, 404);
}
export { ROLES_INVITABLES };

import { json, siteUrl } from '../../_lib/util.js';
import { sendTransferNotice } from '../../_lib/notify.js';
import { orgsWith } from '../../_lib/orgs.js';
import { guard, readJson } from '../../_lib/miembros.js';
import { iniciarTraspaso, listarTraspasos, aceptarTraspaso, rechazarTraspaso, cancelarTraspaso } from '../../_lib/traspaso.js';

const fallo = (r) => json({ error: r.error }, r.status);

// Lo pendiente que ve la persona: lo que mandó como dueña y lo que le mandaron a ella.
export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.error) return g.error;
  const duenos = (await orgsWith(env, g.a.sub, 'transferir')).map((o) => o.org.id);
  return json(await listarTraspasos(env, g.a.sub, duenos));
}

// Proponer la transferencia a un miembro (solo el dueño). Cuerpo: { orgId, memberId }. No cambia nada hasta que acepte.
export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'transferir' });
  if (g.error) return g.error;
  const r = await iniciarTraspaso(env, { org: g.org, fromSub: g.a.sub, fromEmail: g.a.email, memberId: b.memberId });
  if (r.error) return fallo(r);
  await sendTransferNotice(env, { to: r.transfer.toEmail, orgName: g.org.name, fromName: g.a.name, site: siteUrl(env) }); // solo un aviso: si falla, igual la verá al entrar
  return json({ ok: true, transfer: r.transfer });
}

// Aceptar la que me mandaron. Cuerpo: { transferId }.
export async function onRequestAccept({ request, env }) {
  const g = await guard(request, env, { write: true });
  if (g.error) return g.error;
  const b = await readJson(request);
  if (!b || !Number.isInteger(b.transferId)) return json({ error: 'bad_request' }, 400);
  const r = await aceptarTraspaso(env, { transferId: b.transferId, sub: g.a.sub });
  return r.error ? fallo(r) : json({ ok: true, ...r });
}

// Rechazar la que me mandaron. Cuerpo: { transferId }.
export async function onRequestDecline({ request, env }) {
  const g = await guard(request, env, { write: true });
  if (g.error) return g.error;
  const b = await readJson(request);
  if (!b || !Number.isInteger(b.transferId)) return json({ error: 'bad_request' }, 400);
  const r = await rechazarTraspaso(env, { transferId: b.transferId, sub: g.a.sub });
  return r.error ? fallo(r) : json({ ok: true });
}

// Retirar la que mandé (solo el dueño). Cuerpo: { orgId }.
export async function onRequestCancel({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'transferir' });
  if (g.error) return g.error;
  const r = await cancelarTraspaso(env, g.org.id);
  return r.error ? fallo(r) : json({ ok: true });
}

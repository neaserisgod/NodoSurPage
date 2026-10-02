import { json } from '../../_lib/util.js';
import { guard, readJson } from '../../_lib/miembros.js';
import { estadoFacturacion, usarMiSuscripcion } from '../../_lib/facturacion.js';

// Quién paga el negocio y en qué estado está (solo el dueño). ?org=ID
export async function onRequestGet({ request, env }) {
  const g = await guard(request, env, { orgId: Number(new URL(request.url).searchParams.get('org')), accion: 'facturacion' });
  if (g.error) return g.error;
  return json(await estadoFacturacion(env, g.org, g.a.email.toLowerCase()));
}

// Pasar el cobro del negocio a MI suscripción. Cuerpo: { orgId, action: 'use_mine' }. El mail sale de la sesión, nunca del pedido.
export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  const g = await guard(request, env, { write: true, orgId: b && b.orgId, accion: 'facturacion' });
  if (g.error) return g.error;
  if (b.action !== 'use_mine') return json({ error: 'bad_request' }, 400);
  const r = await usarMiSuscripcion(env, g.org, g.a.email.toLowerCase());
  return r.error ? json({ error: r.error }, r.status) : json({ ok: true });
}

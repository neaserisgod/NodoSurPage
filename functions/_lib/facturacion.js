// Facturación de un negocio: quién paga y a nombre de quién está la suscripción.
//
// Reglas de seguridad (el cobro es plata y acceso):
//  * `billing_email` solo puede pasar a ser el mail VERIFICADO de la sesión de quien lo pide, nunca uno que venga en el
//    pedido: si no, cualquiera podría apuntar su negocio a la suscripción de otro cliente y usar el sistema sin pagar.
//  * Y solo si ese mail tiene una suscripción vigente: así no se suelta por accidente la que hoy cubre al negocio.
//  * Nadie cancela la suscripción de otra persona (puede cubrir otros negocios suyos): cancela quien paga (cancel.js).
import { listSubscriptions } from './mp.js';
import { enmascarar } from './miembros.js';
import { isPrivilegedSub } from './devices.js';

const vigente = (subs) => subs.some((s) => s.status === 'authorized');

export async function estadoFacturacion(env, org, email) {
  const mine = org.billing_email === email;
  const base = { mine, billingEmail: mine ? org.billing_email : enmascarar(org.billing_email), mpConfigured: Boolean(env.MP_ACCESS_TOKEN) };
  // Negocio de administración o eximido: se trata como pago y sin vencimiento (igual que en descargas, copias y sync).
  if (await isPrivilegedSub(env, org.owner_sub, org.billing_email)) return { ...base, status: 'authorized', subscriptions: [], ownHasSubscription: true };
  if (!env.MP_ACCESS_TOKEN) return { ...base, status: 'unknown', subscriptions: [], ownHasSubscription: false };
  try {
    const subs = await listSubscriptions(env, org.billing_email);
    const propias = mine ? subs : await listSubscriptions(env, email);
    return { ...base, status: vigente(subs) ? 'authorized' : subs.length ? 'inactive' : 'none', ownHasSubscription: vigente(propias),
      subscriptions: subs.map((s) => ({ plan: s.plan, status: s.status, amount: s.amount, nextPayment: s.nextPayment })) };
  } catch { return { ...base, status: 'unknown', mpError: true, subscriptions: [], ownHasSubscription: false }; }
}

// El negocio pasa a cobrarse con la suscripción de quien lo pide (su mail de sesión).
export async function usarMiSuscripcion(env, org, email) {
  if (org.billing_email === email) return { ok: true };
  if (!env.MP_ACCESS_TOKEN) return { status: 503, error: 'not_configured' };
  let subs; try { subs = await listSubscriptions(env, email); } catch { return { status: 502, error: 'mp_error' }; }
  if (!vigente(subs)) return { status: 409, error: 'no_subscription' };
  await env.DB.prepare('UPDATE orgs SET billing_email = ?2 WHERE id = ?1').bind(org.id, email).run();
  return { ok: true };
}

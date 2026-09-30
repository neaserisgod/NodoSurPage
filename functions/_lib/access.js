import { isAdminEmail } from './util.js';
import { listSubscriptions } from './mp.js';

// ¿Puede esta persona descargar el instalador? Administradores y cuentas eximidas siempre;
// el resto necesita una suscripción vigente (autorizada) en Mercado Pago. Ante la duda (Mercado Pago caído) no habilita.
export async function downloadAccess(env, cu) {
  if (!cu.session || cu.gone) return { ok: false, reason: 'no_session' };
  const privileged = isAdminEmail(env, cu.session.email) || Boolean(cu.user && cu.user.exempt);
  if (privileged) return { ok: true, privileged: true };
  if (!env.MP_ACCESS_TOKEN) return { ok: false, reason: 'mp_error' };
  try {
    const subs = await listSubscriptions(env, cu.session.email);
    return subs.some((s) => s.status === 'authorized') ? { ok: true, privileged: false } : { ok: false, reason: 'no_subscription' };
  } catch { return { ok: false, reason: 'mp_error' }; }
}

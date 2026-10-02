// Quién puede qué sobre descargas y copias de seguridad.
//
// El acceso se calcula por NEGOCIO y sucursal, no por persona: lo paga el negocio (su mail de cobro,
// `billing_email`, que no cambia al transferir la propiedad) y lo que cada miembro puede hacer lo decide
// permisos.js. Quien no pertenece a ningún negocio (cuentas anteriores a este modelo) sigue entrando por la
// suscripción de su propio mail, como siempre.
import { isAdminEmail, now } from './util.js';
import { listSubscriptions } from './mp.js';
import { isPrivilegedSub } from './devices.js';
import { orgsWith, getOrg, getMembership } from './orgs.js';
import { puede } from './permisos.js';
import { VENTANA_RESTAURAR_DIAS } from './backups.js';

const DAY = 86400;

// ¿Puede esta persona descargar el instalador? Administradores y cuentas eximidas siempre; el resto necesita una
// suscripción vigente (autorizada) en Mercado Pago: la propia, o la de un negocio donde su rol permite descargar.
// Ante la duda (Mercado Pago caído) no habilita.
export async function downloadAccess(env, cu) {
  if (!cu.session || cu.gone) return { ok: false, reason: 'no_session' };
  const privileged = isAdminEmail(env, cu.session.email) || Boolean(cu.user && cu.user.exempt);
  if (privileged) return { ok: true, privileged: true };
  if (!env.MP_ACCESS_TOKEN) return { ok: false, reason: 'mp_error' };
  const mails = new Set([cu.session.email]);
  for (const { org } of await orgsWith(env, cu.session.sub, 'descargar')) {
    if (await isPrivilegedSub(env, org.owner_sub, org.billing_email)) return { ok: true, privileged: false }; // negocio de prueba (eximido / admin)
    mails.add(org.billing_email);
  }
  let fallo = false;
  for (const mail of mails) {
    try { if ((await listSubscriptions(env, mail)).some((s) => s.status === 'authorized')) return { ok: true, privileged: false }; }
    catch { fallo = true; }
  }
  return { ok: false, reason: fallo ? 'mp_error' : 'no_subscription' };
}

// Sobre qué copias actúa quien llama. Devuelve el alcance que entienden listBackups / getBackup / saveBackup,
// más `billingEmail` (con qué mail se verifica el pago) y `allowed` (si su rol permite tocar copias).
//  * PC vinculada a un negocio: el negocio y la sucursal de esa PC.
//  * Sesión web: el negocio donde su rol permite ver copias (`orgId` elige uno si tiene varios); un encargado
//    ve solo sus sucursales, la dueña todas.
//  * Sin negocio (cuentas anteriores): sus propias copias, como siempre.
export async function backupScope(env, actor, { orgId } = {}) {
  const d = actor.device;
  if (d && d.owner_org) {
    const org = await getOrg(env, d.owner_org); const m = await getMembership(env, d.owner_org, actor.sub);
    if (!org || !m || m.status !== 'active') return { denied: true, allowed: false };
    return { orgId: org.id, branchIds: [d.branch_id], billingEmail: org.billing_email, ownerSub: org.owner_sub, allowed: puede(m, 'copias', d.branch_id) };
  }
  if (!d) {
    const candidatos = await orgsWith(env, actor.sub, 'copias');
    const elegido = orgId ? candidatos.find((c) => c.org.id === orgId) : candidatos[0];
    if (orgId && !elegido) return { denied: true, allowed: false };
    if (elegido) {
      const m = elegido.membership; const todas = m.role === 'owner' || m.all_branches;
      return { orgId: elegido.org.id, branchIds: todas ? null : m.branches, billingEmail: elegido.org.billing_email, ownerSub: elegido.org.owner_sub, allowed: true };
    }
  }
  return { sub: actor.sub, billingEmail: actor.email, allowed: true };
}

// {upload, restore} o {error:'mp_error'} si no se puede verificar (ante la duda, no).
export async function backupAccess(env, actor, scope) {
  if (scope.denied || !scope.allowed) return { upload: false, restore: false };
  if (await isPrivilegedSub(env, actor.sub, actor.email)) return { upload: true, restore: true, privileged: true };
  if (scope.ownerSub && await isPrivilegedSub(env, scope.ownerSub, scope.billingEmail)) return { upload: true, restore: true, privileged: true }; // negocio de prueba
  if (!env.MP_ACCESS_TOKEN) return { error: 'mp_error' };
  let subs;
  try { subs = await listSubscriptions(env, scope.billingEmail); } catch { return { error: 'mp_error' }; }
  if (subs.some((s) => s.status === 'authorized')) return { upload: true, restore: true };
  const limite = now() - VENTANA_RESTAURAR_DIAS * DAY;
  const reciente = subs.some((s) => ['cancelled', 'canceled', 'paused', 'pending'].includes(s.status)
    && Date.parse(s.modified || s.since || '') / 1000 >= limite);
  return { upload: false, restore: reciente };
}

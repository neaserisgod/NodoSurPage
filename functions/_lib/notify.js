// Aviso previo al borrado. Solo se considera "avisado" si el mail realmente salió.
// Requiere RESEND_API_KEY y MAIL_FROM (dominio verificado en Resend). Sin eso => no hay aviso => no hay borrado.
import { plantillaMail } from './mail_template.js';

export const notifierReady = (env) => Boolean(env.RESEND_API_KEY && env.MAIL_FROM);

// Los avisos de BORRADO son opt-in aparte (AVISOS_BORRADO=on): tener Resend configurado alcanza para las invitaciones y
// las transferencias, pero NO para que el cron mande "tu cuenta se eliminará en 3 días" a cuentas inactivas. Es un mail
// que le llega a gente real y no se puede desmandar, así que no se activa solo. Solo vale el valor exacto "on" (igual que AUTO_DELETE).
export const deletionNoticesReady = (env) => notifierReady(env) && env.AVISOS_BORRADO === 'on';

export async function sendDeletionNotice(env, user, deleteAtEpoch) {
  if (!notifierReady(env)) return false;
  const site = (env.SITE_URL || 'https://horsepos.com').replace(/\/$/, '');
  const fecha = new Date(deleteAtEpoch * 1000).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
  const nombre = String(user.name || '').split(' ')[0] || 'hola';
  const { html, text } = plantillaMail({
    preheader: `Tu cuenta se elimina el ${fecha} si no ingresás antes.`,
    titulo: 'Tu cuenta de Nodo Sur se eliminará en 3 días',
    intro: `Hola ${nombre}, tu cuenta no tiene una suscripción activa ni uso reciente, así que se eliminará el ${fecha}.`,
    boton: { texto: 'Ingresar para conservarla', url: `${site}/ingresar/` },
    nota: `Si preferís suscribirte, podés hacerlo en ${site}/pagar/ antes de esa fecha. Si no querés seguir, no tenés que hacer nada. Si tenés dudas, respondé este mail o escribime por WhatsApp.`,
    sitio: site,
  });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [user.email], subject: 'Tu cuenta de Nodo Sur se eliminará en 3 días', html, text }),
    });
    return res.ok;
  } catch { return false; }
}

// Invitación a un negocio. Devuelve true solo si el mail realmente salió; si no, el dueño copia el link y se lo manda.
export async function sendInvitation(env, { to, orgName, inviterName, link, role }) {
  if (!notifierReady(env)) return false;
  const quien = String(inviterName || '').trim() || 'El dueño';
  const rol = role === 'manager' ? 'encargado' : 'empleado';
  const { html, text } = plantillaMail({
    preheader: `${quien} te invitó a sumarte a "${orgName}" como ${rol}.`,
    titulo: `Te invitaron a ${orgName}`,
    intro: `${quien} te invitó a sumarte como ${rol} a «${orgName}» en Nodo Sur.`,
    filas: [['Negocio', orgName], ['Tu rol', rol], ['Entrás con', to]],
    boton: { texto: 'Aceptar la invitación', url: link },
    nota: `Ingresá con ESTE mismo mail (${to}): si usás otro, no vas a poder aceptar. El enlace vence en 7 días. Si no esperabas esta invitación, ignorá este mail y no pasa nada.`,
    sitio: (env.SITE_URL || 'https://horsepos.com').replace(/\/$/, ''),
  });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: `Te invitaron a ${orgName} en Nodo Sur`, html, text }),
    });
    return res.ok;
  } catch { return false; }
}

// Aviso de que alguien quiere transferirte un negocio. Es solo un aviso: la decisión se toma dentro del sitio.
export async function sendTransferNotice(env, { to, orgName, fromName, site }) {
  if (!notifierReady(env)) return false;
  const quien = String(fromName || '').trim() || 'El dueño';
  const { html, text } = plantillaMail({
    preheader: `${quien} quiere transferirte la propiedad de "${orgName}".`,
    titulo: `Te quieren transferir «${orgName}»`,
    intro: `${quien} quiere transferirte la propiedad de «${orgName}» en Nodo Sur. Si aceptás, pasás a administrar el negocio (equipo, sucursales y facturación) y ${quien} queda como encargado.`,
    filas: [['Negocio', orgName], ['De', quien]],
    boton: { texto: 'Ver la propuesta', url: `${site}/negocio/` },
    nota: 'Entrá con este mismo mail para aceptar o rechazar. La propuesta vence en 7 días. Si no la esperabas, no hagas nada: sin tu aceptación no cambia nada.',
    sitio: site,
  });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: `Te quieren transferir "${orgName}" en Nodo Sur`, html, text }),
    });
    return res.ok;
  } catch { return false; }
}

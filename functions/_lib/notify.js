// Aviso previo al borrado. Solo se considera "avisado" si el mail realmente salió.
// Requiere RESEND_API_KEY y MAIL_FROM (dominio verificado en Resend). Sin eso => no hay aviso => no hay borrado.
export const notifierReady = (env) => Boolean(env.RESEND_API_KEY && env.MAIL_FROM);

export async function sendDeletionNotice(env, user, deleteAtEpoch) {
  if (!notifierReady(env)) return false;
  const site = (env.SITE_URL || 'https://horsepos.com').replace(/\/$/, '');
  const fecha = new Date(deleteAtEpoch * 1000).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
  const nombre = String(user.name || '').split(' ')[0] || 'hola';
  const text = `Hola ${nombre},\n\nTu cuenta de Nodo Sur no tiene una suscripción activa ni uso reciente, así que se eliminará el ${fecha}.\n\n` +
    `Para conservarla, ingresá en ${site}/ingresar/ o suscribite en ${site}/pagar/ antes de esa fecha.\n\n` +
    `Si no querés seguir, no tenés que hacer nada. Si tenés dudas, respondé este mail o escribime por WhatsApp.\n\nNodo Sur`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [user.email], subject: 'Tu cuenta de Nodo Sur se eliminará en 3 días', text }),
    });
    return res.ok;
  } catch { return false; }
}

// Invitación a un negocio. Devuelve true solo si el mail realmente salió; si no, el dueño copia el link y se lo manda.
export async function sendInvitation(env, { to, orgName, inviterName, link, role }) {
  if (!notifierReady(env)) return false;
  const quien = String(inviterName || '').trim() || 'El dueño';
  const rol = role === 'manager' ? 'encargado' : 'empleado';
  const text = `Hola,\n\n${quien} te invitó a sumarte como ${rol} a "${orgName}" en Nodo Sur.\n\n` +
    `Para aceptar, ingresá con ESTE mismo mail (${to}) en: ${link}\n\n` +
    `El link vence en 7 días. Si no esperabas esta invitación, ignorá este mail y no pasa nada.\n\nNodo Sur`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: `Te invitaron a ${orgName} en Nodo Sur`, text }),
    });
    return res.ok;
  } catch { return false; }
}

// Aviso de que alguien quiere transferirte un negocio. Es solo un aviso: la decisión se toma dentro del sitio.
export async function sendTransferNotice(env, { to, orgName, fromName, site }) {
  if (!notifierReady(env)) return false;
  const quien = String(fromName || '').trim() || 'El dueño';
  const text = `Hola,\n\n${quien} quiere transferirte la propiedad de "${orgName}" en Nodo Sur.\n\n` +
    `Si aceptás, pasás a ser quien administra el negocio (equipo, sucursales y facturación) y ${quien} queda como encargado. ` +
    `Podés aceptar o rechazar entrando en ${site}/negocio/ con este mismo mail. La propuesta vence en 7 días.\n\n` +
    `Si no la esperabas, no hagas nada: sin tu aceptación no cambia nada.\n\nNodo Sur`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: `Te quieren transferir "${orgName}" en Nodo Sur`, text }),
    });
    return res.ok;
  } catch { return false; }
}

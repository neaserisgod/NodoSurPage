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

// Cada negocio paga su plan (El dueño, 2026-10-13: una misma cuenta de Google puede tener varios negocios —un almacén, una
// barbería, un emprendimiento de belleza— y cada uno paga lo suyo).
//
// Mercado Pago no dice a qué negocio corresponde cada suscripción: se cobra a un mail (`billing_email`). Entonces se cuenta: si
// un mail paga N planes vigentes, cubre a sus N negocios más viejos (por orden de creación). El que se crea después queda sin
// plan hasta que se pague otro. Así el negocio que ya andaba no pierde nada por crear uno nuevo, y al dar de baja una
// suscripción se queda sin plan el más nuevo.
//
// Los planes con bot se reparten igual entre esos negocios cubiertos: el bot lo tienen los primeros M cubiertos, con M = planes
// vigentes que incluyen el bot.
import { PLANES_CON_BOT } from './mp.js';

const vigentes = (subs) => subs.filter((s) => s.status === 'authorized');

// Los negocios que se cobran a [email], del más viejo al más nuevo. Sin la tabla (instalación vieja), ninguno.
export async function negociosDelMail(env, email) {
  try {
    return (await env.DB.prepare('SELECT id FROM orgs WHERE billing_email = ?1 ORDER BY id').bind(String(email || '').trim().toLowerCase()).all())
      .results.map((r) => r.id);
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return [];
    throw e;
  }
}

// ¿Qué cubren las suscripciones [subs] (las del mail de cobro) para el negocio [orgId]?
// { pago, bot, planes, negocios, posicion }: `posicion` es su lugar entre los negocios de ese mail (0 = el más viejo).
export async function planDelNegocio(env, org, subs) {
  const ids = await negociosDelMail(env, org.billing_email);
  const posicion = Math.max(0, ids.indexOf(org.id));
  const pagos = vigentes(subs);
  const conBot = pagos.filter((s) => PLANES_CON_BOT.has(s.plan)).length;
  return { pago: posicion < pagos.length, bot: posicion < pagos.length && posicion < conBot, planes: pagos.length, negocios: Math.max(ids.length, 1), posicion };
}

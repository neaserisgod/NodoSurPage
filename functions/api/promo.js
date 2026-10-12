import { json } from '../_lib/util.js';
import { getPromo } from '../_lib/db.js';
import { PLAN_CATALOG } from '../_lib/plans.js';

// Público: ¿está activo el precio de fundador? (lo consulta la página de pago). Nunca falla: ante la duda, activo.
// `directo`: todos los planes tienen su link de Mercado Pago con el precio de fundador (promoHref). Mientras falte
// alguno, el sitio no muestra el fundador: así nadie termina derivado a WhatsApp en medio de la prueba.
export async function onRequestGet({ env }) {
  return json({ activa: await getPromo(env), directo: Object.values(PLAN_CATALOG).every((p) => Boolean(p.promoHref)) });
}

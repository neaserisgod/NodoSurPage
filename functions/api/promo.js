import { json } from '../_lib/util.js';
import { getPromo } from '../_lib/db.js';

// Público: ¿está activo el precio de fundador? (lo consulta la página de pago). Nunca falla: ante la duda, activo.
export async function onRequestGet({ env }) {
  return json({ activa: await getPromo(env) });
}

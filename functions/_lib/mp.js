// Cliente mínimo de Mercado Pago (suscripciones). El token vive en env.MP_ACCESS_TOKEN.
const API = 'https://api.mercadopago.com';

// Planes propios: solo se muestran/cancelan suscripciones de estos planes.
export const PLANS = {
  '6fe282d944ef4c018cb7904ce9e122f8': 'Sistema POS',
  '7652202c076c4cc180c72ade28d52924': 'Sistema + Bot',
  'e37aac4650334685873aa8e3920de4c0': 'Solo el bot',
};

async function mp(env, path, init = {}) {
  const go = () => fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${String(env.MP_ACCESS_TOKEN).trim()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  let res = await go();
  // Mercado Pago limita la frecuencia (429): un único reintento corto, solo para lecturas.
  if (res.status === 429 && (!init.method || init.method === 'GET')) {
    await new Promise((r) => setTimeout(r, env.MP_RETRY_MS ?? 900));
    res = await go();
  }
  return res;
}

const mapSub = (r) => ({
  id: String(r.id),
  payerEmail: String(r.payer_email || '').trim().toLowerCase(),
  plan: PLANS[r.preapproval_plan_id] || r.reason || 'Suscripción',
  status: r.status,
  amount: r.auto_recurring && r.auto_recurring.transaction_amount,
  currency: (r.auto_recurring && r.auto_recurring.currency_id) || 'ARS',
  frequency: r.auto_recurring && r.auto_recurring.frequency,
  frequencyType: r.auto_recurring && r.auto_recurring.frequency_type,
  nextPayment: r.next_payment_date || null,
  since: r.date_created || null,
  modified: r.last_modified || r.date_created || null,
});

// Suscripciones cuyo mail de pago == mail verificado de Google, de nuestros planes.
export async function listSubscriptions(env, email) {
  const res = await mp(env, `/preapproval/search?payer_email=${encodeURIComponent(email)}&limit=20`);
  if (!res.ok) await failWith(res);
  const data = await res.json();
  const want = email.trim().toLowerCase();
  return (data.results || [])
    .filter((r) => PLANS[r.preapproval_plan_id] && String(r.payer_email || '').trim().toLowerCase() === want)
    .map(mapSub);
}

export async function listPayments(env, subId) {
  try {
    const res = await mp(env, `/authorized_payments/search?preapproval_id=${encodeURIComponent(subId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || [])
      .map((p) => ({ date: p.debit_date || p.date_created || null, amount: p.transaction_amount, status: p.status }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 6);
  } catch { return []; }
}

export async function cancelSubscription(env, id) {
  for (const status of ['cancelled', 'canceled']) {
    const res = await mp(env, `/preapproval/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status }) });
    if (res.ok) return { ok: true };
    if (res.status !== 400) return { ok: false, status: res.status };
  }
  return { ok: false, status: 400 };
}

// Todos los suscriptores de nuestros planes (para el panel de administración y la limpieza).
export class MpError extends Error {
  constructor(status, detail) { super(`mp_${status}`); this.status = status; this.detail = detail; }
}
async function failWith(res) {
  let detail = '';
  try { const j = await res.json(); detail = String(j.message || j.error || '').slice(0, 160); } catch { /* sin cuerpo */ }
  throw new MpError(res.status, detail);
}

// Memoria breve por instancia: el panel no vuelve a pedir el listado en cada recarga.
const CACHE = new Map();
const FRESH_MS = 60_000, STALE_MS = 10 * 60_000;
// Estado de pago por mail para el camino caliente (cada sincronización, cada cobro con terminal, cada consulta de una orden):
// sin esto, cada pedido de cada dispositivo hacía una consulta en vivo a Mercado Pago (cientos de ms y, con varios equipos, el
// límite de frecuencia). Se recuerda 2 minutos; si Mercado Pago falla se sigue con lo último que se supo hasta 15 minutos, para
// que un tropiezo de ellos no corte los cobros del local. Una baja se nota en minutos, no al instante: es lo aceptable acá.
// `MP_CACHE_MS=0` apaga la memoria (las pruebas y quien quiera verificar en vivo).
const SUBS = new Map();
const SUBS_FRESCO_MS = 2 * 60_000, SUBS_VIEJO_MS = 15 * 60_000;
export const clearMpCache = () => { CACHE.clear(); SUBS.clear(); };
export async function listSubscriptionsCached(env, email) {
  const vida = env.MP_CACHE_MS === undefined ? SUBS_FRESCO_MS : Number(env.MP_CACHE_MS);
  const clave = String(email || '').trim().toLowerCase();
  const hit = SUBS.get(clave), t = Date.now();
  if (vida > 0 && hit && t - hit.at < vida) return hit.data;
  try {
    const data = await listSubscriptions(env, email);
    if (vida > 0) SUBS.set(clave, { at: t, data });
    return data;
  } catch (e) {
    if (vida > 0 && hit && t - hit.at < SUBS_VIEJO_MS) return hit.data; // Mercado Pago falló: lo último que se supo, por poco tiempo
    throw e;
  }
}

// `fresh: true` (limpieza automática) ignora la memoria: nunca decide con datos viejos.
export async function listAllSubscribers(env, { fresh = false } = {}) {
  const key = String(env.MP_ACCESS_TOKEN || '').trim();
  const hit = CACHE.get(key), t = Date.now();
  if (!fresh && hit && t - hit.at < FRESH_MS) return hit.data;
  try {
    const data = await fetchAllSubscribers(env);
    CACHE.set(key, { at: t, data });
    return data;
  } catch (e) {
    // Si Mercado Pago pide esperar y hay datos recientes, se muestran esos (solo en pantalla, nunca para borrar).
    if (!fresh && e.status === 429 && hit && t - hit.at < STALE_MS) { const data = hit.data.slice(); data.stale = true; return data; }
    throw e;
  }
}

async function fetchAllSubscribers(env) {
  const out = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const res = await mp(env, `/preapproval/search?limit=50&offset=${offset}`);
    if (!res.ok) await failWith(res);
    const rows = (await res.json()).results || [];
    out.push(...rows.filter((r) => PLANS[r.preapproval_plan_id]).map(mapSub));
    if (rows.length < 50) break;
  }
  return out;
}

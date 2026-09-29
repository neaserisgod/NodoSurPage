// Cliente mínimo de Mercado Pago (suscripciones). El token vive en env.MP_ACCESS_TOKEN.
const API = 'https://api.mercadopago.com';

// Planes propios: solo se muestran/cancelan suscripciones de estos planes.
export const PLANS = {
  '6fe282d944ef4c018cb7904ce9e122f8': 'Sistema POS',
  '7652202c076c4cc180c72ade28d52924': 'Sistema + Bot',
  'e37aac4650334685873aa8e3920de4c0': 'Solo el bot',
};

async function mp(env, path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
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
});

// Suscripciones cuyo mail de pago == mail verificado de Google, de nuestros planes.
export async function listSubscriptions(env, email) {
  const res = await mp(env, `/preapproval/search?payer_email=${encodeURIComponent(email)}&limit=20`);
  if (!res.ok) throw new Error(`mp_search_${res.status}`);
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
export async function listAllSubscribers(env) {
  const out = [];
  for (const planId of Object.keys(PLANS)) {
    for (let offset = 0; offset < 1000; offset += 50) {
      const res = await mp(env, `/preapproval/search?preapproval_plan_id=${planId}&limit=50&offset=${offset}`);
      if (!res.ok) throw new Error(`mp_search_${res.status}`);
      const rows = (await res.json()).results || [];
      out.push(...rows.filter((r) => r.preapproval_plan_id === planId).map(mapSub));
      if (rows.length < 50) break;
    }
  }
  return out;
}

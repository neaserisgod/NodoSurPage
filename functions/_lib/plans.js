// Catálogo de planes y destinos de pago. Los links de Mercado Pago viven SOLO acá (servidor):
// el sitio no los expone, así que nadie llega a pagar sin pasar por /api/checkout (que exige sesión).
export const WA = 'https://wa.me/5492944796044?text=';
export const ALTA_URL = 'https://mpago.la/2UnGAqA';
const MESES = 6;
const fmt = (n) => '$ ' + n.toLocaleString('es-AR');

// promoHref vacío = el precio de fundador se pide por WhatsApp.
export const PLAN_CATALOG = {
  pos: { nombre: 'Sistema POS', precio: 35000, promo: 24500, alta: false,
    href: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=6fe282d944ef4c018cb7904ce9e122f8', promoHref: '' },
  'pos-bot': { nombre: 'Sistema + Bot', precio: 60000, promo: 42000, alta: true,
    href: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=7652202c076c4cc180c72ade28d52924', promoHref: '' },
  bot: { nombre: 'Solo el bot', precio: 35000, promo: 24500, alta: true,
    href: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=e37aac4650334685873aa8e3920de4c0', promoHref: '' },
  // Nodo Sur Servicios (turnos) con el bot de WhatsApp adentro de la app: sin alta, se instala sola (El dueño, 2026-10-10).
  emprendedor: { nombre: 'Emprendedor', precio: 18000, promo: 12600, alta: false,
    href: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=d28fa6d60f614b8c9a16bfc78ac31f0c', promoHref: '' },
};

export const isPlan = (k) => typeof k === 'string' && Object.hasOwn(PLAN_CATALOG, k);

// A dónde se manda a alguien ya identificado para pagar `plan`.
export function checkoutTarget(plan, promoOn) {
  const p = PLAN_CATALOG[plan];
  if (promoOn) {
    if (p.promoHref) return p.promoHref;
    return WA + encodeURIComponent(`Hola, quiero el precio de fundador con el plan ${p.nombre} (${fmt(p.promo)} por mes durante ${MESES} meses).`);
  }
  return p.href;
}

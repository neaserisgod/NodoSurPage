// Cada negocio paga su plan (El dueño, 2026-10-13: una misma cuenta de Google puede tener varios negocios —un almacén, una
// barbería, un emprendimiento de belleza— y cada uno paga lo suyo).
//
// Mercado Pago no dice a qué negocio corresponde cada suscripción: se cobra a un mail (`billing_email`). Entonces se cuenta: si
// un mail paga N planes vigentes, cubre a sus N negocios más viejos (por orden de creación). El que se crea después queda sin
// plan hasta que se pague otro. Así el negocio que ya andaba no pierde nada por crear uno nuevo, y al dar de baja una
// suscripción se queda sin plan el más nuevo.
//
// Cada plan cubre su producto (El dueño, 2026-10-19, `productos.js` y `Nodo-Sur-Pos/docs/PLAN-CUENTAS.md`): Estudio y Gastro,
// un negocio de su producto con el bot; Gestión, un negocio de Gestión y además, incluido, uno de Estudio o de Gastro con bot.
// El reparto sigue siendo del más viejo al más nuevo: cada negocio toma el lugar libre más justo para él (uno de su producto
// antes que el incluido, que puede servirle a otro). Un negocio sin producto todavía (de antes de esto) toma cualquier plan,
// como siempre, pero no el incluido: ese es solo para Estudio o Gastro.
import { PLANES_CON_BOT } from './mp.js';

const vigentes = (subs) => subs.filter((s) => s.status === 'authorized');

// Qué producto cubre cada plan, por el nombre que le da `mp.js` (`PLANS`). Un plan que no está acá (Solo el bot, uno viejo)
// cubre cualquiera, como antes. Nodo Gastro todavía no tiene plan en Mercado Pago: cuando lo tenga, su nombre en `PLANS` va acá.
const CUBRE = {
  'Sistema POS': { productos: ['gestion'], incluye: true },
  'Sistema + Bot': { productos: ['gestion'], incluye: true },
  Emprendedor: { productos: ['estudio'] },
  'Nodo Gastro': { productos: ['gastro'] },
};
const INCLUIDO = ['estudio', 'gastro'];

// ¿Una suscripción de [plan] sirve para un negocio de [producto]? Para las descargas: el instalador de una app pide un plan
// que cubra su producto (el de Gestión también deja bajar Estudio y Gastro, por el negocio incluido).
export function planCubreProducto(plan, producto) {
  const c = CUBRE[plan];
  return !producto || !c || c.productos.includes(producto) || Boolean(c.incluye && INCLUIDO.includes(producto));
}

// Los lugares que dan las suscripciones vigentes: { acepta: [productos] | null (cualquiera), bot, incluido }.
function lugares(subs) {
  const out = [];
  for (const s of vigentes(subs)) {
    const c = CUBRE[s.plan];
    out.push({ acepta: c ? c.productos : null, bot: PLANES_CON_BOT.has(s.plan) || Boolean(c && !c.incluye), incluido: false });
    if (c && c.incluye) out.push({ acepta: INCLUIDO, bot: true, incluido: true });
  }
  return out;
}

// Reparte los lugares entre [negocios] ({ id, producto }, del más viejo al más nuevo). Map(id → lugar) de los cubiertos.
export function repartir(negocios, subs) {
  const libres = lugares(subs);
  const tam = (l) => (l.acepta ? l.acepta.length : Infinity);
  const out = new Map();
  for (const n of negocios) {
    const sirven = libres.filter((l) => (n.producto
      ? !l.acepta || l.acepta.includes(n.producto)
      : !l.incluido));
    if (!sirven.length) continue;
    // Sin producto: primero los que cubren cualquiera (planes viejos). Con producto: el más justo; a igual, el que trae bot.
    sirven.sort((a, b) => (n.producto ? tam(a) - tam(b) : tam(b) - tam(a)) || (b.bot - a.bot));
    const l = sirven[0];
    libres.splice(libres.indexOf(l), 1); out.set(n.id, l);
  }
  return out;
}

const negociosConProducto = async (env, email) => {
  try {
    return (await env.DB.prepare('SELECT * FROM orgs WHERE lower(trim(billing_email)) = ?1 ORDER BY id').bind(String(email || '').trim().toLowerCase()).all())
      .results.map((r) => ({ id: r.id, producto: r.producto ?? null }));
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return [];
    throw e;
  }
};

// Los negocios que se cobran a [email], del más viejo al más nuevo. Sin la tabla (instalación vieja), ninguno.
export async function negociosDelMail(env, email) {
  return (await negociosConProducto(env, email)).map((n) => n.id);
}

// ¿Qué cubren las suscripciones [subs] (las del mail de cobro) para el negocio [org]?
// { pago, bot, incluido, planes, negocios }. `incluido`: lo cubre el negocio que trae el plan de Gestión.
export async function planDelNegocio(env, org, subs) {
  const negocios = await negociosConProducto(env, org.billing_email);
  // Si el negocio no figura entre los del mail (no debería pasar), cuenta como el último: nunca queda cubierto gratis.
  const esta = negocios.some((n) => n.id === org.id);
  const lista = esta ? negocios : [...negocios, { id: org.id, producto: org.producto ?? null }];
  const l = repartir(lista, subs).get(org.id);
  return { pago: Boolean(l), bot: Boolean(l && l.bot), incluido: Boolean(l && l.incluido), planes: vigentes(subs).length, negocios: Math.max(lista.length, 1) };
}

// ¿Quedaría cubierto [org] si pasara a cobrarse a [email]? Como el más nuevo de ese mail: no le saca el plan a ninguno.
export async function cubririaA(env, org, email, subs) {
  const lista = [...(await negociosConProducto(env, email)).filter((n) => n.id !== org.id), { id: org.id, producto: org.producto ?? null }];
  return repartir(lista, subs).has(org.id);
}

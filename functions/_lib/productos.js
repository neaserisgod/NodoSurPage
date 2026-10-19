// De qué producto es cada negocio (El dueño, 2026-10-19, `Nodo-Sur-Pos/docs/PLAN-CUENTAS.md`): Nodo Gestión (almacén,
// kiosco), Nodo Estudio (turnos) o Nodo Gastro (rotisería). Uno solo y fijo: un almacén con rotisería son dos negocios. Cada
// app entra solo a los negocios de su producto, y el cobro (`plan_por_negocio.js`) mira el producto para saber qué plan
// cubre a cada negocio.
//
// Un negocio sin producto (los de antes de esto) toma el de la primera app que se vincula a él, y mientras tanto se trata como
// siempre: nada que ande deja de andar.
import { addColumn, once } from './util.js';

export const PRODUCTOS = { gestion: 'Nodo Gestión', estudio: 'Nodo Estudio', gastro: 'Nodo Gastro' };

// La app manda su edición tal cual la llama ella (`Nodo-Sur-Pos/lib/edicion.dart`). Lo que no se reconoce (una app vieja
// que no la manda, el bot) es null: no se asigna ni se controla nada.
const DE_EDICION = { almacen: 'gestion', servicios: 'estudio', gastronomia: 'gastro' };
export const productoDeEdicion = (e) => (typeof e === 'string' && Object.hasOwn(DE_EDICION, e) ? DE_EDICION[e] : null);

// De qué producto es cada instalador (`releases.js`, PLATFORMS): los de siempre son del almacén.
export const productoDePlataforma = (p) => (typeof p !== 'string' ? null : p.endsWith('-servicios') ? 'estudio' : p.endsWith('-gastronomia') ? 'gastro' : 'gestion');

// Solo la app del almacén vincula PC (las de Estudio y Gastro en Windows entran como celular): un negocio con una PC vinculada
// es de Gestión. Así La Plazoleta no puede quedar marcada por error como de otro producto al probar ahí otra app.
export const ensureProducto = (env) => once(env, 'orgs_producto', async () => {
  await addColumn(env, 'orgs', 'producto TEXT');
  await marcarGestionPorPc(env);
});
export async function marcarGestionPorPc(env) {
  try {
    await env.DB.prepare(`UPDATE orgs SET producto = 'gestion' WHERE producto IS NULL AND id IN
      (SELECT owner_org FROM devices WHERE kind = 'pc' AND owner_org IS NOT NULL)`).run();
  } catch (e) { if (!/no such (table|column)/i.test(String(e && e.message))) throw e; }
}

// ¿Puede una app de [producto] usar [org]? Sí si es del mismo, o si el negocio todavía no tiene (lo toma ahora).
// Sin producto (app vieja, bot) siempre sí. Devuelve { ok } o { error: 'otro_producto', producto, nombre, status }.
export async function usarConProducto(env, org, producto) {
  if (!producto) return { ok: true };
  await ensureProducto(env);
  const actual = (await env.DB.prepare('SELECT producto FROM orgs WHERE id = ?1').bind(org.id).first())?.producto ?? null;
  if (actual == null) {
    // Condicional: si otra app lo tomó recién, gana la primera y esta recibe `otro_producto`.
    await env.DB.prepare('UPDATE orgs SET producto = ?2 WHERE id = ?1 AND producto IS NULL').bind(org.id, producto).run();
    const ahora = (await env.DB.prepare('SELECT producto FROM orgs WHERE id = ?1').bind(org.id).first()).producto;
    return ahora === producto ? { ok: true } : otro(ahora);
  }
  return actual === producto ? { ok: true } : otro(actual);
}
const otro = (p) => ({ error: 'otro_producto', producto: p, nombre: PRODUCTOS[p] || p, status: 409 });

// Para las listas de "elegí tu negocio": los que esta app puede usar (los suyos y los que todavía no tienen producto).
export const sirveParaProducto = (org, producto) => !producto || org.producto == null || org.producto === producto;

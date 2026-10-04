import { json } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { ensureMpTables, mpFetch } from '../../_lib/mp_conexion.js';

// Prueba de solo lectura (El dueño, 2026-10-04: "probá rapidito el a"): ¿se puede leer el saldo de la cuenta de Mercado Pago
// de un negocio con la conexión que ya guardamos? Prueba los dos caminos posibles para el saldo real en el cierre:
//  - el saldo directo (`/users/{id}/mercadopago_account/balance`), que Mercado Pago está dando de baja y suele negar;
//  - el reporte de Liquidaciones (`/v1/account/release_report/...`), el camino oficial: acá solo se LISTAN los reportes y se
//    lee la configuración, no se genera nada.
// Solo GET a Mercado Pago, solo administradores de la plataforma, y la respuesta nunca lleva el token.
const API = 'https://api.mercadopago.com';

// Cómo acredita la cuenta: en los últimos cobros aprobados, cuánto pasa entre que se aprueba el cobro y que la plata queda
// disponible (`money_release_date`). Una cuenta "al instante" da todo en minutos; una a días deja afuera del disponible del
// reporte de Liquidaciones lo cobrado y no liberado, y el saldo real en el cierre tiene que sumarlo aparte.
export function acreditacionDe(r) {
  if (!r || r.status !== 200) return { status: r ? r.status : null };
  const horas = [];
  for (const p of (r.j && r.j.results) || []) {
    const a = Date.parse(p.date_approved), l = Date.parse(p.money_release_date);
    if (Number.isFinite(a) && Number.isFinite(l)) horas.push(Math.max(0, (l - a) / 3600000));
  }
  if (!horas.length) return { status: 200, cobros: 0 };
  const alInstante = horas.filter((h) => h < 1).length;
  return { status: 200, cobros: horas.length, alInstante, aDias: horas.length - alInstante, demoraMaximaHoras: Math.round(Math.max(...horas)) };
}

const recortar = (j) => {
  const s = JSON.stringify(j ?? null);
  return s.length > 4000 ? `${s.slice(0, 4000)}…` : JSON.parse(s);
};

export async function onRequestGet({ request, env }) {
  const g = await requireAdmin(request, env);
  if (g.error) return g.error;
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  await ensureMpTables(env);
  const orgId = Number(new URL(request.url).searchParams.get('orgId')) || null;
  const filas = (await env.DB.prepare(
    `SELECT c.org_id, c.mp_user_id, c.scope, c.live_mode, o.name AS org_name
       FROM mp_conexiones c LEFT JOIN orgs o ON o.id = c.org_id
      WHERE ?1 IS NULL OR c.org_id = ?1 ORDER BY c.org_id`,
  ).bind(orgId).all()).results || [];

  // ¿La cuenta conectada es la misma de Nodo Sur (la que cobra las suscripciones y probablemente es dueña de la aplicación)?
  // Si lo es, una prueba con ella no dice nada de un suscriptor común: puede tener permisos que ellos no tienen.
  let cuentaNodoSur = null;
  if (env.MP_ACCESS_TOKEN) {
    try {
      const r = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${String(env.MP_ACCESS_TOKEN).trim()}` } });
      if (r.ok) cuentaNodoSur = String((await r.json()).id);
    } catch { /* sin red: queda null */ }
  }

  const negocios = [];
  for (const f of filas) {
    const [saldo, reportes, config, pagos] = await Promise.all([
      mpFetch(env, f.org_id, `/users/${encodeURIComponent(f.mp_user_id)}/mercadopago_account/balance`),
      mpFetch(env, f.org_id, '/v1/account/release_report/list'),
      mpFetch(env, f.org_id, '/v1/account/release_report/config'),
      mpFetch(env, f.org_id, '/v1/payments/search?sort=date_created&criteria=desc&limit=30&status=approved'),
    ]);
    const lista = Array.isArray(reportes.j) ? reportes.j : null;
    negocios.push({
      orgId: f.org_id, negocio: f.org_name, permisos: f.scope, produccion: Boolean(f.live_mode),
      esLaCuentaDeNodoSur: cuentaNodoSur == null ? null : cuentaNodoSur === String(f.mp_user_id),
      acreditacion: acreditacionDe(pagos),
      saldoDirecto: { status: saldo.status, respuesta: recortar(saldo.j) },
      reporteLiquidaciones: {
        listar: { status: reportes.status, cantidad: lista ? lista.length : null, ultimos: lista ? recortar(lista.slice(0, 3)) : recortar(reportes.j) },
        configuracion: { status: config.status, respuesta: recortar(config.j) },
      },
    });
  }
  return json({ negocios });
}

import { json, fetchConPlazo } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { ensureMpTables, mpFetch, tokenDe } from '../../_lib/mp_conexion.js';
import { asegurarConfiguracion, filasDelCsv, rangoDelDia } from '../../_lib/mp_saldo.js';

// Prueba del reporte de Liquidaciones de Mercado Pago con la cuenta real de un negocio (El dueño, 2026-10-04: "generalo").
// El saldo directo está negado (403, ver `mp_saldo.js`); este reporte es el camino oficial para el saldo real en el cierre, y
// lo que se quiere comprobar es si trae TODOS los egresos (el "Pago Facturas AVC" y la transferencia a otra cuenta del 03/10),
// no solo cobros, retiros y comisiones, que es lo único que la documentación lista.
//
//   GET ?orgId=N&dia=AAAA-MM-DD                 → lista los reportes de la cuenta (solo lectura)
//   GET ?orgId=N&dia=AAAA-MM-DD&generar=si      → crea la configuración si no existe y pide el reporte de ese día (hora
//                                                 argentina). No mueve plata: deja un archivo en Mercado Pago → Reportes.
//   GET ?orgId=N&archivo=NOMBRE                 → baja ese reporte y lo devuelve como filas
// Solo administradores de la plataforma; la respuesta nunca lleva el token.

const API = 'https://api.mercadopago.com';
export { rangoDelDia, filasDelCsv };

export async function onRequestGet({ request, env }) {
  const g = await requireAdmin(request, env);
  if (g.error) return g.error;
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  await ensureMpTables(env);
  const q = new URL(request.url).searchParams;
  const orgId = Number(q.get('orgId'));
  const conexion = orgId ? await env.DB.prepare('SELECT mp_user_id FROM mp_conexiones WHERE org_id = ?1').bind(orgId).first() : null;
  if (!conexion) return json({ error: 'sin_conexion', detalle: 'Pasá ?orgId= de un negocio con Mercado Pago conectado.' }, 404);

  const archivo = q.get('archivo');
  if (archivo) {
    if (!/^[\w.-]{1,200}$/.test(archivo)) return json({ error: 'bad_request' }, 400);
    // El archivo es CSV, no JSON: no pasa por `mpFetch`, pero usa el mismo token del negocio.
    const token = await tokenDe(env, orgId);
    if (!token) return json({ error: 'mp_no_conectado' }, 409);
    let r; let texto;
    try {
      r = await fetchConPlazo(`${API}/v1/account/release_report/${encodeURIComponent(archivo)}`, { headers: { Authorization: `Bearer ${token}` } }, 30_000);
      texto = await r.text();
    } catch { return json({ error: 'mp_sin_respuesta' }, 504); }
    if (r.status !== 200) return json({ status: r.status, respuesta: texto.slice(0, 2000) });
    const filas = filasDelCsv(texto);
    return json({ status: 200, archivo, filas: filas.length, columnas: filas[0] ? Object.keys(filas[0]) : [], contenido: filas });
  }

  const salida = {};
  const dia = q.get('dia');
  if (q.get('generar') === 'si') {
    // Esto SÍ crea algo en Mercado Pago y es un GET: un enlace o formulario de otro sitio no puede disparárselo a un
    // administrador con la sesión abierta. Escribir la dirección a mano (`Sec-Fetch-Site: none`) y el mismo sitio siguen andando.
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'forbidden' }, 403);
    const rango = rangoDelDia(dia);
    if (!rango) return json({ error: 'bad_request', detalle: 'Falta ?dia=AAAA-MM-DD' }, 400);
    salida.configuracion = await asegurarConfiguracion(env, orgId, conexion.mp_user_id);
    const r = await mpFetch(env, orgId, '/v1/account/release_report', { method: 'POST', body: JSON.stringify(rango) });
    salida.pedido = { status: r.status, rango, respuesta: r.j };
  }
  const lista = await mpFetch(env, orgId, '/v1/account/release_report/list');
  salida.reportes = { status: lista.status, respuesta: Array.isArray(lista.j) ? lista.j.slice(0, 10) : lista.j };
  return json(salida);
}

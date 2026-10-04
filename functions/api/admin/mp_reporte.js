import { json } from '../../_lib/util.js';
import { requireAdmin } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { ensureMpTables, mpFetch, tokenDe } from '../../_lib/mp_conexion.js';

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
const COLUMNAS = ['DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE', 'RECORD_TYPE', 'DESCRIPTION', 'NET_CREDIT_AMOUNT', 'NET_DEBIT_AMOUNT',
  'GROSS_AMOUNT', 'MP_FEE_AMOUNT', 'TAXES_AMOUNT', 'PAYMENT_METHOD', 'BALANCE_AMOUNT'];
const MAX_FILAS = 500;

// Un día de Argentina (UTC-3, sin horario de verano) en UTC, como lo pide la API.
export function rangoDelDia(dia) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || '')) return null;
  const inicio = new Date(`${dia}T03:00:00Z`);
  if (Number.isNaN(inicio.getTime())) return null;
  const fin = new Date(inicio.getTime() + 86400000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { begin_date: iso(inicio), end_date: iso(fin) };
}

// CSV de Mercado Pago (separador ";" por la configuración, "," si es la de ellos) a filas con nombre de columna.
export function filasDelCsv(texto) {
  const lineas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return [];
  const sep = lineas[0].includes(';') ? ';' : ',';
  const cabecera = lineas[0].split(sep).map((c) => c.trim());
  return lineas.slice(1, MAX_FILAS + 1).map((l) => {
    const v = l.split(sep);
    return Object.fromEntries(cabecera.map((c, i) => [c, (v[i] ?? '').trim()]));
  });
}

async function asegurarConfiguracion(env, orgId, userId) {
  const actual = await mpFetch(env, orgId, '/v1/account/release_report/config');
  if (actual.status === 200) return { status: 200, creada: false };
  const cuerpo = (columnas) => JSON.stringify({
    columns: columnas.map((key) => ({ key })), file_name_prefix: `nodosur-liquidaciones-${userId}`,
    frequency: { hour: 0, type: 'monthly', value: 1 }, display_timezone: 'GMT-03', separator: ';', report_translation: 'es',
    include_withdrawal_at_end: true, execute_after_withdrawal: false,
  });
  let r = await mpFetch(env, orgId, '/v1/account/release_report/config', { method: 'POST', body: cuerpo(COLUMNAS) });
  // BALANCE_AMOUNT figura en el glosario pero no en la lista de la API: si Mercado Pago la rechaza, se pide sin ella.
  if (r.status === 400) r = await mpFetch(env, orgId, '/v1/account/release_report/config', { method: 'POST', body: cuerpo(COLUMNAS.filter((c) => c !== 'BALANCE_AMOUNT')) });
  return { status: r.status, creada: r.status >= 200 && r.status < 300, respuesta: r.status >= 300 ? r.j : undefined };
}

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
    const r = await fetch(`${API}/v1/account/release_report/${encodeURIComponent(archivo)}`, { headers: { Authorization: `Bearer ${token}` } });
    const texto = await r.text();
    if (r.status !== 200) return json({ status: r.status, respuesta: texto.slice(0, 2000) });
    const filas = filasDelCsv(texto);
    return json({ status: 200, archivo, filas: filas.length, columnas: filas[0] ? Object.keys(filas[0]) : [], contenido: filas });
  }

  const salida = {};
  const dia = q.get('dia');
  if (q.get('generar') === 'si') {
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

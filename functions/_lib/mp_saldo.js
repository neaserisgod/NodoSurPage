// Saldo real de la cuenta de Mercado Pago del negocio para el cierre de caja (etapa E, El dueño 2026-10-04): "se pide con un
// botón; al llegar llena el 'MP contado' y queda editable".
//
// El saldo directo (`/users/{id}/mercadopago_account/balance`) da 403 con la cuenta del local: el camino oficial es el reporte de
// Liquidaciones (`/v1/account/release_report`). Es ASÍNCRONO (unos minutos): la app pide el reporte (`pedirSaldo`) y pregunta
// hasta que esté (`estadoSaldo`). El token de Mercado Pago nunca sale de acá.
//
// Qué trae el reporte (verificado con la cuenta real, DECISIONES.md): una fila `initial_available_balance`, y una por cada
// movimiento liberado con el saldo después de él (`BALANCE_AMOUNT`). Trae TODOS los egresos (pagos a proveedores, transferencias),
// y cada pago propio viene con un par `reserve_for_*` (débito y crédito) que se anula: se ignora. Lo cobrado y todavía no
// liberado (`money_release_date` a futuro) NO está en el reporte: se suma aparte desde los pagos.
import { now } from './util.js';
import { ensureMpTables, mpFetch, tokenDe, cobrosDe } from './mp_conexion.js';

const API = 'https://api.mercadopago.com';
export const COLUMNAS = ['DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE', 'RECORD_TYPE', 'DESCRIPTION', 'NET_CREDIT_AMOUNT', 'NET_DEBIT_AMOUNT',
  'GROSS_AMOUNT', 'MP_FEE_AMOUNT', 'TAXES_AMOUNT', 'PAYMENT_METHOD', 'BALANCE_AMOUNT'];
export const MAX_FILAS_SALDO = 20000;
export const MAX_MOVIMIENTOS = 2000;
export const MAX_RANGO_SALDO = 60 * 24 * 3600; // el reporte admite hasta 60 días
export const ESPERA_ENTRE_PEDIDOS = 60;        // segundos: un segundo pedido igual dentro de este plazo reutiliza el primero
export const DIAS_A_LIBERAR = 30;

// Un día de Argentina (UTC-3, sin horario de verano) en UTC, como lo pide la API.
export function rangoDelDia(dia) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || '')) return null;
  const inicio = new Date(`${dia}T03:00:00Z`);
  if (Number.isNaN(inicio.getTime())) return null;
  return rangoDeSegundos(Math.floor(inicio.getTime() / 1000), Math.floor(inicio.getTime() / 1000) + 86400);
}
export function rangoDeSegundos(desde, hasta) {
  const iso = (s) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { begin_date: iso(desde), end_date: iso(hasta) };
}

// CSV de Mercado Pago (";" por nuestra configuración, "," si es la de ellos; con comillas si el texto lleva el separador).
export function filasDelCsv(texto, { max = 500 } = {}) {
  const lineas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return [];
  const sep = lineas[0].includes(';') ? ';' : ',';
  const partir = (l) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  const cabecera = partir(lineas[0]);
  return lineas.slice(1, max + 1).map((l) => { const v = partir(l); return Object.fromEntries(cabecera.map((c, i) => [c, v[i] ?? ''])); });
}

// "286149.00" o "1.234,50" a centavos. null si no es un número.
export function aCentavosCsv(s) {
  let t = String(s ?? '').trim().replace(/\s/g, '');
  if (!t) return null;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const fechaSeg = (s) => {
  const t = String(s || '').trim();
  if (!t) return null;
  // El reporte sale en hora argentina (GMT-03) salvo que traiga zona propia.
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t.replace(' ', 'T')}-03:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

// Filas del reporte a { saldoCentavos, inicialCentavos, movimientos }. Los movimientos son todo menos el saldo inicial y los
// pares `reserve_for_*`. El saldo es el de la última fila real; sin columna de saldo se calcula desde el inicial.
export function parsearReporte(filas) {
  let inicial = null; let saldo = null; let credito = 0; let debito = 0; let hayBalance = false;
  const movimientos = [];
  for (const f of filas) {
    const tipo = (f.RECORD_TYPE || '').trim();
    const cred = aCentavosCsv(f.NET_CREDIT_AMOUNT) || 0;
    const deb = aCentavosCsv(f.NET_DEBIT_AMOUNT) || 0;
    const bal = aCentavosCsv(f.BALANCE_AMOUNT);
    if (tipo === 'initial_available_balance') { inicial = bal ?? cred - deb; continue; }
    if (tipo === 'total') continue;
    credito += cred; debito += deb;
    if (tipo.startsWith('reserve_for_')) continue;
    if (bal != null) { saldo = bal; hayBalance = true; }
    movimientos.push({ fecha: fechaSeg(f.DATE), tipo, descripcion: (f.DESCRIPTION || '').trim().slice(0, 80), creditoCentavos: cred, debitoCentavos: deb,
      referencia: (f.EXTERNAL_REFERENCE || '').trim().slice(0, 64) || null, origen: (f.SOURCE_ID || '').trim().slice(0, 64) || null });
  }
  if (inicial == null && !hayBalance) return { error: 'reporte_sin_saldo' };
  if (!hayBalance) saldo = (inicial ?? 0) + credito - debito;
  else if (saldo == null) saldo = inicial;
  return { saldoCentavos: saldo, inicialCentavos: inicial, movimientos };
}

export async function asegurarConfiguracion(env, orgId, userId) {
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

// Pide el reporte de [desde, hasta] (segundos). Devuelve { id } del pedido de la app, o { error }.
export async function pedirSaldo(env, orgId, branchId, { desde, hasta }, t = now()) {
  await ensureMpTables(env);
  const c = await env.DB.prepare('SELECT mp_user_id FROM mp_conexiones WHERE org_id = ?1').bind(orgId).first();
  if (!c) return { error: 'mp_no_conectado', status: 409 };
  // Un segundo toque al botón no pide otro reporte: reutiliza el pedido de hace instantes.
  const previo = await env.DB.prepare('SELECT id FROM mp_saldo_pedidos WHERE org_id = ?1 AND desde = ?2 AND creado > ?3 ORDER BY id DESC LIMIT 1').bind(orgId, desde, t - ESPERA_ENTRE_PEDIDOS).first();
  if (previo) return { id: previo.id, reutilizado: true };
  const conf = await asegurarConfiguracion(env, orgId, c.mp_user_id);
  if (conf.status < 200 || conf.status >= 300) return { error: 'mp_error', status: 502, mensaje: 'configuracion', http: conf.status };
  const r = await mpFetch(env, orgId, '/v1/account/release_report', { method: 'POST', body: JSON.stringify(rangoDeSegundos(desde, hasta)) });
  if (r.status < 200 || r.status >= 300) return { error: r.status === 409 ? 'mp_no_conectado' : 'mp_error', status: r.status === 409 ? 409 : 502, http: r.status };
  const ins = await env.DB.prepare('INSERT INTO mp_saldo_pedidos (org_id, branch_id, desde, hasta, mp_report_id, creado) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(orgId, branchId, desde, hasta, r.j && r.j.id != null ? String(r.j.id) : null, t).run();
  await env.DB.prepare('DELETE FROM mp_saldo_pedidos WHERE org_id = ?1 AND id <= (SELECT id FROM mp_saldo_pedidos WHERE org_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET 20)').bind(orgId).run();
  return { id: ins.meta.last_row_id };
}

const LISTO = new Set(['processed', 'ready', 'done', 'finished', 'generated']);
const FALLO = new Set(['error', 'failed', 'canceled', 'cancelled']);
// El reporte de este pedido dentro de la lista de Mercado Pago: por id; si la lista no lo trae, por el rango pedido.
export function reporteDelPedido(lista, pedido) {
  if (!Array.isArray(lista)) return null;
  const rango = rangoDeSegundos(pedido.desde, pedido.hasta);
  const mismo = (x) => (pedido.mp_report_id != null && x.id != null && String(x.id) === pedido.mp_report_id)
    || (x.begin_date && x.end_date && Date.parse(x.begin_date) === Date.parse(rango.begin_date) && Date.parse(x.end_date) === Date.parse(rango.end_date));
  return lista.find(mismo) || null;
}

// Lo cobrado y todavía no liberado: no está en el reporte pero es plata de la cuenta.
export async function aLiberarDe(env, orgId, t = now()) {
  const r = await cobrosDe(env, orgId, { desde: t - DIAS_A_LIBERAR * 86400, hasta: t + 60 });
  if (r.error) return { error: r.error };
  let total = 0; let cantidad = 0;
  for (const c of r.cobros) {
    if (c.liberacion == null || c.liberacion <= t) continue;
    if (!['approved', 'partially_refunded'].includes(c.estado)) continue;
    total += c.netoCentavos; cantidad++;
  }
  return { centavos: total, cantidad, truncado: r.truncado };
}

// Estado de un pedido: { estado: 'pendiente' } | { estado: 'error', ... } | { estado: 'listo', saldo… }.
export async function estadoSaldo(env, orgId, id, t = now()) {
  await ensureMpTables(env);
  const pedido = await env.DB.prepare('SELECT * FROM mp_saldo_pedidos WHERE id = ?1 AND org_id = ?2').bind(id, orgId).first();
  if (!pedido) return { error: 'no_encontrado', status: 404 };
  const lista = await mpFetch(env, orgId, '/v1/account/release_report/list');
  if (lista.status === 409) return { error: 'mp_no_conectado', status: 409 };
  if (lista.status !== 200) return { error: 'mp_error', status: 502, http: lista.status };
  const rep = reporteDelPedido(lista.j, pedido);
  if (!rep) return { estado: 'pendiente' };
  const est = String(rep.status || '').toLowerCase();
  if (FALLO.has(est)) return { estado: 'error', motivo: 'mp_reporte_fallo' };
  if (!rep.file_name || !LISTO.has(est)) return { estado: 'pendiente' };
  const token = await tokenDe(env, orgId);
  if (!token) return { error: 'mp_no_conectado', status: 409 };
  if (!/^[\w.-]{1,200}$/.test(rep.file_name)) return { estado: 'error', motivo: 'archivo_invalido' };
  const r = await fetch(`${API}/v1/account/release_report/${encodeURIComponent(rep.file_name)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return { estado: 'pendiente' };
  if (r.status !== 200) return { error: 'mp_error', status: 502, http: r.status };
  const p = parsearReporte(filasDelCsv(await r.text(), { max: MAX_FILAS_SALDO }));
  if (p.error) return { estado: 'error', motivo: p.error };
  const liberar = await aLiberarDe(env, orgId, t);
  return {
    estado: 'listo', desde: pedido.desde, hasta: pedido.hasta,
    saldoDisponibleCentavos: p.saldoCentavos, aLiberarCentavos: liberar.error ? null : liberar.centavos, aLiberarCobros: liberar.error ? null : liberar.cantidad,
    totalCentavos: liberar.error ? null : p.saldoCentavos + liberar.centavos,
    movimientos: p.movimientos.slice(0, MAX_MOVIMIENTOS), truncado: p.movimientos.length > MAX_MOVIMIENTOS || Boolean(liberar.truncado),
  };
}

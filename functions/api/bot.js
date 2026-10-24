// El bot de WhatsApp (`functions/_lib/bot.js`; plan en `Nodo-Sur-Pos/docs/PLAN-BOT.md`). Todo desde un equipo vinculado a una
// sucursal: la app de Nodo Sur (PC o celular) o el bot mismo (`devices.kind = 'bot'`, un celular con Termux). La sesión web no lo usa.
//
// Quién hace qué:
//  * la app ve el estado, cambia la configuración (dueño o encargado), publica el catálogo y acepta o rechaza pedidos;
//  * el bot baja la configuración y el catálogo, manda pedidos y se entera de cómo se resolvieron.
import { json, now } from '../_lib/util.js';
import { actorOf } from '../_lib/actor.js';
import { hasDB } from '../_lib/db.js';
import { getMembership } from '../_lib/orgs.js';
import { puede } from '../_lib/permisos.js';
import { syncAccess } from '../_lib/sync.js';
import {
  botConfigurado, tieneBot, configValida, leerConfig, guardarConfig, itemsDeCatalogo, guardarCatalogo, leerCatalogo,
  pedidoDesdeBot, avisoDePedido, crearPedido, pedidoSinLink, pedidosDesde, resolverPedido, avanzarPedidoBot, avisarBot, botsDeSucursal, MAX_CONFIG_BYTES,
  anotarLector, pedidoConGramosPermitido, pedidoTieneGramos, itemsDeCatalogoWa, guardarCatalogoWa, leerCatalogoWa,
  MAX_FOTO_BYTES, gidValido, tipoDeFoto, guardarFoto, leerFoto, borrarFoto,
} from '../_lib/bot.js';
import { avisarConReintento, cuandoTexto } from '../_lib/push.js';
import { linkDeSena, linkDePedido } from '../_lib/mp_servicios.js';
import { iaConfigurada, generarConIa, modeloConForma } from '../_lib/ia.js';
import { estadoConexion } from '../_lib/mp_conexion.js';
import { upsertDevice, signDeviceToken, getDevice, validDeviceId, DEVICE_TTL } from '../_lib/devices.js';
import { turnoDesdeBot, reservarTurno, ocupadosDesdeApp, publicarOcupados, cambiarTurno, turnosDesde, turnoIdValido, horarioValido, ESTADOS_TURNO } from '../_lib/bot_turnos.js';

// Lo más grande que se acepta: un catálogo de 5.000 productos entra holgado en 1 MB.
const MAX_CUERPO = 1024 * 1024;

// El cuerpo JSON, sin leer más de [max] bytes. null si no es un objeto; `{ grande: true }` si se pasa.
async function cuerpo(request, max = MAX_CUERPO) {
  if (Number(request.headers.get('Content-Length') || 0) > max) return { grande: true };
  const texto = await request.text();
  if (texto.length > max) return { grande: true };
  try { const b = JSON.parse(texto); return b && typeof b === 'object' && !Array.isArray(b) ? { b } : null; } catch { return null; }
}

// Quien llama: un equipo vinculado a un negocio, que opera la sucursal con el negocio al día (el mismo control que sincronizar) y,
// salvo para ver el estado, con el bot en el plan. `bot: true` = solo el bot; `bot: false` = solo la app.
async function equipo(request, env, { bot, accion, sinPlan = false } = {}) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return { error: json({ error: 'no_device' }, 401) };
  if (!hasDB(env) || !botConfigurado(env)) return { error: json({ error: 'bot_no_configurado' }, 503) };
  const d = a.device;
  if (!d.owner_org) return { error: json({ error: 'sin_negocio' }, 409) };
  const esBot = d.kind === 'bot';
  if (bot === true && !esBot) return { error: json({ error: 'solo_bot' }, 403) };
  if (bot === false && esBot) return { error: json({ error: 'solo_app' }, 403) };
  const acc = await syncAccess(env, a);
  if (acc.error) return { error: json({ error: acc.error }, 503) };
  if (!acc.subir) return { error: json({ error: 'forbidden' }, 403) };
  const branchId = d.branch_id ?? 0;
  const m = await getMembership(env, d.owner_org, a.sub);
  if (accion && !puede(m, accion, branchId)) return { error: json({ error: 'forbidden' }, 403) };
  const plan = await tieneBot(env, d.owner_org);
  if (plan.error) return { error: json({ error: plan.error }, 503) };
  if (!plan.ok && !sinPlan) return { error: json({ error: 'sin_plan_bot' }, 403) };
  return { a, orgId: d.owner_org, branchId, esBot, tieneBot: plan.ok, puedeConfigurar: puede(m, 'configurar_bot', branchId) };
}

// GET /api/bot/estado (la app): si el negocio tiene el bot, si quien usa este equipo lo puede configurar, qué versión de la
// configuración hay y los bots vinculados a la sucursal con su última señal. Sin el plan contesta igual (`tieneBot: false`): la app
// lo usa para mostrar o no la pantalla del bot.
export async function onRequestEstado({ request, env }) {
  const w = await equipo(request, env, { bot: false, sinPlan: true }); if (w.error) return w.error;
  if (!w.tieneBot) return json({ tieneBot: false });
  const c = await leerConfig(env, w.orgId, w.branchId);
  return json({ tieneBot: true, puedeConfigurar: w.puedeConfigurar, version: c.version, actualizada: c.actualizada, bots: await botsDeSucursal(env, w.orgId, w.branchId) });
}

// GET /api/bot/config (la app o el bot): `{ version, config, actualizada }`; `config: null` y `version: 0` si nunca se guardó.
// Al bot de un local gastronómico se le suma `pedidos.mp`: si el negocio conectó Mercado Pago, puede ofrecer pagar por link (la app
// no lo sabe; el sitio sí). A la app no, así su comparación con lo que guarda no cambia.
export async function onRequestConfigGet({ request, env }) {
  const w = await equipo(request, env); if (w.error) return w.error;
  const c = await leerConfig(env, w.orgId, w.branchId);
  if (w.esBot && c.config && c.config.pedidos && typeof c.config.pedidos === 'object') {
    let mp = false;
    try { mp = Boolean((await estadoConexion(env, w.orgId))?.connected); } catch (e) { console.error('bot_config_mp', e && e.message); }
    c.config = { ...c.config, pedidos: { ...c.config.pedidos, mp } };
  }
  return json(c);
}

// POST /api/bot/config (la app, dueño o encargado): `{ config }`. El bot se entera al toque y la recarga.
export async function onRequestConfigPost({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: false, accion: 'configurar_bot' }); if (w.error) return w.error;
  const r = await cuerpo(request, MAX_CONFIG_BYTES + 1024);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  if (!r || !configValida(r.b.config)) return json({ error: 'bad_request' }, 400);
  const version = await guardarConfig(env, w.orgId, w.branchId, { config: r.b.config, sub: w.a.sub });
  await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'bots', aviso: { config: version } }));
  return json({ ok: true, version });
}

// POST /api/bot/catalogo (la app): `{ items: [{ gid, nombre, precioCentavos, hay }] }`. Si no cambió, no despierta al bot.
export async function onRequestCatalogoPost({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: false }); if (w.error) return w.error;
  const r = await cuerpo(request);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  const items = r && itemsDeCatalogo(r.b.items);
  if (!items) return json({ error: 'bad_request' }, 400);
  const cambiado = await guardarCatalogo(env, w.orgId, w.branchId, items);
  if (cambiado) await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'bots', aviso: { catalogo: true } }));
  return json({ ok: true, cambiado, items: items.length });
}

// GET /api/bot/catalogo (el bot o la app): `{ items, actualizado }`.
export async function onRequestCatalogoGet({ request, env }) {
  const w = await equipo(request, env); if (w.error) return w.error;
  return json(await leerCatalogo(env, w.orgId, w.branchId));
}

// POST /api/bot/foto?gid=<global_id> (la app): el cuerpo es la foto (JPEG o PNG, hasta MAX_FOTO_BYTES). Devuelve `{ version }` y
// despierta al bot, que la pone en el catálogo de WhatsApp. La sucursal no importa: la foto es del producto en todo el negocio.
export async function onRequestFotoPost({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: false, accion: 'operar' }); if (w.error) return w.error;
  const gid = new URL(request.url).searchParams.get('gid');
  if (!gidValido(gid)) return json({ error: 'bad_request' }, 400);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_FOTO_BYTES) return json({ error: 'too_large' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_FOTO_BYTES) return json({ error: 'too_large' }, 413);
  const tipo = tipoDeFoto(bytes);
  if (!tipo) return json({ error: 'no_es_foto' }, 400);
  const version = await guardarFoto(env, w.orgId, gid, bytes, tipo);
  await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'bots', aviso: { catalogo: true } }));
  return json({ ok: true, version });
}

// GET /api/bot/foto?gid=<global_id> (el bot o la app): la foto, o 404 si ese producto no tiene.
export async function onRequestFotoGet({ request, env }) {
  const w = await equipo(request, env); if (w.error) return w.error;
  const gid = new URL(request.url).searchParams.get('gid');
  if (!gidValido(gid)) return json({ error: 'bad_request' }, 400);
  const f = await leerFoto(env, w.orgId, gid);
  if (!f) return json({ error: 'not_found' }, 404);
  // La URL no cambia con la versión: que nadie guarde una vieja.
  return new Response(f.bytes, { headers: { 'Content-Type': f.tipo, 'Cache-Control': 'private, no-cache', ETag: `"${f.version}"` } });
}

// POST /api/bot/foto/borrar (la app): `{ gid }`. El bot vuelve a la foto genérica.
export async function onRequestFotoBorrar({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: false, accion: 'operar' }); if (w.error) return w.error;
  const r = await cuerpo(request, 1024);
  if (!r || r.grande || !gidValido(r.b.gid)) return json({ error: 'bad_request' }, 400);
  const habia = await borrarFoto(env, w.orgId, r.b.gid);
  if (habia) await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'bots', aviso: { catalogo: true } }));
  return json({ ok: true, habia });
}

// POST /api/bot/catalogo-wa (el bot): `{ items }` (`itemsDeCatalogoWa`), lo que tiene el catálogo de WhatsApp Business del local. La
// app se entera al toque (puede estar esperando para traerlo a la carta).
export async function onRequestCatalogoWaPost({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: true }); if (w.error) return w.error;
  const r = await cuerpo(request);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  const items = r && itemsDeCatalogoWa(r.b.items);
  if (!items) return json({ error: 'bad_request' }, 400);
  await guardarCatalogoWa(env, w.orgId, w.branchId, items);
  await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'equipos', aviso: { catalogoWa: true } }));
  return json({ ok: true, items: items.length });
}

// GET /api/bot/catalogo-wa (la app): `{ items, actualizado }`, lo último que mandó el bot.
export async function onRequestCatalogoWaGet({ request, env }) {
  const w = await equipo(request, env, { bot: false }); if (w.error) return w.error;
  return json(await leerCatalogoWa(env, w.orgId, w.branchId));
}

// POST /api/bot/catalogo-wa/pedir (la app): que el bot lea el catálogo de WhatsApp ahora (el local recién cargó algo allá).
export async function onRequestCatalogoWaPedir({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: false }); if (w.error) return w.error;
  const avisado = await avisarBot(env, w.orgId, w.branchId, { para: 'bots', aviso: { catalogoWa: true } });
  void ctx;
  return json({ ok: true, avisado });
}

// POST /api/bot/ia (el bot): la IA de Google con la clave del negocio (`_lib/ia.js`), para lo que el bot no entiende: le pide que
// reescriba el mensaje del cliente como una frase que sus reglas entienden (`botdemo/src/ia.js`). El bot no puede usar
// `/api/ia/generar` (su token solo abre `/api/bot/*`, ver `_lib/actor.js`); esta ruta le da lo mismo, acotado a lo que necesita:
// texto chico, sin archivos ni herramientas. Cuerpo: `{ modelo, cuerpo }` como `/api/ia/generar`; devuelve lo de Google tal cual.
const MAX_PEDIDO_IA_BOT = 64 * 1024;
const conAdjuntos = (pedido) => Boolean(pedido.tools || pedido.toolConfig || pedido.cachedContent)
  || (Array.isArray(pedido.contents) && pedido.contents.some((c) => (c && Array.isArray(c.parts) ? c.parts : []).some((p) => !p || typeof p.text !== 'string')));
export async function onRequestIa({ request, env }) {
  const w = await equipo(request, env, { bot: true }); if (w.error) return w.error;
  if (!iaConfigurada(env)) return json({ error: 'ia_no_configurada' }, 503);
  const r = await cuerpo(request, MAX_PEDIDO_IA_BOT);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  const b = r && r.b;
  if (!b || !modeloConForma(b.modelo) || typeof b.cuerpo !== 'string' || !b.cuerpo) return json({ error: 'bad_request' }, 400);
  let pedido = null;
  try { pedido = JSON.parse(b.cuerpo); } catch { /* abajo */ }
  if (!pedido || typeof pedido !== 'object' || !Array.isArray(pedido.contents) || conAdjuntos(pedido)) return json({ error: 'bad_request' }, 400);
  const g = await generarConIa(env, w.orgId, { modelo: b.modelo, cuerpo: b.cuerpo });
  if (!g) return json({ error: 'ia_sin_clave' }, 409);
  return new Response(g.body, { status: g.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

// POST /api/bot/pedido (el bot): `{ id, cliente: { nombre, telefono }, items: [{ gid?, nombre, cantidad | gramos, precioCentavos? }],
// nota? }`. Entra "por confirmar" y despierta a la app. Reintentar con el mismo `id` no lo duplica. Con gramos, solo si las apps de la
// sucursal los entienden (`pedidoConGramosPermitido`); si no, 400 `gramos_no_soportado` y el bot lo manda por WhatsApp.
export async function onRequestPedidoPost({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: true }); if (w.error) return w.error;
  const r = await cuerpo(request, 64 * 1024);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  const pedido = r && pedidoDesdeBot(r.b);
  if (!pedido) return json({ error: 'bad_request' }, 400);
  if (pedidoTieneGramos(pedido) && !(await pedidoConGramosPermitido(env, w.orgId, w.branchId))) return json({ error: 'gramos_no_soportado' }, 400);
  const p = await crearPedido(env, w.orgId, w.branchId, pedido);
  // Paga por Mercado Pago: el link para el cliente, y el pedido le llega al local cuando se acredita (`pedidoPagado`). Sin link,
  // entra igual para pagar al recibir, y el bot se lo dice.
  let pago = null;
  let estado = p.estado;
  if (estado === 'esperando_pago') {
    try { pago = await linkDePedido(env, w.orgId, w.branchId, p.id); } catch (e) { console.error('link_pedido', e && e.message); }
    if (!pago && await pedidoSinLink(env, w.orgId, w.branchId, p.id)) {
      estado = 'por_confirmar';
      pedido.datos.pago = 'al_entregar';
      p.repetido = false;
    }
  }
  if (!p.repetido && estado === 'por_confirmar') {
    await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'equipos', aviso: { pedido: p.id } }));
    // Con la app cerrada también: la notificación del celular (si el negocio configuró Firebase).
    await esperar(ctx, avisarConReintento(env, w.orgId, w.branchId, `pedido:${p.id}`, { ...avisoDePedido(pedido.datos), datos: { tipo: 'pedido', id: p.id } }));
  }
  return json({ ok: true, id: p.id, repetido: p.repetido, estado, ...(pago ? { pago } : {}), ...(pedido.datos.pago ? { formaPago: pedido.datos.pago } : {}) }, p.repetido ? 200 : 201);
}

// GET /api/bot/pedidos?desde=<ms>[&gramos=1] (la app o el bot): lo que cambió después de `desde`, con `hasta` para la próxima vez.
// `gramos=1`: la app entiende las líneas en gramos; queda anotado por equipo (`anotarLector`).
export async function onRequestPedidosGet({ request, env }) {
  const w = await equipo(request, env); if (w.error) return w.error;
  const q = new URL(request.url).searchParams;
  const desde = Number(q.get('desde') ?? 0);
  if (!Number.isSafeInteger(desde) || desde < 0) return json({ error: 'bad_request' }, 400);
  if (!w.esBot) await anotarLector(env, { deviceId: w.a.device.id, orgId: w.orgId, branchId: w.branchId, gramos: q.get('gramos') === '1' });
  return json(await pedidosDesde(env, w.orgId, w.branchId, desde));
}

// POST /api/bot/pedido/resolver (la app): `{ id, estado: 'aceptado' | 'rechazado' }`. Una sola vez; el bot le avisa al cliente.
export async function onRequestResolver({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: false }); if (w.error) return w.error;
  const r = await cuerpo(request, 4 * 1024);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  const b = r && r.b;
  if (!b || !Number.isSafeInteger(b.id) || b.id < 1 || !['aceptado', 'rechazado'].includes(b.estado)) return json({ error: 'bad_request' }, 400);
  const res = await resolverPedido(env, w.orgId, w.branchId, { id: b.id, estado: b.estado, por: w.a.sub });
  if (res.error === 'no_existe') return json({ error: 'no_existe' }, 404);
  if (res.error) return json({ error: res.error, estado: res.estado }, 409);
  await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'bots', aviso: { pedido: b.id, estado: b.estado } }));
  return json({ ok: true });
}

// POST /api/bot/pedido/estado (la app, locales gastronómicos §22): `{ id, estado: 'listo' | 'en_camino' | 'entregado' | 'cancelado' }`.
// El pedido ya aceptado avanza y el bot le avisa al cliente ("tu pedido está listo", "salió"). Repetir el mismo estado no avisa de nuevo.
export async function onRequestEstadoPedido({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: false }); if (w.error) return w.error;
  const r = await cuerpo(request, 4 * 1024);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  const b = r && r.b;
  if (!b || !Number.isSafeInteger(b.id) || b.id < 1 || !['listo', 'en_camino', 'entregado', 'cancelado'].includes(b.estado)) return json({ error: 'bad_request' }, 400);
  const res = await avanzarPedidoBot(env, w.orgId, w.branchId, { id: b.id, estado: b.estado });
  if (res.error === 'no_existe') return json({ error: 'no_existe' }, 404);
  if (res.error) return json({ error: res.error, estado: res.estado }, 409);
  if (!res.repetido) await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'bots', aviso: { pedido: b.id, estado: b.estado } }));
  return json({ ok: true });
}

// --- Turnos (negocios de servicios, `functions/_lib/bot_turnos.js`) ------------------------------------------------------------

// POST /api/bot/turno (el bot): `{ id, inicio, fin, profesional?, estado: 'confirmado' | 'esperando_sena', cliente: { nombre, telefono },
// servicio: { gid?, nombre }, senaPedidaCentavos?, senaVence?, nota? }`. Reserva el horario: 201, 200 si es un reintento, o 409
// `ocupado` si otro lo tomó antes (el bot le ofrece otro horario al cliente). Despierta a la app.
export async function onRequestTurnoPost({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: true }); if (w.error) return w.error;
  const r = await cuerpo(request, 16 * 1024);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  const turno = r && turnoDesdeBot(r.b);
  if (!turno) return json({ error: 'bad_request' }, 400);
  const res = await reservarTurno(env, w.orgId, w.branchId, turno);
  if (res.ocupado) return json({ error: 'ocupado' }, 409);
  if (!res.repetido) {
    await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'equipos', aviso: { turno: turno.turnoId } }));
    await esperar(ctx, avisarConReintento(env, w.orgId, w.branchId, `turno:${turno.turnoId}`, {
      titulo: turno.estado === 'esperando_sena' ? '📅 Turno por WhatsApp (espera la seña)' : '📅 Turno por WhatsApp',
      cuerpo: `${turno.datos.cliente.nombre} · ${turno.datos.servicio.nombre} · ${cuandoTexto(turno.inicio)}`,
      datos: { tipo: 'turno', id: turno.turnoId },
    }));
  }
  // La seña por link de Mercado Pago (Nodo Sur Servicios): el bot se la manda a la clienta. Sin Mercado Pago conectado no hay link y
  // el bot sigue con el alias. Si falla, el turno queda reservado igual.
  let sena = null;
  if (turno.estado === 'esperando_sena') {
    try { sena = await linkDeSena(env, w.orgId, w.branchId, turno.turnoId); } catch (e) { console.error('link_sena', e && e.message); }
  }
  return json({ ok: true, id: turno.turnoId, repetido: res.repetido, ...(sena ? { sena } : {}) }, res.repetido ? 200 : 201);
}

// POST /api/bot/turno/cambio (la app o el bot): `{ id, estado?, inicio?, fin? }`. La app mueve, cancela, cobra o marca "no vino" un
// turno del bot; el bot confirma la seña, o el cliente lo cancela o lo cambia. Si lo mueve el bot no puede pisar otro (409
// `ocupado`); la app sí (sobreturno, §21). Despierta al otro lado.
export async function onRequestTurnoCambio({ request, env, ctx }) {
  const w = await equipo(request, env); if (w.error) return w.error;
  const r = await cuerpo(request, 4 * 1024);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  const b = r && r.b;
  if (!b || !turnoIdValido(b.id)) return json({ error: 'bad_request' }, 400);
  if (b.estado !== undefined && !ESTADOS_TURNO.includes(b.estado)) return json({ error: 'bad_request' }, 400);
  const mueve = b.inicio !== undefined || b.fin !== undefined;
  if (mueve && !horarioValido(b.inicio, b.fin)) return json({ error: 'bad_request' }, 400);
  if (!mueve && b.estado === undefined) return json({ error: 'bad_request' }, 400);
  const res = await cambiarTurno(env, w.orgId, w.branchId, { turnoId: b.id, estado: b.estado, inicio: b.inicio, fin: b.fin }, { controlarChoque: w.esBot && mueve });
  if (res.error === 'no_existe') return json({ error: 'no_existe' }, 404);
  if (res.ocupado) return json({ error: 'ocupado' }, 409);
  await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: w.esBot ? 'equipos' : 'bots', aviso: { turno: b.id } }));
  return json({ ok: true });
}

// POST /api/bot/ocupados (la app): `{ turnos: [{ id, inicio, fin, profesional?, estado }] }`, lo que ocupa la agenda de la app de hoy
// en adelante (sin nombres ni teléfonos). Reemplaza lo anterior de la app. Si cambió algo, despierta al bot.
export async function onRequestOcupadosPost({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: false }); if (w.error) return w.error;
  const r = await cuerpo(request, 256 * 1024);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  const lista = r && ocupadosDesdeApp(r.b.turnos);
  if (!lista) return json({ error: 'bad_request' }, 400);
  const cambiado = await publicarOcupados(env, w.orgId, w.branchId, lista);
  if (cambiado) await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'bots', aviso: { ocupados: true } }));
  return json({ ok: true, cambiado });
}

// GET /api/bot/turnos?desde=<ms> (la app o el bot): lo que cambió después de `desde`, con `hasta` para la próxima vez.
export async function onRequestTurnosGet({ request, env }) {
  const w = await equipo(request, env); if (w.error) return w.error;
  const desde = Number(new URL(request.url).searchParams.get('desde') ?? 0);
  if (!Number.isSafeInteger(desde) || desde < 0) return json({ error: 'bad_request' }, 400);
  return json(await turnosDesde(env, w.orgId, w.branchId, desde));
}

// POST /api/bot/token (la app Nodo Sur Servicios, que trae el bot adentro; `Nodo-Sur-Pos/docs/PLAN-APP-SERVICIOS.md`):
// `{ deviceId, name? }` → el token del bot de ESTE celular, sin pasar por el navegador: el celular ya está vinculado a la sucursal y
// quien lo usa puede configurar el bot (el mismo permiso que vincular uno con Termux). El id lo genera la app y lo guarda: pedirlo de
// nuevo renueva el token del mismo bot, no crea otro. Un id que ya es de otro equipo (otro tipo u otro negocio) se rechaza.
export async function onRequestTokenPost({ request, env }) {
  const w = await equipo(request, env, { bot: false, accion: 'configurar_bot' }); if (w.error) return w.error;
  const r = await cuerpo(request, 4096);
  const b = r && r.b;
  if (!b || !validDeviceId(b.deviceId)) return json({ error: 'bad_request' }, 400);
  const previo = await getDevice(env, b.deviceId);
  if (previo && (previo.kind !== 'bot' || previo.owner_org !== w.orgId)) return json({ error: 'forbidden' }, 403);
  const t = now();
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 60) : 'Bot de WhatsApp (en la app)';
  await upsertDevice(env, { id: b.deviceId, sub: w.a.sub, email: w.a.email, name, orgId: w.orgId, branchId: w.branchId, kind: 'bot' }, t);
  return json({ token: await signDeviceToken(env, { sub: w.a.sub, email: w.a.email, deviceId: b.deviceId }, t), email: w.a.email, deviceId: b.deviceId, expiresAt: t + DEVICE_TTL });
}

// El aviso no frena la respuesta: en el Worker sigue después de contestar; en las pruebas (sin `ctx`) se espera.
const esperar = (ctx, p) => (ctx && ctx.waitUntil ? ctx.waitUntil(p) : p);

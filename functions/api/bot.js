// El bot de WhatsApp (`functions/_lib/bot.js`; plan en `Nodo-Sur-Pos/docs/PLAN-BOT.md`). Todo desde un equipo vinculado a una
// sucursal: la app de Nodo Sur (PC o celular) o el bot mismo (`devices.kind = 'bot'`, un celular con Termux). La sesión web no lo usa.
//
// Quién hace qué:
//  * la app ve el estado, cambia la configuración (dueño o encargado), publica el catálogo y acepta o rechaza pedidos;
//  * el bot baja la configuración y el catálogo, manda pedidos y se entera de cómo se resolvieron.
import { json } from '../_lib/util.js';
import { actorOf } from '../_lib/actor.js';
import { hasDB } from '../_lib/db.js';
import { getMembership } from '../_lib/orgs.js';
import { puede } from '../_lib/permisos.js';
import { syncAccess } from '../_lib/sync.js';
import {
  botConfigurado, tieneBot, configValida, leerConfig, guardarConfig, itemsDeCatalogo, guardarCatalogo, leerCatalogo,
  pedidoDesdeBot, crearPedido, pedidosDesde, resolverPedido, avisarBot, botsDeSucursal, MAX_CONFIG_BYTES,
} from '../_lib/bot.js';

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
export async function onRequestConfigGet({ request, env }) {
  const w = await equipo(request, env); if (w.error) return w.error;
  return json(await leerConfig(env, w.orgId, w.branchId));
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

// POST /api/bot/pedido (el bot): `{ id, cliente: { nombre, telefono }, items: [{ gid?, nombre, cantidad, precioCentavos? }], nota? }`.
// Entra "por confirmar" y despierta a la app. Reintentar con el mismo `id` no lo duplica.
export async function onRequestPedidoPost({ request, env, ctx }) {
  const w = await equipo(request, env, { bot: true }); if (w.error) return w.error;
  const r = await cuerpo(request, 64 * 1024);
  if (r && r.grande) return json({ error: 'too_large' }, 413);
  const pedido = r && pedidoDesdeBot(r.b);
  if (!pedido) return json({ error: 'bad_request' }, 400);
  const p = await crearPedido(env, w.orgId, w.branchId, pedido);
  if (!p.repetido) await esperar(ctx, avisarBot(env, w.orgId, w.branchId, { para: 'equipos', aviso: { pedido: p.id } }));
  return json({ ok: true, id: p.id, repetido: p.repetido }, p.repetido ? 200 : 201);
}

// GET /api/bot/pedidos?desde=<ms> (la app o el bot): lo que cambió después de `desde`, con `hasta` para la próxima vez.
export async function onRequestPedidosGet({ request, env }) {
  const w = await equipo(request, env); if (w.error) return w.error;
  const desde = Number(new URL(request.url).searchParams.get('desde') ?? 0);
  if (!Number.isSafeInteger(desde) || desde < 0) return json({ error: 'bad_request' }, 400);
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

// El aviso no frena la respuesta: en el Worker sigue después de contestar; en las pruebas (sin `ctx`) se espera.
const esperar = (ctx, p) => (ctx && ctx.waitUntil ? ctx.waitUntil(p) : p);

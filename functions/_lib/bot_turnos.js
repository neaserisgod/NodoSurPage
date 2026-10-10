// Turnos del bot de WhatsApp de un negocio de servicios (El dueño, 2026-10-10; `Nodo-Sur-Pos/docs/PLAN-SERVICIOS.md`, etapa 5, y
// `REGLAS-NEGOCIO.md` §21). Mismo camino que los pedidos (`bot.js`): el sitio no ve las bases, solo guarda lo que hace falta para
// que el bot y la app no den dos veces el mismo horario.
//
//  * El BOT reserva un turno (`reservarTurno`). La reserva es UNA sentencia SQL que inserta solo si no hay otro turno que ocupe ese
//    horario: D1 ejecuta cada sentencia de forma atómica, así que dos clientes que eligen las 10:00 a la vez no quedan los dos
//    adentro (uno recibe "ocupado"). No hace falta un Durable Object para esto.
//  * La APP publica lo que ocupa su agenda (`publicarOcupados`): solo inicio, fin y profesional de los turnos que cargó ella, sin
//    nombres ni teléfonos. Con eso el bot no ofrece un horario que ya dio la dueña. La app puede dar sobreturnos (§21); el bot no.
//  * Los dos se enteran de los cambios del otro con `turnosDesde` (cursor en milisegundos, como los pedidos): la app baja a su
//    Agenda los turnos del bot y el bot se entera si la dueña movió o canceló uno, para avisarle al cliente.
//
// Lo que tiene datos de clientes (los turnos del bot) va cifrado, como los pedidos.
import { cifrar, descifrar } from './backups.js';
import { once } from './util.js';

export const ESTADOS_TURNO = ['esperando_sena', 'confirmado', 'atendido', 'no_vino', 'cancelado'];
const OCUPAN = "('esperando_sena', 'confirmado', 'atendido')";
export const MAX_TURNOS_LISTA = 200;
export const MAX_OCUPADOS = 1000;
const VIDA_TURNO_MS = 30 * 24 * 3600 * 1000; // un turno que terminó hace más de 30 días ya no le sirve a nadie
const MAX_DURACION_MS = 12 * 3600 * 1000;
const MAX_ADELANTE_MS = 400 * 24 * 3600 * 1000;

const DDL = [
  // `turno_id` lo inventa quien lo crea (el bot, o el `global_id` del turno en la app): reintentar no lo duplica. `inicio` y `fin` en
  // milisegundos. `profesional`: '' = el negocio de una sola persona (o "cualquiera").
  `CREATE TABLE IF NOT EXISTS bot_turnos (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
     turno_id TEXT NOT NULL, origen TEXT NOT NULL, estado TEXT NOT NULL, profesional TEXT NOT NULL DEFAULT '', inicio INTEGER NOT NULL,
     fin INTEGER NOT NULL, datos_enc TEXT, creado INTEGER NOT NULL, actualizado INTEGER NOT NULL, UNIQUE (org_id, branch_id, turno_id))`,
  `CREATE INDEX IF NOT EXISTS idx_bot_turnos_horario ON bot_turnos(org_id, branch_id, inicio)`,
  `CREATE INDEX IF NOT EXISTS idx_bot_turnos_cambio ON bot_turnos(org_id, branch_id, actualizado)`,
];
export const ensureTablaTurnos = (env) => once(env, 'bot_turnos', async () => { for (const sql of DDL) await env.DB.prepare(sql).run(); });

const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const cifrarJson = async (env, v) => b64(await cifrar(env, new TextEncoder().encode(JSON.stringify(v))));
const descifrarJson = async (env, s) => JSON.parse(new TextDecoder().decode(await descifrar(env, unb64(s))));

export const turnoIdValido = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);
const profesionalValido = (s) => s === undefined || s === '' || (typeof s === 'string' && /^[\w-]{1,64}$/.test(s));

// El horario: enteros en ms, que termine después de empezar, no más de 12 h, ni de hace más de un día ni de dentro de más de 400.
export function horarioValido(inicio, fin, tMs = Date.now()) {
  return Number.isSafeInteger(inicio) && Number.isSafeInteger(fin) && fin > inicio && fin - inicio <= MAX_DURACION_MS
    && inicio > tMs - 24 * 3600 * 1000 && inicio < tMs + MAX_ADELANTE_MS;
}

// Lo que manda el bot al reservar, limpio. null si algo no sirve.
export function turnoDesdeBot(b, tMs = Date.now()) {
  if (!b || typeof b !== 'object' || !turnoIdValido(b.id)) return null;
  if (!horarioValido(b.inicio, b.fin, tMs) || !profesionalValido(b.profesional)) return null;
  if (!['confirmado', 'esperando_sena'].includes(b.estado)) return null;
  const c = b.cliente;
  if (!c || typeof c.nombre !== 'string' || !c.nombre.trim() || c.nombre.length > 80) return null;
  if (typeof c.telefono !== 'string' || !/^\d{8,15}$/.test(c.telefono)) return null;
  const s = b.servicio;
  if (!s || typeof s.nombre !== 'string' || !s.nombre.trim() || s.nombre.length > 120) return null;
  if (s.gid !== undefined && (typeof s.gid !== 'string' || !/^[\w-]{1,64}$/.test(s.gid))) return null;
  if (b.senaPedidaCentavos !== undefined && (!Number.isSafeInteger(b.senaPedidaCentavos) || b.senaPedidaCentavos < 0)) return null;
  if (b.senaVence !== undefined && !Number.isSafeInteger(b.senaVence)) return null;
  if (b.nota !== undefined && (typeof b.nota !== 'string' || b.nota.length > 300)) return null;
  return {
    turnoId: b.id, inicio: b.inicio, fin: b.fin, profesional: b.profesional || '', estado: b.estado,
    datos: {
      cliente: { nombre: c.nombre.trim(), telefono: c.telefono },
      servicio: { ...(s.gid ? { gid: s.gid } : {}), nombre: s.nombre.trim() },
      ...(b.senaPedidaCentavos ? { senaPedidaCentavos: b.senaPedidaCentavos } : {}),
      ...(b.senaVence ? { senaVence: b.senaVence } : {}),
      ...(b.nota && b.nota.trim() ? { nota: b.nota.trim() } : {}),
    },
  };
}

// Si choca con otro turno que ocupa su horario. Con profesional '' choca con cualquiera (un negocio de una sola persona); con uno
// puesto, con los de esa persona y con los de "cualquiera".
const CHOQUE = `SELECT 1 FROM bot_turnos o WHERE o.org_id = ?1 AND o.branch_id = ?2 AND o.estado IN ${OCUPAN}
  AND o.inicio < ?5 AND o.fin > ?4 AND (?3 = '' OR o.profesional = '' OR o.profesional = ?3) AND o.turno_id != ?6`;

// Reserva el turno del bot: `{ id, repetido }`, o `{ ocupado: true }` si el horario ya lo tiene otro. Reintentar con el mismo id
// devuelve el que ya estaba.
export async function reservarTurno(env, orgId, branchId, t, tMs = Date.now()) {
  await ensureTablaTurnos(env);
  const ya = await env.DB.prepare('SELECT id FROM bot_turnos WHERE org_id = ?1 AND branch_id = ?2 AND turno_id = ?3').bind(orgId, branchId, t.turnoId).first();
  if (ya) return { id: ya.id, repetido: true };
  const r = await env.DB.prepare(
    `INSERT INTO bot_turnos (org_id, branch_id, turno_id, origen, estado, profesional, inicio, fin, datos_enc, creado, actualizado)
     SELECT ?1, ?2, ?6, 'bot', ?7, ?3, ?4, ?5, ?8, ?9, ?9 WHERE NOT EXISTS (${CHOQUE})
     ON CONFLICT(org_id, branch_id, turno_id) DO NOTHING`
  ).bind(orgId, branchId, t.profesional, t.inicio, t.fin, t.turnoId, t.estado, await cifrarJson(env, t.datos), tMs).run();
  if (!r.meta.changes) {
    const otra = await env.DB.prepare('SELECT id FROM bot_turnos WHERE org_id = ?1 AND branch_id = ?2 AND turno_id = ?3').bind(orgId, branchId, t.turnoId).first();
    return otra ? { id: otra.id, repetido: true } : { ocupado: true };
  }
  await env.DB.prepare('DELETE FROM bot_turnos WHERE org_id = ?1 AND branch_id = ?2 AND fin < ?3').bind(orgId, branchId, tMs - VIDA_TURNO_MS).run();
  return { id: Number(r.meta.last_row_id), repetido: false };
}

// Lo que publica la app: `[{ id, inicio, fin, profesional?, estado }]`, los turnos que cargó ella de hoy en adelante. Reemplaza lo
// anterior de la app: un turno que ya no viene (se borró, o pasó a ser de otro día que ya no se manda) deja de ocupar. Los turnos
// del bot no se tocan por acá (cambian con `cambiarTurno`). Devuelve si algo cambió (para no despertar al bot de más).
export function ocupadosDesdeApp(lista, tMs = Date.now()) {
  if (!Array.isArray(lista) || lista.length > MAX_OCUPADOS) return null;
  const limpios = [];
  for (const x of lista) {
    if (!x || typeof x !== 'object' || !turnoIdValido(x.id)) return null;
    if (!horarioValido(x.inicio, x.fin, tMs) || !profesionalValido(x.profesional) || !ESTADOS_TURNO.includes(x.estado)) return null;
    limpios.push({ turnoId: x.id, inicio: x.inicio, fin: x.fin, profesional: x.profesional || '', estado: x.estado });
  }
  return limpios;
}

export async function publicarOcupados(env, orgId, branchId, lista, tMs = Date.now()) {
  await ensureTablaTurnos(env);
  const previos = new Map((await env.DB.prepare(
    "SELECT turno_id, estado, profesional, inicio, fin FROM bot_turnos WHERE org_id = ?1 AND branch_id = ?2 AND origen = 'app'"
  ).bind(orgId, branchId).all()).results.map((f) => [f.turno_id, f]));
  const sentencias = [];
  const vienen = new Set();
  for (const x of lista) {
    vienen.add(x.turnoId);
    const p = previos.get(x.turnoId);
    if (p && p.estado === x.estado && p.profesional === x.profesional && p.inicio === x.inicio && p.fin === x.fin) continue;
    sentencias.push(env.DB.prepare(
      `INSERT INTO bot_turnos (org_id, branch_id, turno_id, origen, estado, profesional, inicio, fin, datos_enc, creado, actualizado)
       VALUES (?1, ?2, ?3, 'app', ?4, ?5, ?6, ?7, NULL, ?8, ?8)
       ON CONFLICT(org_id, branch_id, turno_id) DO UPDATE SET estado = ?4, profesional = ?5, inicio = ?6, fin = ?7,
         actualizado = MAX(?8, actualizado + 1) WHERE origen = 'app'`
    ).bind(orgId, branchId, x.turnoId, x.estado, x.profesional, x.inicio, x.fin, tMs));
  }
  // Lo de la app que ya no viene y todavía no terminó: deja de ocupar (se marca cancelado, así el bot se entera por el cursor).
  for (const [id, p] of previos) {
    if (!vienen.has(id) && p.fin > tMs && p.estado !== 'cancelado') {
      sentencias.push(env.DB.prepare(
        "UPDATE bot_turnos SET estado = 'cancelado', actualizado = MAX(?4, actualizado + 1) WHERE org_id = ?1 AND branch_id = ?2 AND turno_id = ?3"
      ).bind(orgId, branchId, id, tMs));
    }
  }
  for (const s of sentencias) await s.run();
  return sentencias.length > 0;
}

// Un cambio de estado o de horario de un turno que ya está: la app mueve, cancela, marca "no vino" o cobra uno del bot; el bot
// confirma la seña o el cliente cancela o lo cambia por WhatsApp. Si lo mueve el bot, no puede pisar otro (la app sí: sobreturno).
// `{ ok }`, `{ error: 'no_existe' }` o `{ ocupado: true }`.
export async function cambiarTurno(env, orgId, branchId, { turnoId, estado, inicio, fin }, { controlarChoque }, tMs = Date.now()) {
  await ensureTablaTurnos(env);
  const f = await env.DB.prepare('SELECT * FROM bot_turnos WHERE org_id = ?1 AND branch_id = ?2 AND turno_id = ?3').bind(orgId, branchId, turnoId).first();
  if (!f) return { error: 'no_existe' };
  const nuevoInicio = inicio ?? f.inicio, nuevoFin = fin ?? f.fin, nuevoEstado = estado ?? f.estado;
  const sql = `UPDATE bot_turnos SET estado = ?7, inicio = ?4, fin = ?5, actualizado = MAX(?8, actualizado + 1)
    WHERE org_id = ?1 AND branch_id = ?2 AND turno_id = ?6${controlarChoque ? ` AND NOT EXISTS (${CHOQUE})` : ''}`;
  const r = await env.DB.prepare(sql).bind(orgId, branchId, f.profesional, nuevoInicio, nuevoFin, turnoId, nuevoEstado, tMs).run();
  return r.meta.changes ? { ok: true } : { ocupado: true };
}

const turnoPublico = async (env, f) => ({
  id: f.turno_id, origen: f.origen, estado: f.estado, profesional: f.profesional, inicio: f.inicio, fin: f.fin,
  ...(f.datos_enc ? await descifrarJson(env, f.datos_enc) : {}), actualizado: f.actualizado,
});

// Lo que cambió después de `desde` (ms), en orden: la app ve los turnos nuevos del bot, el bot ve lo que ocupa la app y los
// cambios que la dueña le hizo a los suyos.
export async function turnosDesde(env, orgId, branchId, desde = 0) {
  await ensureTablaTurnos(env);
  const filas = (await env.DB.prepare(
    'SELECT * FROM bot_turnos WHERE org_id = ?1 AND branch_id = ?2 AND actualizado > ?3 ORDER BY actualizado, id LIMIT ?4'
  ).bind(orgId, branchId, desde, MAX_TURNOS_LISTA).all()).results;
  const turnos = [];
  for (const f of filas) turnos.push(await turnoPublico(env, f));
  return { turnos, hasta: filas.length ? filas[filas.length - 1].actualizado : desde, mas: filas.length === MAX_TURNOS_LISTA };
}

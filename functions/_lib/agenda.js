// Los horarios ocupados de la agenda de una sucursal (Nodo Sur para servicios, `Nodo-Sur-Pos/docs/PLAN-SERVICIOS.md` etapa 5,
// `REGLAS-NEGOCIO.md` §21). Viven en el SQLite del Durable Object de la sync de esa sucursal (`sync_hub.js`), porque un
// Durable Object atiende de a un pedido: "¿está libre?" y "anotalo" pasan juntos, sin nada en el medio, y dos equipos
// (dos celulares, o el bot de WhatsApp y un celular) no pueden dar el mismo horario sin verse.
//
// Solo guarda lo que hace falta para decidir: el turno (su `global_id` de la app), el profesional ('' si la agenda es una
// sola), inicio y fin. Ni el cliente ni el servicio: eso viaja cifrado por la sync. Las horas son texto local del negocio,
// 'YYYY-MM-DD HH:MM' (como las guardan la app y el bot): comparar el texto es comparar la hora.

const HORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

// Los turnos que terminaron hace más de esto se borran (al reservar): ya no chocan con nada.
export const DIAS_QUE_SE_GUARDAN = 7;

export function crearTablaAgenda(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS agenda (
    id TEXT PRIMARY KEY,
    profesional TEXT NOT NULL DEFAULT '',
    inicio TEXT NOT NULL,
    fin TEXT NOT NULL,
    por TEXT,
    creado INTEGER NOT NULL
  )`);
  sql.exec('CREATE INDEX IF NOT EXISTS agenda_inicio ON agenda (inicio)');
}

// Un pedido de reserva válido, o null.
export function leerReserva(d) {
  if (!d || typeof d !== 'object') return null;
  const { id, inicio, fin } = d;
  const profesional = d.profesional == null ? '' : String(d.profesional);
  if (!ID.test(String(id || '')) || !HORA.test(String(inicio || '')) || !HORA.test(String(fin || ''))) return null;
  if (!(inicio < fin) || inicio.slice(0, 10) !== fin.slice(0, 10)) return null; // un turno no cruza la medianoche
  if (profesional && !ID.test(profesional)) return null;
  return { id, profesional, inicio, fin, porProfesional: d.porProfesional !== false };
}

// Reserva (o mueve: el mismo id) un horario. Si choca con otro del mismo profesional (o con cualquiera, si la agenda es una
// sola), no anota nada y devuelve con cuál. TODO sincrónico a propósito: nada de `await` entre el chequeo y la escritura.
export function reservar(sql, r, { por = null, ahora = Date.now() } = {}) {
  const choca = sql.exec(
    `SELECT id, profesional, inicio, fin FROM agenda
     WHERE id != ? AND inicio < ? AND ? < fin ${r.porProfesional ? 'AND profesional = ?' : ''} LIMIT 1`,
    ...[r.id, r.fin, r.inicio, ...(r.porProfesional ? [r.profesional] : [])],
  ).toArray()[0];
  if (choca) return { ok: false, choca };
  sql.exec(
    `INSERT INTO agenda (id, profesional, inicio, fin, por, creado) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET profesional = excluded.profesional, inicio = excluded.inicio, fin = excluded.fin, por = excluded.por`,
    r.id, r.profesional, r.inicio, r.fin, por, ahora,
  );
  const limite = new Date(ahora - DIAS_QUE_SE_GUARDAN * 86400000).toISOString().slice(0, 10);
  sql.exec('DELETE FROM agenda WHERE fin < ?', `${limite} 00:00`);
  return { ok: true };
}

// Libera el horario de un turno (cancelado, no vino, o borrado). Liberar uno que no estaba no es un error.
export function liberar(sql, id) {
  if (!ID.test(String(id || ''))) return false;
  sql.exec('DELETE FROM agenda WHERE id = ?', id);
  return true;
}

// Los horarios ocupados entre dos días (inclusive), por hora.
export function ocupados(sql, desde, hasta) {
  if (!DIA.test(String(desde || '')) || !DIA.test(String(hasta || '')) || hasta < desde) return null;
  return sql.exec('SELECT id, profesional, inicio, fin FROM agenda WHERE inicio >= ? AND inicio <= ? ORDER BY inicio', `${desde} 00:00`, `${hasta} 23:59`).toArray();
}

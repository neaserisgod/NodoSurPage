// El asistente de la página (El dueño, 2026-10-17: "un bot exclusivo para la página, que sirva de soporte técnico y busque
// conversión"). Lo común lo contesta el guión del navegador (`/soporte.js`, gratis); lo que el guión no sabe llega acá y lo
// contesta la IA de Google (Gemini) con la clave de Nodo Sur (secreto `SOPORTE_GEMINI_KEY`), leyendo solo lo que el sitio ya dice
// (`soporte_datos.js`, armado desde llms.txt y las preguntas de cada página). Cuando la persona muestra interés, el asistente
// propone el plan que le sirve y el botón de probarlo 7 días.
//
// Cuidados:
//  * no se guarda la charla: solo un contador por día (por IP con hash, y uno total) para que nadie la use de más;
//  * la charla que manda el navegador se recorta (últimos mensajes, largo de cada uno);
//  * si la IA no está configurada, no contesta o pasa el tope, el navegador ofrece seguir por WhatsApp.
import { once } from './util.js';
import { sha256Hex } from './backups.js';
import { CONOCIMIENTO, PREGUNTAS } from './soporte_datos.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
export const MODELO_SOPORTE = 'gemini-2.5-flash-lite';
export const PLANES_SOPORTE = ['emprendedor', 'pos', 'bot', 'pos-bot', 'ninguno'];
export const MAX_MENSAJES = 12;
export const MAX_LARGO = 600;
export const TOPE_POR_IP = 40;
export const TOPE_TOTAL = 3000;

const DDL = [
  `CREATE TABLE IF NOT EXISTS soporte_uso (clave TEXT PRIMARY KEY, dia TEXT NOT NULL, n INTEGER NOT NULL)`,
];
const ensure = (env) => once(env, 'soporte', async () => { for (const sql of DDL) await env.DB.prepare(sql).run(); });

export const soporteConIa = (env) => Boolean(env.DB && typeof env.SOPORTE_GEMINI_KEY === 'string' && env.SOPORTE_GEMINI_KEY.length >= 20);

// `[{ rol: 'yo' | 'asistente', texto }]` → la charla limpia, o null si no sirve. El último mensaje es de la persona.
export function charlaValida(mensajes) {
  if (!Array.isArray(mensajes) || !mensajes.length) return null;
  const limpia = [];
  for (const m of mensajes.slice(-MAX_MENSAJES)) {
    if (!m || (m.rol !== 'yo' && m.rol !== 'asistente') || typeof m.texto !== 'string') return null;
    const texto = m.texto.trim().slice(0, MAX_LARGO);
    if (texto) limpia.push({ rol: m.rol, texto });
  }
  if (!limpia.length || limpia[limpia.length - 1].rol !== 'yo') return null;
  return limpia;
}

const diaDe = (tMs) => new Date(tMs - 3 * 3600 * 1000).toISOString().slice(0, 10); // el día en Argentina

// Suma uno al contador de la IP y al total del día. False si alguno ya llegó al tope (y entonces no suma).
export async function usarCupo(env, ip, tMs = Date.now()) {
  await ensure(env);
  const dia = diaDe(tMs);
  const claveIp = `ip:${(await sha256Hex(new TextEncoder().encode(`${env.BACKUP_KEY || ''}|${ip || 'sin-ip'}`))).slice(0, 32)}`;
  const tope = { [claveIp]: TOPE_POR_IP, total: Number(env.SOPORTE_TOPE_DIA) > 0 ? Number(env.SOPORTE_TOPE_DIA) : TOPE_TOTAL };
  for (const clave of [claveIp, 'total']) {
    const f = await env.DB.prepare('SELECT dia, n FROM soporte_uso WHERE clave = ?1').bind(clave).first();
    if (f && f.dia === dia && f.n >= tope[clave]) return false;
  }
  for (const clave of [claveIp, 'total']) {
    await env.DB.prepare(
      `INSERT INTO soporte_uso (clave, dia, n) VALUES (?1, ?2, 1)
       ON CONFLICT(clave) DO UPDATE SET n = CASE WHEN dia = ?2 THEN n + 1 ELSE 1 END, dia = ?2`
    ).bind(clave, dia).run();
  }
  return true;
}

function instrucciones(pagina) {
  const preguntas = PREGUNTAS.map((x) => `[${x.pagina}] P: ${x.p}\nR: ${x.r}`).join('\n\n');
  return `Sos el asistente de la página de Nodo Sur (horsepos.com): soporte y ventas. Hablás en español rioplatense, de "vos", corto
(2 a 5 oraciones), claro y amable, sin jerga técnica. Hablás como Nodo Sur ("tenemos", "te ayudamos"), nunca como una IA.

Reglas:
- Contestá SOLO con lo que dice la información de abajo. Si no está, decí que no lo sabés seguro y ofrecé seguir por WhatsApp
  (marcá "persona": true). Nunca inventes precios, funciones, plazos ni promesas.
- Si preguntan cómo se usa algo, explicalo paso a paso con lo que dice la información; si no alcanza, "persona": true.
- Si la persona muestra interés (pregunta precio, si le sirve para su negocio, cómo empezar), recomendá UN plan y decí que
  se prueba 7 días gratis; poné ese plan en "plan": "emprendedor" (servicios con turnos: uñas, peluquería, barbería,
  estética), "pos" (kiosco, almacén, comercio: el sistema de caja), "bot" (solo el bot de WhatsApp), "pos-bot" (sistema + bot).
  Si no corresponde ninguno, "ninguno".
- Si pide hablar con alguien, tiene un problema que no se resuelve con la información o algo de su cuenta o un pago,
  "persona": true.
- No pidas ni aceptes datos sensibles (contraseñas, tarjetas, claves).

La persona está mirando la página ${pagina}.

INFORMACIÓN DE NODO SUR:
${CONOCIMIENTO}

PREGUNTAS FRECUENTES DEL SITIO (entre corchetes, la página donde está cada una):
${preguntas}`;
}

const paginaValida = (p) => (typeof p === 'string' && /^\/[\w\-/]{0,80}$/.test(p) ? p : '/');

// La respuesta de la IA: `{ texto, plan, persona }`, o `{ error, status? }` si no contestó algo usable (el estado de Google va en el
// error para saber qué pasó sin adivinar: nunca trae la clave).
export async function contestarConIa(env, { mensajes, pagina }) {
  const modelo = typeof env.SOPORTE_MODELO === 'string' && /^[\w.-]{1,64}$/.test(env.SOPORTE_MODELO) ? env.SOPORTE_MODELO : MODELO_SOPORTE;
  const r = await fetch(`${GEMINI}/models/${modelo}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': env.SOPORTE_GEMINI_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instrucciones(paginaValida(pagina)) }] },
      contents: mensajes.map((m) => ({ role: m.rol === 'yo' ? 'user' : 'model', parts: [{ text: m.texto }] })),
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          // Sin `enum`: no todos los modelos lo aceptan en el esquema (con él, Google rechazaba el pedido). El plan se valida acá.
          properties: { texto: { type: 'STRING' }, plan: { type: 'STRING' }, persona: { type: 'BOOLEAN' } },
          required: ['texto', 'plan', 'persona'],
        },
      },
    }),
  });
  if (!r.ok) {
    let motivo = '';
    try { motivo = String((await r.json())?.error?.message || '').slice(0, 200); } catch { /* sin cuerpo */ }
    console.error('soporte_google', r.status, motivo);
    return { error: 'google', status: r.status, motivo };
  }
  let j;
  try { j = await r.json(); } catch { return { error: 'respuesta_rara' }; }
  const crudo = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let x;
  try { x = JSON.parse(crudo); } catch { return { error: 'respuesta_rara', fin: j?.candidates?.[0]?.finishReason || null }; }
  const texto = typeof x.texto === 'string' ? x.texto.trim().slice(0, 1200) : '';
  if (!texto) return { error: 'respuesta_vacia' };
  return { texto, plan: PLANES_SOPORTE.includes(x.plan) && x.plan !== 'ninguno' ? x.plan : null, persona: x.persona === true };
}

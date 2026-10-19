import { json, sameOriginPost } from '../../_lib/util.js';
import { currentUser } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { createDeviceCode, validPort, validState, validChallenge, validDeviceId, cleanName } from '../../_lib/devices.js';
import { destinoDelDispositivo } from '../../_lib/vincular.js';
import { productoDeEdicion } from '../../_lib/productos.js';
import { otroProducto } from './google.js';

// Paso 2-3 de la vinculación: la persona, ya con sesión y tras confirmar en /vincular/, pide el código de
// un solo uso. Se devuelve a dónde redirigir el navegador: el servidor local que escucha la app (127.0.0.1).
// La PC queda en un negocio y una sucursal: opcionalmente `orgId` y `branchId` (solo el dueño de ese negocio puede
// vincular PC); sin ellos, el primer negocio de la persona y su sucursal principal. Quien todavía no tiene negocio
// recibe el suyo, con su "Sucursal principal". Un encargado o un empleado no vinculan PC.
// Un CELULAR (`tipo: 'celular'`) lo vincula cada miembro con SU cuenta, en una de SUS sucursales: así el celular sabe quién es
// (no hay selector de perfil) y sincroniza la sucursal donde trabaja.
// El BOT de WhatsApp (`tipo: 'bot'`, un celular con Termux; `Nodo-Sur-Pos/docs/PLAN-BOT.md`) lo vincula el dueño o un encargado
// (`configurar_bot`), en una sucursal de un negocio que ya existe: vincular un bot no crea un negocio.
export async function onRequestPost({ request, env }) {
  if (!sameOriginPost(request, env) || request.headers.get('X-Requested-With') !== 'fetch') return json({ error: 'forbidden' }, 403);
  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return json({ error: 'no_session' }, 401);
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  // `web: true`: Nodo Sur Servicios en el navegador (horsepos.com/app/). Se vincula como un celular (cada persona con su cuenta, en una
  // de sus sucursales) y el código vuelve a /app/ de este mismo sitio: no hay servidor local al que mandarlo.
  const enNavegador = b.web === true;
  if (enNavegador && b.tipo != null && b.tipo !== 'celular') return json({ error: 'bad_request' }, 400);
  if ((enNavegador ? b.port != null : !validPort(b.port)) || !validState(b.state) || !validChallenge(b.challenge) || !validDeviceId(b.deviceId)) return json({ error: 'bad_request' }, 400);
  const celular = enNavegador || b.tipo === 'celular';
  const bot = b.tipo === 'bot';
  // Una PC es siempre la caja del almacén (Nodo Gestión): las de Estudio y Gastro en Windows entran como celular.
  const producto = bot ? null : celular ? productoDeEdicion(b.edicion) : 'gestion';
  const destino = await destinoDelDispositivo(env, cu.session, { tipo: bot ? 'bot' : celular ? 'celular' : 'pc', orgId: b.orgId, branchId: b.branchId, producto });
  if (destino.error) return json(otroProducto(destino), destino.status);
  const { org, branch } = destino;
  const sub = cu.session.sub;
  const code = await createDeviceCode(env, {
    sub, email: cu.session.email, deviceId: b.deviceId, name: cleanName(b.name), challenge: b.challenge, orgId: org.id, branchId: branch.id, personName: cu.session.name,
    kind: bot ? 'bot' : celular ? 'celular' : 'pc',
  });
  const vuelta = enNavegador ? '/app/?' : `http://127.0.0.1:${b.port}/callback?`;
  return json({ redirect: `${vuelta}code=${encodeURIComponent(code)}&state=${encodeURIComponent(b.state)}` });
}

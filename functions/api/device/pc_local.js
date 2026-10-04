import { json } from '../../_lib/util.js';
import { actorOf } from '../../_lib/actor.js';
import { readJson } from '../../_lib/miembros.js';
import { syncReady, syncAccess, scopeDeSync } from '../../_lib/sync.js';
import { guardarPcLocal, pcLocalDe, ipLocalValida } from '../../_lib/pc_local.js';
import { orgsWith } from '../../_lib/orgs.js';

// POST: la PC vinculada avisa dónde está en el wifi del local. GET: un celular de la misma sucursal lo pide para
// conectarse solo. Mismas reglas que sincronizar: quien opera la sucursal, con el negocio al día. El alcance sale
// siempre del dispositivo autenticado, nunca del pedido.
async function quien(request, env, { subir }) {
  const a = await actorOf(request, env);
  if (!a || a.via !== 'device') return { error: json({ error: 'no_device' }, 401) };
  if (!syncReady(env)) return { error: json({ error: 'sync_no_configurada' }, 503) };
  const acc = await syncAccess(env, a);
  if (acc.error) return { error: json({ error: acc.error }, 503) };
  if (subir ? !acc.subir : !acc.bajar) return { error: json({ error: 'forbidden' }, 403) };
  return { a, scope: scopeDeSync(a) };
}

// Solo una PC publica dónde está (2026-10-03): si cualquier dispositivo de la sucursal pudiera, el celular de un empleado
// podría hacerse pasar por la PC y los demás celulares le mandarían las ventas a él. El tipo lo guarda el sitio al vincular
// (y una PC solo la vincula quien tiene `vincular_pc`, el dueño). Los vinculados antes de guardar el tipo valen solo si
// quien los vinculó puede vincular PC en ese negocio.
async function esPcDelLocal(env, device) {
  if (device.kind) return device.kind === 'pc';
  return (await orgsWith(env, device.owner_sub, 'vincular_pc')).some((o) => o.org.id === device.owner_org);
}

export async function onRequestPost({ request, env }) {
  const w = await quien(request, env, { subir: true }); if (w.error) return w.error;
  if (!(await esPcDelLocal(env, w.a.device))) return json({ error: 'solo_pc' }, 403);
  const b = await readJson(request);
  if (!b || !ipLocalValida(b.ip) || !Number.isInteger(b.puerto) || b.puerto < 1 || b.puerto > 65535
    || typeof b.token !== 'string' || !/^[A-Za-z0-9]{16,128}$/.test(b.token)) return json({ error: 'bad_request' }, 400);
  await guardarPcLocal(env, { scope: w.scope, deviceId: w.a.device.id, nombre: w.a.device.name, ip: b.ip, puerto: b.puerto, token: b.token });
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  const w = await quien(request, env, { subir: false }); if (w.error) return w.error;
  const pc = await pcLocalDe(env, w.scope);
  if (!pc) return json({ error: 'sin_pc' }, 404);
  return json(pc);
}

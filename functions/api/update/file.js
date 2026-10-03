import { hasR2, getRelease, streamRelease, esPublica, permisoValido } from '../../_lib/releases.js';
import { hasDB } from '../../_lib/db.js';

// Archivo de una actualización (va firmado). Solo entrega versiones registradas y no bloqueadas; una beta o una versión a
// medio liberar, solo con el permiso que dio el feed (`p`, ver `urlArchivo`).
export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1 || !hasDB(env) || !hasR2(env)) return new Response('No encontrado', { status: 404 });
  const rel = await getRelease(env, id);
  const p = new URL(request.url).searchParams.get('p');
  if (!rel || rel.blocked || (!esPublica(rel) && !(await permisoValido(env, p, rel.id)))) {
    return new Response('No encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return streamRelease(env, request, rel);
}

import { json, now, fetchConPlazo } from '../../_lib/util.js';
import { hasDB, upsertLogin } from '../../_lib/db.js';
import { validDeviceId, cleanName } from '../../_lib/devices.js';
import { orgsWith, membershipsOf, describirOrgs, crearOtroNegocio } from '../../_lib/orgs.js';
import { destinoDelDispositivo, emitirTokenDeDispositivo } from '../../_lib/vincular.js';

// El client ID Web que la app le pasa al selector de Google como `serverClientId` (no es secreto: viaja en cada página de
// ingreso). Así no queda escrito en el APK y cambiarlo no pide publicar una versión nueva.
export function onRequestGet({ env }) {
  return env.GOOGLE_CLIENT_ID ? json({ clientId: env.GOOGLE_CLIENT_ID }) : json({ error: 'no_config' }, 503);
}

// Entrar en el celular con Google SIN pasar por el navegador (El dueño, 2026-10-13: "la vinculación por el sitio es un paso
// medio innecesario"). La app pide la cuenta con el selector de Google de Android y manda acá el id_token; el sitio lo
// comprueba con Google y devuelve el token del celular, igual que /vincular/ + authorize + token, con las mismas reglas
// (`_lib/vincular.js`). Solo celulares: la PC y el bot siguen por el navegador.
//
// Si la persona puede entrar en más de un negocio o sucursal y la app no dijo cuál, se contesta `{ elegir: true, orgs }` y la
// app vuelve a llamar con `orgId` y `branchId` y el mismo id_token (vale una hora; no se consume).
//
// Una cuenta puede tener varios negocios (2026-10-13). Agregando otro negocio en el celular, la app manda `elegirSiempre: true`
// para que la lista salga aunque haya uno solo, y ofrece crear uno nuevo: `nuevoNegocio: "Barbería Juan"` lo crea (con su
// "Sucursal principal") y entra el celular ahí.
export async function onRequestPost({ request, env }) {
  if (!hasDB(env)) return json({ error: 'no_db' }, 503);
  if (!env.GOOGLE_CLIENT_ID) return json({ error: 'no_config' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  // Un id_token es un JWT (tres partes): lo que no tiene esa forma se rechaza sin preguntarle a Google.
  if (typeof b.idToken !== 'string' || b.idToken.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(b.idToken) || !validDeviceId(b.deviceId)) {
    return json({ error: 'bad_request' }, 400);
  }

  const claims = await comprobarConGoogle(env, b.idToken);
  if (!claims) return json({ error: 'google_invalido' }, 401);
  const persona = { sub: claims.sub, email: String(claims.email).toLowerCase(), name: claims.name || claims.email };
  await upsertLogin(env, persona, now());

  let pedido = { orgId: b.orgId, branchId: b.branchId };
  if (b.nuevoNegocio != null) {
    const creado = await crearOtroNegocio(env, persona, b.nuevoNegocio);
    if (creado.error) return json({ error: creado.error }, creado.status);
    pedido = { orgId: creado.org.id, branchId: creado.branch.id };
  } else if (b.orgId == null && b.branchId == null) {
    const orgs = await describirOrgs(env, (await orgsWith(env, persona.sub, 'vincular_celular')).map((x) => x.membership));
    const sinSucursal = !orgs.length && (await membershipsOf(env, persona.sub)).length;
    if (sinSucursal && b.elegirSiempre !== true) return json({ error: 'sin_sucursal', email: persona.email }, 403);
    if (orgs.length > 1 || (orgs.length === 1 && orgs[0].branches.length > 1) || (b.elegirSiempre === true && (orgs.length || sinSucursal))) {
      return json({ elegir: true, email: persona.email, name: persona.name, orgs: orgs.map((o) => ({ id: o.id, name: o.name, branches: o.branches })) });
    }
  }
  const destino = await destinoDelDispositivo(env, persona, { tipo: 'celular', ...pedido });
  if (destino.error) return json({ error: destino.error }, destino.status);
  const r = await emitirTokenDeDispositivo(env, {
    sub: persona.sub, email: persona.email, deviceId: b.deviceId, name: cleanName(b.name), orgId: destino.org.id, branchId: destino.branch.id,
    personName: persona.name, kind: 'celular',
  });
  return r.error ? json({ error: r.error }, r.status) : json(r);
}

// El id_token viene del celular, no directo de Google: se le pregunta a Google si es válido (firma incluida) en vez de
// leerlo a ciegas como hace el callback web. El `aud` es el client ID Web del sitio: la app lo pide con ese `serverClientId`.
async function comprobarConGoogle(env, idToken) {
  let c;
  try {
    const r = await fetchConPlazo(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!r.ok) return null;
    c = await r.json();
  } catch { return null; }
  const okIss = c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com';
  const verificado = c.email_verified === true || c.email_verified === 'true';
  if (!okIss || c.aud !== env.GOOGLE_CLIENT_ID || !(Number(c.exp) > now()) || !verificado || !c.email || !c.sub) return null;
  return c;
}

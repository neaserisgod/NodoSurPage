// Nodo Sur Servicios en el navegador: horsepos.com/app/ (El dueño, 2026-10-12; `Nodo-Sur-Pos/docs/PLAN-WEB-SERVICIOS.md`).
//
// La app compilada (Flutter web, ~20 MB) no vive en este repo: cambia con cada versión y llenaría el historial. La sube el
// workflow de Nodo-Sur-Pos a R2 (binding RELEASES, el mismo bucket de los instaladores) con `scripts/publicar-web.mjs`:
//   app/<version>/...        los archivos de esa compilación
//   app/<version>/manifest.json   la lista de archivos (para borrarla entera después)
//   app/actual.json          { version } — cuál se sirve. Se cambia último: pasar de una versión a otra es atómico.
//   app/versiones.json       las publicadas, de la más nueva a la más vieja (se guardan las últimas VERSIONES_WEB)
//
// Cabeceras propias, distintas del resto del sitio (`_headers`): la base de datos corre en el navegador como WebAssembly y,
// para guardarse de forma firme (OPFS), necesita aislamiento entre orígenes (COOP/COEP). Sin eso cae a IndexedDB, que en las
// pruebas perdía lo último escrito al cerrar la pestaña.

export const PREFIJO = 'app/';
export const VERSIONES_WEB = 3;
const MEMORIA_MS = 60_000;

export const CABECERAS_APP = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Robots-Tag': 'noindex',
  // Los nombres de los archivos no llevan la versión (los arma Flutter): se revalidan siempre con la ETag y vuelven en 304.
  'Cache-Control': 'no-cache',
};

const TIPOS = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json',
  wasm: 'application/wasm', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', bin: 'application/octet-stream', frag: 'application/octet-stream',
};
export const tipoDe = (ruta) => TIPOS[(ruta.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

// Una ruta de archivo dentro de la app: sin "..", sin barras dobles, solo caracteres comunes. null si no sirve.
export function rutaSegura(resto) {
  const r = resto === '' ? 'index.html' : resto.endsWith('/') ? `${resto}index.html` : resto;
  if (r.length > 300 || !/^[A-Za-z0-9._/-]+$/.test(r) || r.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return r;
}

// Cuál versión se sirve. Memoria de un minuto por instancia: pasar a una versión nueva tarda a lo sumo eso en verse.
let memoria = null;
export const olvidarVersion = () => { memoria = null; };
async function versionActual(env, ahora = Date.now()) {
  if (memoria && ahora - memoria.en < MEMORIA_MS) return memoria.version;
  const obj = await env.RELEASES.get(`${PREFIJO}actual.json`);
  let version = null;
  if (obj) { try { const j = JSON.parse(await obj.text()); if (typeof j.version === 'string' && /^[\w.+-]{1,40}$/.test(j.version)) version = j.version; } catch { /* roto: sin app */ } }
  memoria = { version, en: ahora };
  return version;
}

const noEncontrado = () => new Response('No encontrado', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

// GET/HEAD /app/... : el archivo de la versión actual.
export async function servirApp(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/app') return Response.redirect(`${url.origin}/app/${url.search}`, 301);
  return servirArchivo(request, env, rutaSegura(url.pathname.slice('/app/'.length)));
}

// GET/HEAD /demo/ : la demo (El dueño, 2026-10-12; `Nodo-Sur-Pos/docs/PLAN-DEMO-SERVICIOS.md`). Es la misma app: la página de
// /app/, que carga todo lo demás desde /app/ (su `<base href>`), y al ver que está en /demo/ arranca sin cuenta, con un negocio
// de ejemplo y todo en memoria. Por eso acá solo se sirve la página; cualquier otra ruta bajo /demo/ no existe.
export async function servirDemo(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/demo') return Response.redirect(`${url.origin}/demo/${url.search}`, 301);
  return servirArchivo(request, env, url.pathname === '/demo/' ? 'index.html' : null);
}

async function servirArchivo(request, env, ruta) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  if (!env.RELEASES) return noEncontrado();
  if (!ruta) return noEncontrado();
  const version = await versionActual(env);
  if (!version) {
    return new Response('Nodo Sur Servicios en el navegador todavía no está publicado.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const obj = await env.RELEASES.get(`${PREFIJO}${version}/${ruta}`, { onlyIf: request.headers });
  if (!obj) return noEncontrado();
  const h = new Headers(CABECERAS_APP);
  h.set('Content-Type', tipoDe(ruta));
  if (obj.httpEtag) h.set('ETag', obj.httpEtag);
  // `onlyIf` con If-None-Match: R2 devuelve el objeto sin cuerpo si no cambió.
  if (!('body' in obj) || obj.body == null) return new Response(null, { status: 304, headers: h });
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers: h });
}

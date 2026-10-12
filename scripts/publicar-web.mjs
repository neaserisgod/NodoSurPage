#!/usr/bin/env node
// Publica Nodo Sur Servicios en el navegador (horsepos.com/app/; `functions/_lib/app_web.js`): sube la carpeta de
// `flutter build web` a R2 bajo app/<version>/ y, al final, la deja como la que se sirve (app/actual.json). Borra las
// versiones más viejas que las últimas --keep.
//   node scripts/publicar-web.mjs --dir ../Nodo-Sur-Pos/build/web --version 1.0.0+2164 [--keep 3] [--bucket nodosur-releases] [--dry-run]
// Requiere: Node y Cloudflare Wrangler con CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID (los mismos de publicar-release).
import { readdirSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { tipoDe, rutaSegura, PREFIJO, VERSIONES_WEB } from '../functions/_lib/app_web.js';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const fail = (m) => { console.error(`Error: ${m}`); process.exit(1); };
const dir = arg('dir'), version = arg('version'), bucket = arg('bucket', 'nodosur-releases');
const keep = Number(arg('keep', String(VERSIONES_WEB)));
const dry = process.argv.includes('--dry-run');
if (!dir || !version) fail('faltan --dir o --version');
if (!/^[\w.+-]{1,40}$/.test(version)) fail('--version: letras, números y . + - (hasta 40)');
if (!Number.isInteger(keep) || keep < 1) fail('--keep: entero de 1 en adelante');

function archivos(base) {
  const out = [];
  const recorrer = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) recorrer(f); else out.push(relative(base, f).split(sep).join('/')); } };
  recorrer(base); return out.sort();
}
// Sin los símbolos de depuración del motor gráfico (.symbols) ni los archivos ocultos de la compilación: no los pide el navegador.
const lista = archivos(dir).filter((r) => !r.endsWith('.symbols') && !r.split('/').some((s) => s.startsWith('.')));
if (!lista.includes('index.html') || !lista.includes('main.dart.js')) fail(`${dir} no parece una compilación web de Flutter (falta index.html o main.dart.js)`);
for (const f of ['sqlite3.wasm', 'drift_worker.js']) if (!lista.includes(f)) fail(`falta ${f}: corré tool/preparar_web.sh antes de compilar`);
const malas = lista.filter((r) => rutaSegura(r) !== r);
if (malas.length) fail(`nombres de archivo que el sitio no serviría: ${malas.join(', ')}`);
const total = lista.reduce((s, r) => s + statSync(join(dir, r)).size, 0);
console.log(`Versión: ${version}\nArchivos: ${lista.length} (${(total / 1048576).toFixed(1)} MB)\nDestino: ${bucket}/${PREFIJO}${version}/`);
if (dry) { console.log('\n(--dry-run: no se subió nada)'); process.exit(0); }

const conWrangler = spawnSync('wrangler', ['--version'], { shell: true }).status === 0;
function wrangler(args, opciones = {}) {
  const r = spawnSync(conWrangler ? 'wrangler' : 'npx', [...(conWrangler ? [] : ['--yes', 'wrangler']), ...args, '--remote'], { shell: true, encoding: 'utf8', ...opciones });
  return r;
}
const subir = (clave, archivo, tipo) => { const r = wrangler(['r2', 'object', 'put', `${bucket}/${clave}`, '--file', JSON.stringify(archivo), '--content-type', JSON.stringify(tipo)], { stdio: 'inherit' }); if (r.status !== 0) fail(`no se pudo subir ${clave}`); };
const leer = (clave) => { const r = wrangler(['r2', 'object', 'get', `${bucket}/${clave}`, '--pipe']); if (r.status !== 0) return null; try { return JSON.parse(r.stdout); } catch { return null; } };
const borrar = (clave) => wrangler(['r2', 'object', 'delete', `${bucket}/${clave}`], { stdio: 'inherit' });
const tmp = mkdtempSync(join(tmpdir(), 'web-'));
const json = (nombre, valor) => { const f = join(tmp, nombre); writeFileSync(f, JSON.stringify(valor)); return f; };

// 1. Los archivos de esta versión (todavía no se sirven: app/actual.json sigue apuntando a la anterior).
for (const r of lista) subir(`${PREFIJO}${version}/${r}`, join(dir, r), tipoDe(r));
subir(`${PREFIJO}${version}/manifest.json`, json('manifest.json', { version, archivos: lista }), 'application/json');

// 2. Pasar a la nueva: un solo archivo, así nunca se sirve una mezcla de dos versiones.
const previas = (leer(`${PREFIJO}versiones.json`) || { versiones: [] }).versiones.filter((v) => v !== version);
const versiones = [version, ...previas];
subir(`${PREFIJO}actual.json`, json('actual.json', { version }), 'application/json');
subir(`${PREFIJO}versiones.json`, json('versiones.json', { versiones: versiones.slice(0, keep) }), 'application/json');

// 3. Las que sobran se borran enteras (con su lista de archivos).
for (const vieja of versiones.slice(keep)) {
  const m = leer(`${PREFIJO}${vieja}/manifest.json`);
  for (const r of (m && m.archivos) || []) borrar(`${PREFIJO}${vieja}/${r}`);
  borrar(`${PREFIJO}${vieja}/manifest.json`);
  console.log(`Borrada la versión vieja ${vieja}`);
}
console.log(`\nListo: horsepos.com/app/ sirve ${version} (los navegadores la ven en menos de un minuto).`);

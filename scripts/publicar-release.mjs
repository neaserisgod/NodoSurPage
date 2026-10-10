#!/usr/bin/env node
// Publica una versión del sistema POS: sube el archivo a R2 y la registra en el sitio.
//   RELEASE_TOKEN=... node scripts/publicar-release.mjs --file build/LaPlazoleta-Setup.exe --platform windows \
//     --version 1.0.0+2099 [--channel stable|beta] [--notes "Qué cambió"] [--signature <firma> --signature-type dsa|ed] [--rollout 10] [--mandatory] [--dry-run]
// Requiere: Node, Cloudflare Wrangler y el secreto RELEASE_TOKEN (el mismo que en Cloudflare).
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes(`--${name}`);
const fail = (m) => { console.error(`Error: ${m}`); process.exit(1); };

const file = arg('file'), platform = arg('platform'), version = arg('version'), channel = arg('channel', 'stable');
const rollout = Number(arg('rollout', '100')), bucket = arg('bucket', 'nodosur-releases');
const site = (process.env.SITE_URL || 'https://horsepos.com').replace(/\/$/, '');
const notes = arg('notes-file') ? readFileSync(arg('notes-file'), 'utf8').trim() : arg('notes');
const dry = flag('dry-run');

if (!file || !platform || !version) fail('faltan --file, --platform o --version');
if (!['windows', 'macos', 'linux', 'android', 'android-servicios'].includes(platform)) fail('--platform: windows | macos | linux | android | android-servicios');
if (!['stable', 'beta'].includes(channel)) fail('--channel: stable | beta');
if (!/^\d+\.\d+\.\d+(?:\.\d{1,9}|\+\d{1,9}|-[0-9A-Za-z.-]{1,32})?$/.test(version)) fail('--version debe verse como 1.0.0.2099, 1.0.0+2099 o 1.0.0');
if (arg('signature-type') && !['ed', 'dsa'].includes(arg('signature-type'))) fail('--signature-type: ed | dsa');
if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) fail('--rollout: entero de 0 a 100');
if (!dry && !process.env.RELEASE_TOKEN) fail('falta la variable de entorno RELEASE_TOKEN');

const size = statSync(file).size;
const sha256 = await new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const key = `${channel}/${version}/${basename(file).replace(/[^A-Za-z0-9._+-]/g, '-')}`;
const body = { action: 'create', platform, channel, version, key, sha256, rollout, mandatory: flag('mandatory'), notes: notes || undefined, signature: arg('signature'), signatureType: arg('signature-type'), releaseToken: process.env.RELEASE_TOKEN };

console.log(`Archivo:  ${file} (${(size / 1048576).toFixed(1)} MB)\nSHA-256:  ${sha256}\nClave R2: ${bucket}/${key}\nSitio:    ${site}\nLiberada: ${rollout} %${flag('mandatory') ? ' · obligatoria' : ''}`);
if (dry) { console.log('\n(--dry-run: no se subió ni registró nada)'); process.exit(0); }

const directWorker = 'https://broad-frog-1e4b.gtalovergamer.workers.dev';
const pareceDesafio = (res, text) => !res.ok && (text.includes('Just a moment') || text.includes('<!DOCTYPE html>') || text.includes('Cloudflare') || res.status === 403);
const encabezados = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'X-Release-Token': process.env.RELEASE_TOKEN,
  Authorization: `Bearer ${process.env.RELEASE_TOKEN}`,
};
// Pide al sitio y, si Cloudflare responde con su desafío anti-bot (pasa en CI), reintenta por el endpoint directo del Worker.
async function pedirAlSitio(init) {
  let res = await fetch(`${site}/api/admin/releases`, init);
  let text = await res.text().catch(() => '');
  if (pareceDesafio(res, text) && site !== directWorker) {
    console.log(`\nAviso: ${site} respondió con desafío anti-bot de Cloudflare. Reintentando por endpoint directo del Worker (${directWorker})...`);
    res = await fetch(`${directWorker}/api/admin/releases`, init);
    text = await res.text().catch(() => '');
  }
  return { res, text };
}

// ANTES de subir: si esta versión ya está registrada, cortar acá. Subir primero pisaba en R2 el archivo de la versión ya
// publicada (misma clave) y después el sitio rechazaba el registro: quedaba la firma y el SHA-256 viejos apuntando a un
// archivo nuevo, y la actualización fallaba en todos los equipos (pasó con la 2122 y con el APK 1.0.0+2129, 2026-10-03).
{
  const { res, text } = await pedirAlSitio({ headers: encabezados });
  let lista = null;
  try { lista = JSON.parse(text).releases; } catch {}
  if (!res.ok || !Array.isArray(lista)) fail(`no se pudo comprobar en el sitio si ${platform} ${version} ya existe (${res.status}); no se subió nada`);
  if (lista.some((r) => r.platform === platform && r.channel === channel && r.version === version)) {
    fail(`${platform} ${version} ya está publicada en ${channel}: no se subió nada. Usá un número de compilación más alto.`);
  }
}

// Si wrangler está en PATH se usa directo; si no, se invoca mediante npx --yes
const hasGlobalWrangler = spawnSync(process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler', ['--version'], { shell: true }).status === 0;
const comando = hasGlobalWrangler
  ? (process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler')
  : (process.platform === 'win32' ? 'npx.cmd' : 'npx');

const argumentos = hasGlobalWrangler
  ? ['r2', 'object', 'put', `${bucket}/${key}`, '--file', file, '--content-type', 'application/octet-stream', '--remote']
  : ['--yes', 'wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file, '--content-type', 'application/octet-stream', '--remote'];

const up = spawnSync(comando, argumentos, { 
  stdio: 'inherit',
  shell: true 
});

if (up.status !== 0) fail('no se pudo subir el archivo a R2');

const { res, text } = await pedirAlSitio({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...encabezados },
  body: JSON.stringify(body),
});

let out = {};
try { out = JSON.parse(text); } catch {}
if (!res.ok) {
  const detail = out.error || (text ? text.slice(0, 140).replace(/\s+/g, ' ').trim() : 'error');
  fail(`el sitio rechazó la versión (${res.status}: ${detail})${out.error === 'exists' ? ' — esa versión ya está publicada' : ''}`);
}
console.log(`\nListo: ${platform} ${version} publicada en ${channel}${rollout < 100 ? ` al ${rollout} %` : ''}. Subí el porcentaje desde el panel de administración cuando veas que anda bien.`);

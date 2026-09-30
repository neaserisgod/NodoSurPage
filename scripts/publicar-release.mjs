#!/usr/bin/env node
// Publica una versión del sistema POS: sube el archivo a R2 y la registra en el sitio.
//   RELEASE_TOKEN=... node scripts/publicar-release.mjs --file build/LaPlazoleta-Setup.exe --platform windows \
//     --version 1.0.0+2099 [--channel stable|beta] [--notes "Qué cambió"] [--signature <firma> --signature-type dsa|ed] [--rollout 10] [--mandatory] [--dry-run]
// Requiere: Node, `npx wrangler` con sesión iniciada (wrangler login) y el secreto RELEASE_TOKEN (el mismo que en Cloudflare).
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
if (!['windows', 'macos', 'linux', 'android'].includes(platform)) fail('--platform: windows | macos | linux | android');
if (!['stable', 'beta'].includes(channel)) fail('--channel: stable | beta');
if (!/^\d+\.\d+\.\d+(?:\.\d{1,9}|\+\d{1,9}|-[0-9A-Za-z.-]{1,32})?$/.test(version)) fail('--version debe verse como 1.0.0.2099, 1.0.0+2099 o 1.0.0');
if (arg('signature-type') && !['ed', 'dsa'].includes(arg('signature-type'))) fail('--signature-type: ed | dsa');
if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) fail('--rollout: entero de 0 a 100');
if (!dry && !process.env.RELEASE_TOKEN) fail('falta la variable de entorno RELEASE_TOKEN');

const size = statSync(file).size;
const sha256 = await new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const key = `${channel}/${version}/${basename(file).replace(/[^A-Za-z0-9._+-]/g, '-')}`;
const body = { action: 'create', platform, channel, version, key, sha256, rollout, mandatory: flag('mandatory'), notes: notes || undefined, signature: arg('signature'), signatureType: arg('signature-type') };

console.log(`Archivo:  ${file} (${(size / 1048576).toFixed(1)} MB)\nSHA-256:  ${sha256}\nClave R2: ${bucket}/${key}\nSitio:    ${site}\nLiberada: ${rollout} %${flag('mandatory') ? ' · obligatoria' : ''}`);
if (dry) { console.log('\n(--dry-run: no se subió ni registró nada)'); process.exit(0); }

const up = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file, '--content-type', 'application/octet-stream', '--remote'], { stdio: 'inherit' });
if (up.status !== 0) fail('no se pudo subir el archivo a R2');

const res = await fetch(`${site}/api/admin/releases`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RELEASE_TOKEN}` }, body: JSON.stringify(body) });
const out = await res.json().catch(() => ({}));
if (!res.ok) fail(`el sitio rechazó la versión (${res.status}: ${out.error || 'error'})${out.error === 'exists' ? ' — esa versión ya está publicada' : ''}`);
console.log(`\nListo: ${platform} ${version} publicada en ${channel}${rollout < 100 ? ` al ${rollout} %` : ''}. Subí el porcentaje desde el panel de administración cuando veas que anda bien.`);

// Fase 4: lo que necesitan las pantallas /negocio/, /unirse/ y /vincular/ (y el panel de administración).
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { sign } from '../functions/_lib/util.js';
import { createOrg, ensureOrgTables } from '../functions/_lib/orgs.js';
import { upsertDevice } from '../functions/_lib/devices.js';
import * as me from '../functions/api/me.js';
import * as whoami from '../functions/api/device/whoami.js';
import * as overview from '../functions/api/admin/overview.js';
import * as devices from '../functions/api/devices.js';
import * as google from '../functions/api/auth/google.js';
import * as callback from '../functions/api/auth/callback.js';
import { mkEnv, addUser, sess, req, mp, mpSub, mockMP, nowS } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const leer = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
async function negocio(env, duena = ['duena@x.com', 'sd'], orgName = 'La Plazoleta') {
  await ensureOrgTables(env); addUser(env, duena[0], duena[1]);
  const r = await createOrg(env, { sub: duena[1], email: duena[0], name: 'Dueña', orgName });
  const b2 = env.DB.raw.prepare("INSERT INTO branches (org_id, name, active, created_at) VALUES (?, 'Centro', 1, ?)").run(r.org.id, nowS());
  return { org: r.org, a: r.branch.id, b: Number(b2.lastInsertRowid) };
}
function miembro(env, n, email, sub, role, { all = 0, branches = [], status = 'active' } = {}) {
  if (!env.DB.raw.prepare('SELECT 1 FROM users WHERE sub = ?').get(sub)) addUser(env, email, sub);
  const m = env.DB.raw.prepare('INSERT INTO memberships (org_id, user_sub, email, role, status, all_branches, created_at) VALUES (?,?,?,?,?,?,?)').run(n.org.id, sub, email, role, status, all, nowS());
  for (const b of branches) env.DB.raw.prepare('INSERT INTO membership_branches (membership_id, branch_id) VALUES (?,?)').run(m.lastInsertRowid, b);
}
const getMe = async (env, email, sub) => me.onRequestGet({ request: req('/api/me', { cookie: await sess(env, email, sub) }), env });
const lista = (cookies) => (typeof cookies.getSetCookie === 'function' ? cookies.getSetCookie() : []).join(' | ');
let llamadasMP = 0; const contarMP = () => { mp.subs = []; mp.fail = false; mockMP(); const f = globalThis.fetch; llamadasMP = 0; globalThis.fetch = async (...a) => { llamadasMP++; return f(...a); }; };

// ───────── /api/me
await t('/api/me: trae los negocios de la persona con su rol, sus sucursales y lo que puede hacer', async () => {
  const env = mkEnv(); const n = await negocio(env); contarMP();
  miembro(env, n, 'enc@x.com', 'se', 'manager', { branches: [n.b] }); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] });
  const dueña = await (await getMe(env, 'duena@x.com', 'sd')).json();
  assert.equal(dueña.billing, true); assert.equal(dueña.orgs.length, 1);
  const o = dueña.orgs[0]; assert.equal(o.name, 'La Plazoleta'); assert.equal(o.role, 'owner'); assert.deepEqual(o.branches.map((b) => b.name), ['Sucursal principal', 'Centro']);
  assert.ok(o.can.miembros && o.can.facturacion && o.can.vincular_pc && o.can.descargar && o.can.copias && o.can.operar);
  const enc = (await (await getMe(env, 'enc@x.com', 'se')).json()).orgs[0];
  assert.equal(enc.role, 'manager'); assert.deepEqual(enc.branches.map((b) => b.name), ['Centro'], 'solo la sucursal asignada');
  assert.deepEqual([enc.can.descargar, enc.can.copias, enc.can.operar, enc.can.miembros, enc.can.facturacion, enc.can.vincular_pc], [true, true, true, false, false, false]);
  assert.equal(o.can.transferir, true, 'solo el dueño puede transferir la propiedad'); assert.equal(enc.can.transferir, false);
  const emp = (await (await getMe(env, 'emp@x.com', 'sm')).json()).orgs[0];
  assert.deepEqual([emp.can.operar, emp.can.descargar, emp.can.copias, emp.can.transferir], [true, false, false, false]);
  assert.ok(!JSON.stringify(dueña).includes('"sd"') && !JSON.stringify(dueña).includes('billing_email'), 'no se filtran subs de Google ni el mail de cobro');
});
await t('/api/me: un empleado no ve facturación: no se consulta Mercado Pago y no se le ofrece "elegí tu sistema"', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] }); contarMP();
  const r = await getMe(env, 'emp@x.com', 'sm'); const j = await r.json();
  assert.equal(j.billing, false); assert.equal(j.subscriptions, null); assert.equal(j.intent, null); assert.equal(llamadasMP, 0, 'ni una consulta a Mercado Pago');
  assert.match(lista(r.headers), /ns_sub=1/, 'la franja "Elegí tu sistema" no le aparece');
});
await t('/api/me: quien es dueño de un negocio (aunque también sea miembro de otro) y quien no tiene negocio siguen viendo su suscripción', async () => {
  const env = mkEnv(); const n1 = await negocio(env); const n2 = await negocio(env, ['otro@x.com', 'so'], 'Otro'); miembro(env, n2, 'duena@x.com', 'sd', 'employee', { branches: [n2.a] });
  contarMP(); assert.equal((await (await getMe(env, 'duena@x.com', 'sd')).json()).billing, true); assert.ok(llamadasMP > 0);
  addUser(env, 'solo@x.com', 'ss'); const j = await (await getMe(env, 'solo@x.com', 'ss')).json(); assert.equal(j.billing, true); assert.deepEqual(j.orgs, []); assert.ok(n1);
});
await t('/api/me: un miembro quitado ya no ve ese negocio; sin D1 o sin tablas de negocios responde como siempre', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'ex@x.com', 'sx', 'employee', { branches: [n.a], status: 'removed' }); contarMP();
  const j = await (await getMe(env, 'ex@x.com', 'sx')).json(); assert.deepEqual(j.orgs, []); assert.equal(j.billing, true);
  const limpio = mkEnv(); addUser(limpio, 'a@x.com', 'sa'); assert.deepEqual((await (await getMe(limpio, 'a@x.com', 'sa')).json()).orgs, []);
});

// ───────── vincular: a quién se le ofrece
await t('/api/device/whoami: ofrece negocios y sucursales a quien puede vincular; un encargado o empleado no', async () => {
  const env = mkEnv(); const n = await negocio(env); miembro(env, n, 'enc@x.com', 'se', 'manager', { all: 1 }); miembro(env, n, 'emp@x.com', 'sm', 'employee', { branches: [n.a] }); addUser(env, 'nueva@x.com', 'sn');
  const w = async (e, s) => (await whoami.onRequestGet({ request: req('/api/device/whoami', { cookie: await sess(env, e, s) }), env })).json();
  const d = await w('duena@x.com', 'sd'); assert.equal(d.canLink, true); assert.equal(d.email, 'duena@x.com');
  assert.deepEqual(d.orgs.map((o) => [o.id, o.name, o.branches.map((b) => b.name)]), [[n.org.id, 'La Plazoleta', ['Sucursal principal', 'Centro']]]);
  assert.equal((await w('enc@x.com', 'se')).canLink, false); assert.equal((await w('emp@x.com', 'sm')).canLink, false);
  const nueva = await w('nueva@x.com', 'sn'); assert.equal(nueva.canLink, true); assert.deepEqual(nueva.orgs, [], 'sin negocio: se le crea al vincular');
});

// ───────── panel de administración: negocios (solo lectura)
await t('/api/admin/overview: lista los negocios con dueño, suscripción, miembros, sucursales y PC; solo para el administrador', async () => {
  const env = mkEnv({ MAX_MIEMBROS_SIN_COSTO: '2' }); const n = await negocio(env, ['paga@x.com', 'sp'], 'La Plazoleta'); const m = await negocio(env, ['sin@x.com', 'ss'], 'Sin pagar');
  miembro(env, n, 'a@x.com', 's1', 'employee', { branches: [n.a] }); miembro(env, n, 'b@x.com', 's2', 'manager', { all: 1 });
  await upsertDevice(env, { id: 'pc-1-0123456789abcdefghijk', sub: 'sp', email: 'paga@x.com', orgId: n.org.id, branchId: n.a });
  addUser(env, 'admin@x.com', 'sa'); mp.subs = [mpSub('paga@x.com', 'authorized')]; mp.fail = false; mockMP();
  const ver = async (e, s) => overview.onRequestGet({ request: req('/api/admin/overview', { cookie: await sess(env, e, s) }), env });
  assert.equal((await ver('paga@x.com', 'sp')).status, 403);
  const j = await (await ver('admin@x.com', 'sa')).json(); assert.equal(j.kpis.orgs, 2);
  const o = j.orgs.find((x) => x.name === 'La Plazoleta'); assert.equal(o.ownerEmail, 'paga@x.com'); assert.equal(o.billingEmail, 'paga@x.com');
  assert.deepEqual([o.members, o.branches, o.devices], [3, 2, 1]); assert.equal(o.subscription.status, 'authorized'); assert.equal(o.overSoftCap, true); assert.ok(o.lastSeen);
  const s = j.orgs.find((x) => x.name === 'Sin pagar'); assert.equal(s.subscription, null); assert.equal(s.overSoftCap, false); assert.equal(s.devices, 0); assert.ok(m);
  assert.ok(!/pin|token|sub"/i.test(JSON.stringify(j.orgs)), 'nada interno');
});

// ───────── volver a /unirse/ después de ingresar con Google
await t('ingresar con Google: se puede volver a /unirse/?t=<token> (y solo a eso); lo demás sigue cayendo en /cuenta/', async () => {
  const env = mkEnv({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'gs' });
  const idt = (nonce) => 'h.' + Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'cid', exp: nowS() + 99, nonce, email_verified: true, email: 'ana@x.com', sub: 's1', name: 'Ana' })).toString('base64url') + '.s';
  const ir = async (next) => {
    const r0 = await google.onRequestGet({ request: req('/api/auth/google?next=' + encodeURIComponent(next)), env });
    const u = new URL(r0.headers.get('Location')); const flow = r0.headers.getSetCookie().find((c) => c.startsWith('ns_oauth')).split(';')[0].split('=').slice(1).join('=');
    globalThis.fetch = async () => new Response(JSON.stringify({ id_token: idt(u.searchParams.get('nonce')) }), { status: 200 });
    return (await callback.onRequestGet({ request: req(`/api/auth/callback?code=c&state=${u.searchParams.get('state')}`, { headers: { Cookie: `ns_oauth=${flow}` } }), env })).headers.get('Location');
  };
  const buena = '/unirse/?t=' + 'a1'.repeat(32); assert.equal(await ir(buena), 'https://horsepos.com' + buena);
  for (const mala of ['/unirse/', '/unirse/?t=corto', '/unirse/?t=' + 'g'.repeat(64), '/unirse/?t=' + 'a'.repeat(63), '/unirse/?t=' + 'a'.repeat(65), '/unirse/?t=' + 'a'.repeat(64) + '&x=1', '/unirse/?t=' + 'a'.repeat(64) + '<', '//evil.com/unirse/?t=' + 'a'.repeat(64), '/negocio/'])
    assert.equal(await ir(mala), 'https://horsepos.com/cuenta/', mala);
});

// ───────── PC vinculadas: a qué negocio pertenece cada una
await t('/api/devices: cada PC dice a qué negocio y sucursal pertenece (para la pantalla del dueño)', async () => {
  const env = mkEnv(); const n = await negocio(env);
  await upsertDevice(env, { id: 'pc-1-0123456789abcdefghijk', sub: 'sd', email: 'duena@x.com', orgId: n.org.id, branchId: n.b });
  const j = await (await devices.onRequestGet({ request: req('/api/devices', { cookie: await sess(env, 'duena@x.com', 'sd') }), env })).json();
  assert.equal(j.devices[0].orgId, n.org.id); assert.equal(j.devices[0].branchId, n.b);
});

// ───────── páginas nuevas
const PAGINAS = [['negocio', 'negocio.js'], ['unirse', 'unirse.js']];
await t('páginas /negocio/ y /unirse/: existen, no se indexan y cargan su script; el script no arma HTML con texto de la base', async () => {
  for (const [dir, js] of PAGINAS) {
    assert.ok(existsSync(new URL(`../${dir}/index.html`, import.meta.url)), dir); const html = leer(`${dir}/index.html`);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/, dir); assert.ok(html.includes(`src="/${js}?v=`), `${dir} carga ${js}`);
    assert.ok(html.includes(`<link rel="canonical" href="https://horsepos.com/${dir}/">`), dir);
    const src = leer(js); new vm.Script(src, { filename: js }); // sintaxis válida
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(src), `${js}: solo textContent / createElement (nombres y mails vienen de la base)`);
    assert.ok(!/\sonclick=|\sonerror=/.test(html), `${dir}: sin manejadores en línea`);
    assert.match(readFileSync(new URL('../_headers', import.meta.url), 'utf8'), new RegExp(`/${js.replace('.', '\\.')}\\n  Cache-Control: public, max-age=0, must-revalidate`), `${js} sin caché larga`);
    assert.ok(leer('robots.txt').includes(`Disallow: /${dir}/`), `robots: /${dir}/`);
    assert.ok(!leer('sitemap.xml').includes(`/${dir}/`), 'fuera del sitemap');
  }
});
await t('en /negocio/ y /unirse/ no aparecen ni el botón flotante de WhatsApp ni la barra "Elegí tu sistema" (quien se une a un negocio ya está cubierto)', async () => {
  const main = leer('main.js');
  assert.match(main, /\^\\\/\(pagar\|cuenta\|ingresar\|admin\|negocio\|unirse\)/, 'barra "Elegí tu sistema"');
  assert.ok(main.includes("'/negocio','/unirse'"), 'botón flotante de WhatsApp');
});
await t('admin.js: los manejadores de los diálogos se registran al nivel principal (no adentro de otra función, donde nunca se enganchan)', async () => {
  const src = leer('admin.js');
  for (const id of ['cobro-si', 'cobro-no', 'baja-si', 'baja-no']) assert.match(src, new RegExp(`\\n  document\\.getElementById\\('${id}'\\)\\.addEventListener`), id);
  const dentro = src.slice(src.indexOf('function bajaBtn'), src.indexOf('  var cd = document.getElementById'));
  assert.ok(!dentro.includes('cobro-si'), 'el manejador de «mail de cobro» no puede quedar dentro de bajaBtn');
});
await t('las páginas internas no llevan las partículas del resto del sitio (theme.js) y /cuenta/, /vincular/, /admin/ cargan los scripts actualizados', async () => {
  assert.match(leer('theme.js'), /\(pagar\|cuenta\|ingresar\|vincular\|admin\|descargar\|negocio\|unirse\)/);
  for (const p of ['cuenta', 'vincular', 'admin']) new vm.Script(leer(p + '.js'), { filename: p + '.js' });
});
console.log(`\n${pass} pruebas OK (negocio, pantallas e integración)`);

// Los .js y .css se guardan un año (immutable) porque llevan la huella de su contenido en la dirección. Estas pruebas hacen que
// NO se pueda olvidar actualizarla: si un archivo cambia y la página sigue con la dirección vieja, falla acá, antes de publicar.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { revisar } from '../scripts/versionar-estaticos.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };

await t('todas las páginas del sitio apuntan a la huella actual de cada .js y .css (si falla: node scripts/versionar-estaticos.mjs)', () => {
  const { cambios, problemas } = revisar({ escribir: false });
  assert.deepEqual(problemas, []); assert.deepEqual(cambios, [], `páginas con dirección vieja: ${cambios.join(', ')}`);
});
await t('_headers guarda .js y .css un año, sin reglas por archivo que se junten y dupliquen el Cache-Control', () => {
  const h = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  assert.match(h, /\/\*\.js\n\s+Cache-Control: public, max-age=31536000, immutable/); assert.match(h, /\/\*\.css\n\s+Cache-Control: public, max-age=31536000, immutable/);
  assert.ok(!/^\/[A-Za-z0-9_.-]+\.(js|css)\s*$/m.test(h), 'quedó una regla por archivo para un .js o .css');
});
await t('el script detecta un archivo cambiado, uno sin huella y uno que no existe, y al corregir queda estable', () => {
  const d = mkdtempSync(join(tmpdir(), 'est-')); mkdirSync(join(d, 'cuenta'));
  writeFileSync(join(d, 'app.js'), 'console.log(1)'); writeFileSync(join(d, 'a.css'), 'body{}');
  writeFileSync(join(d, 'index.html'), '<script src="/app.js"></script><link rel="stylesheet" href="/a.css?v=vieja"><script src="/falta.js?v=x"></script>');
  let r = revisar({ dir: d }); assert.equal(r.problemas.length, 1); assert.match(r.problemas[0], /falta\.js no existe/); assert.deepEqual(r.cambios, ['index.html']);
  r = revisar({ dir: d, escribir: true }); const html = readFileSync(join(d, 'index.html'), 'utf8'); assert.match(html, /app\.js\?v=[0-9a-f]{10}/); assert.match(html, /a\.css\?v=[0-9a-f]{10}/);
  assert.deepEqual(revisar({ dir: d }).cambios, [], 'idempotente');
  writeFileSync(join(d, 'app.js'), 'console.log(2)'); assert.deepEqual(revisar({ dir: d }).cambios, ['index.html'], 'si el archivo cambia, la página queda pendiente');
});
await t('la política de contenido no permite scripts en línea y ninguna página ejecuta uno (solo datos JSON-LD)', async () => {
  const { paginas } = await import('../scripts/versionar-estaticos.mjs');
  const h = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  const csp = /Content-Security-Policy: (.*)/.exec(h)[1];
  const scriptSrc = /script-src ([^;]*)/.exec(csp)[1];
  assert.ok(!/unsafe-inline|unsafe-eval/.test(scriptSrc), `script-src no puede llevar unsafe-*: ${scriptSrc}`);
  for (const pagina of paginas()) {
    const html = readFileSync(pagina, 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
      const attrs = m[1];
      if (/\bsrc=/.test(attrs) || /type="application\/ld\+json"/.test(attrs)) continue;
      assert.fail(`${pagina}: <script> en línea que la política de contenido bloquearía: <script${attrs}>`);
    }
    assert.ok(!/\son(click|load|error|submit|change|input)\s*=/i.test(html), `${pagina}: manejador de evento en línea (onclick=...) bloqueado por la política de contenido`);
    assert.ok(!/href="javascript:/i.test(html), `${pagina}: enlace javascript:`);
  }
});
await t('los scripts que muestran datos de la base o del servidor (nombres, mails, importes) no arman HTML con ellos', () => {
  // home.js / main.js / descargar.js usan innerHTML solo con texto fijo del propio archivo (íconos, la animación del titular).
  for (const js of ['cuenta.js', 'admin.js', 'device.js', 'vincular.js', 'pagar.js', 'unirse.js', 'negocio.js']) {
    const src = readFileSync(new URL(`../${js}`, import.meta.url), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(src), `${js}: solo textContent / createElement`);
  }
});
console.log(`\n${pass} pruebas OK (direcciones con huella)`);

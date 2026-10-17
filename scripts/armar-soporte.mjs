// Arma lo que sabe el asistente de la página (`functions/_lib/soporte_datos.js`) a partir de lo que el sitio ya dice: `llms.txt`
// (qué es cada producto y cuánto sale) y las preguntas frecuentes de cada página pública (el `FAQPage` del JSON-LD, que es lo mismo
// que se ve en la página). Así el asistente nunca promete algo que el sitio no dice, y si cambia una página alcanza con correr esto.
//
//   node scripts/armar-soporte.mjs           # escribe el archivo
//   node scripts/armar-soporte.mjs --revisar # sale con error si está desactualizado (lo usa tests/soporte.test.mjs)
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'functions', '_lib', 'soporte_datos.js');

// Las páginas públicas son las que cargan `nodo.js` (las de cuenta, admin y maquetas no cuentan).
function paginasPublicas() {
  const salida = [];
  const mirar = (rel) => {
    const f = join(raiz, rel, 'index.html');
    if (existsSync(f) && readFileSync(f, 'utf8').includes('/nodo.js')) salida.push({ ruta: rel ? `/${rel}/` : '/', archivo: f });
  };
  mirar('');
  for (const d of readdirSync(raiz).sort()) {
    if (d.startsWith('.') || ['mocks', 'node_modules', 'functions', 'tests', 'scripts', 'marketing'].includes(d)) continue;
    if (statSync(join(raiz, d)).isDirectory()) mirar(d);
  }
  return salida;
}

const limpiar = (t) => String(t).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

export function armar() {
  const faq = [];
  for (const { ruta, archivo } of paginasPublicas()) {
    const html = readFileSync(archivo, 'utf8');
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let j;
      try { j = JSON.parse(m[1]); } catch { continue; }
      for (const nodo of [j, ...(Array.isArray(j['@graph']) ? j['@graph'] : [])]) {
        if (!nodo || nodo['@type'] !== 'FAQPage' || !Array.isArray(nodo.mainEntity)) continue;
        for (const q of nodo.mainEntity) {
          const p = limpiar(q.name || '');
          const r = limpiar(q.acceptedAnswer?.text || '');
          if (p && r) faq.push({ pagina: ruta, p, r });
        }
      }
    }
  }
  const llms = readFileSync(join(raiz, 'llms.txt'), 'utf8').trim();
  return `// GENERADO por scripts/armar-soporte.mjs: no editar a mano (se vuelve a armar desde llms.txt y las preguntas de cada página).
export const CONOCIMIENTO = ${JSON.stringify(llms)};

export const PREGUNTAS = ${JSON.stringify(faq, null, 0).replace(/\},\{/g, '},\n  {')};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const nuevo = armar();
  if (process.argv.includes('--revisar')) {
    const actual = existsSync(destino) ? readFileSync(destino, 'utf8') : '';
    if (actual !== nuevo) {
      console.error('functions/_lib/soporte_datos.js está desactualizado: corré node scripts/armar-soporte.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(destino, nuevo);
    console.log(`soporte_datos.js: ${(nuevo.match(/"pagina"/g) || []).length} preguntas`);
  }
}

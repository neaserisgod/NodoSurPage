// Pone en cada <script src> y <link rel=stylesheet> local de las páginas un ?v=<huella del contenido>.
// Con la huella en la dirección, los .js y .css se pueden guardar un año en el navegador (immutable): si el archivo cambia, la
// huella cambia, la dirección cambia y todos bajan el nuevo; si no cambió, no se vuelve a pedir nada. No hay que acordarse de subir
// ningún número a mano: se corre `node scripts/versionar-estaticos.mjs` y listo. Con `--check` solo verifica (lo usan las pruebas).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
const IGNORAR = new Set(['node_modules', '.git', 'mocks', 'tests', 'functions', 'scripts', 'migrations', '.wrangler', 'bot-whatsapp-src']);
const huella = (ruta) => createHash('sha256').update(readFileSync(ruta)).digest('hex').slice(0, 10);

export function paginas(dir = RAIZ) {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    if (IGNORAR.has(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) out.push(...paginas(ruta));
    else if (nombre.endsWith('.html')) out.push(ruta);
  }
  return out;
}

const RE = /((?:src|href)=")(\/[A-Za-z0-9_.-]+\.(?:js|css))(?:\?v=[^"]*)?(")/g;

// Devuelve { cambios, problemas }: `cambios` son los archivos html que cambian (o cambiarían con --check), `problemas` lo que no se puede resolver.
export function revisar({ escribir = false, dir = RAIZ } = {}) {
  const cambios = [], problemas = [];
  for (const pagina of paginas(dir)) {
    const original = readFileSync(pagina, 'utf8');
    const nuevo = original.replace(RE, (m, pre, ruta, post) => {
      const archivo = join(dir, ruta);
      if (!existsSync(archivo)) { problemas.push(`${relative(dir, pagina)}: ${ruta} no existe`); return m; }
      return `${pre}${ruta}?v=${huella(archivo)}${post}`;
    });
    if (nuevo !== original) { cambios.push(relative(dir, pagina)); if (escribir) writeFileSync(pagina, nuevo); }
  }
  return { cambios, problemas };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const { cambios, problemas } = revisar({ escribir: !check });
  for (const p of problemas) console.error('ERROR', p);
  if (check && cambios.length) { console.error(`Faltan versionar ${cambios.length} página(s): corré "node scripts/versionar-estaticos.mjs"\n  ` + cambios.join('\n  ')); process.exit(1); }
  if (problemas.length) process.exit(1);
  console.log(check ? 'Todas las direcciones de .js y .css llevan la huella de su contenido.' : `Actualizadas ${cambios.length} página(s).`);
}

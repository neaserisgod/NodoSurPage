// Graba historia.html a MP4 (1080×1920, 30 fps). El archivo es un fragmento (así se publica
// como artifact), así que acá se envuelve en un documento completo antes de abrirlo.
// Uso: node render.js [salida.mp4] [segundo] → con un segundo, saca solo ese cuadro a PNG.
// HISTORIA=previas.html#1 elige otra página; FPS (30) y ESCALA (1) controlan la calidad: con ESCALA=2 cada cuadro se
// dibuja al doble y se reduce a 1080×1920, así los bordes y los textos salen más nítidos.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FPS = +(process.env.FPS || 30);
const ESCALA = +(process.env.ESCALA || 1);
const [PAGINA, HASH] = (process.env.HISTORIA || 'historia.html').split('#');
const out = process.argv[2] || path.join(__dirname, 'historia-nodosur-v2.mp4');
const solo = process.argv[3];

(async () => {
  const wrap = path.join(__dirname, `_rec-${process.pid}.html`);
  fs.writeFileSync(wrap, '<!doctype html><html><head><meta charset="utf-8"><script>window.__REC__=1;window.__H__=' + JSON.stringify(HASH || '') + '</script></head><body>' +
    fs.readFileSync(path.join(__dirname, PAGINA), 'utf8') + '</body></html>');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: ESCALA });
  await page.goto('file://' + wrap);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  try {
    if (solo !== undefined) {
      await page.evaluate((t) => window.render(t), +solo);
      await page.screenshot({ path: out });
      return;
    }
    const dur = await page.evaluate(() => window.DUR);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '14', '-movflags', '+faststart', out],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    const total = Math.round(dur * FPS);
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => window.render(t), i / FPS);
      const buf = await page.screenshot({ type: 'png' });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log('listo:', out);
  } finally {
    await browser.close();
    fs.unlinkSync(wrap);
  }
})();

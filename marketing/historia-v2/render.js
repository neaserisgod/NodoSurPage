// Graba historia.html a MP4 (1080×1920, 30 fps). El archivo es un fragmento (así se publica
// como artifact), así que acá se envuelve en un documento completo antes de abrirlo.
// Uso: node render.js [salida.mp4] [segundo] → con un segundo, saca solo ese cuadro a PNG.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FPS = 30;
const out = process.argv[2] || path.join(__dirname, 'historia-nodosur-v2.mp4');
const solo = process.argv[3];

(async () => {
  const wrap = path.join(__dirname, '_rec.html');
  fs.writeFileSync(wrap, '<!doctype html><html><head><meta charset="utf-8"><script>window.__REC__=1</script></head><body>' +
    fs.readFileSync(path.join(__dirname, 'historia.html'), 'utf8') + '</body></html>');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
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
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', out],
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

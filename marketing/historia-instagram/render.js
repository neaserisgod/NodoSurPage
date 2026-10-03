// Graba historia.html a MP4 (1080×1920, 30 fps, H.264) cuadro por cuadro.
// Uso: node render.js [salida.mp4] [segundo] → con un segundo, saca solo ese cuadro a PNG.
// Necesita playwright (Chromium) y ffmpeg en el PATH.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const FPS = 30;
const out = process.argv[2] || path.join(__dirname, 'historia-nodosur.mp4');
const solo = process.argv[3];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'historia.html') + '?rec=1');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));

  if (solo !== undefined) {
    await page.evaluate((t) => window.render(t), +solo);
    await page.screenshot({ path: out });
    await browser.close();
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
    if (i % 60 === 0) process.stdout.write(`${i}/${total}\n`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();
  console.log('listo:', out);
})();

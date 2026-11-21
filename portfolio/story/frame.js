// Single frames for checking, or the still poster.
//   node frame.js 0 4 9.6 17        → out/frame-<seconds>.png (1080x1920)
//   node frame.js --still            → out/still.png (rendered at 2x, scaled down)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

(async () => {
  const still = process.argv.includes('--still');
  const times = still ? [0] : process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text'] });
  const ctx = await b.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: still ? 2 : 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await p.goto('file://' + path.join(__dirname, 'story.html') + (still ? '?still=1' : ''));
  await p.evaluate(() => window.STORY.ready);
  for (const t of times) {
    await p.evaluate((t) => window.renderAt(t), t);
    const file = path.join(out, still ? 'still@2x.png' : `frame-${t.toFixed(2)}.png`);
    await p.screenshot({ path: file, clip: { x: 0, y: 0, width: 1080, height: 1920 } });
    if (still) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', 'scale=1080:1920:flags=lanczos', path.join(out, 'still.png')]);
      fs.unlinkSync(file);
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

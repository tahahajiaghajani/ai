// Renders story.html frame by frame into a lossless master.
//   node render.js [--fps 30] [--sub 4] [--dpr 1] [--from 0] [--to 15] [--out out/master.mkv] [--shutter 2]
// --sub: temporal samples per output frame (motion blur); --shutter: how many of them are averaged (sub = full 360°).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const FPS = Number(arg('fps', 30));
const SUB = Number(arg('sub', 1));
const SHUTTER = Math.min(SUB, Number(arg('shutter', SUB)));
const DPR = Number(arg('dpr', 1));
const FROM = Number(arg('from', 0));
const OUT = arg('out', path.join(__dirname, 'out', 'master.mkv'));
const QUERY = arg('query', '');

(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text'] });
  const ctx = await b.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: DPR });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await p.goto('file://' + path.join(__dirname, 'story.html') + QUERY);
  await p.evaluate(() => window.STORY.ready);
  const DUR = await p.evaluate(() => window.STORY.DUR);
  const TO = Number(arg('to', DUR));
  const cdp = await ctx.newCDPSession(p);

  const weights = Array.from({ length: SUB }, (_, i) => (i >= SUB - SHUTTER ? 1 : 0)).join(' ');
  const vf = [SUB > 1 ? `tmix=frames=${SUB}:weights='${weights}'` : null, SUB > 1 ? `fps=${FPS}` : null, DPR !== 1 ? 'scale=1080:1920:flags=lanczos' : null].filter(Boolean).join(',');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'png', '-i', '-', ...(vf ? ['-vf', vf] : []), '-c:v', 'libx264rgb', '-crf', '0', '-preset', 'ultrafast', '-r', String(FPS), OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))));

  const total = Math.round((TO - FROM) * FPS * SUB);
  const t0 = Date.now();
  for (let n = 0; n < total; n++) {
    // output frame k shows time k/FPS; its samples are the SUB instants ending there
    const t = FROM + (n - (SUB - 1)) / (FPS * SUB);
    await p.evaluate((t) => window.renderAt(Math.max(0, t)), t);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false });
    const buf = Buffer.from(data, 'base64');
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (n % (FPS * SUB) === 0) console.log(`t=${(FROM + n / (FPS * SUB)).toFixed(1)}s  ${(((Date.now() - t0) / 1000) | 0)}s elapsed`);
  }
  ff.stdin.end();
  await done;
  await b.close();
  console.log('done', OUT, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
})().catch((e) => { console.error(e); process.exit(1); });

// Renders out/teaser.html frame by frame with Chromium and encodes with ffmpeg.
//   node render.mjs --stills 1.5,12,40          PNG stills to out/stills/
//   node render.mjs --video [--fps 60] [--from 0 --to 30] [--workers 3] [--audio out/music.wav] [--gain 2]
//   node render.mjs --chapters                 chapter list; every run also writes out/cues.json for the music
// Every frame is a pure function of time, so workers render separate ranges in parallel and the chunks are joined.
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
const CHROME = process.env.CHROME_PATH;
const fps = +(args.fps ?? 60);

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push("failed: " + r.url()));
  await page.goto("file://" + path.join(OUT, "teaser.html"), { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? i.decode().catch(() => {}) : new Promise((r) => (i.onload = i.onerror = r)))));
  });
  await page.waitForFunction(() => window.TEASER);
  await page.evaluate(() => window.TEASER.ready);
  if (errors.length) throw new Error(errors.join("\n"));
  const cdp = await page.context().newCDPSession(page);
  return { page, cdp };
}
async function frame({ page, cdp }, t, format = "png") {
  await page.evaluate((t) => window.TEASER.render(t), t);
  const { data } = await cdp.send("Page.captureScreenshot", { format, quality: format === "jpeg" ? 95 : undefined, optimizeForSpeed: true, captureBeyondViewport: false });
  return Buffer.from(data, "base64");
}

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const probe = await openPage(browser);
const duration = await probe.page.evaluate(() => window.TEASER.duration);
console.log(`duration ${duration.toFixed(2)} s`);
// the cue sheet for the music: chapter starts and kinds, in seconds
const sheet = await probe.page.evaluate(() => ({ duration: window.TEASER.duration, sections: window.TEASER.chapters.map((c) => ({ start: c.start, end: c.end, kind: c.kind, name: c.name })), hits: window.TEASER.cues.sort((a, b) => a.t - b.t) }));
fs.writeFileSync(path.join(OUT, "cues.json"), JSON.stringify(sheet, null, 1));
if (args.chapters) for (const c of sheet.sections) console.log(c.start.toFixed(1).padStart(6), c.end.toFixed(1).padStart(6), c.kind.padEnd(12), c.name);

if (args.stills) {
  fs.mkdirSync(path.join(OUT, "stills"), { recursive: true });
  for (const s of String(args.stills).split(",")) {
    const t = +s;
    fs.writeFileSync(path.join(OUT, "stills", `t${t.toFixed(2).padStart(7, "0")}.png`), await frame(probe, t));
  }
  console.log("stills →", path.join(OUT, "stills"));
}

if (args.video) {
  const from = +(args.from ?? 0), to = Math.min(+(args.to ?? duration), duration);
  const total = Math.round((to - from) * fps);
  const workers = +(args.workers ?? 3);
  const per = Math.ceil(total / workers);
  const dir = path.join(OUT, "chunks");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  let done = 0;
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per);
    if (a >= b) return;
    const ctx = w === 0 ? probe : await openPage(browser);
    const file = path.join(dir, `c${String(w).padStart(2, "0")}.mp4`);
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
      "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.2",
      "-x264-params", "keyint=" + fps * 2, "-r", String(fps), file], { stdio: ["pipe", "inherit", "inherit"] });
    for (let i = a; i < b; i++) {
      const buf = await frame(ctx, from + i / fps, "jpeg");
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      done++;
      if (done % (fps * 5) === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${done}/${total} frames, ${(done / el).toFixed(1)} fps, eta ${Math.round(((total - done) / done) * el)} s`);
      }
    }
    ff.stdin.end();
    await new Promise((r, j) => ff.on("close", (c) => (c ? j(new Error("ffmpeg " + c)) : r())));
  }));
  const list = fs.readdirSync(dir).filter((f) => f.endsWith(".mp4")).sort().map((f) => `file '${path.join(dir, f)}'`).join("\n");
  fs.writeFileSync(path.join(dir, "list.txt"), list);
  const silent = path.join(OUT, "teaser-video.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-c", "copy", silent]);
  const audio = args.audio === true || args.audio === "true" ? path.join(OUT, "music.wav") : args.audio;
  const final = path.join(OUT, args.out ?? "pars-teaser.mp4");
  if (audio && fs.existsSync(audio)) {
    // --gain (dB) brings the mix to about -15 LUFS for a TV at a booth
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-ss", String(from), "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
      "-af", `volume=${+(args.gain ?? 2)}dB`, "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-shortest", "-movflags", "+faststart", final]);
  } else {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-c", "copy", "-movflags", "+faststart", final]);
  }
  console.log(`video → ${final} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
await browser.close();

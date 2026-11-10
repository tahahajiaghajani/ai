// Draws every brand asset from the one drawing in src/shared/brand.ts (docs/BRAND_FA.md §نشانه):
//
//   npx tsx scripts/brand-assets.mts            (also: cd desktop && npm run icons)
//
//   docs/brand/logo/*.svg                         the masters: mark, wordmarks, lockups, app icon (colour, dark, mono, inverse)
//   docs/brand/*.png                              previews for the brand book (app icon, installer art, splash)
//   src/ui/static/favicon.svg, favicon.ico        16 / 32 / 48 (the heavy small cut up to 24 px)
//   src/ui/static/apple-touch-icon.png            180, full bleed (iOS rounds it)
//   src/ui/static/icons/icon-{192,512}.png        PWA "any": the rounded tile
//   src/ui/static/icons/icon-maskable-{192,512}.png  PWA "maskable": full bleed, the mark inside the 80 % safe circle
//   desktop/build/icon.ico                        16–256 px (32-bit bitmaps below 256, PNG at 256): exe, installer, window
//   desktop/build/icon.png, icon-256.png, icon.svg
//   desktop/build/tray.png, tray@1.5x.png, tray@2x.png   notification area (16 / 24 / 32)
//   desktop/build/installerSidebar.bmp (164 × 314), installerHeader.bmp (150 × 57)   NSIS welcome/finish and page header
//
// A maintainer's tool: the outputs are committed, so builds and CI never run it. It rasterises with Chromium through
// Playwright (installed on the dev machine, not a dependency): each SVG is drawn into a canvas at its exact pixel size.
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import {
  BRAND_COLORS,
  SKY_GRADIENT,
  appIconSvg,
  lockupLayout,
  lockupSvg,
  markInner,
  markSvg,
  wordmarkInner,
  wordmarkSvg,
  MARK,
  WORDMARK_EN,
  WORDMARK_FA,
  type BrandTone,
} from "../src/shared/brand";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = join(ROOT, "src/ui/static");
const BUILD = join(ROOT, "desktop/build");
const DOCS = join(ROOT, "docs/brand");

function write(file: string, data: string | Buffer) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log(`  ${file.slice(ROOT.length + 1)} (${typeof data === "string" ? Buffer.byteLength(data) : data.length} bytes)`);
}

// ------------------------------------------------------------------ rasteriser (Chromium canvas)
const require = createRequire(join(ROOT, "package.json"));
const { chromium } = require("playwright") as typeof import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><canvas id=c></canvas>");

interface Raster {
  /** filtered, deflate-9 PNG */
  png: Buffer;
  rgba: Buffer;
}
/** Draws an SVG document at w × h px (transparent unless the SVG paints its background). */
async function raster(svg: string, w: number, h = w): Promise<Raster> {
  const out = await page.evaluate(
    async ({ svg, w, h }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await img.decode();
      const c = document.getElementById("c") as HTMLCanvasElement;
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      return Array.from(ctx.getImageData(0, 0, w, h).data);
    },
    { svg, w, h },
  );
  const rgba = Buffer.from(out);
  return { png: png(rgba, w, h), rgba };
}

// ------------------------------------------------------------------ encoders (.ico, .bmp, opaque .png)
/** One 32-bit bitmap entry of an .ico: bottom-up BGRA plus the 1-bit AND mask. */
function icoBitmap(px: Buffer, s: number): Buffer {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(s, 4);
  head.writeInt32LE(s * 2, 8);
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  const color = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const from = ((s - 1 - y) * s + x) * 4;
      const to = (y * s + x) * 4;
      color[to] = px[from + 2];
      color[to + 1] = px[from + 1];
      color[to + 2] = px[from];
      color[to + 3] = px[from + 3];
    }
  const rowBytes = Math.ceil(s / 32) * 4;
  const mask = Buffer.alloc(rowBytes * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (px[((s - 1 - y) * s + x) * 4 + 3] === 0) mask[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  return Buffer.concat([head, color, mask]);
}
async function ico(sizes: number[], svgFor: (s: number) => string): Promise<Buffer> {
  const images: Buffer[] = [];
  for (const s of sizes) {
    const r = await raster(svgFor(s), s);
    images.push(s >= 256 ? r.png : icoBitmap(r.rgba, s));
  }
  const dir = Buffer.alloc(6 + 16 * sizes.length);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(sizes.length, 4);
  let offset = dir.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    dir[e] = s >= 256 ? 0 : s;
    dir[e + 1] = s >= 256 ? 0 : s;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(images[i].length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([dir, ...images]);
}
/** 24-bit bottom-up BMP (NSIS sidebar and header). */
function bmp(px: Buffer, w: number, h: number): Buffer {
  const row = Math.ceil((w * 3) / 4) * 4;
  const out = Buffer.alloc(54 + row * h);
  out.write("BM", 0, "ascii");
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * h, 34);
  out.writeInt32LE(2835, 38);
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const from = ((h - 1 - y) * w + x) * 4;
      const to = 54 + y * row + x * 3;
      out[to] = px[from + 2];
      out[to + 1] = px[from + 1];
      out[to + 2] = px[from];
    }
  return out;
}
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf: Buffer) {
  let c = -1;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/**
 * A PNG from RGBA pixels: RGBA, or RGB when `opaque` (Apple touch and maskable icons must not be transparent). Each
 * row takes the filter (none, sub, up, average, Paeth) with the smallest sum of signed residuals, then deflate 9 — a
 * fraction of the size of the canvas encoder's output on the tile's gradients.
 */
function png(px: Buffer, w: number, h: number, opaque = false): Buffer {
  const bpp = opaque ? 3 : 4;
  const line = w * bpp;
  const rows: Buffer[] = [];
  let prev = Buffer.alloc(line);
  for (let y = 0; y < h; y++) {
    const cur = Buffer.alloc(line);
    for (let x = 0; x < w; x++) for (let c = 0; c < bpp; c++) cur[x * bpp + c] = px[(y * w + x) * 4 + c];
    let best: Buffer | null = null;
    let bestScore = Infinity;
    for (let t = 0; t < 5; t++) {
      const out = Buffer.alloc(line + 1);
      out[0] = t;
      let score = 0;
      for (let i = 0; i < line; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const cc = i >= bpp ? prev[i - bpp] : 0;
        const pred = t === 0 ? 0 : t === 1 ? a : t === 2 ? b : t === 3 ? (a + b) >> 1 : (() => { const p = a + b - cc; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc); return pa <= pb && pa <= pc ? a : pb <= pc ? b : cc; })();
        const v = (cur[i] - pred) & 0xff;
        out[i + 1] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = out;
      }
    }
    rows.push(best!);
    prev = cur;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ 1. masters (docs/brand/logo)
console.log("masters");
const LOGO = join(DOCS, "logo");
const tones: [BrandTone, string][] = [
  ["brand", ""],
  ["brand-dark", "-dark"],
  ["mono", "-mono"],
  ["inverse", "-inverse"],
];
for (const [tone, suffix] of tones) {
  write(join(LOGO, `kariz-mark${suffix}.svg`), markSvg({ tone, pad: 1, title: "کاریز" }));
  write(join(LOGO, `kariz-wordmark-fa${suffix}.svg`), wordmarkSvg("fa", { tone, pad: 1 }));
  write(join(LOGO, `kariz-wordmark-en${suffix}.svg`), wordmarkSvg("en", { tone, pad: 1 }));
  write(join(LOGO, `kariz-lockup-fa${suffix}.svg`), lockupSvg("horizontal", "fa", { tone, pad: 2 }));
  write(join(LOGO, `kariz-lockup-en${suffix}.svg`), lockupSvg("horizontal", "en", { tone, pad: 2 }));
  write(join(LOGO, `kariz-lockup-stacked${suffix}.svg`), lockupSvg("stacked", "fa", { tone, pad: 2 }));
}
write(join(LOGO, "kariz-app-icon.svg"), appIconSvg({ px: 512 }));
write(join(LOGO, "kariz-app-icon-square.svg"), appIconSvg({ px: 512, shape: "square", inset: 0.72 }));

// ------------------------------------------------------------------ 2. web: favicons and PWA icons
console.log("web");
const tile = (s: number) => appIconSvg({ px: s });
write(join(STATIC, "favicon.svg"), appIconSvg({ px: 16 }).replace(/ width="16" height="16"/, ""));
write(join(STATIC, "favicon.ico"), await ico([16, 32, 48], tile));
write(join(STATIC, "apple-touch-icon.png"), png((await raster(appIconSvg({ px: 180, shape: "square", inset: 0.82 }), 180)).rgba, 180, 180, true));
for (const s of [192, 512]) {
  write(join(STATIC, "icons", `icon-${s}.png`), (await raster(tile(s), s)).png);
  write(join(STATIC, "icons", `icon-maskable-${s}.png`), png((await raster(appIconSvg({ px: s, shape: "square", inset: 0.72 }), s)).rgba, s, s, true));
}

// ------------------------------------------------------------------ 3. Windows: icon, tray
console.log("windows");
write(join(BUILD, "icon.ico"), await ico([16, 20, 24, 30, 32, 36, 40, 48, 64, 96, 128, 256], tile));
const icon256 = (await raster(tile(256), 256)).png;
write(join(BUILD, "icon.png"), icon256);
write(join(BUILD, "icon-256.png"), icon256);
write(join(BUILD, "icon.svg"), appIconSvg({ px: 256 }));
for (const [name, s] of [["tray.png", 16], ["tray@1.5x.png", 24], ["tray@2x.png", 32]] as const) write(join(BUILD, name), (await raster(tile(s), s)).png);

// ------------------------------------------------------------------ 4. installer art (NSIS, 96 dpi bitmaps)
console.log("installer");
const sky = SKY_GRADIENT.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join("");
const at = (inner: string, x: number, y: number, s: number) => `<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;
// the sidebar of the welcome and finish pages: the kariz night, the mark lit at its outlet, the name, the horizon
{
  const W = 164;
  const H = 314;
  const markPx = 70;
  const ms = markPx / 24;
  const fa = WORDMARK_FA;
  const faS = 96 / fa.bounds[2];
  const en = WORDMARK_EN;
  const enS = 46 / en.bounds[2];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">${sky}</linearGradient><radialGradient id="g" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="#2CAFB9" stop-opacity=".38"/><stop offset="1" stop-color="#2CAFB9" stop-opacity="0"/></radialGradient><linearGradient id="h" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#s)"/><rect y="252" width="${W}" height="${H - 252}" fill="url(#g)"/><rect y="252" width="${W}" height="1" fill="url(#h)"/>
<path d="M${W / 2} 248l4 4-4 4-4-4z" fill="${BRAND_COLORS.zaferan[300]}"/>
${at(markInner(MARK, "#FFFFFF", BRAND_COLORS.zaferan[300]), W / 2 - 12 * ms, 64 - 4.4 * ms, ms)}
${at(wordmarkInner(fa, "#FFFFFF"), W / 2 - (fa.bounds[0] + fa.bounds[2] / 2) * faS, 150 - fa.bounds[1] * faS, faS)}
${at(wordmarkInner(en, "rgba(255,255,255,0.62)"), W / 2 - (en.bounds[0] + en.bounds[2] / 2) * enS, 205 - en.bounds[1] * enS, enS)}</svg>`;
  const r = await raster(svg, W, H);
  write(join(BUILD, "installerSidebar.bmp"), bmp(r.rgba, W, H));
  write(join(DOCS, "installer-sidebar.png"), (await raster(svg, W * 2, H * 2)).png);
}
// the header of the inner pages: white, the Persian lockup at the end (right) edge
{
  const W = 150;
  const H = 57;
  const { box } = lockupLayout("horizontal", "fa");
  const s = 30 / box[3];
  const lw = box[2] * s;
  const inner = lockupSvg("horizontal", "fa", { tone: "brand" }).replace(/^<svg[^>]*>(<title>[^<]*<\/title>)?/, "").replace(/<\/svg>\n?$/, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#FFFFFF"/>${at(inner, W - 10 - lw - box[0] * s, (H - box[3] * s) / 2 - box[1] * s, s)}</svg>`;
  const r = await raster(svg, W, H);
  write(join(BUILD, "installerHeader.bmp"), bmp(r.rgba, W, H));
  write(join(DOCS, "installer-header.png"), (await raster(svg, W * 2, H * 2)).png);
}
write(join(DOCS, "app-icon.png"), (await raster(tile(512), 512)).png);

// ------------------------------------------------------------------ 5. the splash, as the Windows app shows it (preview)
{
  const dir = mkdtempSync(join(tmpdir(), "kariz-splash-"));
  mkdirSync(join(dir, "renderer/fonts"), { recursive: true });
  symlinkSync(join(STATIC, "fonts/ds"), join(dir, "renderer/fonts/ds"), "dir");
  copyFileSync(join(ROOT, "desktop/src/splash.html"), join(dir, "splash.html"));
  const shot = await browser.newPage({ viewport: { width: 520, height: 320 }, deviceScaleFactor: 2 });
  const { APP_NAME, APP_TAGLINE } = await import("../src/shared/constants");
  await shot.goto(`${pathToFileURL(join(dir, "splash.html")).href}?still&${new URLSearchParams({ name: APP_NAME, tagline: APP_TAGLINE })}`);
  await shot.evaluate(() => document.fonts.ready);
  await shot.evaluate(() => {
    const w = window as unknown as { itsm: { status: (s: string) => void; version: (s: string) => void } };
    w.itsm.status("آماده‌سازی میز کار…");
    w.itsm.version("نسخهٔ ۱٫۰٫۰");
  });
  await shot.addStyleTag({ content: "html{background:#ECE8E2}" }); // the window's rounded corners over paper (JPEG has no alpha)
  await shot.waitForTimeout(300);
  write(join(DOCS, "splash.jpg"), await shot.screenshot({ type: "jpeg", quality: 86 }));
  rmSync(dir, { recursive: true, force: true });
}

await browser.close();
console.log("✓ brand assets written");

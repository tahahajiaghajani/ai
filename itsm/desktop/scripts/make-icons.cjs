// Draws the placeholder monogram (a rounded tile with the letters «IT» built from three bars) into every icon the
// app ships, with Node's own modules only:
//   cd desktop && npm run icons
//
//   desktop/build/icon.ico            16, 20, 24, 30, 32, 36, 40, 48, 64 px (32-bit bitmaps) and 256 px (PNG): exe, installer, window
//   desktop/build/icon.png, icon-256.png, icon.svg
//   desktop/build/tray.png, tray@1.5x.png, tray@2x.png        notification-area icon (16 / 24 / 32 px)
//   desktop/build/installerSidebar.bmp (164 × 314), installerHeader.bmp (150 × 57)
//   src/ui/static/favicon.ico (16, 32, 48), favicon.svg, apple-touch-icon.png (180)
//   src/ui/static/icons/icon-{192,512}.png, icon-maskable-{192,512}.png
//
// The geometry matches BrandMark/BrandTile in src/ui/components/brand.tsx: change both together. The real brand
// replaces this placeholder later (then this script is swapped for the brand package's own art).
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.join(__dirname, "..", "..");
const BUILD = path.join(root, "desktop", "build");
const STATIC = path.join(root, "src", "ui", "static");

// ------------------------------------------------------------------ geometry (x, y, width, height)
// 24-unit grid: the tile is the whole box, the glyph is 12 × 12 in its middle (I, then the T's bar and stem).
const GLYPH_24 = [
  [6, 6, 3, 12],
  [11, 6, 7, 3],
  [13, 9, 3, 9],
];
// 16-unit cut for 16, 32 and 64 px (every edge on the pixel grid)
const GLYPH_16 = [
  [3, 3, 2, 10],
  [7, 3, 6, 2],
  [9, 5, 2, 8],
];
// the tile: the design system's primary («شامگاه»), dark at the top, lighter toward the bottom end
const TILE_FROM = [0x24, 0x0d, 0x21];
const TILE_TO = [0x6a, 0x2e, 0x63];
const WHITE = [255, 255, 255];

const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const gradientAt = (x, y, w, h) => lerp(TILE_FROM, TILE_TO, Math.min(1, Math.max(0, (x / w) * 0.35 + (y / h) * 0.65)));

function inRoundRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const cx = x < r ? r : x > w - r ? w - r : x;
  const cy = y < r ? r : y > h - r ? h - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * RGBA pixels of one icon. `tile`: "round" (rounded tile, transparent corners) or "full" (full-bleed square:
 * maskable and apple-touch icons). `scale` shrinks the glyph (maskable icons keep it inside the safe zone).
 */
function render(size, { tile = "round", scale = 1 } = {}) {
  const grid = size === 16 || size === 32 || size === 64 ? 16 : 24;
  const glyph = grid === 16 ? GLYPH_16 : GLYPH_24;
  const unit = (size / grid) * scale;
  const off = (size - grid * unit) / 2;
  const radius = size * 0.225;
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          const onTile = tile === "full" || inRoundRect(fx, fy, size, size, radius);
          if (!onTile) continue;
          const gx = (fx - off) / unit;
          const gy = (fy - off) / unit;
          const c = glyph.some(([X, Y, W, H]) => gx >= X && gx < X + W && gy >= Y && gy < Y + H) ? WHITE : gradientAt(fx, fy, size, size);
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
      }
      px[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return px;
}

/** The glyph in white over a background drawn by `paint(x, y)` (installer art); `box` = [centre x, centre y, size]. */
function art(w, h, paint, box) {
  const [cx, cy, size] = box;
  const unit = size / 12;
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const fx = x + (sx + 0.5) / 4;
          const fy = y + (sy + 0.5) / 4;
          const gx = (fx - cx) / unit + 12;
          const gy = (fy - cy) / unit + 12;
          const c = GLYPH_24.some(([X, Y, W, H]) => gx >= X && gx < X + W && gy >= Y && gy < Y + H) ? WHITE : paint(fx, fy);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (y * w + x) * 4;
      px[i] = Math.round(r / 16);
      px[i + 1] = Math.round(g / 16);
      px[i + 2] = Math.round(b / 16);
      px[i + 3] = 255;
    }
  }
  return px;
}

// ------------------------------------------------------------------ encoders
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** PNG (RGBA, or RGB when `opaque`). */
function png(px, w, h, opaque = false) {
  const ch = opaque ? 3 : 4;
  const stride = w * ch + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) raw[y * stride + 1 + x * ch + c] = px[(y * w + x) * 4 + c];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
/** One 32-bit bitmap entry of an .ico (bottom-up BGRA plus the 1-bit AND mask). */
function icoBitmap(px, s) {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(s, 4);
  head.writeInt32LE(s * 2, 8);
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  const color = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const from = ((s - 1 - y) * s + x) * 4;
      const to = (y * s + x) * 4;
      color[to] = px[from + 2];
      color[to + 1] = px[from + 1];
      color[to + 2] = px[from];
      color[to + 3] = px[from + 3];
    }
  }
  const rowBytes = Math.ceil(s / 32) * 4;
  const mask = Buffer.alloc(rowBytes * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (px[((s - 1 - y) * s + x) * 4 + 3] === 0) mask[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  return Buffer.concat([head, color, mask]);
}
function ico(sizes) {
  const images = sizes.map((s) => (s >= 256 ? png(render(s), s, s) : icoBitmap(render(s), s)));
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
/** 24-bit bottom-up BMP (the installer's sidebar and header). */
function bmp(px, w, h) {
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
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = ((h - 1 - y) * w + x) * 4;
      const to = 54 + y * row + x * 3;
      out[to] = px[from + 2];
      out[to + 1] = px[from + 1];
      out[to + 2] = px[from];
    }
  }
  return out;
}

/** The master drawing as SVG (desktop/build/icon.svg and the favicon). */
function svg(size) {
  const rects = GLYPH_24.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">
  <!-- placeholder monogram (desktop/scripts/make-icons.cjs, src/ui/components/brand.tsx) -->
  <defs><linearGradient id="t" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#240D21"/><stop offset="1" stop-color="#6A2E63"/></linearGradient></defs>
  <rect width="24" height="24" rx="5.4" fill="url(#t)"/>
  <g fill="#FFFFFF">${rects}</g>
</svg>
`;
}

// ------------------------------------------------------------------ write
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`  ${path.relative(root, file)} (${data.length} bytes)`);
}

write(path.join(BUILD, "icon.ico"), ico([16, 20, 24, 30, 32, 36, 40, 48, 64, 256]));
const icon256 = png(render(256), 256, 256);
write(path.join(BUILD, "icon.png"), icon256);
write(path.join(BUILD, "icon-256.png"), icon256);
write(path.join(BUILD, "icon.svg"), svg(256));
for (const [name, s] of [["tray.png", 16], ["tray@1.5x.png", 24], ["tray@2x.png", 32]]) write(path.join(BUILD, name), png(render(s), s, s));
// installer art: the sky of the brand surfaces with the glyph (welcome and finish pages), and a white header that
// ends in the tile
const sky = (x, y) => lerp([0x1c, 0x0a, 0x1a], [0x43, 0x20, 0x3d], y / 314);
write(path.join(BUILD, "installerSidebar.bmp"), bmp(art(164, 314, sky, [82, 104, 56]), 164, 314));
const header = (x, y) => (x >= 150 - 57 ? gradientAt(x - (150 - 57), y, 57, 57) : [255, 255, 255]);
write(path.join(BUILD, "installerHeader.bmp"), bmp(art(150, 57, header, [150 - 28.5, 28.5, 24]), 150, 57));

write(path.join(STATIC, "favicon.ico"), ico([16, 32, 48]));
write(path.join(STATIC, "favicon.svg"), svg(16));
write(path.join(STATIC, "apple-touch-icon.png"), png(render(180, { tile: "full" }), 180, 180, true));
for (const s of [192, 512]) {
  write(path.join(STATIC, "icons", `icon-${s}.png`), png(render(s), s, s));
  write(path.join(STATIC, "icons", `icon-maskable-${s}.png`), png(render(s, { tile: "full", scale: 0.8 }), s, s, true));
}
console.log("✓ icons written");

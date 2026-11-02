// Generates the Windows icon (.ico), window icon (.png) and the NSIS installer images (.bmp)
// from SVG/HTML rendered by Chromium (Playwright). Run: node scripts/make-icons.cjs
const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const fs = require("fs");
const path = require("path");

const out = path.join(__dirname, "..", "build");
const font = path.join(__dirname, "..", "..", "src", "ui", "static", "fonts", "vazirmatn-var.woff2");
fs.mkdirSync(out, { recursive: true });

const LOGO = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0e7490"/><stop offset="1" stop-color="#0b1f33"/></linearGradient>
<linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f1d58a"/><stop offset="1" stop-color="#b8862f"/></linearGradient></defs>
<rect width="64" height="64" rx="${size <= 32 ? 10 : 14}" fill="url(#g)"/>
<path d="M14 22h36" stroke="url(#a)" stroke-width="4.5" stroke-linecap="round"/>
<path d="M32 18v28" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
<circle cx="32" cy="17" r="3.2" fill="url(#a)"/>
<path d="M18 22l-6.5 12.5h13zM46 22l-6.5 12.5h13z" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
<path d="M11.5 34.5a6.5 3.4 0 0 0 13 0zM39.5 34.5a6.5 3.4 0 0 0 13 0z" fill="#fff" opacity=".9"/>
<path d="M22 48h20" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/></svg>`;

async function render(page, html, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>@font-face{font-family:V;src:url("file://${font}")}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}

function toIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]);
}

function toBmp24(pngBuf, bg = [255, 255, 255]) {
  const png = PNG.sync.read(pngBuf);
  const { width: w, height: h, data } = png;
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pixelBytes = rowSize * h;
  const buf = Buffer.alloc(54 + pixelBytes);
  buf.write("BM", 0);
  buf.writeUInt32LE(54 + pixelBytes, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelBytes, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const row = 54 + (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3] / 255;
      const r = Math.round(data[i] * a + bg[0] * (1 - a));
      const g = Math.round(data[i + 1] * a + bg[1] * (1 - a));
      const b = Math.round(data[i + 2] * a + bg[2] * (1 - a));
      buf[row + x * 3] = b;
      buf[row + x * 3 + 1] = g;
      buf[row + x * 3 + 2] = r;
    }
  }
  return buf;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) pngs.push({ size: s, buf: await render(page, LOGO(s), s, s) });
  fs.writeFileSync(path.join(out, "icon.ico"), toIco(pngs));
  fs.writeFileSync(path.join(out, "icon.png"), await render(page, LOGO(512), 512, 512));
  fs.writeFileSync(path.join(out, "icon-256.png"), pngs.find((p) => p.size === 256).buf);

  // installer sidebar 164×314 (welcome / finish pages)
  const sidebar = `<div style="width:164px;height:314px;box-sizing:border-box;padding:26px 16px;direction:rtl;font-family:V;color:#fff;
    background:radial-gradient(220px 160px at 30% 0%,#13a3c466,transparent 70%),radial-gradient(200px 160px at 90% 100%,#b8862f55,transparent 70%),linear-gradient(170deg,#0b1f33,#071321);
    display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px">
    ${LOGO(76)}
    <div style="font-size:38px;font-weight:800;line-height:1.2;margin-top:6px">تراز</div>
    <div style="font-size:12px;line-height:1.9;color:#c7d3e0">حسابداری و مدیریت<br>کسب‌وکار</div>
    <div style="margin-top:auto;font-size:10.5px;line-height:1.9;color:#e9c46a">کالا · طلا · صرافی</div>
    <div style="font-size:9.5px;color:#8aa0b6">نسخه‌ی ویندوز و وب، هم‌گام</div>
  </div>`;
  fs.writeFileSync(path.join(out, "installerSidebar.bmp"), toBmp24(await render(page, sidebar, 164, 314), [11, 31, 51]));
  // installer header 150×57
  const header = `<div style="width:150px;height:57px;display:flex;align-items:center;justify-content:center;gap:8px;background:#fff;direction:rtl;font-family:V">
    ${LOGO(38)}<div style="font-size:22px;font-weight:800;color:#0b1f33">تراز</div></div>`;
  fs.writeFileSync(path.join(out, "installerHeader.bmp"), toBmp24(await render(page, header, 150, 57)));
  await browser.close();
  console.log("icons written to", out);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

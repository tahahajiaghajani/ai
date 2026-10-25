// Renders every booth item, style and mode with Chromium:
//   out/print/pars-<item>-<style>-<mode>-<w>x<h>cm.pdf   the print file at its exact size, fonts embedded, TrimBox/BleedBox set
//   out/proof/<item>-<style>-<mode>.pdf                   the same with guides: returns, panel seams, trim and safe areas
//   out/preview/<item>-<style>-<mode>.png                 a preview (2400 px on the long side), rasterized from the print PDF
//   out/jpg/pars-<item>-<style>-<mode>-<w>x<h>cm.jpg      with --jpg: a full-size RGB JPEG for shops that print from images
//                                                         (pop-up 100 dpi, the rest 150 dpi)
// and fails if an asset fails to load, a gradient word wraps, a block overflows, or the QR stops decoding.
// Usage: node render.mjs [item…] [--jpg]      Chromium: CHROME_PATH=… or Playwright's installed browser.
import { chromium } from "playwright-core";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const PT = 72 / 2.54; // points per cm
const ITEMS = { popup: [361, 230, 0], rollup1: [95, 210, 5], rollup2: [95, 210, 5], counter: [214, 90, 0], swatch: [60, 45, 0] }; // w, h, bleed (cm)
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith("--")), JPG = args.includes("--jpg");
for (const a of args) if (!Object.hasOwn(ITEMS, a) && a !== "--jpg") throw new Error(`unknown argument ${a} (items: ${Object.keys(ITEMS).join(", ")}; flag: --jpg)`);
const SITE = fs.readFileSync(path.join(OUT, "qr.js"), "utf8").match(/SITE_URL = "([^"]+)"/)[1]; // what the QR must read
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
for (const d of ["print", "proof", "preview", ...(JPG ? ["jpg"] : [])]) fs.mkdirSync(path.join(OUT, d), { recursive: true });

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push("failed to load " + r.url()));
  await page.emulateMedia({ media: "print" });
  await page.goto("file://" + path.join(OUT, "booth.html") + query, { waitUntil: "networkidle" });
  await page.waitForSelector("html[data-ready]", { timeout: 60000 });
  const failed = await page.evaluate(() => document.documentElement.dataset.error);
  if (failed) errors.push(failed);
  if (errors.length) throw new Error(query + ": " + errors.join("; "));
  return page;
}

/** Chromium tags every font subset AAAAAA+ …; give each embedded subset its own tag (PDF 32000 §9.6.4). */
function uniqueSubsets(doc) {
  const tag = (i) => { let t = ""; for (let k = 0; k < 6; k++, i = Math.floor(i / 26)) t = String.fromCharCode(65 + (i % 26)) + t; return t; };
  const rename = (dict, key, t) => { const v = dict.get(PDFName.of(key)); if (v instanceof PDFName) dict.set(PDFName.of(key), PDFName.of(t + "+" + v.decodeText().replace(/^[A-Z]{6}\+/, ""))); };
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Type")) !== PDFName.of("Font") || obj.get(PDFName.of("Subtype")) !== PDFName.of("Type0")) continue;
    const t = tag(n++);
    rename(obj, "BaseFont", t);
    const cid = obj.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
    rename(cid, "BaseFont", t);
    const fd = cid.lookup(PDFName.of("FontDescriptor"), PDFDict);
    if (fd) rename(fd, "FontName", t);
  }
}
/** Chromium sizes PDF pages in 0.01 in steps; cut the page to the exact file size and set the trim and bleed boxes */
async function finish(src, out, [w, h, bleed]) {
  const doc = await PDFDocument.load(fs.readFileSync(src));
  for (const page of doc.getPages()) {
    const { height } = page.getMediaBox();
    const box = [0, height - h * PT, w * PT, h * PT];
    page.setMediaBox(...box);
    page.setCropBox(...box);
    page.setBleedBox(...box);
    page.setTrimBox(bleed * PT, height - (h - bleed) * PT, (w - 2 * bleed) * PT, (h - 2 * bleed) * PT);
  }
  uniqueSubsets(doc);
  doc.setTitle("Pars Project Management — exhibition booth");
  fs.writeFileSync(out, await doc.save());
}

for (const [item, dims] of Object.entries(ITEMS)) {
  if (only.length && !only.includes(item)) continue;
  // the test strip has one style
  for (const style of item === "swatch" ? [""] : ["minimal", "detailed"]) for (const mode of ["dark", "light"]) {
    const name = [item, style, mode].filter(Boolean).join("-");
    const q = `?item=${item}&style=${style || "minimal"}&mode=${mode}`;
    const raw = path.join(OUT, "chromium.pdf"), check = path.join(OUT, "check");
    const print = path.join(OUT, "print", `pars-${name}-${dims[0]}x${dims[1]}cm.pdf`), draft = print + ".part";
    const preview = path.join(OUT, "preview", name), jpg = path.join(OUT, "jpg", path.basename(print, ".pdf")), proofPdf = path.join(OUT, "proof", name + ".pdf");
    // this file's previous outputs go first, so a failed check never leaves an older file under the final name
    for (const f of [print, preview + ".png", jpg + ".jpg", proofPdf]) fs.rmSync(f, { force: true });
    try {
      const page = await open(q);
      // nothing may overflow its block or leave the safe area (window.SAFE, items.js; the proof draws the same area), and on
      // the pop-up and the counter no logo, number, QR or agent step may sit on a seam or fold. The returns' marks are art.
      const { blocks, keyed, safe } = await page.evaluate(() => {
        const CM = 96 / 2.54, s = document.getElementById("board").getBoundingClientRect();
        const box = (n) => { const r = n.getBoundingClientRect(); return { x0: (r.left - s.left) / CM, x1: (r.right - s.left) / CM, y0: (r.top - s.top) / CM, y1: (r.bottom - s.top) / CM }; };
        const what = (n) => n.className + ": " + n.textContent.trim().slice(0, 40);
        return {
          blocks: [...document.querySelectorAll(".b:not(.mark)")].map((n) => ({ what: what(n), overflow: n.scrollWidth > n.clientWidth + 2 || (n.scrollHeight > n.clientHeight + 2 && !!n.style.height), ...box(n) })),
          keyed: [...document.querySelectorAll(".logos figure, .stat .num, .qr, .flow .st")].map((n) => ({ what: what(n), ...box(n) })),
          safe: window.SAFE[new URLSearchParams(location.search).get("item")] ?? null,
        };
      });
      const e = 0.05, fmt = (b) => `${b.what} [${b.x0.toFixed(1)}–${b.x1.toFixed(1)} × ${b.y0.toFixed(1)}–${b.y1.toFixed(1)} cm]`;
      const bad = [
        ...blocks.filter((b) => b.overflow).map((b) => "overflows: " + fmt(b)),
        ...(safe ? blocks.filter((b) => b.x0 < safe.x[0] - e || b.x1 > safe.x[1] + e || b.y0 < safe.y[0] - e || b.y1 > safe.y[1] + e).map((b) => "outside the safe area: " + fmt(b)) : []),
        ...(safe ? keyed.filter((b) => safe.seams.some((x) => b.x0 < x && b.x1 > x)).map((b) => "on a seam: " + fmt(b)) : []),
      ];
      if (bad.length) throw new Error(`${name}: ${bad.join(" | ")}`);
      // the print file is written under a temporary name and gets its real name only after every check has passed
      await page.pdf({ path: raw, preferCSSPageSize: true, printBackground: true });
      await finish(raw, draft, dims);
      await page.close();
      // the edges of the print: no blank sliver along any side (the art must reach the cut on every edge)
      execFileSync("pdftoppm", ["-png", "-r", "40", "-singlefile", draft, check]);
      const ep = PNG.sync.read(fs.readFileSync(check + ".png"));
      const px = (x, y) => { const i = (y * ep.width + x) * 4; return ep.data[i] + ep.data[i + 1] + ep.data[i + 2]; };
      const col = (x) => { let t = 0; for (let y = 0; y < ep.height; y++) t += px(x, y); return t / ep.height / 3; };
      const row = (y) => { let t = 0; for (let x = 0; x < ep.width; x++) t += px(x, y); return t / ep.width / 3; };
      const W1 = ep.width - 1, H1 = ep.height - 1;
      for (const [edge, next, side] of [[col(0), col(2), "left"], [col(W1), col(W1 - 2), "right"], [row(0), row(2), "top"], [row(H1), row(H1 - 2), "bottom"]])
        if (Math.abs(edge - next) > 18) throw new Error(`${name}: the ${side} edge differs from the art next to it (${edge.toFixed(0)} vs ${next.toFixed(0)}): a blank sliver?`);
      // the QR must decode from the print at a phone-like resolution, to the site
      if (style !== "minimal") {
        const scale = Math.max(30, Math.round(2400 / Math.max(dims[0], dims[1]) * 2.54));
        execFileSync("pdftoppm", ["-png", "-r", String(scale), "-singlefile", draft, check]);
        const png = PNG.sync.read(fs.readFileSync(check + ".png"));
        const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
        if (code?.data !== SITE) throw new Error(`${name}: the QR ${code ? "reads " + code.data : "does not decode"}`);
      }
      fs.renameSync(draft, print);
      const proof = await open(q + "&guides");
      await proof.pdf({ path: raw, preferCSSPageSize: true, printBackground: true });
      await finish(raw, proofPdf, dims);
      await proof.close();
    } finally {
      for (const f of [raw, draft, check + ".png"]) fs.rmSync(f, { force: true });
    }
    // preview from the print PDF itself, about 2400 px on the long side
    execFileSync("pdftoppm", ["-png", "-scale-to", "2400", "-singlefile", print, preview]);
    // without --jpg this file's JPEG was removed above, so out/jpg never holds an older design or address
    // whole pixels only: a partial last pixel would blend the edge with what lies beyond the page
    if (JPG) {
      const dpi = item === "popup" ? 100 : 150, px = (cm) => String(Math.floor((cm / 2.54) * dpi));
      execFileSync("pdftoppm", ["-jpeg", "-jpegopt", "quality=92", "-r", String(dpi), "-x", "0", "-y", "0", "-W", px(dims[0]), "-H", px(dims[1]), "-singlefile", print, jpg]);
    }
    console.log("✓", name);
  }
}
await browser.close();

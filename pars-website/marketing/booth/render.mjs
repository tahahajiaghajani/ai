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
for (const a of args) if (!(a in ITEMS) && a !== "--jpg") throw new Error(`unknown argument ${a} (items: ${Object.keys(ITEMS).join(", ")}; flag: --jpg)`);
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
    const page = await open(q);
    // nothing may overflow its block, and no block may leave the area where it can be seen: on the pop-up everything sits
    // above the counters (y ≤ 140), on a roll-up inside the safe area and above the stand foot, on the counter nothing
    // crosses a fold (x = 72, 142)
    const blocks = await page.evaluate(() => {
      const CM = 96 / 2.54, s = document.getElementById("board").getBoundingClientRect();
      return [...document.querySelectorAll(".b")].map((n) => {
        const r = n.getBoundingClientRect();
        return { what: n.className + ": " + n.textContent.trim().slice(0, 40), overflow: n.scrollWidth > n.clientWidth + 2 || (n.scrollHeight > n.clientHeight + 2 && !!n.style.height),
          x0: (r.left - s.left) / CM, x1: (r.right - s.left) / CM, y0: (r.top - s.top) / CM, y1: (r.bottom - s.top) / CM };
      });
    });
    const outside = {
      popup: (b) => b.y1 > 140.05,
      rollup1: (b) => b.x0 < 9.95 || b.x1 > 85.05 || b.y0 < 9 || b.y1 > 190.05,
      counter: (b) => [72, 142].some((x) => b.x0 < x && b.x1 > x) || b.y1 > 86,
    };
    outside.rollup2 = outside.rollup1;
    const bad = blocks.filter((b) => b.overflow || outside[item]?.(b)).map((b) => `${b.what} [${b.x0.toFixed(1)}–${b.x1.toFixed(1)} × ${b.y0.toFixed(1)}–${b.y1.toFixed(1)} cm]`);
    if (bad.length) throw new Error(name + " has blocks outside their area: " + bad.join(" | "));
    // the print file is written under a temporary name and gets its real name only after every check has passed
    const raw = path.join(OUT, "chromium.pdf");
    const print = path.join(OUT, "print", `pars-${name}-${dims[0]}x${dims[1]}cm.pdf`), draft = print + ".part";
    const preview = path.join(OUT, "preview", name), jpg = path.join(OUT, "jpg", path.basename(print, ".pdf"));
    for (const f of [print, preview + ".png", jpg + ".jpg"]) fs.rmSync(f, { force: true });
    await page.pdf({ path: raw, preferCSSPageSize: true, printBackground: true });
    await finish(raw, draft, dims);
    await page.close();
    // the QR must decode from the print at a phone-like resolution, to the site
    if (style !== "minimal") {
      const scale = Math.max(30, Math.round(2400 / Math.max(dims[0], dims[1]) * 2.54));
      execFileSync("pdftoppm", ["-png", "-r", String(scale), "-singlefile", draft, path.join(OUT, "qrcheck")]);
      const png = PNG.sync.read(fs.readFileSync(path.join(OUT, "qrcheck.png")));
      const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      fs.rmSync(path.join(OUT, "qrcheck.png"));
      if (code?.data !== SITE) { fs.rmSync(draft); throw new Error(`${name}: the QR ${code ? "reads " + code.data : "does not decode"}`); }
    }
    fs.renameSync(draft, print);
    const proof = await open(q + "&guides");
    await proof.pdf({ path: raw, preferCSSPageSize: true, printBackground: true });
    await finish(raw, path.join(OUT, "proof", name + ".pdf"), dims);
    await proof.close();
    fs.rmSync(raw);
    // preview from the print PDF itself, about 2400 px on the long side
    execFileSync("pdftoppm", ["-png", "-scale-to", "2400", "-singlefile", print, preview]);
    // without --jpg the stale JPEG of this file was removed above, so out/jpg never holds an older design or address
    if (JPG) execFileSync("pdftoppm", ["-jpeg", "-jpegopt", "quality=92", "-r", String(item === "popup" ? 100 : 150), "-singlefile", print, jpg]);
    console.log("✓", name);
  }
}
await browser.close();

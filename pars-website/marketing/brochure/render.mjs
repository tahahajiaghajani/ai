// Renders out/brochure.html with Chromium:
//   out/pars-brochure-A4.pdf           2 pages, exactly A4 landscape 297 × 210 mm (the finished size)
//   out/pars-brochure-print.pdf        2 pages, exactly 303 × 216 mm (trim + 3 mm bleed), TrimBox and BleedBox set
//   out/pars-brochure-print-marks.pdf  the same on larger pages with crop marks, fold marks and a slug line
//   out/brochure-outside.png, out/brochure-inside.png   A4 at 300 dpi (3508 × 2480)
//   out/outside.png, out/inside.png    300-dpi spreads with bleed; out/panels/*.png  each trimmed panel
//   out/mockup.png                     a 3D mockup
// and fails if a panel overflows, a gradient word wraps, or the QR stops decoding at print or phone-like resolutions.
// Chromium: CHROME_PATH=… or Playwright's installed browser.
import { chromium } from "playwright-core";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const DPI = 300 / 96;
const PT = 72 / 25.4; // points per mm

async function open(query = "", dsf = DPI) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: dsf });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push("failed to load " + r.url()));
  await page.emulateMedia({ media: "print" });
  await page.goto("file://" + path.join(OUT, "brochure.html") + query, { waitUntil: "networkidle" });
  await page.waitForSelector("html[data-ready]", { timeout: 30000 });
  const failed = await page.evaluate(() => document.documentElement.dataset.error);
  if (failed) errors.push(failed);
  if (errors.length) throw new Error(errors.join("; "));
  return page;
}

/** Chromium tags every font subset AAAAAA+, BAAAAA+ … per page; give each embedded subset its own tag (PDF 32000 §9.6.4). */
function uniqueSubsets(doc) {
  const tag = (i) => {
    let t = "";
    for (let k = 0; k < 6; k++, i = Math.floor(i / 26)) t = String.fromCharCode(65 + (i % 26)) + t;
    return t;
  };
  const rename = (dict, key, t) => {
    const v = dict.get(PDFName.of(key));
    if (v instanceof PDFName) dict.set(PDFName.of(key), PDFName.of(t + "+" + v.decodeText().replace(/^[A-Z]{6}\+/, "")));
  };
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

/**
 * Page boxes for printing. The trim starts `offset` mm from the top-left corner of Chromium's page.
 * crop "bleed" or "trim" also cuts the page itself to that box, so the file is exactly 303 × 216 or 297 × 210 mm.
 */
async function finish(src, out, offset, crop) {
  const doc = await PDFDocument.load(fs.readFileSync(src));
  for (const page of doc.getPages()) {
    const { height } = page.getMediaBox();
    const top = height - offset * PT;
    const trim = [offset * PT, top - 210 * PT, 297 * PT, 210 * PT];
    const bleed = [(offset - 3) * PT, top - 213 * PT, 303 * PT, 216 * PT];
    page.setTrimBox(...trim);
    page.setBleedBox(...(crop === "trim" ? trim : bleed));
    if (crop) {
      const box = crop === "trim" ? trim : bleed;
      page.setMediaBox(...box);
      page.setCropBox(...box);
    }
  }
  uniqueSubsets(doc);
  fs.writeFileSync(out, await doc.save());
}

const page = await open();
const overflow = await page.evaluate(() => [...document.querySelectorAll(".p")].filter((p) => p.scrollHeight > p.clientHeight + 1).map((p) => p.className));
if (overflow.length) throw new Error("content overflows its panel: " + overflow.join(", "));

const mm = 96 / 25.4;
/** a region of a sheet in mm, at 300 dpi */
async function shot(sheet, file, x, y, w, h) {
  await page.evaluate(() => window.scrollTo(0, 0)); // element screenshots scroll the page; clips are in page coordinates
  const box = await page.locator("#" + sheet).boundingBox();
  await page.screenshot({ path: path.join(OUT, file), fullPage: true, clip: { x: box.x + x * mm, y: box.y + y * mm, width: w * mm, height: h * mm } });
}
for (const id of ["outside", "inside"]) {
  await shot(id, id + ".png", 0, 0, 303, 216);
  await shot(id, `brochure-${id}.png`, 3, 3, 297, 210);
}
fs.mkdirSync(path.join(OUT, "panels"), { recursive: true });
const PANELS = [
  ["outside", "1-cover", 3, 100], ["inside", "2-cover-inner", 200, 100], ["outside", "3-flap-outer", 203, 97],
  ["inside", "4-middle-inner", 100, 100], ["inside", "5-foldin-inner", 3, 97], ["outside", "6-back-qr", 103, 100],
];
for (const [sheet, name, x, w] of PANELS) await shot(sheet, `panels/${name}.png`, x, 3, w, 210);

for (const [dsf, label] of [[DPI, "300 dpi"], [1, "96 dpi"], [0.6, "58 dpi"]]) {
  const p = dsf === DPI ? page : await open("", dsf);
  const png = PNG.sync.read(await p.locator("#qr").screenshot());
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!code) throw new Error(`the QR does not decode at ${label}`);
  console.log(`QR at ${label}: ${code.data}`);
  if (p !== page) await p.close();
}

const raw = path.join(OUT, "chromium.pdf");
await page.pdf({ path: raw, preferCSSPageSize: true, printBackground: true });
await finish(raw, path.join(OUT, "pars-brochure-print.pdf"), 3, "bleed");
await finish(raw, path.join(OUT, "pars-brochure-A4.pdf"), 3, "trim");
const marks = await open("?marks", 1);
await marks.pdf({ path: raw, preferCSSPageSize: true, printBackground: true });
await finish(raw, path.join(OUT, "pars-brochure-print-marks.pdf"), 13);
fs.rmSync(raw);

const mock = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2 });
await mock.goto("file://" + path.join(OUT, "mockup.html"), { waitUntil: "networkidle" });
await mock.screenshot({ path: path.join(OUT, "mockup.png") });

await browser.close();
console.log("done →", OUT);

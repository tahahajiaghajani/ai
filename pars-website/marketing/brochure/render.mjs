// Renders out/brochure.html with Chromium:
//   out/pars-brochure-print.pdf        2 pages, 303 × 216 mm (A4 landscape 297 × 210 trim + 3 mm bleed), fonts embedded,
//                                      TrimBox and BleedBox set for imposition
//   out/pars-brochure-print-marks.pdf  the same on 323 × 236 mm pages with crop marks, fold marks and a slug line
//   out/outside.png, out/inside.png    300-dpi spreads with bleed; out/panels/*.png  each trimmed panel
//   out/mockup.png                     a 3D mockup
// and fails if a panel overflows, a gradient word wraps, or the QR stops decoding at print or phone-like resolutions.
// Chromium: CHROME_PATH=… or Playwright's installed browser.
import { chromium } from "playwright-core";
import { PDFDocument } from "pdf-lib";
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

/** TrimBox and BleedBox on every page: the trim starts `offset` mm from the top-left corner. */
async function setBoxes(file, offset) {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  for (const page of doc.getPages()) {
    const { height } = page.getSize();
    const top = height - offset * PT;
    page.setTrimBox(offset * PT, top - 210 * PT, 297 * PT, 210 * PT);
    page.setBleedBox((offset - 3) * PT, top - 213 * PT, 303 * PT, 216 * PT);
  }
  fs.writeFileSync(file, await doc.save());
}

const page = await open();
const overflow = await page.evaluate(() => [...document.querySelectorAll(".p")].filter((p) => p.scrollHeight > p.clientHeight + 1).map((p) => p.className));
if (overflow.length) throw new Error("content overflows its panel: " + overflow.join(", "));

for (const id of ["outside", "inside"]) await page.locator("#" + id).screenshot({ path: path.join(OUT, id + ".png") });
fs.mkdirSync(path.join(OUT, "panels"), { recursive: true });
const PANELS = [
  ["outside", "1-cover", 3, 100], ["inside", "2-cover-inner", 200, 100], ["outside", "3-flap-outer", 203, 97],
  ["inside", "4-middle-inner", 100, 100], ["inside", "5-foldin-inner", 3, 97], ["outside", "6-back-qr", 103, 100],
];
for (const [sheet, name, x, w] of PANELS) {
  // element screenshots scroll the page; clips are in page coordinates
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator("#" + sheet).boundingBox();
  const mm = 96 / 25.4;
  await page.screenshot({ path: path.join(OUT, "panels", name + ".png"), fullPage: true, clip: { x: box.x + x * mm, y: box.y + 3 * mm, width: w * mm, height: 210 * mm } });
}

for (const [dsf, label] of [[DPI, "300 dpi"], [1, "96 dpi"], [0.6, "58 dpi"]]) {
  const p = dsf === DPI ? page : await open("", dsf);
  const png = PNG.sync.read(await p.locator("#qr").screenshot());
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!code) throw new Error(`the QR does not decode at ${label}`);
  console.log(`QR at ${label}: ${code.data}`);
  if (p !== page) await p.close();
}

const print = path.join(OUT, "pars-brochure-print.pdf");
await page.pdf({ path: print, preferCSSPageSize: true, printBackground: true });
await setBoxes(print, 3);
const marks = await open("?marks", 1);
const proof = path.join(OUT, "pars-brochure-print-marks.pdf");
await marks.pdf({ path: proof, preferCSSPageSize: true, printBackground: true });
await setBoxes(proof, 13);

const mock = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2 });
await mock.goto("file://" + path.join(OUT, "mockup.html"), { waitUntil: "networkidle" });
await mock.screenshot({ path: path.join(OUT, "mockup.png") });

await browser.close();
console.log("done →", OUT);

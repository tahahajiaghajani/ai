// Renders out/brochure.html with Chromium:
//   out/pars-brochure-print.pdf        2 pages, 303×216 mm (A4 landscape 297×210 trim + 3 mm bleed), fonts embedded
//   out/pars-brochure-print-marks.pdf  the same on 323×236 mm pages with crop marks, fold marks and a slug line
//   out/outside.png, out/inside.png    300-dpi spreads with bleed; out/panels/*.png  each trimmed panel
//   out/mockup.png                     a 3D mockup
// and checks that the QR decodes at print and at phone-like resolutions.
// Chromium: CHROME_PATH=… or Playwright's installed browser.
import { chromium } from "playwright-core";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const DPI = 300 / 96;

async function open(query = "", dsf = DPI) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: dsf });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ media: "print" });
  await page.goto("file://" + path.join(OUT, "brochure.html") + query, { waitUntil: "networkidle" });
  await page.waitForSelector("html[data-ready='1']", { timeout: 30000 });
  if (errors.length) throw new Error("page errors: " + errors.join("; "));
  return page;
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

await page.pdf({ path: path.join(OUT, "pars-brochure-print.pdf"), preferCSSPageSize: true, printBackground: true });
const marks = await open("?marks", 1);
await marks.pdf({ path: path.join(OUT, "pars-brochure-print-marks.pdf"), preferCSSPageSize: true, printBackground: true });

const mock = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2 });
await mock.goto("file://" + path.join(OUT, "mockup.html"), { waitUntil: "networkidle" });
await mock.screenshot({ path: path.join(OUT, "mockup.png") });

await browser.close();
console.log("done →", OUT);

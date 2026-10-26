// Booth mockups from the rendered previews (run render.mjs first):
//   out/mockup/booth-<style>-<mode>.jpg   a 3/4 view of the pop-up, both roll-ups and both counters at real proportions
//   out/mockup/booth-final-dark.jpg       the chosen set: the minimal pop-up and counters with the detailed roll-ups
// A mockup whose previews have not been rendered (e.g. after render.mjs --final) is skipped.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
fs.mkdirSync(path.join(OUT, "mockup"), { recursive: true });
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const NEEDS = { final: ["popup-minimal", "rollup1-detailed", "rollup2-detailed", "counter-minimal"] };
const combos = [["final", "dark"], ...["minimal", "detailed"].flatMap((s) => ["dark", "light"].map((m) => [s, m]))];
for (const [style, mode] of combos) {
  const needs = (NEEDS[style] ?? ["popup", "rollup1", "rollup2", "counter"].map((i) => `${i}-${style}`)).map((n) => path.join(OUT, "preview", `${n}-${mode}.png`));
  if (!needs.every((f) => fs.existsSync(f))) { console.log("· skipped mockup", style, mode, "(previews not rendered)"); continue; }
  const page = await browser.newPage({ viewport: { width: 2400, height: 1500 } });
  await page.goto(`file://${path.join(OUT, "mockup.html")}?style=${style}&mode=${mode}`);
  await page.waitForSelector("html[data-ready], html[data-error]");
  const failed = await page.evaluate(() => document.documentElement.dataset.error);
  if (failed) throw new Error(failed);
  const png = path.join(OUT, "mockup", `booth-${style}-${mode}.png`);
  await page.screenshot({ path: png });
  execFileSync("convert", [png, "-quality", "90", png.replace(/\.png$/, ".jpg")]);
  fs.rmSync(png);
  await page.close();
  console.log("✓ mockup", style, mode);
}
await browser.close();

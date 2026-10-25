// Booth mockups from the rendered previews (run render.mjs first):
//   out/mockup/booth-<style>-<mode>.jpg   a 3/4 view of the pop-up, both roll-ups and both counters at real proportions
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
fs.mkdirSync(path.join(OUT, "mockup"), { recursive: true });
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
for (const style of ["minimal", "detailed"]) for (const mode of ["dark", "light"]) {
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

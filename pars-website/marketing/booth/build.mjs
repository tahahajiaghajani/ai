// Builds out/: copies the brand assets from ../../public, the static font files from @fontsource and the page
// sources from src/, and writes out/site.js with the site address the boards print.
// Usage: node build.mjs [url]   (or BOOTH_URL=…)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const OUT = path.join(HERE, "out");
const URL_ = process.argv[2] ?? process.env.BOOTH_URL ?? "https://parspmi.ir";

// the page and its assets are rebuilt; rendered files (print/, proof/, preview/) stay until render.mjs replaces them
fs.rmSync(path.join(OUT, "assets"), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "assets/fonts"), { recursive: true });
for (const f of fs.readdirSync(path.join(PUBLIC, "brand"))) fs.copyFileSync(path.join(PUBLIC, "brand", f), path.join(OUT, "assets", f));
const fonts = [
  ...[300, 400, 500, 600, 700].flatMap((w) => ["arabic", "latin"].map((s) => `ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-${s}-${w}-normal.woff2`)),
  ...[400, 600, 700].map((w) => `sora/files/sora-latin-${w}-normal.woff2`),
];
for (const f of fonts) fs.copyFileSync(path.join(HERE, "node_modules/@fontsource", f), path.join(OUT, "assets/fonts", path.basename(f)));
for (const f of fs.readdirSync(path.join(HERE, "src"))) fs.copyFileSync(path.join(HERE, "src", f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, "site.js"), `window.SITE_URL = ${JSON.stringify(URL_)};\n`);
console.log("address →", new URL(URL_).host);

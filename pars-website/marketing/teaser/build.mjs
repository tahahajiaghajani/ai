// Builds out/: the teaser page, scripts, fonts, GSAP, brand and client logos, the demo screenshots and out/site.js
// with the site address the video shows. Screenshots are not in the repository: put them in screens/ (gitignored) or
// pass SCREENS=/path/to/folder.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const PUBLIC = path.resolve(HERE, "../../public");
const SCREENS = process.env.SCREENS ?? path.join(HERE, "screens");
const URL_ = process.env.TEASER_URL ?? "https://parspmi.ir";

const cp = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(path.join(HERE, "src"))) cp(path.join(HERE, "src", f), path.join(OUT, f));
for (const w of [300, 400, 500, 600, 700]) {
  for (const s of ["arabic", "latin"]) cp(path.join(HERE, `node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-${s}-${w}-normal.woff2`), path.join(OUT, `assets/fonts/ibm-plex-sans-arabic-${s}-${w}-normal.woff2`));
}
for (const w of [300, 400, 600, 700]) cp(path.join(HERE, `node_modules/@fontsource/sora/files/sora-latin-${w}-normal.woff2`), path.join(OUT, `assets/fonts/sora-latin-${w}-normal.woff2`));
for (const f of ["gsap.min.js", "CustomEase.min.js"]) cp(path.join(HERE, "node_modules/gsap/dist", f), path.join(OUT, "assets/gsap", f));
for (const f of fs.readdirSync(path.join(PUBLIC, "brand"))) cp(path.join(PUBLIC, "brand", f), path.join(OUT, "assets/brand", f));
for (const f of fs.readdirSync(path.join(PUBLIC, "clients"))) cp(path.join(PUBLIC, "clients", f), path.join(OUT, "assets/clients", f));
// only the screenshots the teaser uses (named in data.js) go into out/; nothing else from the archives travels with it
const used = [...new Set([...fs.readFileSync(path.join(HERE, "src/data.js"), "utf8").matchAll(/S\("([\w-]+)"/g)].map((m) => m[1] + ".png"))];
fs.rmSync(path.join(OUT, "screens"), { recursive: true, force: true });
for (const f of used) {
  if (fs.existsSync(path.join(SCREENS, f))) cp(path.join(SCREENS, f), path.join(OUT, "screens", f));
  else console.warn("missing screenshot", f, "in", SCREENS);
}

fs.writeFileSync(path.join(OUT, "site.js"), `window.SITE_URL = ${JSON.stringify(URL_)};\n`);
console.log("built", OUT);

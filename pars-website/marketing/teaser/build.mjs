// Builds out/: the teaser page, scripts, fonts, GSAP, brand and client logos, the demo screenshots and the QR.
// Screenshots are not in the repository: put them in screens/ (gitignored) or pass SCREENS=/path/to/folder.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const PUBLIC = path.resolve(HERE, "../../public");
const SCREENS = process.env.SCREENS ?? path.join(HERE, "screens");
const URL_ = process.env.TEASER_URL ?? "https://parspmi.vercel.app";

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

// the QR: dark modules on white, 4-module quiet zone, level Q; square finder patterns (rounded ones fail some decoders)
const q = QRCode.create(URL_, { errorCorrectionLevel: "Q" });
const N = q.modules.size, Q = 4;
let mods = "";
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const finder = (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
  if (q.modules.get(y, x) === 1 && !finder) mods += `<rect x="${x}" y="${y}" width="1" height="1" rx=".3"/>`;
}
const eye = (x, y) => `<path fill-rule="evenodd" d="M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5z"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#7b235a"/>`;
const svg = `<svg viewBox="${-Q} ${-Q} ${N + 2 * Q} ${N + 2 * Q}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block"><g fill="#1a183a">${mods}${eye(0, 0)}${eye(N - 7, 0)}${eye(0, N - 7)}</g></svg>`;
fs.writeFileSync(path.join(OUT, "qr.js"), `window.QR_SVG = ${JSON.stringify(svg)};\nwindow.QR_URL = ${JSON.stringify(URL_)};\n`);
console.log("built", OUT);

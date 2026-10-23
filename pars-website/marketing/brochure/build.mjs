// Builds out/brochure.html: copies the brand and client assets from ../../public and the static font files from
// @fontsource, and draws the QR code (vector, error correction Q, 4-module quiet zone, solid dark modules on white).
// The printed address on the cover and the back is taken from the same URL, so the two never disagree.
// Usage: node build.mjs [url]   (or BROCHURE_URL=…)
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const OUT = path.join(HERE, "out");
const URL_ = process.argv[2] ?? process.env.BROCHURE_URL ?? "https://parspmi.vercel.app";
const host = new URL(URL_).host;
const dot = host.indexOf(".");

const q = QRCode.create(URL_, { errorCorrectionLevel: "Q" });
const N = q.modules.size;
const dark = (x, y) => q.modules.get(y, x) === 1;
const Q = 4; // quiet zone, in modules
const inFinder = (x, y) => (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
let mods = "";
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  if (dark(x, y) && !inFinder(x, y)) mods += `<rect x="${x}" y="${y}" width="1" height="1" rx=".3"/>`;
}
const finder = (x, y) =>
  `<path fill-rule="evenodd" d="M${x + 2} ${y}h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM${x + 2.4} ${y + 1}h2.2a1.4 1.4 0 0 1 1.4 1.4v2.2a1.4 1.4 0 0 1-1.4 1.4h-2.2a1.4 1.4 0 0 1-1.4-1.4v-2.2a1.4 1.4 0 0 1 1.4-1.4z"/>` +
  `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".9" fill="#7b235a"/>`;
const svg = `<svg viewBox="${-Q} ${-Q} ${N + 2 * Q} ${N + 2 * Q}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" role="img" aria-label="${URL_}">
<g fill="#1a183a">${mods}${finder(0, 0)}${finder(N - 7, 0)}${finder(0, N - 7)}</g>
</svg>`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "assets/fonts"), { recursive: true });
const assets = ["brand/pars-logo-reverse.svg", "brand/pars-wordmark-reverse.svg", ...fs.readdirSync(path.join(PUBLIC, "clients")).map((f) => "clients/" + f)];
for (const a of assets) fs.copyFileSync(path.join(PUBLIC, a), path.join(OUT, "assets", path.basename(a)));
const fonts = [
  ...[400, 500, 600, 700].flatMap((w) => ["arabic", "latin"].map((s) => `ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-${s}-${w}-normal.woff2`)),
  "sora/files/sora-latin-600-normal.woff2",
];
for (const f of fonts) fs.copyFileSync(path.join(HERE, "node_modules/@fontsource", f), path.join(OUT, "assets/fonts", path.basename(f)));
for (const f of ["art.js", "mockup.html"]) fs.copyFileSync(path.join(HERE, f), path.join(OUT, f));

const html = fs.readFileSync(path.join(HERE, "brochure.html"), "utf8")
  .replace("{{QR}}", svg)
  .replace("{{HOST}}", host)
  .replace("{{HOST_NAME}}", host.slice(0, dot))
  .replace("{{HOST_REST}}", host.slice(dot));
if (html.includes("{{")) throw new Error("unfilled placeholder in brochure.html");
fs.writeFileSync(path.join(OUT, "brochure.html"), html);
console.log(`QR version ${q.version} (${N}×${N}, level Q) → ${URL_}`);

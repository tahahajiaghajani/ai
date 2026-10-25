// Builds out/: copies the brand and client assets from ../../public, the static font files from @fontsource and the page
// sources from src/, and draws the QR code (vector, error correction Q, 4-module quiet zone, solid dark modules on white).
// The printed address and the QR come from the same URL, so the two never disagree.
// Usage: node build.mjs [url]   (or BOOTH_URL=…)
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const OUT = path.join(HERE, "out");
const URL_ = process.argv[2] ?? process.env.BOOTH_URL ?? "https://parspmi.vercel.app";

const q = QRCode.create(URL_, { errorCorrectionLevel: "Q" });
const N = q.modules.size;
const Q = 4; // quiet zone, in modules
const inFinder = (x, y) => (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
let mods = "";
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (q.modules.get(y, x) === 1 && !inFinder(x, y)) mods += `<rect x="${x}" y="${y}" width="1" height="1" rx=".3"/>`;
// square finder eyes: every phone camera finds them
const eye = (x, y) => `<path fill-rule="evenodd" d="M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5z"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#7b235a"/>`;
const qr = `<svg viewBox="${-Q} ${-Q} ${N + 2 * Q} ${N + 2 * Q}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision"><rect x="${-Q}" y="${-Q}" width="${N + 2 * Q}" height="${N + 2 * Q}" fill="#fff"/><g fill="#1a183a">${mods}${eye(0, 0)}${eye(N - 7, 0)}${eye(0, N - 7)}</g></svg>`;

// the page and its assets are rebuilt; rendered files (print/, proof/, preview/) stay until render.mjs replaces them
fs.rmSync(path.join(OUT, "assets"), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "assets/fonts"), { recursive: true });
const assets = [...fs.readdirSync(path.join(PUBLIC, "brand")).map((f) => "brand/" + f), ...fs.readdirSync(path.join(PUBLIC, "clients")).map((f) => "clients/" + f)];
for (const a of assets) fs.copyFileSync(path.join(PUBLIC, a), path.join(OUT, "assets", path.basename(a)));
const fonts = [
  ...[300, 400, 500, 600, 700].flatMap((w) => ["arabic", "latin"].map((s) => `ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-${s}-${w}-normal.woff2`)),
  ...[400, 600, 700].map((w) => `sora/files/sora-latin-${w}-normal.woff2`),
];
for (const f of fonts) fs.copyFileSync(path.join(HERE, "node_modules/@fontsource", f), path.join(OUT, "assets/fonts", path.basename(f)));
for (const f of fs.readdirSync(path.join(HERE, "src"))) fs.copyFileSync(path.join(HERE, "src", f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, "qr.js"), `window.QR_SVG = ${JSON.stringify(qr)};\nwindow.SITE_URL = ${JSON.stringify(URL_)};\n`);
console.log(`QR version ${q.version} (${N}×${N}, level Q) → ${URL_}`);

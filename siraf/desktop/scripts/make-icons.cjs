// Brings the Windows art of «سیراف» into desktop/build from the brand package (brand/final), which holds the
// hand-pixelled cuts of the app icon and the installer art (Dusk gradient with the mark):
//   cd desktop && npm run icons -- <path to brand/final>
//
//   app-icon.ico                → build/icon.ico            (16, 20, 24, 30, 32, 36, 40, 48, 64, 256 px; exe, installer, window)
//   app-icon-256.png            → build/icon.png, icon-256.png
//   app-icon.svg                → build/icon.svg            (the master, for reference)
//   app-icon-16/24/32.png       → build/tray.png, tray@1.5x.png, tray@2x.png (notification-area icon)
//   installer-sidebar.bmp       → build/installerSidebar.bmp (164 × 314, welcome and finish pages)
//   installer-header.bmp        → build/installerHeader.bmp  (150 × 57)
//
// Never redraw the mark here: its small sizes are pixel-fitted by hand in the brand package.
const fs = require("fs");
const path = require("path");

const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, "app-icon.ico"))) {
  console.error("usage: node scripts/make-icons.cjs <brand/final>  (the folder with app-icon.ico)");
  process.exit(1);
}
const out = path.join(__dirname, "..", "build");
fs.mkdirSync(out, { recursive: true });

const MAP = [
  ["app-icon.ico", "icon.ico"],
  ["app-icon-256.png", "icon.png"],
  ["app-icon-256.png", "icon-256.png"],
  ["app-icon.svg", "icon.svg"],
  ["app-icon-16.png", "tray.png"],
  ["app-icon-24.png", "tray@1.5x.png"],
  ["app-icon-32.png", "tray@2x.png"],
  ["installer-sidebar.bmp", "installerSidebar.bmp"],
  ["installer-header.bmp", "installerHeader.bmp"],
];
for (const [from, to] of MAP) {
  const f = path.join(src, from);
  if (!fs.existsSync(f)) {
    console.error(`missing ${f}`);
    process.exit(1);
  }
  fs.copyFileSync(f, path.join(out, to));
  console.log(`${from} → build/${to}`);
}
console.log("icons written to", out);

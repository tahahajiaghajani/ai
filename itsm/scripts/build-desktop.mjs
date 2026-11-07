// Prepares desktop/app (what electron-builder packages) for the Windows app: the built SPA, the bundled local server
// (backend.cjs), the Electron main/preload, the splash, the icons, PGlite and a minimal package.json whose names come
// from src/shared/constants.ts.
//   node scripts/build-desktop.mjs            → then: cd desktop && npx electron-builder --win
// The splash (desktop/src/splash.html) loads Arad, DS Num and Geist from renderer/fonts/ds/, so the SPA build must carry
// the fonts.
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "desktop");
const app = join(desktop, "app");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const desktopPkg = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));

// the product's name and description, from the one place that defines them
const constants = await build({ entryPoints: [join(root, "src/shared/constants.ts")], bundle: true, format: "esm", platform: "node", write: false, logLevel: "warning" });
const C = await import(`data:text/javascript;base64,${Buffer.from(constants.outputFiles[0].text).toString("base64")}`);

rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

console.log("• building the user interface");
execSync("npx vite build", { cwd: root, stdio: "inherit", env: { ...process.env, ITSM_UI_OUT: "./desktop/app/renderer" } });

console.log("• bundling the local server");
await build({
  entryPoints: [join(root, "src/desktop/backend-entry.ts")],
  outfile: join(app, "backend.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  tsconfig: join(root, "tsconfig.json"),
  external: ["@electric-sql/pglite", "@electric-sql/pglite/*"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;" },
});

console.log("• bundling Electron main and preload");
for (const [entry, out] of [["desktop/src/main.ts", "main.cjs"], ["desktop/src/preload.ts", "preload.cjs"]]) {
  await build({
    entryPoints: [join(root, entry)],
    outfile: join(app, out),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    minify: true,
    logLevel: "warning",
  });
}

console.log("• copying PGlite and assets");
const pgliteSrc = join(root, "node_modules/@electric-sql/pglite");
const pgliteVersion = JSON.parse(readFileSync(join(pgliteSrc, "package.json"), "utf8")).version;
cpSync(pgliteSrc, join(app, "node_modules/@electric-sql/pglite"), {
  recursive: true,
  dereference: true,
  filter: (src) => !src.endsWith(".map") && !src.endsWith(".d.ts") && !src.endsWith(".d.cts"),
});
// window icon (.ico on Windows: its hand-pixelled small cuts), tray cuts (16 / 24 / 32 px) and the splash
for (const f of ["icon.png", "icon.ico", "tray.png", "tray@1.5x.png", "tray@2x.png"]) {
  if (existsSync(join(desktop, "build", f))) cpSync(join(desktop, "build", f), join(app, f));
}
cpSync(join(desktop, "src/splash.html"), join(app, "splash.html"));
for (const f of ["AradVF.woff2", "DSNum.woff2", "Geist-Variable.woff2"]) if (!existsSync(join(app, "renderer/fonts/ds", f))) throw new Error(`renderer/fonts/ds/${f} missing: the splash needs it`);

writeFileSync(
  join(app, "package.json"),
  JSON.stringify(
    {
      name: "itsm",
      productName: C.APP_NAME_EN,
      version: desktopPkg.version ?? pkg.version,
      description: `${C.APP_NAME} — ${C.APP_TAGLINE}`,
      author: C.APP_NAME_EN,
      license: "UNLICENSED",
      main: "main.cjs",
      dependencies: { "@electric-sql/pglite": pgliteVersion },
    },
    null,
    2,
  ),
);
if (!existsSync(join(desktop, "build/icon.ico"))) console.warn("! desktop/build/icon.ico missing — run: cd desktop && npm run icons");
if (C.APP_VERSION !== (desktopPkg.version ?? pkg.version)) console.warn(`! desktop/package.json version ${desktopPkg.version} differs from APP_VERSION ${C.APP_VERSION}`);
console.log("✓ desktop/app ready");

// Prepares desktop/app (what electron-builder packages): the built SPA, the bundled local
// server (backend.cjs), the Electron main/preload, PGlite and a minimal package.json.
//   node scripts/build-desktop.mjs            → then: cd desktop && npx electron-builder --win
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

rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

console.log("• building the user interface");
execSync("npx vite build", { cwd: root, stdio: "inherit", env: { ...process.env, TARAZ_UI_OUT: "./desktop/app/renderer" } });

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
cpSync(join(desktop, "build/icon.png"), join(app, "icon.png"));

writeFileSync(
  join(app, "package.json"),
  JSON.stringify(
    {
      name: "taraz",
      productName: "Taraz",
      version: desktopPkg.version ?? pkg.version,
      description: "تراز — حسابداری و مدیریت کسب‌وکار",
      author: "Taraz",
      license: "UNLICENSED",
      main: "main.cjs",
      dependencies: { "@electric-sql/pglite": pgliteVersion },
    },
    null,
    2,
  ),
);
if (!existsSync(join(desktop, "build/icon.ico"))) console.warn("! desktop/build/icon.ico missing — run: cd desktop && npm run icons");
console.log("✓ desktop/app ready");

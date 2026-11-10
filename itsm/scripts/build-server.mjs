// Builds the server edition's application bundle into server-dist/ (what the MSI installs under C:\Program Files\Kariz):
//   server-dist/app/server.cjs       the server (supervisor + workers; src/server-edition/main.ts)
//   server-dist/app/karizctl.cjs     the administrator's command line (src/server-edition/ctl-main.ts)
//   server-dist/app/public/          the single-page app, with .br/.gz next to every compressible file
//   server-dist/app/node_modules/    packages listed in packaging/server/externals.json (with their dependencies)
//   server-dist/scripts, winsw, wix  installer scripts and templates; edition.json (the Windows-facing names)
//   server-dist/karizctl.cmd         runs karizctl with the bundled node.exe
// Node.js, PostgreSQL + pgvector and WinSW are added by packaging/server/scripts/fetch-deps.ps1 on the Windows CI runner.
//   node scripts/build-server.mjs [--skip-ui] [--out <dir>]
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { brotliCompressSync, gzipSync, constants as zc } from "node:zlib";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const out = outArg >= 0 ? join(process.cwd(), args[outArg + 1]) : join(root, "server-dist");
const app = join(out, "app");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const edition = JSON.parse(readFileSync(join(root, "packaging/server/edition.json"), "utf8"));
const externals = JSON.parse(readFileSync(join(root, "packaging/server/externals.json"), "utf8"));

const constants = await build({ entryPoints: [join(root, "src/shared/constants.ts")], bundle: true, format: "esm", platform: "node", write: false, logLevel: "warning" });
const C = await import(`data:text/javascript;base64,${Buffer.from(constants.outputFiles[0].text).toString("base64")}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

if (args.includes("--skip-ui") && existsSync(join(root, "public/index.html"))) {
  console.log("• copying the built user interface (public/)");
  cpSync(join(root, "public"), join(app, "public"), { recursive: true });
} else {
  console.log("• building the user interface");
  execSync("npx vite build", { cwd: root, stdio: "inherit", env: { ...process.env, ITSM_UI_OUT: relative(root, join(app, "public")) } });
}
if (!existsSync(join(app, "public/index.html"))) throw new Error("the user interface was not built (public/index.html missing)");

console.log("• pre-compressing static files (.br, .gz)");
const COMPRESS = /\.(js|mjs|css|html|svg|json|webmanifest|txt|map|wasm|ico)$/i;
let compressed = 0;
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (COMPRESS.test(e.name) && statSync(p).size >= 1024) {
      const data = readFileSync(p);
      const br = brotliCompressSync(data, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: data.length } });
      const gz = gzipSync(data, { level: 9 });
      if (br.length < data.length * 0.95) writeFileSync(`${p}.br`, br);
      if (gz.length < data.length * 0.95) writeFileSync(`${p}.gz`, gz);
      compressed++;
    }
  }
};
walk(join(app, "public"));
console.log(`  ${compressed} files`);

// a CSP without external origins: the built app must not reference any (fonts, CDNs)
const html = readFileSync(join(app, "public/index.html"), "utf8");
const foreign = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi)].map((m) => m[0]);
if (foreign.length) throw new Error(`index.html references external origins (air-gapped servers cannot load them): ${foreign.join(", ")}`);

console.log("• bundling the server and karizctl");
const externalList = [...externals.external, ...externals.native, ...externals.unused];
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  tsconfig: join(root, "tsconfig.json"),
  external: externalList,
  minify: true,
  keepNames: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
  metafile: true,
  define: { "import.meta.url": "__importMetaUrl", "process.env.NODE_ENV": '"production"' },
  banner: { js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;" },
};
const server = await build({ ...common, entryPoints: [join(root, "src/server-edition/main.ts")], outfile: join(app, "server.cjs") });
await build({ ...common, entryPoints: [join(root, "src/server-edition/ctl-main.ts")], outfile: join(app, "karizctl.cjs") });
const inputs = Object.keys(server.metafile.inputs);
if (inputs.some((i) => i.includes("node_modules/@electric-sql/pglite/") && !i.endsWith(".d.ts"))) console.warn("! PGlite was bundled into server.cjs: an import pulls it in");

console.log("• copying external packages");
const copied = new Set();
const copyPackage = (name, why) => {
  if (copied.has(name)) return;
  const src = join(root, "node_modules", name);
  if (!existsSync(join(src, "package.json"))) {
    console.log(`  - ${name}: not installed (${why}); skipped`);
    return;
  }
  copied.add(name);
  cpSync(src, join(app, "node_modules", name), { recursive: true, dereference: true, filter: (s) => !/[\\/](test|tests|docs|example|examples|\.github)[\\/]?$/.test(s) && !s.endsWith(".md") && !s.endsWith(".d.ts") });
  const p = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
  for (const dep of [...Object.keys(p.dependencies ?? {}), ...Object.keys(p.optionalDependencies ?? {})]) copyPackage(dep, `dependency of ${name}`);
  console.log(`  + ${name}@${p.version}`);
};
for (const name of [...externals.external, ...externals.native]) copyPackage(name, externals.native.includes(name) ? "optional native" : "external");

writeFileSync(
  join(app, "package.json"),
  JSON.stringify({ name: "itsm-server", productName: edition.product, version: pkg.version, private: true, description: `${C.APP_NAME} — ${C.APP_TAGLINE}`, main: "server.cjs", license: "UNLICENSED" }, null, 2),
);

console.log("• installer scripts and templates");
for (const d of ["scripts", "winsw", "wix"]) if (existsSync(join(root, "packaging/server", d))) cpSync(join(root, "packaging/server", d), join(out, d), { recursive: true });
cpSync(join(root, "packaging/server/edition.json"), join(out, "edition.json"));
writeFileSync(join(out, `${edition.ctl}.cmd`), `@echo off\r\n"%~dp0node\\node.exe" "%~dp0app\\karizctl.cjs" %*\r\n`);
writeFileSync(join(out, "VERSION"), `${C.APP_VERSION}\n`);
if (C.APP_VERSION !== pkg.version) console.warn(`! package.json version ${pkg.version} differs from APP_VERSION ${C.APP_VERSION}`);
const size = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((s, f) => s + size(join(p, f)), 0) : statSync(p).size);
console.log(`✓ ${relative(process.cwd(), out) || "."} ready (${Math.round(size(out) / 1048576)} MB; server.cjs ${Math.round(statSync(join(app, "server.cjs")).size / 1024)} KB)`);

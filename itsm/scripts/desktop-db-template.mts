// The Windows app's database made at build time (src/desktop/db-template.ts): every migration run once into a data
// folder, packed as db-template.tar.br next to the app, so a new installation's first start loads it instead of running
// initdb and the migrations (19–25 s on a Windows runner). scripts/build-desktop.mjs runs this.
//   npx tsx scripts/desktop-db-template.mts desktop/app/db-template.tar.br
import { buildDbTemplate } from "../src/desktop/db-template";

const out = process.argv[2];
if (!out) {
  console.error("usage: desktop-db-template.mts <out file>");
  process.exit(2);
}
const t = performance.now();
const info = await buildDbTemplate(out, { info: () => {}, warn: (m: string, d?: unknown) => console.warn(m, d ?? "") });
console.log(
  `database template: ${(info.bytes / 1048576).toFixed(1)} MB, ${info.steps} migration steps in ${info.migrate_ms} ms, ${info.segments_dropped} spare log segments left out, ${Math.round(performance.now() - t)} ms in all → ${info.file}`,
);

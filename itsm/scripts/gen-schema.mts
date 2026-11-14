// Writes the complete database script for Supabase from the steps the app itself runs (src/server/db/migrate.ts):
//   supabase/schema.sql             — everything, in order (for psql or any client without a size limit)
//   supabase/manual/NN-of-MM.sql    — the same, in parts small enough for the Supabase SQL Editor (≈ 0.98 MB per query
//                                     there); run them in order, each once (a part run again changes nothing)
//   supabase/migrations/<id>.sql    — one file per migration (for later updates by hand)
//   src/server/db/schema-fingerprint.generated.ts — the migrations and engine DDL version of this build (the web
//                                     version's one-query cold-start check, src/server/db/schema-check.ts)
// Every part records what it applied exactly as the app does (sm_migrations, and sm_meta for the record engine's
// chunks), so the app and the SQL Editor resume each other's work. `--check` fails when a file is out of date (CI).
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { manualSchema } from "../src/server/db/manual";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const out = manualSchema();
const files = new Map<string, string>();
for (const [rel, content] of Object.entries(out.files)) files.set(join(root, rel), content);
const dirs = [join(root, "supabase", "migrations"), join(root, "supabase", "manual")];

const stale: string[] = [];
for (const [path, content] of files) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current !== content) stale.push(path.replace(root + "/", ""));
}
const known = new Set([...files.keys()]);
for (const d of dirs) if (existsSync(d)) for (const f of readdirSync(d)) if (!known.has(join(d, f))) stale.push(`${join(d, f).replace(root + "/", "")} (extra)`);
const summary = `${out.parts} SQL Editor parts, largest ${Math.round(out.largestPart / 1024)} KB`;

if (check) {
  if (stale.length) {
    console.error(`Database script is out of date — run \`npm run schema\`:\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`supabase/schema.sql, supabase/manual (${summary}) and the schema fingerprint are up to date`);
} else {
  for (const d of dirs) {
    mkdirSync(d, { recursive: true });
    for (const f of readdirSync(d)) if (!known.has(join(d, f))) rmSync(join(d, f));
  }
  for (const [path, content] of files) writeFileSync(path, content);
  console.log(`wrote supabase/schema.sql, ${summary}, the migration files and the schema fingerprint`);
}

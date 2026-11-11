// Prepare (or bring up to date) the web version's database outside any request — the preferred path on Vercel + Supabase
// (docs/SETUP_FA.md §۱-۵ and §۹). Every step is idempotent and recorded, so running it again, or after the app or the
// SQL Editor did part of the work, only does what is missing.
//
//   From any computer (Node.js 22+, in the itsm folder after `npm ci`):
//     DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres' npx tsx scripts/migrate-db.mts
//   PowerShell:  $env:DATABASE_URL='…'; npx tsx scripts/migrate-db.mts
//
//   During `npm run build` (Vercel): `--build` — runs only when DATABASE_URL is set (Vercel passes the project's variables
//   to the build), never for Preview deployments (VERCEL_ENV=preview) unless MIGRATE_ON_PREVIEW=true, and not with
//   AUTO_MIGRATE=false. A failure there is reported and does not fail the build: the app finishes the steps itself.
//   `--strict` makes a failure fail the build. `--status` only prints how far the database is.
import { createPostgresDb } from "../src/server/db/postgres";
import { migrateSteps, schemaProgress } from "../src/server/db/migrate";
import { poolerMode } from "../src/server/db/schema-check";

const args = new Set(process.argv.slice(2));
const build = args.has("--build");
const strict = args.has("--strict") || process.env.MIGRATE_STRICT === "true";
const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "";
const say = (m: string) => console.log(`[migrate-db] ${m}`);

function skip(reason: string): never {
  say(`skipped: ${reason}`);
  process.exit(0);
}

if (!url) {
  if (build) skip("DATABASE_URL is not set for this build (the app prepares the database on its first requests)");
  console.error("DATABASE_URL is not set. Example:\n  DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres' npx tsx scripts/migrate-db.mts");
  process.exit(2);
}
if (build && process.env.VERCEL_ENV === "preview" && process.env.MIGRATE_ON_PREVIEW !== "true") skip("a Preview build never changes the database (MIGRATE_ON_PREVIEW=true to allow it)");
if (build && process.env.AUTO_MIGRATE === "false") skip("AUTO_MIGRATE=false (run this script by hand)");

const host = (() => {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "(unparsable URL)";
  }
})();
const mode = poolerMode(url);
say(`database ${host} (${mode === "transaction" ? "Supabase transaction pooler" : mode === "session" ? "Supabase session pooler" : mode === "direct" ? "Supabase direct connection" : "PostgreSQL"})`);

const db = createPostgresDb({ url, max: 1, ssl: process.env.DATABASE_SSL !== "disable", connectTimeout: 20 });
const started = Date.now();
try {
  const before = await schemaProgress(db);
  say(`schema: ${before.done}/${before.total} steps done${before.complete ? " — up to date" : ""}`);
  if (args.has("--status") || before.complete) {
    await db.close();
    process.exit(0);
  }
  const r = await migrateSteps(db, { log: (m) => say(m) });
  say(`${r.complete ? "done" : "stopped"}: ${r.done}/${r.total} steps, ${r.ran.length} run now, ${Math.round((Date.now() - started) / 1000)} s`);
  await db.close();
  process.exit(r.complete ? 0 : 1);
} catch (e) {
  console.error(`[migrate-db] failed after ${Math.round((Date.now() - started) / 1000)} s: ${String((e as Error)?.message ?? e)}`);
  await db.close().catch(() => undefined);
  // in a build the app still finishes the steps on its first requests; by hand (or --strict) it is an error
  process.exit(build && !strict ? 0 : 1);
}

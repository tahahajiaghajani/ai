// Writes the complete database script for Supabase from the migrations used by the app:
//   supabase/schema.sql            — everything, in order (paste once into the SQL Editor)
//   supabase/migrations/<id>.sql   — one file per migration (for later updates)
// `--check` fails when the files are out of date (CI).
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIGRATIONS } from "../src/server/db/migrations/index";
import { APP_NAME } from "../src/shared/constants";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase");
const migDir = join(dir, "migrations");
const check = process.argv.includes("--check");

const header = `-- ============================================================================
-- «${APP_NAME}» — پایگاه دادهٔ کامل برای Supabase (PostgreSQL 15+)
-- این فایل را یک بار در Supabase ← SQL Editor ← New query بچسبانید و Run بزنید.
-- اجرای دوباره بی‌خطر است (همهٔ دستورها idempotent هستند).
-- برنامه هم هنگام اجرا migrationهای جاافتاده را خودکار اعمال می‌کند (AUTO_MIGRATE).
-- این فایل خودکار از src/server/db/migrations ساخته می‌شود: npm run schema
-- ============================================================================
`;

function wrap(id: string, title: string, sql: string) {
  return `-- ---------------------------------------------------------------------------
-- ${id} — ${title}
-- ---------------------------------------------------------------------------
${sql.trim()}

insert into sm_migrations (id) values ('${id}') on conflict (id) do nothing;
`;
}

const files = new Map<string, string>();
files.set(join(dir, "schema.sql"), `${header}\ncreate table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());\n\n${MIGRATIONS.map((m) => wrap(m.id, m.title, m.sql)).join("\n")}`);
for (const m of MIGRATIONS) {
  files.set(join(migDir, `${m.id}.sql`), `-- «${APP_NAME}» migration ${m.id} — ${m.title}\ncreate table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());\n\n${wrap(m.id, m.title, m.sql)}`);
}

let stale: string[] = [];
for (const [path, content] of files) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current !== content) stale.push(path.replace(root + "/", ""));
}
const known = new Set([...files.keys()]);
if (existsSync(migDir)) for (const f of readdirSync(migDir)) if (!known.has(join(migDir, f))) stale.push(`supabase/migrations/${f} (extra)`);

if (check) {
  if (stale.length) {
    console.error(`Database script is out of date — run \`npm run schema\`:\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  console.log("supabase/schema.sql is up to date");
} else {
  mkdirSync(migDir, { recursive: true });
  for (const f of existsSync(migDir) ? readdirSync(migDir) : []) if (!known.has(join(migDir, f))) rmSync(join(migDir, f));
  for (const [path, content] of files) writeFileSync(path, content);
  console.log(`wrote supabase/schema.sql and ${MIGRATIONS.length} migration files`);
}

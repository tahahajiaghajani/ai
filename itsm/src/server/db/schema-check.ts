// The web version's cold-start check: is this database's schema the one this build expects? One round trip and no
// generated DDL — the expected migrations and engine DDL version come from a file `npm run schema` writes
// (schema-fingerprint.generated.ts, kept current by `npm run check:schema` and tests/schema-manual.test.ts). Only when
// the answer is not a plain yes does the caller load the migration planner (./migrate.ts) to compute the real plan.
import type { Queryable } from "./index";
import { SCHEMA_FINGERPRINT } from "./schema-fingerprint.generated";

export { SCHEMA_FINGERPRINT };

/** True when every migration of this build is recorded and the engine DDL version is this build's. */
export async function schemaIsCurrent(db: Queryable): Promise<boolean> {
  try {
    const r = await db.one<{ missing: number; engine: boolean }>(
      `select (select count(*)::int from unnest($1::text[]) m(id) where not exists (select 1 from sm_migrations s where s.id = m.id)) as missing,
              exists (select 1 from sm_meta where key = 'engine.ddl' and value = $2 or key = 'engine.ddl.seen:' || $2) as engine`,
      [`{${SCHEMA_FINGERPRINT.migrations.join(",")}}`, SCHEMA_FINGERPRINT.engine],
    );
    // every migration of this build is recorded and this build's engine DDL is (or once was: it is additive) applied
    return !!r && r.missing === 0 && r.engine;
  } catch (e) {
    // no sm_migrations / sm_meta yet (a fresh database); anything else (no connection, wrong password) is the caller's
    if ((e as { code?: string })?.code === "42P01") return false;
    throw e;
  }
}

/** What kind of connection a PostgreSQL URL is (Supabase: the transaction pooler is the one to use on Vercel). */
export type PoolerMode = "transaction" | "session" | "direct" | "other";

export function poolerMode(url: string): PoolerMode {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "other";
  }
  const port = u.port || "5432";
  if (/\.pooler\.supabase\.com$/i.test(u.hostname)) return port === "6543" ? "transaction" : "session";
  if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(u.hostname)) return "direct";
  // a PgBouncer-style pooler on its usual port, or one the URL says it is
  if (port === "6543" || u.searchParams.get("pgbouncer") === "true") return "transaction";
  return "other";
}

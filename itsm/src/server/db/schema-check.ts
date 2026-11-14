// The web version's cold-start check: is this database's schema the one this build expects — and is nothing left of a
// move into another cluster? One round trip and no generated DDL — the expected migrations and engine DDL version come
// from a file `npm run schema` writes (schema-fingerprint.generated.ts, kept current by `npm run check:schema` and
// tests/schema-manual.test.ts). Only when the answer is not a plain yes does the caller load the migration planner
// (./migrate.ts) to compute the real plan, or run the restamp's steps (../sync/snapshot.ts restampSteps).
import type { Queryable } from "./index";
import { SCHEMA_FINGERPRINT } from "./schema-fingerprint.generated";
import { regressionWaiting, RESTAMP_KEY, XID_MARK_KEY } from "../sync/snapshot";

export { SCHEMA_FINGERPRINT };

export interface ColdStart {
  /** every migration of this build is recorded and this build's engine DDL is (or once was: it is additive) applied */
  current: boolean;
  /**
   * the database went back in transaction ids (moved into another cluster) and its synced rows ahead of them are not
   * restamped yet: handled like a schema that is not current (503 «migrating» while restampSteps runs)
   */
  xidWaiting: boolean;
}

/** The cold start's question in one statement (the snapshot and the mark read together, as sync/snapshot.ts does). */
export async function coldStart(db: Queryable): Promise<ColdStart> {
  try {
    const r = await db.one<{ missing: number; engine: boolean; xmax: string; mark: string | null; restamp: boolean }>(
      `select (select count(*)::int from unnest($1::text[]) m(id) where not exists (select 1 from sm_migrations s where s.id = m.id)) as missing,
              exists (select 1 from sm_meta where key = 'engine.ddl' and value = $2 or key = 'engine.ddl.seen:' || $2) as engine,
              pg_snapshot_xmax(pg_current_snapshot())::text as xmax,
              (select value from sm_meta where key = $3) as mark,
              exists (select 1 from sm_meta where key = $4) as restamp`,
      [`{${SCHEMA_FINGERPRINT.migrations.join(",")}}`, SCHEMA_FINGERPRINT.engine, XID_MARK_KEY, RESTAMP_KEY],
    );
    if (!r) return { current: false, xidWaiting: false };
    return { current: r.missing === 0 && r.engine, xidWaiting: regressionWaiting(Number(r.xmax), r.mark, r.restamp || null) };
  } catch (e) {
    // no sm_migrations / sm_meta yet (a fresh database); anything else (no connection, wrong password) is the caller's
    if ((e as { code?: string })?.code === "42P01") return { current: false, xidWaiting: false };
    throw e;
  }
}

/** True when every migration of this build is recorded and the engine DDL version is this build's. */
export async function schemaIsCurrent(db: Queryable): Promise<boolean> {
  return (await coldStart(db)).current;
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

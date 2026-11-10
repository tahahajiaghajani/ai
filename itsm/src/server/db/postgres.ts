// Cloud adapter: Supabase PostgreSQL through postgres.js.
// Use the Supabase *transaction pooler* URL (port 6543) on Vercel; prepared statements are off
// because the transaction pooler does not support them.
import postgres from "postgres";
import { runBeforeCommit, toIsoTimestamp, type Db, type Row, type Tx } from "./index";
import { txEnded } from "./lockprobe";

/**
 * postgres.js lets the server decide parameter types and serialises json/jsonb itself, so
 * objects and arrays are passed as they are (a JSON string stays a JSON string, see `types`).
 */
function pgParam(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "toFixed" in (v as object) && "isZero" in (v as object)) return (v as { toFixed(): string }).toFixed();
  return v;
}

const jsonSerialize = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x));

export interface PostgresOptions {
  url: string;
  max?: number;
  ssl?: boolean;
  /**
   * Named prepared statements for parameterised queries (parsed and planned once per connection). Off by default:
   * Supabase's transaction pooler (the web deployment) does not keep them. The server edition talks to its own
   * PostgreSQL directly and turns them on.
   */
  prepare?: boolean;
  /** Seconds an idle connection stays open (default 20). */
  idleTimeout?: number;
  /** Seconds to wait for a new connection (default 15). */
  connectTimeout?: number;
  /** Seconds after which a connection is replaced (postgres.js default: 30–60 minutes); bounds prepared statements. */
  maxLifetime?: number;
  /** Server-side statement timeout in milliseconds for every statement of this pool (default: none). */
  statementTimeoutMs?: number;
}

const ROLLED_BACK = Symbol("rolled back to savepoint");

/**
 * postgres.js fails a whole transaction when any statement in it failed, even one the caller
 * rolled back with a plain `rollback to savepoint` — so a statement that is expected to fail
 * (a unique clash that is then renumbered, one bad row of an import) would lose everything.
 * Plain `savepoint` / `release savepoint` / `rollback to savepoint` statements are therefore run
 * as postgres.js savepoints, and every other statement goes to the innermost open one.
 */
function savepoints(t: postgres.TransactionSql) {
  type Open = { name: string; s: postgres.TransactionSql; finish: (keep: boolean) => void; ended: Promise<unknown> };
  const stack: Open[] = [];
  const top = (): postgres.TransactionSql => stack[stack.length - 1]?.s ?? t;
  const open = async (name: string) => {
    let ready!: (s: postgres.TransactionSql) => void;
    const opened = new Promise<postgres.TransactionSql>((r) => (ready = r));
    let finish!: (keep: boolean) => void;
    const decided = new Promise<boolean>((r) => (finish = r));
    const ended = top()
      .savepoint(async (s) => {
        ready(s);
        if (!(await decided)) throw ROLLED_BACK;
      })
      .catch((e) => {
        if (e !== ROLLED_BACK) throw e;
      });
    // a failure to open (aborted transaction…) surfaces here instead of hanging
    const failed = ended.then(() => {
      throw new Error(`savepoint ${name} was not opened`);
    });
    failed.catch(() => {});
    const s = await Promise.race([opened, failed]);
    stack.push({ name, s, finish, ended });
  };
  const close = async (keep: boolean) => {
    const x = stack.pop()!;
    x.finish(keep);
    await x.ended;
  };
  const control = /^\s*(savepoint|release\s+savepoint|release|rollback\s+to\s+savepoint|rollback\s+to)\s+"?(\w+)"?\s*;?\s*$/i;
  const handle = async (text: string): Promise<boolean> => {
    const m = control.exec(text);
    if (!m) return false;
    const verb = m[1].toLowerCase().replace(/\s+/g, " ");
    const name = m[2].toLowerCase();
    if (verb === "savepoint") {
      await open(name);
      return true;
    }
    let i = stack.length - 1;
    while (i >= 0 && stack[i].name !== name) i--;
    if (i < 0) throw new Error(`savepoint "${name}" does not exist`);
    const release = verb.startsWith("release");
    // savepoints opened after this one end with it
    while (stack.length > i + 1) await close(release);
    await close(release);
    // PostgreSQL keeps a savepoint after rolling back to it
    if (!release) await open(name);
    return true;
  };
  const sql = new Proxy(t, {
    get(target, prop) {
      if (prop === "unsafe") {
        return async (text: string, params?: never[], options?: never) => ((await handle(text)) ? [] : top().unsafe(text, params, options));
      }
      return Reflect.get(target, prop);
    },
  });
  return {
    sql,
    async closeAll(keep: boolean) {
      while (stack.length) await close(keep);
    },
  };
}

export function createPostgresDb(opts: PostgresOptions): Db {
  const prepare = opts.prepare ?? false;
  const sql = postgres(opts.url, {
    prepare,
    max: opts.max ?? 3,
    idle_timeout: opts.idleTimeout ?? 20,
    connect_timeout: opts.connectTimeout ?? 15,
    ...(opts.maxLifetime ? { max_lifetime: opts.maxLifetime } : {}),
    ssl: opts.ssl === false ? false : "require",
    onnotice: () => {},
    connection: { application_name: "itsm", ...(opts.statementTimeoutMs ? { statement_timeout: Math.trunc(opts.statementTimeoutMs) } : {}) },
    types: {
      // keep dates as 'YYYY-MM-DD' and timestamps as ISO strings, int8 as JS numbers
      date: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x },
      timestamp: { to: 1114, from: [1114], serialize: (x: unknown) => String(x), parse: (x: string) => x },
      timestamptz: { to: 1184, from: [1184], serialize: (x: unknown) => String(x), parse: (x: string) => toIsoTimestamp(x) },
      int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      json: { to: 114, from: [114], serialize: jsonSerialize, parse: (x: string) => JSON.parse(x) },
      jsonb: { to: 3802, from: [3802], serialize: jsonSerialize, parse: (x: string) => JSON.parse(x) },
    },
  });

  // postgres.js runs `unsafe` text unprepared unless asked per statement (the pool option covers tagged templates only)
  const per = prepare ? { prepare: true } : undefined;
  const make = (s: postgres.Sql | postgres.TransactionSql): Pick<Tx, "query" | "one" | "exec"> => ({
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const rows = await s.unsafe(text, params.map(pgParam) as never[], per);
      return rows as unknown as T[];
    },
    async one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
      const rows = await s.unsafe(text, params.map(pgParam) as never[], per);
      return ((rows as unknown as T[])[0] ?? null) as T | null;
    },
    async exec(text: string): Promise<void> {
      await s.unsafe(text);
    },
  });

  const base = make(sql);
  return {
    kind: "postgres",
    ...base,
    async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      let txq: Tx | null = null;
      let committed = false;
      try {
        const result = await sql.begin(async (t) => {
          const sp = savepoints(t);
          try {
            txq = { ...make(sp.sql), inTx: true };
            const r = await fn(txq);
            await runBeforeCommit(txq);
            await sp.closeAll(true);
            return r;
          } catch (e) {
            await sp.closeAll(false).catch(() => {});
            throw e;
          }
        });
        committed = true;
        return result as T;
      } finally {
        // the write-lock probe (off in production): the transaction is over, its lock released
        txEnded(txq, committed);
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

// Cloud adapter: PostgreSQL through postgres.js — Supabase on the web version (Vercel), the server edition's own
// PostgreSQL, the scripts and the real-PostgreSQL tests.
//
// The web version talks to Supabase's *transaction pooler* (Supavisor, port 6543), with the options of
// src/server/cloud.ts webPoolOptions. The rules behind them:
// - No pipelining outside a transaction (maxPipeline 1). Supavisor before v2.10 hands a backend back to its pool as
//   soon as a chunk read from it ends with ReadyForQuery 'I', even when the client has already sent its next statement,
//   whose answer then goes nowhere (the statement never ends, and the backend waits «active / ClientRead» inside an open
//   transaction for a Bind that never comes) or to the next client of that backend. postgres.js sends a statement whose
//   parameter types it does not know as Parse/Describe/Flush and binds it only once that is answered, so any statement
//   pipelined behind another on a connection is exposed. A transaction's own statements still pipeline on its
//   connection: it is leased to the transaction, and every ReadyForQuery inside it says 'T'.
// - No prepared statements (`prepare` off): the transaction pooler does not keep them.
// - Startup parameters never reach the server (Supavisor drops them) and a role's settings reach only new backends: the
//   server-side limits are set per transaction, with transaction-local set_config calls in ONE simple-protocol statement
//   together with the demo scope (txPreamble).
// - Every wait is bounded: for a connection (queueTimeoutSec: QUEUE_TIMEOUT), on the server per transaction (txLimits:
//   statement, lock, idle in transaction) and on the client per statement (statementClientMs: a CancelRequest, then
//   DB_TIMEOUT after a grace — the answer is lost or the socket is dead — and a fresh pool before the next statement).
//   A transaction's statements that the server's own statement_timeout ends first get no CancelRequest: sent at the
//   same moment, it reached the pooler after the transaction had ended and cancelled the next statement of that
//   connection, another request's.
// - A pool nobody used for replaceIdleAfterMs is replaced before its next statement: a paused serverless instance runs
//   no timers, so its idle sockets are never closed and may be dead when it wakes (the first statement would hang until
//   TCP gives up).
// - Never rely on postgres.js' PG* environment defaults (it reads PGMAX_PIPELINE, PGQUEUE_TIMEOUT…): the options that
//   matter are always passed.
// The server edition (its own PostgreSQL: prepared statements, pipelining, no limits), scripts/migrate-db.mts (no
// pipelining, no limits), PGlite (./pglite.ts) and the tests keep their own settings.
import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { runBeforeCommit, toIsoTimestamp, type Db, type Row, type Tx } from "./index";
import { txEnded } from "./lockprobe";
import { demoScopeOrg, scopedWrite } from "./scope";

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

/** Server-side limits of one transaction in milliseconds (0: none). */
export interface TxLimits {
  /** statement_timeout: a statement running longer is cancelled (57014) */
  statementMs: number;
  /** lock_timeout: a lock (row or advisory) waited for longer is given up (55P03) */
  lockMs: number;
  /** idle_in_transaction_session_timeout: a transaction whose client is silent longer loses its session */
  idleMs: number;
}

/** What a pool did on its own (the web version logs it). */
export type PoolEvent = { kind: "replaced"; reason: "idle" | "gave_up"; idleMs: number } | { kind: "gave_up"; ms: number };

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
  /** Statements pipelined on one connection outside a transaction (default 100; 1 behind a transaction pooler). */
  maxPipeline?: number;
  /** Seconds a statement or a transaction may wait for a connection before QUEUE_TIMEOUT (fractions allowed; default 0: as long as it takes). */
  queueTimeoutSec?: number;
  /** Server-side limits set at the start of every transaction (default none; `withTxLimits` overrides them). */
  txLimits?: TxLimits | null;
  /** Client deadline of every statement in milliseconds: a CancelRequest, then DB_TIMEOUT after the grace (default none). */
  statementClientMs?: number;
  /** Milliseconds between the CancelRequest and giving up (default 5000; tests shorten it). */
  statementGraceMs?: number;
  /** Replace the pool before its next statement when nobody used it for this many milliseconds (default never). */
  replaceIdleAfterMs?: number;
  onEvent?: (e: PoolEvent) => void;
}

const limitsOverride = new AsyncLocalStorage<TxLimits | null>();

/**
 * Run `fn` with other server-side limits for every transaction it opens, whatever the pool's `txLimits` (null: none) —
 * the migration steps the web version runs after its answers (src/server/cloud.ts MIGRATION_TX_LIMITS).
 */
export function withTxLimits<T>(limits: TxLimits | null, fn: () => T): T {
  return limitsOverride.run(limits, fn);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const msText = (v: number) => String(Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);

/**
 * The statement that opens a transaction: its server-side limits and the demo scope (./scope.ts), each a
 * transaction-local set_config, in ONE simple-protocol statement — one round trip, nothing to describe first. An
 * organisation id is written into the text only when it is a UUID; anything else goes as a parameter. Null when there is
 * nothing to set.
 */
export function txPreamble(limits: TxLimits | null, demoOrg: string | null): { text: string; params?: unknown[] } | null {
  const sets: string[] = [];
  if (limits) {
    sets.push(`set_config('statement_timeout','${msText(limits.statementMs)}',true)`);
    sets.push(`set_config('lock_timeout','${msText(limits.lockMs)}',true)`);
    sets.push(`set_config('idle_in_transaction_session_timeout','${msText(limits.idleMs)}',true)`);
  }
  let params: unknown[] | undefined;
  if (demoOrg) {
    if (UUID.test(demoOrg)) sets.push(`set_config('itsm.demo','${demoOrg}',true)`);
    else {
      sets.push(`set_config('itsm.demo',$1,true)`);
      params = [demoOrg];
    }
  }
  if (!sets.length) return null;
  const text = `select ${sets.join(", ")}`;
  return params ? { text, params } : { text };
}

/** The mark of an error that left this adapter (src/server/http/errors.ts: a Node socket code is then the database's). */
const DB_ERROR = Symbol.for("itsm.db-error");

function marked<E>(e: E): E {
  if (e && typeof e === "object" && !(DB_ERROR in e)) {
    try {
      Object.defineProperty(e, DB_ERROR, { value: true });
    } catch {
      /* a frozen object stays unmarked */
    }
  }
  return e;
}

/** The DB_TIMEOUT errors this adapter gave (a statement whose answer never came). */
const noAnswered = new WeakSet<object>();

function noAnswer(ms: number): Error {
  const e = Object.assign(new Error(`DB_TIMEOUT: no answer from the database in ${ms} ms`), { code: "DB_TIMEOUT" });
  noAnswered.add(e);
  return e;
}

const ROLLED_BACK = Symbol("rolled back to savepoint");

/**
 * postgres.js fails a whole transaction when any statement in it failed, even one the caller
 * rolled back with a plain `rollback to savepoint` — so a statement that is expected to fail
 * (a unique clash that is then renumbered, one bad row of an import) would lose everything.
 * Plain `savepoint` / `release savepoint` / `rollback to savepoint` statements are therefore run
 * as postgres.js savepoints, and every other statement goes to the innermost open one as it is (a pending query the
 * client deadline can cancel).
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
  const handle = async (m: RegExpExecArray): Promise<void> => {
    const verb = m[1].toLowerCase().replace(/\s+/g, " ");
    const name = m[2].toLowerCase();
    if (verb === "savepoint") {
      await open(name);
      return;
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
  };
  const sql = new Proxy(t, {
    get(target, prop) {
      if (prop === "unsafe") {
        return (text: string, params?: never[], options?: never) => {
          const m = control.exec(text);
          return m ? handle(m).then(() => []) : top().unsafe(text, params, options);
        };
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

/** A statement on its way: postgres.js' pending query (which can be cancelled) or a plain promise. */
type Pending<T> = PromiseLike<T> & { cancel?: () => Promise<void> };
type Run = (text: string, params?: unknown[]) => Pending<unknown>;

export function createPostgresDb(opts: PostgresOptions): Db {
  const prepare = opts.prepare ?? false;
  const clientMs = opts.statementClientMs && opts.statementClientMs > 0 ? opts.statementClientMs : 0;
  const graceMs = Math.max(0, opts.statementGraceMs ?? 5000);
  const open = (): postgres.Sql =>
    postgres(opts.url, {
      prepare,
      max: opts.max ?? 3,
      // always passed: postgres.js would otherwise take PGMAX_PIPELINE / PGQUEUE_TIMEOUT from the environment
      max_pipeline: opts.maxPipeline ?? 100,
      queue_timeout: opts.queueTimeoutSec ?? 0,
      idle_timeout: opts.idleTimeout ?? 20,
      connect_timeout: opts.connectTimeout ?? 15,
      ...(opts.maxLifetime ? { max_lifetime: opts.maxLifetime } : {}),
      ssl: opts.ssl === false ? false : "require",
      onnotice: () => {},
      connection: { application_name: "itsm" },
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

  // ---- the pool holder: statements go to the pool of the moment; replaced ones end in the background ----
  let pool = open();
  /** operations the current pool started (an unused pool is never replaced for being idle) */
  let uses = 0;
  let inFlight = 0;
  let lastWall = Date.now();
  let lastMono = performance.now();
  /** a statement got no answer: its pool's sockets are not to be trusted */
  let suspect = false;
  let closed = false;
  const retiring = new Set<Promise<void>>();

  const emit = (e: PoolEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      /* a log line never fails a statement */
    }
  };
  const stamp = () => {
    lastWall = Date.now();
    lastMono = performance.now();
  };

  /** Before every statement or transaction: a fresh pool after a statement was given up or after a long idle. */
  function acquire(): void {
    // the larger of the wall-clock and monotonic gaps: either may stand still while an instance is paused
    const idleMs = Math.max(Date.now() - lastWall, performance.now() - lastMono);
    const idle = !!opts.replaceIdleAfterMs && inFlight === 0 && uses > 0 && idleMs > opts.replaceIdleAfterMs;
    if (!closed && (suspect || idle)) {
      const old = pool;
      const reason = suspect ? "gave_up" : "idle";
      pool = open();
      uses = 0;
      suspect = false;
      emit({ kind: "replaced", reason, idleMs: Math.round(idleMs) });
      // what still runs on the old pool gets 30 s to finish; an idle one is closed at once
      const ending: Promise<void> = old
        .end({ timeout: inFlight ? 30 : 0 })
        .catch(() => {})
        .finally(() => retiring.delete(ending));
      retiring.add(ending);
    }
    uses++;
    inFlight++;
    stamp();
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    acquire();
    try {
      return await work();
    } finally {
      inFlight--;
      stamp();
    }
  }

  /**
   * A statement with the client deadline: at statementClientMs a CancelRequest, which the pooler forwards to the backend
   * the client holds (a statement that is merely slow ends with 57014); still no answer after the grace, DB_TIMEOUT — the
   * answer is lost (a backend handed back early by the pooler, a dead socket) and the pool is replaced before the next
   * statement. Its handlers are attached at once, so an answer or a rejection after giving up is dropped quietly. Every
   * rejection is marked as the database's.
   * `cancel` false: no CancelRequest, only the give-up — a statement of a transaction whose statement_timeout is no
   * longer than the client's deadline, which the server ends by itself (57014). The pooler forwards a cancel to the
   * backend the client connection holds when it arrives; sent at the same moment as the server's own timeout, it
   * arrived after the transaction had rolled back and cancelled the next statement of that connection, another
   * request's (Supavisor v2.9.13; a direct connection does the same).
   */
  function bounded<T>(q: Pending<T>, cancel = true): Promise<T> {
    if (!clientMs)
      return Promise.resolve(q).catch((e) => {
        throw marked(e);
      });
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let late: ReturnType<typeof setTimeout> | undefined;
      const due = setTimeout(() => {
        if (settled) return;
        if (cancel) q.cancel?.().catch(() => {});
        late = setTimeout(() => {
          if (settled) return;
          settled = true;
          suspect = true;
          emit({ kind: "gave_up", ms: clientMs + graceMs });
          reject(marked(noAnswer(clientMs + graceMs)));
        }, graceMs);
        late.unref?.();
      }, clientMs);
      due.unref?.();
      const end = () => {
        settled = true;
        clearTimeout(due);
        if (late) clearTimeout(late);
      };
      q.then(
        (v) => {
          if (settled) return;
          end();
          resolve(v);
        },
        (e) => {
          if (settled) return;
          end();
          reject(marked(e));
        },
      );
    });
  }

  /**
   * postgres.js runs a transaction's own statements (begin, the savepoints' release, commit or rollback) itself, out of
   * `bounded`'s reach: they are bounded as phases with the statement deadline — from the call to the start of `fn` (a
   * connection, then begin) and from the end of `fn` to the transaction's end. Given up, the transaction fails with
   * DB_TIMEOUT, `fn` never runs should begin be answered later, and the pool is replaced before the next statement. When
   * `fn` failed because one of its statements was given up, the rollback is not waited for at all (`now`): it would go
   * through the same silent connection and add a second deadline (35 + 35 s, past the function's 60 s); nothing was
   * committed, and the server ends the transaction with its connection (idle_in_transaction_session_timeout at the
   * latest).
   */
  function phases() {
    const total = clientMs + graceMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let gaveUp: Error | null = null;
    let fail!: (e: Error) => void;
    const given = new Promise<never>((_, reject) => (fail = reject));
    given.catch(() => {});
    const disarm = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    return {
      arm() {
        disarm();
        timer = setTimeout(() => {
          gaveUp = marked(noAnswer(total));
          suspect = true;
          emit({ kind: "gave_up", ms: total });
          fail(gaveUp);
        }, total);
        timer.unref?.();
      },
      disarm,
      /** End the transaction now with `e` (one of its statements got no answer). */
      now(e: Error) {
        disarm();
        gaveUp ??= e;
        fail(e);
      },
      enter() {
        disarm();
        if (gaveUp) throw gaveUp;
      },
      race<T>(p: Promise<T>): Promise<T> {
        p.catch(() => {});
        return Promise.race([p, given]);
      },
    };
  }

  // postgres.js runs `unsafe` text unprepared unless asked per statement (the pool option covers tagged templates only)
  const per = prepare ? { prepare: true } : undefined;
  const runner =
    (s: () => postgres.Sql | postgres.TransactionSql): Run =>
    (text, params) =>
      (params ? s().unsafe(text, params.map(pgParam) as never[], per) : s().unsafe(text)) as Pending<unknown>;
  /** Statements through `r`, each with the client deadline (`cancel`: with its CancelRequest, see `bounded`). */
  const make = (r: Run, cancel = true): Pick<Tx, "query" | "one" | "exec"> => ({
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      return (await bounded(r(text, params), cancel)) as T[];
    },
    async one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
      const rows = (await bounded(r(text, params), cancel)) as T[];
      return rows[0] ?? null;
    },
    async exec(text: string): Promise<void> {
      await bounded(r(text), cancel);
    },
  });

  // the pool of the moment, looked up per statement
  const direct = make(runner(() => pool));
  // a lone write of demo work runs in a transaction that carries the demo setting (src/server/db/scope.ts)
  const base = {
    query: <T = Row>(text: string, params: unknown[] = []): Promise<T[]> => (scopedWrite(text) ? tx((t) => t.query<T>(text, params)) : run(() => direct.query<T>(text, params))),
    one: <T = Row>(text: string, params: unknown[] = []): Promise<T | null> => (scopedWrite(text) ? tx((t) => t.one<T>(text, params)) : run(() => direct.one<T>(text, params))),
    exec: (text: string): Promise<void> => (scopedWrite(text) ? tx((t) => t.exec(text)) : run(() => direct.exec(text))),
  };
  return {
    kind: "postgres",
    ...base,
    tx,
    async close() {
      closed = true;
      await Promise.all([pool.end({ timeout: 5 }), ...retiring]);
    },
  };

  function tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return run(() => transaction(fn));
  }

  async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const sql = pool;
    const override = limitsOverride.getStore();
    const limits = override === undefined ? (opts.txLimits ?? null) : override;
    const pre = txPreamble(limits, demoScopeOrg());
    // the server ends its statements at its own statement_timeout, no later than the client's deadline: the client sends
    // no CancelRequest of its own, which would come too late and cancel another request's statement (`bounded`)
    const serverEnds = !!limits && limits.statementMs > 0 && limits.statementMs <= clientMs;
    const phase = clientMs ? phases() : null;
    // the caller's own error leaves as it is (its database errors are marked already)
    const caller: { error?: unknown; set: boolean } = { set: false };
    let txq: Tx | null = null;
    let committed = false;
    try {
      phase?.arm();
      const done = sql.begin(async (t) => {
        phase?.enter();
        const sp = savepoints(t);
        try {
          // the limits and the demo scope: one statement, awaited before anything else of the transaction (its own
          // deadline keeps the cancel: it runs before the limits it sets)
          if (pre) await bounded(t.unsafe(pre.text, (pre.params ?? []) as never[]));
          txq = { ...make(runner(() => sp.sql), !serverEnds), inTx: true };
          let r: T;
          try {
            r = await fn(txq);
            await runBeforeCommit(txq);
          } catch (e) {
            caller.error = e;
            caller.set = true;
            throw e;
          }
          phase?.arm();
          await sp.closeAll(true);
          return r;
        } catch (e) {
          // one of its statements got no answer: the rollback is not waited for through the same silent connection
          if (phase && noAnswered.has(e as object)) phase.now(e as Error);
          else phase?.arm();
          await sp.closeAll(false).catch(() => {});
          throw e;
        }
      });
      const result = phase ? await phase.race(done) : await done;
      committed = true;
      return result as T;
    } catch (e) {
      throw caller.set && caller.error === e ? e : marked(e);
    } finally {
      phase?.disarm();
      // the write-lock probe (off in production): the transaction is over, its lock released
      txEnded(txq, committed);
    }
  }
}

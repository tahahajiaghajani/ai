// Every step of «حذف داده‌های نمایشی» fits the web version's limits whatever the pack's size (docs/DEMO_FA.md «هیچ ردیفی
// حذف را نمی‌ایستاند»; the review of 1.1.5). On the web a function is cut at 60 s and a statement at 30 s, and a round
// trip to the database costs 2–6 ms, so a step is bounded in statements: before, the accounts phase removed every account
// of the pack in one transaction (six statements each: 18,000 for the large pack's 3,000), the remove phase began with a
// whole derivation over every table, the finish phase derived and removed every row and account once more, and a table
// whose bulk delete failed went row by row without looking at the clock — a step past the cut, rolled back and run again
// with the same work, for ever. Now each of those steps does at least one unit of work — a table, a chunk of accounts, a
// row — and stops at its budget, resuming from its cursor; the accounts go in chunks of set-based statements.
// Driven here with no time left at all (a deadline already passed), the remove, accounts and finish phases still make
// progress a step at a time, every step stays within a fixed number of statements however many rows and accounts the
// pack has, and the purge ends with what it removes removed: 450 accounts, 120 records of which one refuses to go (it
// stays, reported once), a real comment on a demo record written after the plan was made. Called on its own with no
// time left, the accounts' removal takes one chunk of 200 in a handful of statements.
// The pack is simulated as tests/demo-purge-conflicts.test.ts does (a loaded pack row, demo rows written in the scope).
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { purgeStep } from "@server/modules/demo";
import { removeAccounts } from "@server/modules/demo/purge";
import type { Db, Queryable, Tx } from "@server/db";

const ACCOUNTS = 450;
const RECORDS = 120;
/** Statements one step may issue (the old accounts phase issued about 6 × 450 in one step, the old finish more). */
const STEP_STATEMENTS = 200;

/** Count the statements issued through `db` and its transactions (patched in place: before-commit work keys on them). */
function counting(db: Db): { n: number } {
  const c = { n: 0 };
  const done = new WeakSet<object>();
  const wrap = (q: Queryable) => {
    if (done.has(q)) return;
    done.add(q);
    for (const k of ["query", "one", "exec"] as const) {
      const f = (q as unknown as Record<string, (...a: unknown[]) => unknown>)[k];
      (q as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => {
        c.n++;
        return f(...a);
      };
    }
  };
  wrap(db);
  const tx = db.tx.bind(db);
  (db as unknown as { tx: Db["tx"] }).tx = <T,>(fn: (t: Tx) => Promise<T>) =>
    tx((t) => {
      wrap(t);
      return fn(t);
    });
  return c;
}

describe("the purge's steps fit the web's limits whatever the pack's size", () => {
  let e: EngineOrg;
  let stmts: { n: number };
  let refused = "";
  let ids: string[] = [];
  let lateComment = "";
  const calls: Record<string, number> = {};
  const most: Record<string, number> = {};
  /** the purge's audit line (counts only) */
  let audit: Record<string, unknown> = {};

  const phase = async () => (await e.db.one<{ purge: string | null }>(`select progress->>'purge' as purge from sm_demo_packs where org_id = $1 and state = 'purging'`, [e.org]))?.purge ?? null;
  /** One step of the purge; the remove, accounts and finish phases with no time left at all. */
  async function step(): Promise<string | null> {
    const at = await phase();
    if (!at) return null;
    const hurried = at === "remove" || at === "accounts" || at === "finish";
    stmts.n = 0;
    await purgeStep(e.cfg, e.org, null, hurried ? Date.now() - 1 : Infinity);
    if (hurried) {
      calls[at] = (calls[at] ?? 0) + 1;
      most[at] = Math.max(most[at] ?? 0, stmts.n);
    }
    return at;
  }

  /** `ACCOUNTS` of the pack's accounts in the registry, each a member of the organisation. */
  const packPeople = (q: Queryable, prefix: string) =>
    q.query(
      `with u as (insert into sm_users (id, email, full_name, prefs)
         select gen_random_uuid(), $2 || g || '.' || substr($1::text, 1, 8) || '@aftab-bank.example', 'کارمند نمایشی ' || g, jsonb_build_object('demo_org', $1::text)
           from generate_series(1, ${ACCOUNTS}) g returning id),
       r as (insert into sm_demo_rows (org_id, row_id, tbl) select $1::uuid, id, 'sm_users' from u returning row_id)
       insert into sm_org_members (id, org_id, user_id, role, title, origin) select gen_random_uuid(), $1::uuid, row_id, 'member', 'نمایشی', 'cloud' from r`,
      [e.org, prefix],
    );

  beforeAll(async () => {
    e = await engineOrg();
    stmts = counting(e.db);
    const sys = await systemCtx(e.cfg, e.org);
    await e.db.query(
      `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
      [e.org, e.ownerId],
    );
    // the pack's people, as the loader adds them (an account marked with the pack, its membership in the scope)
    await inDemoScope(e.org, () => e.db.tx((tx) => packPeople(tx, "persona")));
    // the pack's records; one of them refuses to go (as a module's guard would): its table's bulk delete fails
    ids = await inDemoScope(e.org, () =>
      sys.write(async (tx) => {
        const out: string[] = [];
        for (let i = 0; i < RECORDS; i++) out.push(String((await createIn(tx, sys, "todo", { short_description: `کار نمایشی ${i + 1}` }, { trusted: true })).id));
        return out;
      }),
    );
    refused = ids[Math.floor(RECORDS / 2)];
    await e.db.query(`create or replace function test_keep_demo_todo() returns trigger language plpgsql as $f$ begin if old.id = '${refused}' then raise exception 'این ردیف نگه داشته می‌شود'; end if; return old; end $f$`);
    await e.db.query(`create trigger test_keep_demo_todo before delete on sm_todos for each row execute function test_keep_demo_todo()`);
    await e.db.query(`update sm_demo_packs set state = 'purging', purge_started_at = now(), progress = progress || '{"purge":"expand"}'::jsonb where org_id = $1`, [e.org]);
    // the plan is made (expand, clear) …
    while ((await phase()) !== "remove") await step();
    // … and then the owner comments on a demo record: recorded on demo data after the plan, it goes with the pack
    await e.owner.post(`/o/${e.org}/r/todo/${ids[0]}/journal`, { kind: "comment", body: "یادداشت پس از برنامهٔ حذف" });
    lateComment = (await e.db.one<{ id: string }>(`select id::text as id from sm_journal where org_id = $1 and record_id = $2 and body = 'یادداشت پس از برنامهٔ حذف'`, [e.org, ids[0]]))!.id;
    for (let i = 0; i < 5000 && (await step()); i++);
    audit = (await e.db.one<{ data: Record<string, unknown> }>(`select data from sm_audit where org_id = $1 and action = 'demo_purge' order by at desc limit 1`, [e.org]))?.data ?? {};
  }, 900_000);

  it("ends, a step at a time, each step within a fixed number of statements", async () => {
    expect(await e.db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [e.org])).toBeNull();
    // with no time left a phase still moves: the accounts in chunks, the rows of the refused table one by one
    expect(calls.accounts).toBeGreaterThanOrEqual(3);
    expect(calls.remove).toBeGreaterThan(RECORDS);
    expect(calls.finish).toBeGreaterThan(1);
    for (const p of ["remove", "accounts", "finish"]) expect(most[p], p).toBeLessThanOrEqual(STEP_STATEMENTS);
  });

  it("removes what the pack made and what was recorded on it; the row that refused stays, reported once", async () => {
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_users where prefs ->> 'demo_org' = $1`, [e.org]))!.n).toBe(0);
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_users where email like 'persona%.' || substr($1::text, 1, 8) || '@aftab-bank.example'`, [e.org]))!.n).toBe(0);
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_org_members m where m.org_id = $1 and m.user_id <> $2`, [e.org, e.ownerId]))!.n).toBe(0);
    expect((await e.db.query<{ id: string }>(`select id::text as id from sm_todos where id = any($1::uuid[])`, [`{${ids.join(",")}}`])).map((r) => r.id)).toEqual([refused]);
    expect(await e.db.one(`select 1 as x from sm_todos where id = $1 and deleted_at is null`, [refused])).toBeTruthy();
    expect(await e.db.one(`select 1 as x from sm_journal where id = $1`, [lateComment])).toBeNull();
    expect(audit).toMatchObject({ skipped: 1 });
  });

  it("removes accounts a chunk at a time, in a handful of statements however many there are", async () => {
    // more of the pack's accounts in the registry (before, all of them went in one call: six statements each)
    await e.db.tx((tx) => packPeople(tx, "again"));
    const cur = { after: null as string | null, removed: 0, kept: 0 };
    stmts.n = 0;
    const first = await removeAccounts(e.db, e.org, { tombstones: false }, cur, Date.now() - 1);
    expect(stmts.n).toBeLessThanOrEqual(20);
    expect(first).toMatchObject({ removed: 200, done: false });
    for (let i = 0; i < 10 && !(await removeAccounts(e.db, e.org, { tombstones: false }, cur, Date.now() - 1)).done; i++);
    expect(cur.removed).toBe(ACCOUNTS);
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_users where email like 'again%.' || substr($1::text, 1, 8) || '@aftab-bank.example'`, [e.org]))!.n).toBe(0);
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_org_members m where m.org_id = $1 and m.user_id <> $2`, [e.org, e.ownerId]))!.n).toBe(0);
  });
});

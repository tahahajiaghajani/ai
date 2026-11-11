// Transaction-id sync revisions on a real PostgreSQL (docs/spec/ENGINE.md §13, PERFORMANCE_FA.md «دور سوم»): writes
// of one organisation run side by side (no organisation lock), revisions are the writers' transaction ids in any commit
// order, and pulls read exact snapshot deltas — nothing missed, nothing twice. Skipped unless ITSM_PG_URL or ITSM_PG_BIN
// (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin npx vitest run tests/sync-xid-pg.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "./fixtures/module";
import { createPostgresDb } from "@server/db/postgres";
import { migrate } from "@server/db/migrate";
import { createApp } from "@server/app";
import { onBeforeCommit, pgArray, type Db } from "@server/db";
import { create, createIn, systemCtx, update } from "@server/engine";
import { seedItamDefaults } from "@server/modules/itam";
import { addCustody, verifyCustody } from "@server/modules/itam/bank";
import { configureWriteSerialisation, type ServerConfig } from "@server/context";
import { checkXidRegression, currentSnap, notePurged, snapText } from "@server/sync/snapshot";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { startLocal, type LocalServer } from "@local/server";
import { registerTable, tableDef } from "@shared/tables";
import { BY_ENTITY } from "@server/sync/registry";
import { Client, quietLog } from "./helpers";
import { realPg, realPgAvailable, type RealPg } from "./pg-real";

// an engine table of this suite (what the scoped pulse answers about)
registerTable({
  key: "xid_note",
  table: "sm_xid_notes",
  label: "یادداشت آزمون",
  plural: "یادداشت‌های آزمون",
  icon: "file",
  module: "test",
  area: "work",
  display: "title",
  fields: [{ name: "title", label: "عنوان", type: "text" }],
  scope: {},
});

const EMAIL = "xid-owner@example.com";
const PASSWORD = "xid-pass-1405";
const INSERT = `insert into sm_test_items (id, org_id, name, code) values ($1, $2, $3, $4)`;

/** Gates holding transactions open; a failed test releases its own (afterEach) so none outlives it. */
const open: (() => void)[] = [];
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  open.push(resolve);
  return { promise, resolve };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let codes = 0;
const code = () => `X${process.pid}-${++codes}`;

/** A Windows app's replica as the protocol defines it (src/desktop/sync-client.ts, without the database). */
class Replica {
  since = "";
  snap = "";
  after = "";
  epoch: string | null = null;
  rows = new Map<string, Record<string, unknown>>();
  seen = new Set<string>();
  delivered = new Map<string, number>();
  resets = 0;
  pages = 0;
  constructor(private c: Client, private org: string) {}

  async pullAll(): Promise<void> {
    let swept = false;
    for (let round = 0; round < 1000; round++) {
      const qs = new URLSearchParams({ org_id: this.org, protocol: String(SYNC_PROTOCOL) });
      if (this.since) qs.set("since", this.since);
      if (this.snap) qs.set("snap", this.snap);
      if (this.after) qs.set("after", this.after);
      if (this.epoch !== null) qs.set("epoch", this.epoch);
      const page = await this.c.get(`/sync/pull?${qs.toString()}`);
      this.pages++;
      if (page.reset) {
        this.resets++;
        this.since = this.snap = this.after = "";
        this.seen.clear();
        this.epoch = page.epoch;
        continue;
      }
      if (page.full && !this.snap) this.seen.clear();
      for (const a of page.aggregates as { entity: string; id: string; row: Record<string, unknown> }[]) {
        const key = `${a.entity}:${a.id}`;
        this.rows.set(key, a.row);
        if (page.full) this.seen.add(key);
        const v = `${key}@${a.row.rev}`;
        this.delivered.set(v, (this.delivered.get(v) ?? 0) + 1);
      }
      for (const t of (page.tombstones ?? []) as { entity: string; id: string }[]) this.rows.delete(`${t.entity}:${t.id}`);
      let sweep = false;
      if (page.full && !page.has_more) {
        // engine rows only (the platform's roots are always sent whole), as src/desktop/sync-client.ts does
        for (const key of [...this.rows.keys()]) if (BY_ENTITY.get(key.split(":")[0])?.engine && !this.seen.has(key)) this.rows.delete(key);
        this.seen.clear();
        sweep = true;
      }
      this.since = page.cursor ?? "";
      this.snap = page.has_more ? page.snap : "";
      this.after = page.has_more ? page.after : "";
      this.epoch = page.epoch;
      if (page.has_more) continue;
      if (sweep && !swept) {
        swept = true;
        continue;
      }
      return;
    }
    throw new Error("pull did not finish");
  }

  item(id: string) {
    return this.rows.get(`test_item:${id}`);
  }
  items(): Map<string, Record<string, unknown>> {
    const out = new Map<string, Record<string, unknown>>();
    for (const [k, v] of this.rows) if (k.startsWith("test_item:")) out.set(k.slice("test_item:".length), v);
    return out;
  }
  /** test_item versions delivered more than once (none, outside a reset) */
  duplicates(): string[] {
    return [...this.delivered].filter(([k, n]) => k.startsWith("test_item:") && n > 1).map(([k]) => k);
  }
}

describe.skipIf(!realPgAvailable())("sync revisions are transaction ids (real PostgreSQL)", () => {
  let pg: RealPg;
  let db: Db;
  let cfg: ServerConfig;
  let owner: Client;
  let org = "";
  let app: ReturnType<typeof createApp>;

  const rev = async (id: string) => Number((await db.one<{ rev: number }>(`select rev from sm_test_items where id = $1`, [id]))!.rev);
  /** What a converged replica must hold: every test item of the organisation, its latest version. */
  async function truth(): Promise<Map<string, { rev: number; name: string; deleted: boolean }>> {
    const rows = await db.query<{ id: string; rev: number; name: string; deleted_at: string | null }>(`select id, rev, name, deleted_at from sm_test_items where org_id = $1`, [org]);
    return new Map(rows.map((r) => [String(r.id), { rev: Number(r.rev), name: r.name, deleted: !!r.deleted_at }]));
  }
  async function expectConverged(r: Replica) {
    const want = await truth();
    const got = r.items();
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [id, w] of want) {
      const g = got.get(id)!;
      expect({ id, rev: Number(g.rev), name: g.name, deleted: !!g.deleted_at }).toEqual({ id, ...w });
    }
  }

  beforeAll(async () => {
    pg = await realPg("xid");
    db = createPostgresDb({ url: pg.url, ssl: false, max: 16 });
    await migrate(db);
    cfg = { mode: "cloud", db, secret: "xid-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) } as ServerConfig;
    app = createApp(cfg);
    owner = new Client(app);
    await owner.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مالک" });
    org = (await owner.post<{ id: string }>("/orgs", { name: "سازمان شناسهٔ تراکنش", timezone: "Asia/Tehran" })).id;
  }, 120_000);

  afterEach(() => {
    for (const release of open.splice(0)) release();
  });

  afterAll(async () => {
    configureWriteSerialisation(false);
    await db?.close();
    await pg?.stop();
  });

  it("stamps rows with the writing transaction's id (no counter, no organisation lock)", async () => {
    const id = uuidv7();
    const xid = await db.tx(async (tx) => {
      await tx.query(INSERT, [id, org, "یک", code()]);
      return Number((await tx.one<{ x: string }>(`select pg_current_xact_id()::text as x`))!.x);
    });
    expect(await rev(id)).toBe(xid);
    const lockRow = await db.one<{ rev: number }>(`select rev from sm_org_sync where org_id = $1`, [org]);
    expect(Number(lockRow?.rev ?? 0)).toBe(0);
  });

  it("needs no privilege: an ordinary role (Supabase's pooled one alike) reads snapshots and transaction ids", async () => {
    await db.exec(`do $r$ begin if not exists (select 1 from pg_roles where rolname = 'itsm_xid_app') then create role itsm_xid_app; end if; end $r$`);
    const got = await db.tx(async (tx) => {
      await tx.query(`set local role itsm_xid_app`);
      return tx.one<{ s: string; x: string }>(`select pg_current_snapshot()::text as s, pg_current_xact_id()::text as x`);
    });
    expect(got?.s).toMatch(/^\d+:\d+:/);
    expect(Number(got?.x)).toBeGreaterThan(0);
  });

  it("a transaction that began first and commits last still arrives (A writes, B commits, pull, A commits)", async () => {
    const r = new Replica(owner, org);
    await r.pullAll();
    const x = uuidv7();
    const y = uuidv7();
    const gate = deferred();
    const wrote = deferred();
    const a = db.tx(async (tx) => {
      await tx.query(INSERT, [x, org, "A", code()]);
      wrote.resolve();
      await gate.promise;
    });
    await wrote.promise;
    await db.tx(async (tx) => void (await tx.query(INSERT, [y, org, "B", code()])));
    await r.pullAll();
    expect(r.item(y)?.name).toBe("B");
    expect(r.item(x)).toBeUndefined();
    gate.resolve();
    await a;
    // A's revision is below B's: a numeric cursor that moved past B would never come back for A
    expect(await rev(x)).toBeLessThan(await rev(y));
    await r.pullAll();
    expect(r.item(x)?.name).toBe("A");
    expect(r.duplicates()).toEqual([]);
    await expectConverged(r);
  });

  it("an update committed later by an older transaction replaces the newer revision it overwrote", async () => {
    const id = uuidv7();
    await db.tx(async (tx) => void (await tx.query(INSERT, [id, org, "آغاز", code()])));
    const r = new Replica(owner, org);
    await r.pullAll();
    const gate = deferred();
    const started = deferred();
    const older = db.tx(async (tx) => {
      // takes its transaction id now (a write elsewhere), updates the row after the newer writer committed
      await tx.query(INSERT, [uuidv7(), org, "دیگر", code()]);
      started.resolve();
      await gate.promise;
      await tx.query(`update sm_test_items set name = 'قدیمی‌تر' where id = $1`, [id]);
    });
    await started.promise;
    await db.tx(async (tx) => void (await tx.query(`update sm_test_items set name = 'تازه‌تر' where id = $1`, [id])));
    const newer = await rev(id);
    await r.pullAll();
    expect(r.item(id)?.name).toBe("تازه‌تر");
    gate.resolve();
    await older;
    expect(await rev(id)).toBeLessThan(newer);
    await r.pullAll();
    expect(r.item(id)?.name).toBe("قدیمی‌تر");
    expect(r.duplicates()).toEqual([]);
    await expectConverged(r);
  });

  it("a long transaction only delays its own rows; pages of one big transaction lose nothing", async () => {
    const r = new Replica(owner, org);
    await r.pullAll();
    const gate = deferred();
    const wrote = deferred();
    const longId = uuidv7();
    const long = db.tx(async (tx) => {
      await tx.query(INSERT, [longId, org, "طولانی", code()]);
      wrote.resolve();
      await gate.promise;
    });
    await wrote.promise;
    // 2 500 rows with one revision (more than two pages), then small transactions
    const bulk = Array.from({ length: 2500 }, () => uuidv7());
    await db.tx(async (tx) => {
      await tx.query(
        `insert into sm_test_items (id, org_id, name, code) select x, $2, 'انبوه', 'B' || x::text from unnest($1::uuid[]) as x`,
        [pgArray(bulk), org],
      );
    });
    for (let i = 0; i < 20; i++) await db.tx(async (tx) => void (await tx.query(INSERT, [uuidv7(), org, `کوچک ${i}`, code()])));
    const pagesBefore = r.pages;
    await r.pullAll();
    expect(r.pages - pagesBefore).toBeGreaterThanOrEqual(3);
    for (const id of bulk) expect(r.item(id)).toBeDefined();
    expect(r.item(longId)).toBeUndefined();
    gate.resolve();
    await long;
    await r.pullAll();
    expect(r.item(longId)?.name).toBe("طولانی");
    expect(r.duplicates()).toEqual([]);
    await expectConverged(r);
  });

  it("the scoped pulse reports a write committed late by an older transaction", async () => {
    const pulse = (since?: string) =>
      owner.get<{ pulse: string; changed?: string[] }>(`/o/${org}/pulse?t=xid_note${since ? `&since=${encodeURIComponent(since)}` : ""}`);
    const group = `insert into sm_xid_notes (id, org_id, title) values ($1, $2, $3)`;
    const p0 = (await pulse()).pulse;
    expect(p0.startsWith("x")).toBe(true);
    const gate = deferred();
    const wrote = deferred();
    const a = db.tx(async (tx) => {
      await tx.query(group, [uuidv7(), org, "گروه الف"]);
      wrote.resolve();
      await gate.promise;
    });
    try {
      await wrote.promise;
      await db.tx(async (tx) => void (await tx.query(group, [uuidv7(), org, "گروه ب"])));
      const p1 = await pulse(p0);
      expect(p1.changed).toEqual(["xid_note"]);
      const p1b = await pulse(p1.pulse);
      expect(p1b.changed).toEqual([]);
      gate.resolve();
      await a;
      const p2 = await pulse(p1b.pulse);
      expect(p2.changed).toEqual(["xid_note"]);
      const p3 = await pulse(p2.pulse);
      expect(p3.changed).toEqual([]);
    } finally {
      gate.resolve();
      await a.catch(() => undefined);
    }
  });

  it("writes of one organisation no longer wait for each other (and the switch brings the lock back)", async () => {
    const sys = await systemCtx(cfg, org);
    const race = async (serialised: boolean) => {
      configureWriteSerialisation(serialised);
      const gate = deferred();
      const wrote = deferred();
      const first = sys.write(async (tx) => {
        await tx.query(INSERT, [uuidv7(), org, "اول", code()]);
        wrote.resolve();
        await gate.promise;
      });
      await wrote.promise;
      const second = sys.write(async (tx) => void (await tx.query(INSERT, [uuidv7(), org, "دوم", code()])));
      const outcome = await Promise.race([second.then(() => "done"), sleep(1500).then(() => "waiting")]);
      gate.resolve();
      await Promise.all([first, second]);
      configureWriteSerialisation(false);
      return outcome;
    };
    expect(await race(false)).toBe("done");
    expect(await race(true)).toBe("waiting");
  });

  it("before-commit work on one key takes turns, and the second sees what the first committed", async () => {
    await db.exec(`create table if not exists xid_rollup (id int primary key, done int not null default 0);
      create table if not exists xid_child (id uuid primary key, parent int not null, done boolean not null);
      insert into xid_rollup (id) values (1) on conflict (id) do nothing`);
    const recount = (tx: { query: Db["query"] }) => async () => {
      await tx.query(`update xid_rollup set done = (select count(*) from xid_child where parent = 1 and done) where id = 1`);
    };
    const inside = deferred();
    const gate = deferred();
    const t1 = db.tx(async (tx) => {
      await tx.query(`insert into xid_child values ($1, 1, true)`, [uuidv7()]);
      onBeforeCommit(tx, "xid.rollup:1", async () => {
        await recount(tx)();
        inside.resolve();
        await gate.promise;
      });
    });
    await inside.promise;
    const t2 = db.tx(async (tx) => {
      await tx.query(`insert into xid_child values ($1, 1, true)`, [uuidv7()]);
      onBeforeCommit(tx, "xid.rollup:1", recount(tx));
    });
    const outcome = await Promise.race([t2.then(() => "done"), sleep(800).then(() => "waiting")]);
    expect(outcome).toBe("waiting");
    gate.resolve();
    await Promise.all([t1, t2]);
    expect(Number((await db.one<{ done: number }>(`select done from xid_rollup where id = 1`))!.done)).toBe(2);
  });

  it("custody events of one asset take turns: the bank ITAM chain never forks", async () => {
    await seedItamDefaults(cfg, org);
    const sys = await systemCtx(cfg, org);
    const idBy = async (table: string, field: string, v: string) =>
      String((await db.one<{ id: string }>(`select id from ${tableDef(table)!.table} where org_id = $1 and ${field} = $2 and deleted_at is null`, [org, v]))!.id);
    const model = await idBy("asset_model", "name", "لنوو ThinkPad E14 Gen 5");
    const stockroom = await idBy("stockroom", "code", "WH-01");
    const asset = await sys.write((tx) => createIn(tx, sys, "asset", { model_id: model, state: "in_stock", stockroom_id: stockroom }, { trusted: true }));
    const chain = async () => (await db.query<{ seq: number }>(`select seq from sm_asset_custody where asset_id = $1 order by seq`, [asset.id])).map((r) => Number(r.seq));
    expect(await chain()).toEqual([1]);
    // a count's «seen» stamp has written its link and holds its transaction open; an attestation of the same asset
    // meanwhile must not follow the same last link (two links of one seq: the chain broken for good)
    const inside = deferred();
    const gate = deferred();
    const first = sys.write(async (tx) => {
      await addCustody(tx, sys, asset, { event: "audited", reference: "شمارش" });
      inside.resolve();
      await gate.promise;
    });
    await inside.promise;
    const second = sys.write((tx) => addCustody(tx, sys, asset, { event: "attested", reference: "تأیید" }));
    // the asset's row lock makes it wait; it reads the first one's link once that one committed
    expect(await Promise.race([second.then(() => "done"), sleep(800).then(() => "waiting")])).toBe("waiting");
    gate.resolve();
    await Promise.all([first, second]);
    expect(await chain()).toEqual([1, 2, 3]);
    expect(await verifyCustody(db, sys, String(asset.id))).toMatchObject({ ok: true, rows: 3, broken_at: null });
  }, 120_000);

  it("a cursor ahead of the database resets that app; a database that went back resets every app once", async () => {
    const r = new Replica(owner, org);
    await r.pullAll();
    const other = new Replica(owner, org);
    await other.pullAll();
    const cur = await currentSnap(db);
    // r's cursor comes from a database whose transaction ids were far ahead of this one's
    r.since = snapText({ xmin: cur.xmax + 1_000_000, xmax: cur.xmax + 1_000_000, xip: [] });
    await r.pullAll();
    expect(r.resets).toBe(1);
    await expectConverged(r);
    // the database itself did not go back (its high-water mark is not ahead): the other app's cursor stays good
    await other.pullAll();
    expect(other.resets).toBe(0);
    await expectConverged(other);
    // the database's high-water mark is ahead of its next transaction id (a restore the server did not run itself)
    await db.query(`insert into sm_meta (key, value) values ('sync.xid_high', $1) on conflict (key) do update set value = excluded.value`, [String(cur.xmax + 5_000_000)]);
    expect(await checkXidRegression(db, { force: true })).toBe(true);
    expect(await checkXidRegression(db, { force: true })).toBe(false);
    await r.pullAll();
    expect(r.resets).toBe(2);
    await expectConverged(r);
    await other.pullAll();
    expect(other.resets).toBe(1);
    await expectConverged(other);
  });

  it("tombstones removed for good: an app that never saw them reads everything again and drops them", async () => {
    const note = `insert into sm_xid_notes (id, org_id, title) values ($1, $2, $3)`;
    const noteRev = async (id: string) => Number((await db.one<{ rev: number }>(`select rev from sm_xid_notes where id = $1`, [id]))!.rev);
    const gone = uuidv7();
    await db.tx(async (tx) => void (await tx.query(note, [gone, org, "بایگانی‌شدنی"])));
    const r = new Replica(owner, org);
    await r.pullAll();
    expect(r.rows.get(`xid_note:${gone}`)).toBeDefined();
    // the record is archived (a tombstone with a new revision) and its tombstone purged before this app pulls again
    await db.tx(async (tx) => void (await tx.query(`update sm_xid_notes set deleted_at = now() where id = $1`, [gone])));
    const tomb = await noteRev(gone);
    await db.tx(async (tx) => {
      await tx.query(`delete from sm_xid_notes where id = $1`, [gone]);
      await notePurged(tx, org, tomb);
    });
    await r.pullAll();
    expect(r.resets).toBe(1);
    expect(r.rows.get(`xid_note:${gone}`)).toBeUndefined();
    await expectConverged(r);
    // an app that saw the tombstone before the purge is not reset
    const id2 = uuidv7();
    await db.tx(async (tx) => void (await tx.query(note, [id2, org, "دومی"])));
    await db.tx(async (tx) => void (await tx.query(`update sm_xid_notes set deleted_at = now() where id = $1`, [id2])));
    await r.pullAll();
    expect(r.rows.get(`xid_note:${id2}`)?.deleted_at).toBeTruthy();
    const tomb2 = await noteRev(id2);
    await db.tx(async (tx) => {
      await tx.query(`delete from sm_xid_notes where id = $1`, [id2]);
      await notePurged(tx, org, tomb2);
    });
    await r.pullAll();
    expect(r.resets).toBe(1);
  });

  it("engine writes of one organisation run concurrently (history, journal, events and all) and a replica converges", async () => {
    const sys = await systemCtx(cfg, org);
    const made = await Promise.all(Array.from({ length: 12 }, (_, i) => create(sys, "xid_note", { title: `موازی ${i}` })));
    const ids = made.map((m) => String(m.row.id));
    const r = new Replica(owner, org);
    await r.pullAll();
    // 12 records × 4 updates each, all at once; and 8 writers on one record (they queue on its row)
    const results = await Promise.allSettled([
      ...ids.flatMap((id, i) => Array.from({ length: 4 }, (_, k) => update(sys, "xid_note", id, { title: `موازی ${i}.${k}` }))),
      ...Array.from({ length: 8 }, (_, k) => update(sys, "xid_note", ids[0], { title: `یک رکورد ${k}` })),
      r.pullAll(),
    ]);
    const failed = results.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason?.message ?? x));
    expect(failed).toEqual([]);
    await r.pullAll();
    const stored = await db.query<{ id: string; title: string; rev: number }>(`select id, title, rev from sm_xid_notes where id = any($1::uuid[])`, [pgArray(ids)]);
    for (const s of stored) expect({ id: s.id, title: r.rows.get(`xid_note:${s.id}`)?.title, rev: Number(r.rows.get(`xid_note:${s.id}`)?.rev) }).toEqual({ id: s.id, title: s.title, rev: Number(s.rev) });
    expect(r.duplicates()).toEqual([]);
  }, 120_000);

  it("randomised: writers × pullers in any commit and abort order — every replica ends with exactly the committed rows", async () => {
    const WRITERS = 6;
    const TXS = 40;
    const PULLERS = 4;
    let seed = 20261110;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const ids: string[] = (await db.query<{ id: string }>(`select id from sm_test_items where org_id = $1 and deleted_at is null limit 50`, [org])).map((x) => String(x.id));
    const replicas = Array.from({ length: PULLERS }, () => new Replica(owner, org));
    for (const r of replicas) await r.pullAll();
    let writing = WRITERS;
    let aborted = 0;
    let committed = 0;
    const writer = async (w: number) => {
      for (let t = 0; t < TXS; t++) {
        const ops = 1 + Math.floor(rand() * 4);
        const abort = rand() < 0.2;
        const hold = Math.floor(rand() * 25);
        try {
          await db.tx(async (tx) => {
            for (let o = 0; o < ops; o++) {
              const pick = rand();
              if (pick < 0.45 || !ids.length) {
                const id = uuidv7();
                await tx.query(INSERT, [id, org, `w${w}-t${t}-o${o}`, code()]);
                if (!abort) ids.push(id);
              } else if (pick < 0.9) {
                await tx.query(`update sm_test_items set name = $2 where id = $1`, [ids[Math.floor(rand() * ids.length)], `w${w}-t${t}-u${o}`]);
              } else {
                await tx.query(`update sm_test_items set deleted_at = now() where id = $1`, [ids[Math.floor(rand() * ids.length)]]);
              }
              if (hold) await sleep(hold);
            }
            if (abort) throw new Error("abort");
          });
          committed++;
        } catch (e) {
          if ((e as Error).message === "abort") aborted++;
          else if (!["40P01", "40001"].includes(String((e as { code?: string }).code))) throw e;
        }
      }
      writing--;
    };
    const puller = async (r: Replica) => {
      while (writing > 0) {
        await r.pullAll();
        await sleep(Math.floor(rand() * 30));
      }
    };
    await Promise.all([...Array.from({ length: WRITERS }, (_, w) => writer(w)), ...replicas.map(puller)]);
    for (const r of replicas) {
      await r.pullAll();
      expect(r.resets).toBe(0);
      expect(r.duplicates()).toEqual([]);
      await expectConverged(r);
    }
    expect(committed).toBeGreaterThan(WRITERS * TXS * 0.6);
    expect(replicas.every((r) => r.pages > 3)).toBe(true);
    expect(aborted).toBeGreaterThan(0);
  }, 180_000);

  it("a Windows app (PGlite) pulls from the server under concurrent writes and converges; its LAN clients keep writing", async () => {
    let url = "";
    const server = await new Promise<ReturnType<typeof serve>>((ok) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
        url = `http://127.0.0.1:${info.port}`;
        ok(s);
      });
    });
    const dataDir = mkdtempSync(join(tmpdir(), "itsm-xid-"));
    let desktop: LocalServer | null = null;
    try {
      desktop = await startLocal({ dataDir, staticDir: join(__dirname, "..", "public"), port: 0, memory: true, log: { info() {}, warn() {}, error: console.error } });
      const desk = new Client({ fetch: (r: Request) => fetch(r) }, desktop.url);
      const linked = await desk.post("/local/cloud/link", { url, email: EMAIL, password: PASSWORD, org_id: org, direction: "download" });
      expect(linked.ok).toBe(true);
      await desk.post("/auth/login", { email: EMAIL, password: PASSWORD });
      // another computer of the office works through this Windows app (LAN mode serves the same API)
      const lan = new Client({ fetch: (r: Request) => fetch(r) }, desktop.url);
      await lan.post("/auth/login", { email: EMAIL, password: PASSWORD });
      let writing = true;
      const writes = (async () => {
        for (let i = 0; i < 40; i++) {
          await db.tx(async (tx) => {
            await tx.query(INSERT, [uuidv7(), org, `ابر ${i}`, code()]);
            if (i % 3 === 0) await sleep(15);
          });
          if (i % 10 === 5) await lan.post(`/o/${org}/data/test_item`, { name: `شبکه ${i}` });
        }
        writing = false;
      })();
      while (writing) {
        await desk.post("/local/sync");
        await sleep(20);
      }
      await writes;
      await desk.post("/local/sync");
      await desk.post("/local/sync");
      const want = (await db.query<{ name: string }>(`select name from sm_test_items where org_id = $1 and deleted_at is null`, [org])).map((r) => r.name).sort();
      const seen: string[] = [];
      for (let page = 1; ; page++) {
        const got = await desk.get(`/o/${org}/data/test_item?size=500&page=${page}`);
        seen.push(...got.rows.map((r: { name: string }) => r.name));
        if (got.rows.length < 500) break;
      }
      expect(seen.sort()).toEqual(want);
      // what the office computer wrote through this Windows app reached the server
      const lanRows = await db.query<{ name: string }>(`select name from sm_test_items where org_id = $1 and name like 'شبکه %'`, [org]);
      expect(lanRows.length).toBe(4);
    } finally {
      await desktop?.close();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 180_000);
});

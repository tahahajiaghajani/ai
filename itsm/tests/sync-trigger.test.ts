// The sync trigger function sm_sync_touch() is defined by three migrations: 0001_core (the organisation's counter),
// 0099_demo_touch (on a Windows app, a write inside the demo scope never enters the outbox — demo data is loaded on the
// server, never pushed from an app) and 0100_xid_revisions (the writing transaction's id instead of the counter, no
// lock). The last definition wins — on a fresh database, and on a 1.1.0-beta one that ran 0098/0099 before the
// update — so 0100's must do both: transaction ids on the server, the outbox on a Windows app, and no outbox entry for
// demo work there.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, quietLog, signupWithOrg } from "./helpers";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { migrate } from "@server/db/migrate";
import { MIGRATIONS } from "@server/db/migrations";
import { uuidv7 } from "@shared/id";
import type { Db } from "@server/db";
import type { DesktopBridge, ServerConfig } from "@server/context";

const sqlOf = (id: string) => MIGRATIONS.find((m) => m.id === id)!.sql;
const fnSource = async (db: Db) => (await db.one<{ src: string }>(`select prosrc as src from pg_proc where proname = 'sm_sync_touch'`))!.src;

/** A todo written by the system as one transaction: its id, its stored revision and that transaction's id. */
async function writeTodo(cfg: ServerConfig, org: string, text: string): Promise<{ id: string; rev: string; xid: string }> {
  const sys = await systemCtx(cfg, org);
  return sys.write(async (tx) => {
    const row = await createIn(tx, sys, "todo", { short_description: text }, { trusted: true });
    const stored = await tx.one<{ rev: string }>(`select rev::text as rev from sm_todos where id = $1`, [row.id]);
    const xid = await tx.one<{ x: string }>(`select pg_current_xact_id()::text as x`);
    return { id: String(row.id), rev: stored!.rev, xid: xid!.x };
  });
}

describe("the sync trigger function (0099_demo_touch and 0100_xid_revisions together)", () => {
  describe("on the server", () => {
    let db: Db;
    let cfg: ServerConfig;
    let org = "";

    beforeAll(async () => {
      const s = await makeServer({ mode: "cloud" });
      db = s.db;
      cfg = { mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch };
      org = await signupWithOrg(new Client(s.app));
    }, 120_000);

    it("is 0100's definition: the transaction id and the demo scope's outbox rule", async () => {
      const src = await fnSource(db);
      expect(src).toContain("pg_current_xact_id()");
      expect(src).toContain("itsm.demo");
      expect(src).not.toContain("sm_org_sync");
    });

    it("stamps every synced row with the id of the transaction that writes it, without the organisation's counter", async () => {
      const counter = async () => (await db.one<{ rev: string }>(`select rev::text as rev from sm_org_sync where org_id = $1`, [org]))?.rev ?? null;
      const before = await counter();
      const a = await writeTodo(cfg, org, "نوشتن اول");
      expect(a.rev).toBe(a.xid);
      // the record's own history line of that write carries the same id
      const history = await db.query<{ rev: string }>(`select rev::text as rev from sm_history where record_id = $1`, [a.id]);
      for (const h of history) expect(h.rev).toBe(a.xid);
      // another transaction, another id; the counter row is not touched (no organisation-wide lock)
      const b = await writeTodo(cfg, org, "نوشتن دوم");
      expect(b.rev).toBe(b.xid);
      expect(BigInt(b.xid) > BigInt(a.xid)).toBe(true);
      expect(await counter()).toBe(before);
      // nothing is queued for upload on a server
      expect((await db.one<{ n: number }>(`select count(*)::int as n from sm_outbox`))!.n).toBe(0);
    });

    it("stamps demo work too, and its capture still records it", async () => {
      await db.query(`insert into sm_demo_packs (org_id, state) values ($1, 'loaded') on conflict do nothing`, [org]);
      const d = await inDemoScope(org, () => writeTodo(cfg, org, "کار نمایشی"));
      expect(d.rev).toBe(d.xid);
      expect(await db.one(`select 1 from sm_demo_rows where org_id = $1 and row_id = $2`, [org, d.id])).toBeTruthy();
      expect((await db.one<{ n: number }>(`select count(*)::int as n from sm_outbox`))!.n).toBe(0);
    });
  });

  describe("on a Windows app's database", () => {
    let db: Db;
    let cfg: ServerConfig;
    let org = "";
    const outboxed = async (id: string) => !!(await db.one(`select 1 from sm_outbox where id = $1`, [id]));

    beforeAll(async () => {
      const bridge = { notifyLocalWrite() {}, fetchBlob: () => Promise.reject(new Error("no blobs")) } as unknown as DesktopBridge;
      const s = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "desk-secret" } });
      db = s.db;
      cfg = { mode: "desktop", db, secret: "desk-secret", allowSignup: false, platformAdmins: [], origin: "desktop", log: quietLog, fetch, desktop: bridge };
      const local = new Client(s.app, "http://desk.test");
      await local.post("/auth/signup", { email: "trigger@example.com", password: "trigger-pass-1405", full_name: "مدیر محلی" });
      org = (await local.post<{ id: string }>("/orgs", { name: "سازمان رایانهٔ محلی", timezone: "Asia/Tehran" })).id;
    }, 120_000);

    it("has the same definition (0100 runs on a Windows app's database too)", async () => {
      const src = await fnSource(db);
      expect(src).toContain("pg_current_xact_id()");
      expect(src).toContain("itsm.demo");
    });

    it("queues a local write for upload and leaves its revision to the server", async () => {
      const w = await writeTodo(cfg, org, "کار واقعی محلی");
      expect(await outboxed(w.id)).toBe(true);
      expect(w.rev).toBe("0");
      expect(await db.one(`select 1 from sm_outbox where entity = 'org' and id = $1`, [org])).toBeTruthy();
    });

    it("never queues demo work of the organisation, which the capture records", async () => {
      await db.query(`insert into sm_demo_packs (org_id, state) values ($1, 'loaded') on conflict do nothing`, [org]);
      const d = await inDemoScope(org, () => writeTodo(cfg, org, "کار نمایشی محلی"));
      expect(await outboxed(d.id)).toBe(false);
      expect(await db.one(`select 1 from sm_demo_rows where org_id = $1 and row_id = $2`, [org, d.id])).toBeTruthy();
      // the organisation's own row is never demo data (its org_id is still null inside a BEFORE trigger)
      await db.query(`delete from sm_outbox where entity = 'org' and id = $1`, [org]);
      await inDemoScope(org, () => db.query(`update sm_orgs set name = name where id = $1`, [org]));
      expect(await db.one(`select 1 from sm_outbox where entity = 'org' and id = $1`, [org])).toBeTruthy();
    });

    it("queues a write made in another organisation's demo scope (the scope is the row's organisation)", async () => {
      const w = await inDemoScope(uuidv7(), () => writeTodo(cfg, org, "کار واقعی در دامنهٔ دیگر"));
      expect(await outboxed(w.id)).toBe(true);
      expect(await db.one(`select 1 from sm_demo_rows where row_id = $1`, [w.id])).toBeNull();
    });

    it("never queues what a pull applies (itsm.applying), and keeps its time", async () => {
      const w = await writeTodo(cfg, org, "از نسخهٔ وب");
      await db.query(`delete from sm_outbox where id = $1`, [w.id]);
      const at = (await db.one<{ t: string }>(`select updated_at::text as t from sm_todos where id = $1`, [w.id]))!.t;
      await db.tx(async (tx) => {
        await tx.query(`set local itsm.applying = 'on'`);
        await tx.query(`update sm_todos set short_description = 'دریافت‌شده' where id = $1`, [w.id]);
      });
      expect(await outboxed(w.id)).toBe(false);
      expect((await db.one<{ t: string }>(`select updated_at::text as t from sm_todos where id = $1`, [w.id]))!.t).toBe(at);
    });
  });

  it("replaces a 1.1.0-beta database's definition (0099 applied before) when 0100 is applied", async () => {
    const s = await makeServer({ mode: "cloud" });
    const db = s.db;
    const cfg: ServerConfig = { mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch };
    const org = await signupWithOrg(new Client(s.app), { email: "beta@example.com" });
    // the database as a 1.1.0-beta server left it: 0099's function (the organisation's counter), 0100 not applied
    await db.exec(sqlOf("0099_demo_touch"));
    await db.query(`delete from sm_migrations where id = '0100_xid_revisions'`);
    expect(await fnSource(db)).toContain("sm_org_sync");
    const counterNow = async () => Number((await db.one<{ rev: string }>(`select rev::text as rev from sm_org_sync where org_id = $1`, [org]))?.rev ?? 0);
    const first = await counterNow();
    const counted = await writeTodo(cfg, org, "پیش از ارتقا");
    const counter = await counterNow();
    // every synced row of that write took the next value of the counter (the record first, its history lines after)
    expect(counter).toBeGreaterThan(first);
    expect(Number(counted.rev)).toBeGreaterThan(first);
    expect(Number(counted.rev)).toBeLessThanOrEqual(counter);
    expect(counted.rev).not.toBe(counted.xid);
    // the update: migrate() finds 0100 pending (it is not in sm_migrations) and runs it after 0098/0099
    await migrate(db);
    expect(await db.one(`select 1 from sm_migrations where id = '0100_xid_revisions'`)).toBeTruthy();
    const src = await fnSource(db);
    expect(src).toContain("pg_current_xact_id()");
    expect(src).toContain("itsm.demo");
    const stamped = await writeTodo(cfg, org, "پس از ارتقا");
    expect(stamped.rev).toBe(stamped.xid);
    expect(await counterNow()).toBe(counter);
    await db.close();
  }, 120_000);
});

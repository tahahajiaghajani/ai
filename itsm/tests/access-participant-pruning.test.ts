// Participant sources at scale (docs/PERFORMANCE_FA.md §۶): before the engine reads a table for a member, the
// provider asks each `grant` source's `tables()` (one query per source and request) and leaves out of the read rule
// the sources that name none of that table's rows for the member — they would select nothing, and an OR term no index
// answers turns every list into a scan. The rows a member reads stay exactly the rows of the whole rule (SQL == the
// complete predicate), for a member who takes part and for one who does not; the provider never prunes without
// having asked.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TICKET } from "./fixtures/access";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { list } from "@server/engine";
import { readSql, registerParticipantSource, subjectOf } from "@server/access";
import { access } from "@server/access/provider";
import type { Ctx } from "@server/context";

let calls = 0;
const unregister = registerParticipantSource({
  name: "test.followers",
  reach: "grant",
  sql(def, alias, params, userId) {
    if (def.key !== TICKET.key) return null;
    params.push(userId);
    return `${alias}.id in (select f.ticket_id from test_followers f where f.user_id = $${params.length}::uuid)`;
  },
  async tables(q, _orgId, userId) {
    calls++;
    const r = await q.one(`select 1 as x from test_followers where user_id = $1::uuid limit 1`, [userId]);
    return r ? [TICKET.key] : [];
  },
});

describe("participant sources that name no row are left out of the read rule", () => {
  let e: EngineOrg;
  const who = { follower: "", other: "" };
  let followed = "";
  let seen: { sql: string; params: unknown[] }[] = [];

  beforeAll(async () => {
    e = await engineOrg();
    const P = `/o/${e.org}`;
    for (const k of Object.keys(who) as (keyof typeof who)[]) who[k] = (await e.member("member", `prune-${k}@example.com`)).userId;
    await e.owner.put(`${P}/access/settings`, { preset: "need_to_know" });
    for (const id of Object.values(who)) await e.owner.put(`${P}/access/members/${id}`, { roles: ["requester"] });
    await e.db.exec(`create table if not exists test_followers (ticket_id uuid not null, user_id uuid not null)`);
    const t1 = await e.owner.post(`${P}/r/${TICKET.key}`, { short_description: "پیگیری‌شده" });
    await e.owner.post(`${P}/r/${TICKET.key}`, { short_description: "دیگری" });
    followed = t1.row.id;
    await e.db.query(`insert into test_followers (ticket_id, user_id) values ($1, $2)`, [followed, who.follower]);
  });

  afterAll(() => unregister());

  async function spied(userId: string): Promise<Ctx> {
    const real = await e.ctxOf(userId);
    const spy = (fn: (sql: string, params?: unknown[]) => Promise<unknown>) => (sql: string, params?: unknown[]) => {
      seen.push({ sql, params: params ?? [] });
      return fn(sql, params);
    };
    return { ...real, db: { ...real.db, query: spy(real.db.query.bind(real.db)), one: spy(real.db.one.bind(real.db)) } as Ctx["db"] };
  }

  /** The ids the complete rule (no pruning) selects for the member. */
  async function complete(ctx: Ctx): Promise<string[]> {
    const params: unknown[] = [];
    const where = readSql(subjectOf(ctx), TICKET as never, "t", params);
    const rows = await e.db.query<{ id: string }>(`select t.id from ${TICKET.table} t where ${where} and t.deleted_at is null order by t.id`, params);
    return rows.map((r) => r.id);
  }

  it("keeps the source for a member it names, and reads the same rows as the complete rule", async () => {
    seen = [];
    calls = 0;
    const ctx = await spied(who.follower);
    const r = await list(ctx, TICKET.key, { sort: "number" });
    expect(r.rows.map((x) => x.id)).toContain(followed);
    expect(calls).toBe(1);
    const page = seen.find((x) => new RegExp(`from ${TICKET.table} t where`).test(x.sql) && / limit /.test(x.sql))!;
    expect(page.sql).toMatch(/test_followers/);
    expect(r.rows.map((x) => String(x.id)).sort()).toEqual(await complete(ctx));
  });

  it("leaves it out for a member it names nowhere — the same rows, without the term", async () => {
    seen = [];
    calls = 0;
    const ctx = await spied(who.other);
    const r = await list(ctx, TICKET.key, { sort: "number" });
    expect(calls).toBe(1);
    const page = seen.find((x) => new RegExp(`from ${TICKET.table} t where`).test(x.sql) && / limit /.test(x.sql))!;
    expect(page.sql).not.toMatch(/test_followers/);
    expect(r.rows.map((x) => String(x.id)).sort()).toEqual(await complete(ctx));
    expect(r.rows.map((x) => x.id)).not.toContain(followed);
  });

  it("never prunes a read it was not prepared for (the predicate is complete by default)", async () => {
    const ctx = await e.ctxOf(who.other);
    await list(ctx, "todo", { size: 1, total: false }).catch(() => undefined); // loads the subject, prepares another table
    const params: unknown[] = [];
    expect(access().readWhere(ctx, TICKET as never, "t", params)).toMatch(/test_followers/);
  });
});

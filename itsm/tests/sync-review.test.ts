// Regressions of the sync review (docs/spec/ENGINE.md, docs/spec/ACCESS.md §8): a push that lost to a newer cloud copy
// gets that copy back only as a pull would send it to the account (never a record it may not read, never a field it may
// not see); a pushed change is held to what the API lets the account do — a change of state is a transition it may
// take, a requester's own record keeps its system fields, journal entries and history come only in the account's own
// name, and a module's derived access columns (a knowledge article's internal flag and contributors) are the cloud's;
// participant grants that start or end move the members' scope epochs.
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import "./fixtures/rag";
import { world, type World } from "./incident-helpers";
import { kbWorld, type KbWorld } from "./knowledge-helpers";
import type { Client } from "./helpers";
import { create, systemCtx } from "@server/engine";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";

type Result = { entity: string; id: string; status: string; message?: string; aggregate?: { row: Record<string, unknown> } };

async function push(c: Client, org: string, aggregates: { entity: string; id: string; base_rev: number; row: Record<string, unknown> }[]): Promise<Result[]> {
  return (await c.post(`/sync/push`, { org_id: org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates })).results as Result[];
}

/** The stored row as a Windows app would push it back (JSON round trip), newer than the cloud's copy. */
async function wireRow(w: { e: { db: World["e"]["db"] } }, table: string, id: string, patch: Record<string, unknown> = {}) {
  const r = (await w.e.db.one<Record<string, unknown>>(`select * from ${table} where id = $1`, [id]))!;
  const row = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
  return { base_rev: Number(r.rev), row: { ...row, updated_at: new Date(Date.now() + 5_000).toISOString(), ...patch } };
}

const epoch = async (w: World, userId: string) => Number((await w.e.db.one<{ epoch: number }>(`select epoch from sm_scope_epochs where org_id = $1 and user_id = $2`, [w.e.org, userId]))?.epoch ?? 0);

describe("sync review: the incident organisation", () => {
  let w: World;
  beforeAll(async () => {
    w = await world({ preset: "need_to_know" });
  });

  it("a stale push gets back only what a pull would send: nothing of a record the account may not read, no hidden field", async () => {
    // the other requester's incident: unreadable for req2
    const theirs = String((await w.incident({ short_description: "لپ‌تاپ اداری confQs1", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).id);
    expect((await push(w.p.req2.client, w.e.org, [{ entity: "incident", id: theirs, base_rev: 0, row: { updated_at: "2000-01-01T00:00:00.000Z" } }]))[0]).toMatchObject({ status: "skipped" });
    const r = (await push(w.p.req2.client, w.e.org, [{ entity: "incident", id: theirs, base_rev: 0, row: { updated_at: "2000-01-01T00:00:00.000Z" } }]))[0];
    expect(r.aggregate).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("confQs1");
    // the requester's own ticket: the cloud's copy comes back, without the internal diagnosis they may not see
    const sys = await systemCtx(w.e.cfg, w.e.org);
    const own = String((await create(sys, "rag_ticket", { short_description: "چاپگر", diagnosis: "تشخیص داخلی diagQs2", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).row.id);
    const mine = (await push(w.p.req.client, w.e.org, [{ entity: "rag_ticket", id: own, base_rev: 0, row: { updated_at: "2000-01-01T00:00:00.000Z" } }]))[0];
    expect(mine.status).toBe("conflict");
    expect(mine.aggregate?.row.short_description).toBe("چاپگر");
    expect("diagnosis" in (mine.aggregate?.row ?? {})).toBe(false);
    expect(JSON.stringify(mine)).not.toContain("diagQs2");
  });

  it("a pushed change of state is a transition the account may take; a requester's own record keeps its system fields", async () => {
    const id = String((await w.incident({ short_description: "کندی رایانه", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).id);
    const before = (await w.o.get(`${w.P}/r/incident/${id}`)).row;
    // the requester may not move their incident into work
    const jump = await wireRow(w, "sm_incidents", id, { state: "in_progress" });
    const r1 = (await push(w.p.req.client, w.e.org, [{ entity: "incident", id, ...jump }]))[0];
    expect(r1.status).toBe("error");
    expect((await w.o.get(`${w.P}/r/incident/${id}`)).row.state).toBe(before.state);
    // a system field (who opened it) is the cloud's, whatever the push says; the other requester still reads nothing
    const forged = await wireRow(w, "sm_incidents", id, { opened_by: w.p.req2.userId, description: "شرح تازه" });
    const r2 = (await push(w.p.req.client, w.e.org, [{ entity: "incident", id, ...forged }]))[0];
    expect(r2.status).toBe("ok");
    const after = (await w.o.get(`${w.P}/r/incident/${id}`)).row;
    expect(after.description).toBe("شرح تازه"); // a requester field travels
    expect(after.opened_by).toBe(before.opened_by);
    await w.p.req2.client.get(`${w.P}/r/incident/${id}`, 404);
  });

  it("journal entries and history come only in the pushing account's own name", async () => {
    const id = String((await w.incident({ short_description: "قطعی تلفن", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).id);
    await w.p.req.client.post(`${w.P}/r/incident/${id}/journal`, { kind: "comment", body: "پاسخ من" });
    const j = (await w.e.db.one<Record<string, unknown>>(`select * from sm_journal where org_id = $1 and record_id = $2 order by created_at desc limit 1`, [w.e.org, id]))!;
    const entry = (patch: Record<string, unknown>) => {
      const nid = randomUUID();
      return { entity: "journal", id: nid, base_rev: 0, row: { ...JSON.parse(JSON.stringify(j)), id: nid, rev: 0, ...patch } };
    };
    // an approval «by» the desk agent, and a comment in the agent's name: refused
    const forged = await push(w.p.req.client, w.e.org, [
      entry({ kind: "approval", visibility: "public", body: "تأیید شد", author: w.p.agent.userId }),
      entry({ kind: "comment", visibility: "public", body: "پاسخ کارشناس جعلی", author: w.p.agent.userId }),
    ]);
    expect(forged.map((r) => r.status)).toEqual(["error", "error"]);
    // their own comment lands
    expect((await push(w.p.req.client, w.e.org, [entry({ kind: "comment", visibility: "public", body: "پاسخ دوم من", author: w.p.req.userId })]))[0].status).toBe("ok");
    const bodies = ((await w.o.get(`${w.P}/r/incident/${id}/journal`)).entries as { body: string }[]).map((e) => e.body);
    expect(bodies).toContain("پاسخ دوم من");
    expect(bodies).not.toContain("تأیید شد");
    expect(bodies).not.toContain("پاسخ کارشناس جعلی");
    // a history row in someone else's name: refused
    await w.o.patch(`${w.P}/r/incident/${id}`, { description: "شرح دوم" });
    const h = (await w.e.db.one<Record<string, unknown>>(`select * from sm_history where org_id = $1 and record_id = $2 order by at desc limit 1`, [w.e.org, id]))!;
    const hid = randomUUID();
    const hist = await push(w.p.req.client, w.e.org, [{ entity: "history", id: hid, base_rev: 0, row: { ...JSON.parse(JSON.stringify(h)), id: hid, rev: 0, actor: w.p.agent.userId, field: "priority", old: "5", new: "1" } }]);
    expect(hist[0].status).toBe("error");
    expect(await w.e.db.one(`select 1 from sm_history where id = $1`, [hid])).toBeNull();
  });

  it("delegations and service owners that change move the scope epochs of the people they grant", async () => {
    const before = await epoch(w, w.p.other.userId);
    await w.p.agent.client.post(`${w.P}/r/delegation`, { to_user: w.p.other.userId, scopes: ["approvals"] });
    expect(await epoch(w, w.p.other.userId)).toBeGreaterThan(before);
    const svc = (await w.o.post(`${w.P}/r/service`, { name: "خدمت ایمیل", owner_id: w.p.mim.userId })).row;
    const [mim, pm] = [await epoch(w, w.p.mim.userId), await epoch(w, w.p.pm.userId)];
    await w.o.patch(`${w.P}/r/service/${svc.id}`, { owner_id: w.p.pm.userId });
    expect(await epoch(w, w.p.mim.userId)).toBeGreaterThan(mim); // the old owner loses the grant
    expect(await epoch(w, w.p.pm.userId)).toBeGreaterThan(pm); // the new one gains it
  });
});

describe("sync review: a knowledge article's derived access columns", () => {
  let k: KbWorld;
  beforeAll(async () => {
    k = await kbWorld();
  }, 240_000);

  it("are the cloud's computation, never the push's", async () => {
    const { article } = await k.article({ title: "پیش‌نویس داخلی", body: "## گام‌ها\n\n1. یک کار\n" });
    // an article for agents only (its visibility «داخلی»: the internal flag follows it)
    await k.p.km.client.patch(`${k.P}/r/kb_article/${article.id}`, { visibility: "internal" });
    const stored = (await k.e.db.one<{ confidential: boolean; k_users: string[] }>(`select confidential, k_users from sm_kb_articles where id = $1`, [article.id]))!;
    expect(stored.confidential).toBe(true);
    const forged = await wireRow(k as unknown as World, "sm_kb_articles", String(article.id), { confidential: false, k_users: [...(stored.k_users ?? []), k.p.req2.userId], summary: "خلاصهٔ تازه" });
    const r = (await push(k.p.km.client, k.e.org, [{ entity: "kb_article", id: String(article.id), ...forged }]))[0];
    expect(r.status).toBe("ok");
    const now = (await k.e.db.one<{ confidential: boolean; k_users: string[]; summary: string }>(`select confidential, k_users, summary from sm_kb_articles where id = $1`, [article.id]))!;
    expect(now.summary).toBe("خلاصهٔ تازه");
    expect(now.confidential).toBe(true);
    expect(now.k_users ?? []).not.toContain(k.p.req2.userId);
    await k.p.req2.client.get(`${k.P}/r/kb_article/${article.id}`, 404);
  });
});

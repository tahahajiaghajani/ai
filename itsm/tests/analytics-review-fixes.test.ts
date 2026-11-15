// Regressions of the analytics review: organisation-wide stored scores are read only by those a report administrator
// names (an owner only as a report administrator), indicators are checked field by field against their writer, the
// readers of an indicator change without a deadlock and on every stored score, jobs progress under small budgets,
// deliveries never repeat a recipient, the AI tool never computes fields kept from models, trashed definitions are
// gone for readers, total scores are never duplicated, and point-in-time deltas compare like with like.
import { describe, expect, it, beforeAll, vi } from "vitest";
import { analyticsWorld, type AnalyticsWorld } from "./analytics-helpers";
import { enqueue, tick } from "@server/jobs";
import { registerHooks, systemCtx } from "@server/engine";
import { collectIndicator } from "@server/modules/analytics/indicators";
import { stopAt } from "@server/modules/analytics/jobs";
import { toolCatalog } from "@server/modules/ai/tools";
import { definitionActions } from "../src/ui/modules/analytics/model";

// a recipient whose notification fails (the write/notify block of a delivery throws)
const failing = vi.hoisted(() => ({ user: "" }));
vi.mock("@server/modules/notify", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@server/modules/notify")>();
  return {
    ...mod,
    notifyPeople: async (...args: Parameters<typeof mod.notifyPeople>) => {
      if (failing.user && (args[2] as { users?: string[] }).users?.includes(failing.user)) throw new Error("notification channel down");
      return mod.notifyPeople(...args);
    },
  };
});

let w: AnalyticsWorld;
let author: { client: any; userId: string };

const scoresOf = async (who: any, id: string) => (await who.post(`${w.P}/r/analytics_score/query`, { filter: { f: "indicator_id", op: "eq", v: id }, size: 500, total: true })).total as number;
const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`still pending after ${ms} ms`)), ms))]);

beforeAll(async () => {
  w = await analyticsWorld();
  // an author of reports without the financial field group
  await w.o.put(`${w.P}/access/roles/report_author`, { name: "نویسندهٔ گزارش", persona: "agent", grants: { reports: { read: "all", create: true, write: "own" }, change: { read: "all" }, incident: { read: "all" } }, field_groups: [], contains: [], workspaces: "member", domains: "own" });
  author = await w.e.member("member", "author@example.com");
  await w.o.put(`${w.P}/access/members/${author.userId}`, { roles: ["report_author"], persona: "agent" });
}, 180_000);

describe("stored scores are the organisation's (analytics-kpi-owner-reads-orgwide-snapshots)", () => {
  it("a non-administrator's indicator is not collected and its owner reads no organisation-wide scores", async () => {
    const ind = (await w.sdm.client.post(`${w.P}/r/analytics_indicator`, {
      name: "رخدادها با عنوان", key: "sdm.titles", formula: "n", grain: "month", collect: true,
      parts: [{ name: "n", table: "incident", fn: "count", date_field: "opened_at" }], breakdowns: ["short_description"],
    })).row;
    expect(ind.collect).toBe(false);
    expect(ind.s_users ?? []).not.toContain(w.sdm.userId);
    const sys = await systemCtx(w.e.cfg, w.e.org);
    await collectIndicator(sys, (await w.o.get(`${w.P}/r/analytics_indicator/${ind.id}`)).row);
    expect(await scoresOf(w.sdm.client, ind.id)).toBe(0);
    // readers are a report administrator's to name
    await w.sdm.client.post(`${w.P}/r/analytics_indicator`, { name: "x", key: "sdm.readers", formula: "n", parts: [{ name: "n", table: "incident", fn: "count" }], score_shares: [{ kind: "everyone" }] }, 403);
    const fresh = (await w.sdm.client.get(`${w.P}/r/analytics_indicator/${ind.id}`)).row;
    await w.sdm.client.patch(`${w.P}/r/analytics_indicator/${ind.id}`, { collect: true, version: fresh.version }, 403);
  });

  it("every measured, filtered and broken-down field is checked against the writer", async () => {
    const r = await author.client.post(`${w.P}/r/analytics_indicator`, { name: "هزینهٔ تغییرها", key: "author.cost", formula: "c", parts: [{ name: "c", table: "change_request", fn: "sum", field: "planned_cost" }] }, 403);
    expect(JSON.stringify(r)).toContain("planned_cost");
    await author.client.post(`${w.P}/r/analytics_indicator`, { name: "تغییرهای گران", key: "author.costly", formula: "n", parts: [{ name: "n", table: "change_request", fn: "count", filter: { f: "planned_cost", op: "gt", v: 1000 } }] }, 400);
    await author.client.post(`${w.P}/r/analytics_indicator`, { name: "تغییرها به تفکیک هزینه", key: "author.bycost", formula: "n", parts: [{ name: "n", table: "change_request", fn: "count" }], breakdowns: ["planned_cost"] }, 403);
    const ok = (await author.client.post(`${w.P}/r/analytics_indicator`, { name: "تغییرها", key: "author.count", formula: "n", parts: [{ name: "n", table: "change_request", fn: "count" }] })).row;
    expect(ok.key).toBe("author.count");
  });
});

describe("score readers (analytics-score-shares-writable-by-any-editor, analytics-score-readers-change-deadlocks-pglite, analytics-restamp-stale-readers)", () => {
  it("only a report administrator changes an indicator's readers or owner", async () => {
    const lib = ((await w.o.get(`${w.P}/r/analytics_indicator?size=200`)).rows as Record<string, any>[]).find((r) => r.key === "incident.mttr")!;
    expect(lib).toBeTruthy();
    const row = (await w.sdm.client.get(`${w.P}/r/analytics_indicator/${lib.id}`)).row;
    await w.sdm.client.patch(`${w.P}/r/analytics_indicator/${lib.id}`, { score_shares: [{ kind: "everyone" }], version: row.version }, 403);
    await w.sdm.client.patch(`${w.P}/r/analytics_indicator/${lib.id}`, { owner_id: w.sdm.userId, version: row.version }, 403);
    expect((await w.o.get(`${w.P}/r/analytics_indicator/${lib.id}`)).row.s_all).toBe(false);
  });

  it("changing the readers completes (no deadlock) and restamps every stored score, past ten thousand", async () => {
    const ind = (await w.o.post(`${w.P}/r/analytics_indicator`, { name: "حجم رخداد (خوانندگان)", key: "test.readers", formula: "n", grain: "month", parts: [{ name: "n", table: "incident", fn: "count", date_field: "opened_at" }] })).row;
    await w.o.post(`${w.P}/analytics/indicators/${ind.id}/collect`, {});
    const [one] = await w.e.db.query<{ id: string }>(`select id from sm_analytics_scores where org_id = $1 and indicator_id = $2 limit 1`, [w.e.org, ind.id]);
    const cols = (await w.e.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'sm_analytics_scores' and is_generated = 'NEVER' order by ordinal_position`)).map((c) => c.column_name);
    const pick = (c: string) => (c === "id" ? "gen_random_uuid()" : c === "element" ? "'e' || g" : c === "breakdown" ? "'bulk'" : `t.${c}`);
    await w.e.db.query(`insert into sm_analytics_scores (${cols.join(", ")}) select ${cols.map(pick).join(", ")} from sm_analytics_scores t cross join generate_series(1, 10050) g where t.id = $1`, [one.id]);
    const row = (await w.o.get(`${w.P}/r/analytics_indicator/${ind.id}`)).row;
    const up = await withTimeout(w.o.patch(`${w.P}/r/analytics_indicator/${ind.id}`, { score_shares: [{ kind: "user", id: w.p.agent.userId }], version: row.version }), 20_000);
    expect(up.row.s_users).toContain(w.p.agent.userId);
    const stale = await w.e.db.one<{ n: number }>(`select count(*)::int as n from sm_analytics_scores where org_id = $1 and indicator_id = $2 and not (s_users @> $3::jsonb)`, [w.e.org, ind.id, JSON.stringify([w.p.agent.userId])]);
    expect(stale!.n).toBe(0);
  }, 120_000);
});

describe("jobs under small budgets (analytics-jobs-never-progress-small-budget)", () => {
  it("stops halfway through what is left, never before starting", () => {
    const now = 1_000_000;
    expect(stopAt(now + 8_000, now)).toBe(now + 4_000);
    expect(stopAt(now - 5_000, now)).toBe(now + 1_000);
  });

  it("a snapshot and a delivery make progress in a 4-second tick", async () => {
    await w.e.db.query(`update sm_analytics_indicators set collected_at = null where org_id = $1 and collect and active`, [w.e.org]);
    await enqueue(w.e.db, { kind: "analytics.snapshot", orgId: w.e.org, payload: { since: new Date().toISOString() } });
    await tick(w.e.cfg, { budgetMs: 4_000 });
    const collected = await w.e.db.one<{ n: number }>(`select count(*)::int as n from sm_analytics_indicators where org_id = $1 and collected_at is not null`, [w.e.org]);
    expect(collected!.n).toBeGreaterThan(0);
  }, 120_000);
});

describe("deliveries (analytics-delivery-not-idempotent)", () => {
  it("one recipient's failure never repeats the others, and the run finishes", async () => {
    const report = (await w.sdm.client.post(`${w.P}/r/analytics_report`, { name: "رخدادها برای تحویل", spec: { v: 1, table: "incident", measures: [{ fn: "count" }], dims: [], viz: "score" }, shares: [{ kind: "group", id: w.g.desk }, { kind: "group", id: w.g.network }] })).row;
    const s = (await w.sdm.client.post(`${w.P}/r/analytics_schedule`, { name: "تحویل آزمون", report_id: report.id, schedule: { kind: "daily", time: "08:00" }, recipients: [w.p.agent.userId, w.p.other.userId], include_owner: true, channels: ["in_app"], formats: ["summary"], skip_if_empty: false })).row;
    failing.user = w.p.agent.userId;
    try {
      const queued = await w.sdm.client.post(`${w.P}/analytics/schedules/${s.id}/send`, {});
      expect(queued.queued).toBe(true);
      await tick(w.e.cfg, { budgetMs: 30_000 });
      // a retry of whatever is left (the old job failed and came back) sends nobody anything again
      await w.e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'analytics.deliver' and status = 'queued'`, [w.e.org]);
      await tick(w.e.cfg, { budgetMs: 30_000 });
    } finally {
      failing.user = "";
    }
    const rows = await w.e.db.query<{ recipient_id: string; n: number }>(`select recipient_id, count(*)::int as n from sm_analytics_deliveries where org_id = $1 and schedule_id = $2 group by recipient_id`, [w.e.org, s.id]);
    expect(rows.every((r) => r.n === 1)).toBe(true);
    expect(rows.some((r) => r.recipient_id === w.p.other.userId)).toBe(true);
    const after = (await w.sdm.client.get(`${w.P}/r/analytics_schedule/${s.id}`)).row;
    expect(after.last_result).toContain("۱ ناموفق");
  });

  it("an occurrence is delivered once: a twin of a run in progress sends nothing, and the tick queues none (D4 A1-18)", async () => {
    const report = (await w.sdm.client.post(`${w.P}/r/analytics_report`, { name: "رخدادها یک‌بار", spec: { v: 1, table: "incident", measures: [{ fn: "count" }], dims: [], viz: "score" }, shares: [{ kind: "group", id: w.g.desk }, { kind: "group", id: w.g.network }] })).row;
    const s = (await w.sdm.client.post(`${w.P}/r/analytics_schedule`, { name: "تحویل یک‌باره", report_id: report.id, schedule: { kind: "daily", time: "08:00" }, recipients: [w.p.agent.userId, w.p.other.userId], include_owner: true, channels: ["in_app"], formats: ["summary"], skip_if_empty: false })).row;
    await w.drain();
    // the occurrence was due a minute ago; its run (A) is queued, and so is a twin (B) that escaped the dedupe key
    const at = new Date(Date.now() - 60_000).toISOString();
    await w.e.db.query(`update sm_analytics_schedules set next_run_at = $2 where id = $1`, [s.id, at]);
    const key = `analytics.deliver:${s.id}`;
    const a = await enqueue(w.e.db, { kind: "analytics.deliver", orgId: w.e.org, payload: { id: s.id, at }, dedupeKey: key, runAt: new Date(Date.now() - 1_800_000), maxAttempts: 3 });
    const b = await enqueue(w.e.db, { kind: "analytics.deliver", orgId: w.e.org, payload: { id: s.id, at }, runAt: new Date(Date.now() + 3600_000), maxAttempts: 3 });
    const deliveries = async () => w.e.db.query<{ recipient_id: string; n: number }>(`select recipient_id, count(*)::int as n from sm_analytics_deliveries where org_id = $1 and schedule_id = $2 group by recipient_id`, [w.e.org, s.id]);
    // each delivery takes a while: A stops at its budget after the first recipient
    const slow = registerHooks("analytics_delivery", { afterWrite: () => new Promise((r) => setTimeout(r, 1_100)) });
    try {
      await tick(w.e.cfg, { max: 1, budgetMs: 2_000 });
    } finally {
      slow();
    }
    expect((await deliveries()).length).toBe(1);
    // while A runs (on another worker), the tick queues no twin of it — even before A moved the schedule on
    const claimed = await w.e.db.one<{ next_run_at: string }>(`select next_run_at from sm_analytics_schedules where id = $1`, [s.id]);
    await w.e.db.query(`update sm_jobs set status = 'running', locked_until = now() + interval '5 minutes' where id = $1`, [a]);
    await w.e.db.query(`update sm_analytics_schedules set next_run_at = $2 where id = $1`, [s.id, at]);
    await enqueue(w.e.db, { kind: "analytics.tick", orgId: w.e.org, runAt: new Date(Date.now() - 3600_000), maxAttempts: 3 });
    await tick(w.e.cfg, { max: 1, budgetMs: 10_000 });
    const twins = await w.e.db.query(`select id from sm_jobs where org_id = $1 and dedupe_key = $2 and status = 'queued'`, [w.e.org, key]);
    expect(twins).toEqual([]);
    await w.e.db.query(`update sm_analytics_schedules set next_run_at = $2 where id = $1`, [s.id, claimed?.next_run_at ?? null]);
    await w.e.db.query(`update sm_jobs set status = 'queued', locked_until = null, run_at = now() where id = $1`, [a]);
    // the twin runs before A goes on: the occurrence is A's, it sends nobody anything; then A finishes
    await w.e.db.query(`update sm_jobs set run_at = now() - interval '1 hour' where id = $1`, [b]);
    await tick(w.e.cfg, { max: 1, budgetMs: 10_000 });
    await w.drain();
    const rows = await deliveries();
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.n === 1)).toBe(true);
  }, 120_000);
});

describe("models never get kept fields (analytics-ai-tool-bypasses-prompt-field-rules)", () => {
  it("the report tool refuses to group request answers", async () => {
    const ctx = await w.e.ctxOf(w.e.ownerId);
    const tool = (await toolCatalog(ctx, { proposals: false })).registered.find((t) => t.name === "analytics_report")!;
    const res = await tool.run(ctx, { table: "request_answer", measure: "count", group_by: [{ field: "value_text" }] }, { log: () => undefined } as never);
    expect((res.data as Record<string, unknown>).allowed).toBe(false);
    expect(JSON.stringify(res.data)).not.toContain("groups");
  });
});

describe("the recycle bin (analytics-trashed-dashboard-still-served, analytics-trash-action-for-readers)", () => {
  it("a trashed dashboard and report are gone for readers, kept for their owner", async () => {
    const dash = (await w.sdm.client.post(`${w.P}/r/analytics_dashboard`, { name: "داشبورد مشترک", layout: { widgets: [{ id: "a", kind: "text", text: "سلام", x: 0, y: 0, w: 4, h: 2 }] }, filters: [], shares: [{ kind: "group", id: w.g.desk }] })).row;
    const report = (await w.sdm.client.post(`${w.P}/r/analytics_report`, { name: "گزارش مشترک", spec: { v: 1, table: "incident", measures: [{ fn: "count" }], dims: [], viz: "score" }, shares: [{ kind: "group", id: w.g.desk }] })).row;
    await w.p.agent.client.get(`${w.P}/analytics/dashboards/${dash.id}`);
    await w.sdm.client.patch(`${w.P}/r/analytics_dashboard/${dash.id}`, { trashed: true, version: dash.version });
    await w.sdm.client.patch(`${w.P}/r/analytics_report/${report.id}`, { trashed: true, version: report.version });
    await w.p.agent.client.get(`${w.P}/analytics/dashboards/${dash.id}`, 404);
    await w.p.agent.client.post(`${w.P}/analytics/dashboards/${dash.id}/widgets/a`, {}, 404);
    await w.p.agent.client.post(`${w.P}/analytics/reports/${report.id}/run`, {}, 404);
    await w.sdm.client.get(`${w.P}/analytics/dashboards/${dash.id}`);
    // the library offers the recycle bin only to those who may change the definition
    expect(definitionActions("all", { canEdit: false, canAuthor: false })).not.toContain("trash");
    expect(definitionActions("trash", { canEdit: false, canAuthor: true })).toEqual([]);
    expect(definitionActions("trash", { canEdit: true, canAuthor: true })).toEqual(["restore"]);
    const { DEFINITION_WRITE } = await import("@shared/tables/analytics");
    const editable = await w.p.agent.client.post(`${w.P}/r/analytics_dashboard/query`, { filter: { and: [{ f: "trashed", op: "eq", v: false }, DEFINITION_WRITE] }, size: 50, total: true });
    expect(editable.total).toBe(0);
  });
});

describe("collections at once (analytics-score-total-duplicates)", () => {
  it("two collectors store one total per period", async () => {
    const ind = (await w.o.post(`${w.P}/r/analytics_indicator`, { name: "حجم همزمان", key: "test.concurrent", formula: "n", grain: "month", parts: [{ name: "n", table: "incident", fn: "count", date_field: "opened_at" }] })).row;
    const sys = await systemCtx(w.e.cfg, w.e.org);
    const row = (await w.o.get(`${w.P}/r/analytics_indicator/${ind.id}`)).row;
    await Promise.all([collectIndicator(sys, row), collectIndicator(sys, row), collectIndicator(sys, row)]);
    const dup = await w.e.db.query<{ period_key: string; n: number }>(`select period_key, count(*)::int as n from sm_analytics_scores where org_id = $1 and indicator_id = $2 and breakdown is null and element is null group by period_key having count(*) > 1`, [w.e.org, ind.id]);
    expect(dup).toEqual([]);
  });
});

describe("point-in-time deltas (analytics-pointintime-delta-mixes-scopes)", () => {
  it("a reader whose live scope is smaller compares the stored numbers, never live against stored", async () => {
    const ind = (await w.o.post(`${w.P}/r/analytics_indicator`, {
      name: "رخدادهای باز (آزمون)", key: "test.open_now", formula: "n", grain: "month",
      parts: [{ name: "n", table: "incident", fn: "count", filter: { f: "active", op: "eq", v: true } }], score_shares: [{ kind: "group", id: w.g.network }],
    })).row;
    const sys = await systemCtx(w.e.cfg, w.e.org);
    const row = (await w.o.get(`${w.P}/r/analytics_indicator/${ind.id}`)).row;
    await collectIndicator(sys, row, { now: Date.now() - 40 * 86_400_000 });
    await collectIndicator(sys, row);
    const card = (await w.p.other.client.get(`${w.P}/analytics/scorecard?ids=${ind.id}`)).items as Record<string, any>[];
    const item = card.find((i) => i.id === ind.id)!;
    expect(item.previous.value).toBeGreaterThan(item.current.value);
    expect(item.delta).toBe(0);
  });
});

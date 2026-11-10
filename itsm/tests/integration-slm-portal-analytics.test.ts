// Service level management, workforce and analytics with the portal and event modules (after the SLM merge):
//   · XLA reads the portal's survey answers — answering a record's survey rescores that record's experience;
//   · experience scores stay in the record's workspace and are never kept for confidential records;
//   · a KPI broken down by person (an assignee, a paged on-call person…) stores that person's figures for them and
//     their managers only, whoever reads the indicator's other scores — and follows a change of manager;
//   · working shifts (workforce) and on-call rotations (event) are separate: no table of one module duplicates the other.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TABLES } from "@shared/tables";
import { scoreRecordIn } from "@server/modules/slm/xla";
import { portalWorld, type PortalWorld } from "./portal-helpers";

vi.setConfig({ testTimeout: 180_000 });

let w: PortalWorld;

beforeAll(async () => {
  w = await portalWorld();
  await w.o.post(`${w.P}/slm/seed`, {});
  await w.o.post(`${w.P}/workforce/seed`, {});
  await w.o.post(`${w.P}/analytics/seed`, { force: true });
  await w.drain();
}, 300_000);

const scoreOf = async (table: string, id: string) =>
  (await w.e.db.query<{ score: number; survey: boolean; workspace_id: string | null }>(`select score, survey, workspace_id from sm_slm_xla_scores where org_id = $1 and table_key = $2 and record_id = $3 and deleted_at is null`, [w.e.org, table, id]))[0] ?? null;

describe("XLA ↔ the portal's surveys", () => {
  it("rescores a resolved incident when its requester answers the survey", async () => {
    const policies = (await w.o.get(`${w.P}/r/slm_xla_policy?size=50`)).rows as { table_key: string }[];
    expect(policies.some((p) => p.table_key === "incident")).toBe(true);
    const inc = await w.incident(w.p.req.client, { short_description: "ایمیل باز نمی‌شود" });
    await w.o.post(`${w.P}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "تنظیمات اصلاح شد" } });
    await w.drain();
    const before = await scoreOf("incident", inc.id);
    expect(before?.survey ?? false).toBe(false);
    const todo = await w.p.req.client.get(`${w.P}/portal/todo`);
    const invitation = (todo.surveys as { id: string }[])[0].id;
    const view = await w.p.req.client.get(`${w.P}/portal/surveys/${invitation}`);
    const rating = (view.questions as { id: string; metric: string }[]).find((q) => q.metric === "csat")!;
    await w.p.req.client.post(`${w.P}/portal/surveys/${invitation}`, { answers: { [rating.id]: 1 } });
    // the rescoring job waits a little after the answer (deduplicated); run it now
    await w.e.db.query(`update sm_jobs set run_at = now() where kind = 'slm.xla'`).catch(() => undefined);
    await w.drain();
    const after = await scoreOf("incident", inc.id);
    expect(after?.survey).toBe(true);
    if (before) expect(after!.score).toBeLessThanOrEqual(before.score);
  });

  it("keeps no score for a confidential record", async () => {
    const inc = await w.incident(w.p.req.client, { short_description: "موضوع محرمانه" });
    await w.o.post(`${w.P}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "حل شد" } });
    await w.sys.write((tx) => scoreRecordIn(tx, w.sys, "incident", inc.id));
    expect(await scoreOf("incident", inc.id)).not.toBeNull();
    // the record becomes confidential: its next scoring removes the row
    await w.e.db.query(`update sm_incidents set confidential = true where id = $1`, [inc.id]);
    await w.sys.write((tx) => scoreRecordIn(tx, w.sys, "incident", inc.id));
    expect(await scoreOf("incident", inc.id)).toBeNull();
  });
});

describe("module KPIs as analytics indicators", () => {
  it("SLM and workforce seed theirs now that the analytics tables exist", async () => {
    const keys = (await w.e.db.query<{ key: string }>(`select key from sm_analytics_indicators where org_id = $1 and deleted_at is null`, [w.e.org])).map((r) => r.key);
    for (const k of ["slm.attainment", "slm.xla_score", "workforce.kudos", "workforce.absence_days"]) expect(keys, k).toContain(k);
  });
});

describe("personal KPI scores", () => {
  it("are read by the person and their managers only, and follow a change of manager", async () => {
    // two incidents assigned to the agent, one to nobody
    for (const i of [1, 2]) {
      const inc = await w.incident(w.p.req.client, { short_description: `کار ${i}` });
      await w.o.patch(`${w.P}/r/incident/${inc.id}`, { assigned_to: w.p.agent.userId, assignment_group_id: w.g.desk, version: (await w.o.get(`${w.P}/r/incident/${inc.id}`)).row.version });
    }
    const ind = (await w.o.post(`${w.P}/r/analytics_indicator`, {
      key: "test.resolved_by_agent", name: "رخدادها به تفکیک کارشناس", practice: "other", unit: "count", direction: "up", grain: "month",
      formula: "n", parts: [{ name: "n", table: "incident", fn: "count", date_field: "created_at" }], breakdowns: ["assigned_to"],
      score_shares: [{ kind: "role", id: "service_desk_manager", right: "view" }, { kind: "role", id: "tenant_admin", right: "view" }], collect: true, active: true,
    })).row;
    await w.o.post(`${w.P}/analytics/indicators/${ind.id}/collect`, {});
    await w.drain();
    const rowsOf = async (c: typeof w.o) => ((await c.get(`${w.P}/r/analytics_score?size=500&filter=${encodeURIComponent(JSON.stringify({ f: "indicator_id", op: "eq", v: ind.id }))}`)).rows as { breakdown: string | null; element: string | null }[]);
    const personal = (rows: { breakdown: string | null; element: string | null }[]) => rows.filter((r) => r.breakdown === "assigned_to" && r.element === w.p.agent.userId);
    // stored: the agent's own row exists
    const stored = await w.e.db.query<{ n: number }>(`select count(*)::int as n from sm_analytics_scores where org_id = $1 and indicator_id = $2 and breakdown = 'assigned_to' and element = $3`, [w.e.org, ind.id, w.p.agent.userId]);
    expect(stored[0].n).toBeGreaterThan(0);
    // the agent's own figures name the agent as their reader (and no group, nobody else); the desk manager (not their
    // manager) and the tenant administrator read the indicator's totals but not the agent's personal row
    const readers = await w.e.db.query<{ s_users: string[]; s_groups: string[]; s_all: boolean }>(`select s_users, s_groups, s_all from sm_analytics_scores where org_id = $1 and indicator_id = $2 and breakdown = 'assigned_to' and element = $3`, [w.e.org, ind.id, w.p.agent.userId]);
    for (const r of readers) expect([r.s_users, r.s_groups ?? [], r.s_all], JSON.stringify(r)).toEqual([[w.p.agent.userId], [], false]);
    const sdm = await rowsOf(w.p.sdm.client);
    expect(sdm.some((r) => !r.breakdown)).toBe(true);
    expect(personal(sdm)).toHaveLength(0);
    expect(personal(await rowsOf(w.o))).toHaveLength(0);
    // the desk manager becomes the agent's manager: the personal rows follow
    await w.o.put(`${w.P}/access/members/${w.p.agent.userId}`, { roles: ["agent"], persona: "agent", manager_id: w.p.sdm.userId });
    await w.drain();
    expect((await w.e.db.query<{ manager_id: string }>(`select manager_id from sm_member_profiles where org_id = $1 and user_id = $2`, [w.e.org, w.p.agent.userId]))[0]?.manager_id).toBe(w.p.sdm.userId);
    // the recomputation queued by the profile change (run now rather than after its short delay)
    await w.e.db.query(`update sm_jobs set run_at = now() where kind = 'analytics.shares' and status = 'queued'`).catch(() => undefined);
    await w.drain();
    expect(personal(await rowsOf(w.p.sdm.client)).length).toBeGreaterThan(0);
    expect(personal(await rowsOf(w.o))).toHaveLength(0);
  });
});

describe("working shifts and on-call rotations", () => {
  it("live in their own modules, with no duplicate tables", () => {
    const keys = [...TABLES.keys()];
    const oncall = keys.filter((k) => /oncall|on_call|escalation_policy|^page$/.test(k));
    for (const k of oncall) expect(TABLES.get(k)!.module, k).toBe("event");
    const wfm = keys.filter((k) => TABLES.get(k)!.module === "workforce");
    expect(wfm.some((k) => /oncall|on_call|page|escalat/.test(k))).toBe(false);
    expect(wfm).toContain("wfm_roster");
  });
});

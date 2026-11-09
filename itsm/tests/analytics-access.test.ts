// Access in analytics — the hard part. Under «نیاز به دانستن»: every aggregate is computed with the VIEWER's own access
// (a report counts exactly what its viewer could list; a shared dashboard shows each viewer only their rows), field
// groups hide restricted measures, definitions are private until shared, and stored snapshots of org-wide indicators
// are read only by the roles the indicator names. Checked with a requester, an agent of another group and an auditor.
import { describe, it, expect, beforeAll } from "vitest";
import { analyticsWorld, type AnalyticsWorld } from "./analytics-helpers";

let w: AnalyticsWorld;
let desk: Record<string, any>;
beforeAll(async () => {
  w = await analyticsWorld();
  desk = (await w.o.get(`${w.P}/r/analytics_dashboard?size=20`)).rows.find((d: any) => d.library_key === "service_desk");
});

describe("a requester", () => {
  it("has no reports area: no meta, no runs, no dashboards, no scorecard", async () => {
    const c = w.p.req.client;
    await c.get(`${w.P}/analytics/meta`, 403);
    await w.run(c, { table: "incident" }, 403);
    await c.get(`${w.P}/analytics/scorecard`, 403);
    await c.get(`${w.P}/analytics/dashboards/${desk.id}`, 403);
    await c.post(`${w.P}/analytics/ask`, { question: "تعداد رخدادها" }, 403);
    await c.get(`${w.P}/r/analytics_dashboard`, 403);
  });
});

describe("aggregates run as the viewer", () => {
  it("count exactly what each viewer could list (agent, an agent of another group, auditor)", async () => {
    for (const who of [w.p.agent, w.p.other, w.p.auditor, w.sdm, w.o as any]) {
      const c = who.client ?? who;
      const r = await w.run(c, { table: "incident", dims: [{ field: "priority" }], viz: "column" });
      expect(r.total_n).toBe(await w.listed(c));
      // each group matches the list filtered the same way
      for (const row of r.rows) {
        const n = await w.listed(c, "incident", row.keys[0] === null ? { f: "priority", op: "empty" } : { f: "priority", op: "eq", v: row.keys[0] });
        expect(row.n).toBe(n);
      }
    }
    const other = await w.run(w.p.other.client, { table: "incident" });
    const agent = await w.run(w.p.agent.client, { table: "incident" });
    const auditor = await w.run(w.p.auditor.client, { table: "incident" });
    expect(other.total_n).toBe(2);
    expect(agent.total_n).toBeGreaterThanOrEqual(3);
    expect(auditor.total_n).toBe(6);
  });

  it("dot-walks and filters never reach past the viewer's access", async () => {
    const r = await w.run(w.p.other.client, { table: "incident", filter: { f: "assignment_group_id", op: "eq", v: w.g.desk } });
    expect(r.total_n).toBe(0);
    const g = await w.run(w.p.other.client, { table: "incident", dims: [{ field: "assignment_group_id" }], viz: "bar" });
    expect(g.rows.map((x: any) => x.keys[0])).toEqual([w.g.network]);
  });

  it("field groups hide restricted measures: an agent cannot sum planned costs, the auditor can", async () => {
    const spec = { table: "change_request", measures: [{ fn: "sum", field: "planned_cost" }] };
    const denied = await w.run(w.p.agent.client, spec, 403);
    expect(JSON.stringify(denied)).toContain("planned_cost");
    await w.run(w.p.agent.client, { table: "change_request", dims: [{ field: "planned_cost", ranges: [1000] }], viz: "column" }, 403);
    await w.run(w.p.auditor.client, spec, 200);
  });
});

describe("a shared dashboard shows each viewer only their rows", () => {
  it("opens for the roles it is shared with and computes every widget as the viewer", async () => {
    expect(desk).toBeTruthy();
    const counts: Record<string, number> = {};
    for (const [name, c] of [["agent", w.p.agent.client], ["other", w.p.other.client], ["auditor", w.p.auditor.client]] as const) {
      const v = await c.get(`${w.P}/analytics/dashboards/${desk.id}`);
      expect(v.can_edit).toBe(false);
      const run = await c.post(`${w.P}/analytics/dashboards/${desk.id}/widgets/open_priority`, {});
      expect(run.kind).toBe("report");
      counts[name] = run.result.total_n;
      expect(run.result.total_n).toBe(await w.listed(c, "incident", { f: "active", op: "eq", v: true }));
    }
    expect(counts.other).toBe(2);
    expect(counts.auditor).toBeGreaterThan(counts.other);
    // the dashboard's controls narrow every widget, still as the viewer
    const narrowed = await w.p.auditor.client.post(`${w.P}/analytics/dashboards/${desk.id}/widgets/open_priority`, { values: { group: [w.g.network] } });
    expect(narrowed.result.total_n).toBe(2);
    expect(narrowed.applied).toContain("group");
  });

  it("opens for someone given a shared role later (role holders recomputed after access changes)", async () => {
    const late = await w.e.member("member", "late-agent@example.com");
    await w.o.put(`${w.P}/access/members/${late.userId}`, { roles: ["agent"], persona: "agent" });
    await w.drain();
    // the recomputation waits a few seconds to absorb bursts of access changes: run it now
    const queued = await w.e.db.one<{ n: number }>(`select count(*)::int as n from sm_jobs where org_id = $1 and kind = 'analytics.shares' and status = 'queued'`, [w.e.org]);
    expect(queued!.n).toBe(1);
    await w.e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'analytics.shares' and status = 'queued'`, [w.e.org]);
    await w.drain();
    const v = await late.client.get(`${w.P}/analytics/dashboards/${desk.id}`);
    expect(v.name).toBe("داشبورد میز خدمت");
  });

  it("is the home dashboard of those who read it", async () => {
    const h = await w.p.other.client.get(`${w.P}/analytics/home`);
    expect(h.dashboard?.id).toBe(desk.id);
    expect(h.reason).toBe("everyone");
  });

  it("can be curated only by its editors (the service-desk manager), not by readers", async () => {
    const v = await w.sdm.client.get(`${w.P}/analytics/dashboards/${desk.id}`);
    expect(v.can_edit).toBe(true);
    const row = (await w.p.agent.client.get(`${w.P}/r/analytics_dashboard/${desk.id}`)).row;
    await w.p.agent.client.patch(`${w.P}/r/analytics_dashboard/${desk.id}`, { name: "تغییر نام", version: row.version }, 403);
  });
});

describe("definitions are private until shared", () => {
  let report: Record<string, any>;
  it("an agent reads reports but does not create them; a manager's new report is private", async () => {
    await w.p.agent.client.post(`${w.P}/r/analytics_report`, { name: "گزارش من", spec: { v: 1, table: "incident", measures: [{ fn: "count" }], dims: [], viz: "score" } }, 403);
    report = (await w.sdm.client.post(`${w.P}/r/analytics_report`, { name: "رخدادهای گروه‌ها", spec: { v: 1, table: "incident", measures: [{ fn: "count" }], dims: [{ field: "assignment_group_id" }], viz: "bar" } })).row;
    expect(report.number).toMatch(/^RPT/);
    for (const c of [w.p.agent.client, w.p.other.client, w.p.auditor.client]) await c.get(`${w.P}/r/analytics_report/${report.id}`, 404);
    await w.p.other.client.post(`${w.P}/analytics/reports/${report.id}/run`, {}, 404);
  });

  it("sharing with a group or a role shares the definition, never the data", async () => {
    const row = (await w.sdm.client.get(`${w.P}/r/analytics_report/${report.id}`)).row;
    await w.sdm.client.patch(`${w.P}/r/analytics_report/${report.id}`, { shares: [{ kind: "group", id: w.g.network, right: "view" }, { kind: "role", id: "auditor" }], version: row.version });
    const mine = await w.sdm.client.post(`${w.P}/analytics/reports/${report.id}/run`, {});
    const theirs = await w.p.other.client.post(`${w.P}/analytics/reports/${report.id}/run`, {});
    expect(theirs.total_n).toBe(2);
    expect(mine.total_n).toBeGreaterThan(theirs.total_n);
    await w.p.auditor.client.get(`${w.P}/r/analytics_report/${report.id}`);
    await w.p.agent.client.get(`${w.P}/r/analytics_report/${report.id}`, 404);
    // the compiled columns are the module's own: nobody sets them by hand
    const again = (await w.sdm.client.get(`${w.P}/r/analytics_report/${report.id}`)).row;
    await w.sdm.client.patch(`${w.P}/r/analytics_report/${report.id}`, { r_all: true, version: again.version });
    await w.p.agent.client.get(`${w.P}/r/analytics_report/${report.id}`, 404);
  });

  it("only the owner (or a report administrator) changes the sharing; readers cannot", async () => {
    const row = (await w.p.other.client.get(`${w.P}/r/analytics_report/${report.id}`)).row;
    await w.p.other.client.patch(`${w.P}/r/analytics_report/${report.id}`, { shares: [{ kind: "everyone" }], version: row.version }, 403);
  });
});

describe("stored snapshots of org-wide indicators", () => {
  beforeAll(async () => {
    await w.o.post(`${w.P}/analytics/collect`, {});
  });

  it("are read only by the roles the indicator grants", async () => {
    const all = await w.o.get(`${w.P}/r/analytics_score?size=200`);
    expect(all.rows.length).toBeGreaterThan(0);
    for (const c of [w.p.agent.client, w.p.other.client, w.p.auditor.client]) expect((await c.get(`${w.P}/r/analytics_score?size=50`)).rows).toEqual([]);
    const mim = await w.p.mim.client.get(`${w.P}/r/analytics_score?size=200`);
    expect(mim.rows.length).toBeGreaterThan(0);
    // the service-desk manager reads every incident score (a role the incident indicators name), the owner more
    const incidentScores = { f: "indicator_key", op: "starts", v: "incident." };
    const ownerInc = await w.o.post(`${w.P}/r/analytics_score/query`, { filter: incidentScores, size: 1, total: true });
    const sdmInc = await w.sdm.client.post(`${w.P}/r/analytics_score/query`, { filter: incidentScores, size: 1, total: true });
    expect(sdmInc.total).toBe(ownerInc.total);
    expect(sdmInc.total).toBeGreaterThan(0);
  });

  it("the scorecard shows live values as the viewer, and stored series only to score readers", async () => {
    const pick = (r: any) => r.items.find((i: any) => i.key === "incident.backlog");
    const other = pick(await w.p.other.client.get(`${w.P}/analytics/scorecard?practice=incident`));
    const mim = pick(await w.p.mim.client.get(`${w.P}/analytics/scorecard?practice=incident`));
    expect(other.current.value).toBe(await w.listed(w.p.other.client, "incident", { f: "active", op: "eq", v: true }));
    expect(other.stored).toBeNull();
    expect(Array.isArray(mim.stored)).toBe(true);
    expect(mim.current.value).toBeGreaterThan(other.current.value);
    const hub = await w.p.auditor.client.get(`${w.P}/analytics/indicators/${other.id}/hub`);
    expect(hub.history).toBeNull();
    expect(hub.narrative.text).toContain("رخدادهای باز");
  });

  it("nobody but the system writes scores or deliveries", async () => {
    const ind = (await w.o.get(`${w.P}/r/analytics_indicator?size=1`)).rows[0];
    await w.o.post(`${w.P}/r/analytics_score`, { indicator_id: ind.id, period_key: "x", value: "1" }, 403);
    await w.o.post(`${w.P}/r/analytics_delivery`, { title: "x", recipient_id: w.e.ownerId }, 403);
  });
});

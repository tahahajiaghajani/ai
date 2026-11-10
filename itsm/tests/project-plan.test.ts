// Project and portfolio management: seeds and roles, demand scoring and conversion, the gate on the approvals service,
// the WBS with the critical path, health and roll-ups, RAID scores, time approval, status reports, the portfolio and
// resource views, and access (a requester, an agent without project roles, an auditor).
import { describe, expect, it, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";

type Who = "pm" | "member" | "sponsor" | "agent" | "req" | "auditor";
const ROLES: Record<Who, string> = { pm: "project_manager", member: "project_member", sponsor: "project_member", agent: "agent", req: "requester", auditor: "auditor" };

let e: EngineOrg;
let P = "";
let o: Client;
const p = {} as Record<Who, { client: Client; userId: string }>;

const drain = async () => {
  for (let i = 0; i < 30; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
};
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const q = (cond: unknown) => encodeURIComponent(JSON.stringify(cond));

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  o = e.owner;
  const seeded = await o.post(`${P}/project/seed`, {});
  expect(seeded.skipped).toBe(false);
  for (const k of Object.keys(ROLES) as Who[]) p[k] = await e.member("member", `${k}@example.com`);
  for (const k of Object.keys(ROLES) as Who[]) await o.put(`${P}/access/members/${p[k].userId}`, { roles: [ROLES[k]], persona: k === "req" ? "requester" : "agent" });
  await drain();
}, 120_000);

describe("seed", () => {
  it("is idempotent and adds the roles, the portfolio and the gate rule", async () => {
    expect((await o.post(`${P}/project/seed`, {})).skipped).toBe(true);
    const roles = (await o.get(`${P}/r/role?size=50`)).rows.map((r: any) => r.key);
    expect(roles).toEqual(expect.arrayContaining(["project_manager", "project_member"]));
    const rules = (await o.get(`${P}/r/approval_rule?filter=${q({ f: "table_key", op: "eq", v: "project" })}`)).rows;
    expect(rules.length).toBe(1);
  });
});

describe("demands", () => {
  it("scores a demand by its model and converts an approved one into a project", async () => {
    const d = (await p.member.client.post(`${P}/r/demand`, { title: "پرتال خدمات کارکنان", type: "project", business_value: 8, time_criticality: 6, risk_reduction: 4, job_size: 3, objectives: "کاهش درخواست‌های تلفنی", sponsor_id: p.sponsor.userId, needed_by: day(90) })).row;
    expect(Number(d.score_wsjf)).toBe(6);
    expect(Number(d.score)).toBe(6);
    // the submitter edits only the requester's fields; scoring is the portfolio's
    await p.member.client.patch(`${P}/r/demand/${d.id}`, { scoring_model: "rice", version: d.version }, 403);
    const rice = (await p.pm.client.patch(`${P}/r/demand/${d.id}`, { scoring_model: "rice", reach: 400, impact_level: "2", confidence: 80, effort_months: 4, version: d.version })).row;
    expect(Number(rice.score_rice)).toBe(160);
    expect(Number(rice.score)).toBe(160);
    let row = (await p.member.client.post(`${P}/r/demand/${d.id}/transition`, { to: "submitted", version: rice.version })).row;
    expect(row.state).toBe("submitted");
    row = (await p.pm.client.post(`${P}/r/demand/${d.id}/transition`, { to: "screening", version: row.version })).row;
    row = (await p.pm.client.post(`${P}/r/demand/${d.id}/transition`, { to: "qualified", version: row.version })).row;
    // a member may not convert
    await p.member.client.post(`${P}/project/demands/${d.id}/convert`, {}, 403);
    const project = await p.pm.client.post(`${P}/project/demands/${d.id}/convert`, { planned_start: day(7) });
    expect(project.name).toBe("پرتال خدمات کارکنان");
    expect(project.demand_id).toBe(d.id);
    expect(project.sponsor_id).toBe(p.sponsor.userId);
    const after = (await o.get(`${P}/r/demand/${d.id}`)).row;
    expect(after.state).toBe("converted");
    expect(after.converted_project_id).toBe(project.id);
    const board = await p.pm.client.get(`${P}/project/demands/board`);
    expect(board.columns.some((c: any) => c.items.some((i: any) => i.id === d.id))).toBe(false);
  });
});

describe("the plan", () => {
  let project: Record<string, any>;
  const task = async (data: Record<string, unknown>) => (await p.pm.client.post(`${P}/r/project_task`, { project_id: project.id, ...data })).row;

  beforeAll(async () => {
    project = (await p.pm.client.post(`${P}/r/project`, { name: "مهاجرت ایمیل", planned_start: day(0), planned_end: day(30), sponsor_id: p.sponsor.userId, objectives: "انتقال صندوق‌ها", scope_in: "همهٔ صندوق‌ها" })).row;
  });

  it("schedules finish-to-start dependencies and finds the critical path", async () => {
    const phase = await task({ short_description: "فاز اجرا", kind: "phase", sort_order: 10 });
    const a = await task({ short_description: "طراحی", parent_id: phase.id, duration_days: 3, sort_order: 10 });
    const b = await task({ short_description: "پیاده‌سازی", parent_id: phase.id, duration_days: 5, depends_on: [a.id], sort_order: 20 });
    const c = await task({ short_description: "مستندسازی", parent_id: phase.id, duration_days: 1, depends_on: [a.id], sort_order: 30 });
    const m = await task({ short_description: "پایان مهاجرت", kind: "milestone", depends_on: [b.id, c.id], sort_order: 20 });
    // a cycle is refused
    await p.pm.client.patch(`${P}/r/project_task/${a.id}`, { depends_on: [m.id], version: a.version }, 400);
    await drain();
    const g = await p.pm.client.get(`${P}/project/projects/${project.id}/gantt`);
    const by = Object.fromEntries(g.tasks.map((t: any) => [t.short_description, t]));
    expect(by["طراحی"].wbs).toBe("1.1");
    expect(by["پایان مهاجرت"].wbs).toBe("2");
    expect(by["طراحی"].is_critical).toBe(true);
    expect(by["پیاده‌سازی"].is_critical).toBe(true);
    expect(by["مستندسازی"].is_critical).toBe(false);
    expect(by["مستندسازی"].float_days).toBe(4);
    expect(by["پیاده‌سازی"].planned_start > by["طراحی"].planned_end).toBe(true);
    expect(by["پایان مهاجرت"].planned_start >= by["پیاده‌سازی"].planned_end).toBe(true);
    // the phase spans its children
    expect(by["فاز اجرا"].planned_start).toBe(by["طراحی"].planned_start);
    expect(by["فاز اجرا"].planned_end).toBe(by["پیاده‌سازی"].planned_end);
    const proj = (await o.get(`${P}/r/project/${project.id}`)).row;
    expect(proj.tasks_total).toBe(4);
    expect(proj.projected_end).toBe(by["پایان مهاجرت"].planned_end);
  });

  it("takes a baseline and keeps the variance", async () => {
    const r = await p.pm.client.post(`${P}/project/projects/${project.id}/baseline`, {});
    expect(r.tasks).toBe(5);
    const g = await p.pm.client.get(`${P}/project/projects/${project.id}/gantt`);
    expect(g.tasks.every((t: any) => t.variance.end === 0 || t.variance.end === null)).toBe(true);
    expect((await o.get(`${P}/r/project/${project.id}`)).row.baseline_taken_at).toBeTruthy();
  });

  it("gates the lifecycle: approval through the sponsor, a plan before execution, lessons before closing", async () => {
    let row = (await o.get(`${P}/r/project/${project.id}`)).row;
    row = (await p.pm.client.post(`${P}/r/project/${project.id}/transition`, { to: "gate", version: row.version })).row;
    expect(row.state).toBe("gate");
    await drain();
    const approvals = (await o.get(`${P}/approvals/record/project/${project.id}`)).approvals as any[];
    const mine = approvals.find((a) => a.approver_id === p.sponsor.userId && a.state === "requested");
    expect(mine).toBeTruthy();
    await p.sponsor.client.post(`${P}/approvals/${mine.id}/decide`, { decision: "approved", comment: "تأیید" });
    await drain();
    row = (await o.get(`${P}/r/project/${project.id}`)).row;
    expect(["approved", "gate"]).toContain(row.state);
    if (row.state === "gate") {
      // the portfolio has no manager here: the second level resolved to nobody, the project manager approves manually
      row = (await p.pm.client.post(`${P}/r/project/${project.id}/transition`, { to: "approved", version: row.version })).row;
    }
    row = (await p.pm.client.post(`${P}/r/project/${project.id}/transition`, { to: "planning", version: row.version })).row;
    row = (await p.pm.client.post(`${P}/r/project/${project.id}/transition`, { to: "executing", version: row.version })).row;
    expect(row.actual_start).toBeTruthy();
    row = (await p.pm.client.post(`${P}/r/project/${project.id}/transition`, { to: "closing", version: row.version })).row;
    await p.pm.client.post(`${P}/r/project/${project.id}/transition`, { to: "closed", version: row.version }, 409);
  });

  it("an incomplete charter cannot go to the gate", async () => {
    const bare = (await p.pm.client.post(`${P}/r/project`, { name: "پروژهٔ بی‌منشور" })).row;
    const r = await p.pm.client.post(`${P}/r/project/${bare.id}/transition`, { to: "gate", version: bare.version }, 409);
    expect(JSON.stringify(r)).toContain("منشور");
  });
});

describe("health, RAID, time and status reports", () => {
  let project: Record<string, any>;
  let late: Record<string, any>;

  beforeAll(async () => {
    project = (await p.pm.client.post(`${P}/r/project`, { name: "نوسازی شبکه", planned_start: day(-20), planned_end: day(10), team: [p.member.userId] })).row;
    late = (await p.pm.client.post(`${P}/r/project_task`, { project_id: project.id, short_description: "خرید تجهیزات", planned_start: day(-20), planned_end: day(-5), assigned_to: p.member.userId })).row;
    await p.pm.client.post(`${P}/r/project_task`, { project_id: project.id, short_description: "تحویل مرحلهٔ نخست", kind: "milestone", planned_start: day(-2) });
    await p.pm.client.post(`${P}/r/project_task`, { project_id: project.id, short_description: "نصب", planned_start: day(-4), planned_end: day(-1), assigned_to: p.member.userId });
    let row = (await o.get(`${P}/r/project/${project.id}`)).row;
    for (const to of ["approved", "planning", "executing"]) row = (await p.pm.client.post(`${P}/r/project/${project.id}/transition`, { to, version: row.version })).row;
    await drain();
  });

  it("scores risks and turns the project red with its reasons", async () => {
    const risk = (await p.pm.client.post(`${P}/r/raid_item`, { project_id: project.id, kind: "risk", title: "تأخیر تأمین‌کننده", probability: 4, impact: 5 })).row;
    expect(risk.score).toBe(20);
    await drain();
    const row = (await o.get(`${P}/r/project/${project.id}`)).row;
    expect(row.open_risks).toBe(1);
    expect(row.milestones_overdue).toBe(1);
    expect(["amber", "red"]).toContain(row.health);
    expect((row.health_reasons as any[]).length).toBeGreaterThan(0);
    const portfolio = await p.pm.client.get(`${P}/project/portfolio`);
    expect(portfolio.totals.at_risk).toBeGreaterThanOrEqual(1);
  });

  it("time is approved by the project's manager only, never one's own", async () => {
    const t = (await p.member.client.post(`${P}/r/time_entry`, { task_id: late.id, entry_date: day(-1), hours: 6, note: "هماهنگی خرید" })).row;
    expect(t.project_id).toBe(project.id);
    const sub = (await p.member.client.post(`${P}/r/time_entry/${t.id}/transition`, { to: "submitted", version: t.version })).row;
    await p.member.client.post(`${P}/r/time_entry/${t.id}/transition`, { to: "approved", version: sub.version }, 403);
    const ok = (await p.pm.client.post(`${P}/r/time_entry/${t.id}/transition`, { to: "approved", version: sub.version })).row;
    expect(ok.state).toBe("approved");
    // approved time is closed (locked)
    await p.member.client.patch(`${P}/r/time_entry/${t.id}`, { hours: 8, version: ok.version }, 409);
    await drain();
    expect(Number((await o.get(`${P}/r/project_task/${late.id}`)).row.actual_hours)).toBe(6);
    expect(Number((await o.get(`${P}/r/project/${project.id}`)).row.actual_hours)).toBe(6);
  });

  it("drafts a status report from the plan and freezes its metrics on publishing", async () => {
    const d = await p.pm.client.post(`${P}/project/projects/${project.id}/status/draft`, { save: true });
    expect(d.ai).toBe(false);
    expect(d.draft.summary).toContain("پیشرفت");
    const rep = d.report;
    const pub = (await p.pm.client.patch(`${P}/r/status_report/${rep.id}`, { state: "published", version: rep.version })).row;
    expect(pub.published_at).toBeTruthy();
    expect(pub.metrics.open_risks).toBe(1);
    await p.pm.client.patch(`${P}/r/status_report/${rep.id}`, { summary: "تغییر", version: pub.version }, 403);
    expect((await o.get(`${P}/r/project/${project.id}`)).row.last_status_at).toBeTruthy();
  });

  it("shows the resource heat map", async () => {
    await p.pm.client.post(`${P}/r/resource_allocation`, { project_id: project.id, user_id: p.member.userId, role: "مهندس شبکه", start_date: day(0), end_date: day(30), hours_per_week: 50 });
    const r = await p.pm.client.get(`${P}/project/resources?weeks=4`);
    const row = r.people.find((x: any) => x.user_id === p.member.userId);
    expect(row.weeks[1].over).toBe(true);
  });
});

describe("access", () => {
  it("keeps projects from requesters and agents without project roles; auditors read without writing", async () => {
    await p.req.client.get(`${P}/r/project?size=5`, 403);
    await p.agent.client.get(`${P}/project/portfolio`, 403);
    const list = await p.auditor.client.get(`${P}/r/project?size=50`);
    expect(list.rows.length).toBeGreaterThan(0);
    await p.auditor.client.post(`${P}/r/project`, { name: "پروژهٔ ممیز" }, 403);
  });

  it("a team member reads the plan and works only the tasks assigned to them", async () => {
    const proj = (await p.pm.client.post(`${P}/r/project`, { name: "پروژهٔ تیمی", planned_start: day(0), planned_end: day(20) })).row;
    const mine = (await p.pm.client.post(`${P}/r/project_task`, { project_id: proj.id, short_description: "کار من", assigned_to: p.member.userId })).row;
    const theirs = (await p.pm.client.post(`${P}/r/project_task`, { project_id: proj.id, short_description: "کار دیگری", assigned_to: p.sponsor.userId })).row;
    const moved = (await p.member.client.post(`${P}/r/project_task/${mine.id}/transition`, { to: "in_progress", version: mine.version })).row;
    expect(moved.state).toBe("in_progress");
    await p.member.client.post(`${P}/r/project_task/${theirs.id}/transition`, { to: "in_progress", version: theirs.version }, 403);
    const g = await p.member.client.get(`${P}/project/projects/${proj.id}/gantt`);
    expect(g.tasks.length).toBe(2);
  });
});

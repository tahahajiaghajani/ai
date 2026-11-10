// Regressions of the project review: a member creates time, projects and demands only in their first state (approval
// comes through the guarded transitions), adds nothing to a project they may not change, and a status report is
// published by the project's manager.
import { describe, expect, it, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";

type Who = "pm" | "member" | "sponsor";
const ROLES: Record<Who, string> = { pm: "project_manager", member: "project_member", sponsor: "project_member" };

let e: EngineOrg;
let P = "";
let o: Client;
const p = {} as Record<Who, { client: Client; userId: string }>;
let project: Record<string, any>;
let task: Record<string, any>;

const drain = async () => {
  for (let i = 0; i < 30; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
};
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  o = e.owner;
  await o.post(`${P}/project/seed`, {});
  for (const k of Object.keys(ROLES) as Who[]) p[k] = await e.member("member", `${k}@example.com`);
  for (const k of Object.keys(ROLES) as Who[]) await o.put(`${P}/access/members/${p[k].userId}`, { roles: [ROLES[k]], persona: "agent" });
  project = (await p.pm.client.post(`${P}/r/project`, { name: "پروژهٔ مدیر", planned_start: day(-5), planned_end: day(30), sponsor_id: p.sponsor.userId, team: [p.member.userId] })).row;
  task = (await p.pm.client.post(`${P}/r/project_task`, { project_id: project.id, short_description: "کار تیم", assigned_to: p.member.userId })).row;
  await drain();
}, 120_000);

describe("first states (release-project-create-approved)", () => {
  it("a member cannot create approved time, an approved project or an approved demand", async () => {
    await p.member.client.patch(`${P}/r/project/${project.id}`, { description: "تغییر", version: project.version }, 403);
    await p.member.client.post(`${P}/r/time_entry`, { task_id: task.id, entry_date: day(-1), hours: 8, state: "approved" }, 403);
    await p.member.client.post(`${P}/r/project`, { name: "پروژهٔ خودتصویب", state: "approved" }, 403);
    await p.member.client.post(`${P}/r/demand`, { title: "تقاضای خودتصویب", type: "project", state: "approved" }, 403);
    // the first state is fine, and approval stays the manager's transition
    const t = (await p.member.client.post(`${P}/r/time_entry`, { task_id: task.id, entry_date: day(-1), hours: 2, state: "draft" })).row;
    expect(t.state).toBe("draft");
    await drain();
    expect(Number((await o.get(`${P}/r/project/${project.id}`)).row.actual_hours ?? 0)).toBe(0);
  });
});

describe("a project's rows (release-project-children-foreign)", () => {
  it("a member who may not change the project adds no report, risk, task or allocation to it", async () => {
    await p.member.client.post(`${P}/r/status_report`, { project_id: project.id, title: "گزارش بیرونی", state: "published", overall: "red" }, 403);
    await p.member.client.post(`${P}/r/raid_item`, { project_id: project.id, kind: "risk", title: "ریسک ساختگی", probability: 5, impact: 5 }, 403);
    await p.member.client.post(`${P}/r/project_task`, { project_id: project.id, short_description: "کار ساختگی" }, 403);
    await p.member.client.post(`${P}/r/resource_allocation`, { project_id: project.id, user_id: p.member.userId, role: "مهندس", start_date: day(0), end_date: day(10), hours_per_week: 40 }, 403);
    await drain();
    const row = (await o.get(`${P}/r/project/${project.id}`)).row;
    expect(row.open_risks ?? 0).toBe(0);
    expect(row.last_status_at ?? null).toBeNull();
  });

  it("the sponsor may write a report, the project's manager publishes it", async () => {
    const draft = (await p.sponsor.client.post(`${P}/r/status_report`, { project_id: project.id, title: "گزارش حامی" })).row;
    expect(draft.state).toBe("draft");
    await p.sponsor.client.patch(`${P}/r/status_report/${draft.id}`, { state: "published", version: draft.version }, 403);
    await p.sponsor.client.post(`${P}/r/status_report`, { project_id: project.id, title: "گزارش منتشر", state: "published" }, 403);
    const pub = (await p.pm.client.patch(`${P}/r/status_report/${draft.id}`, { state: "published", version: draft.version })).row;
    expect(pub.published_at).toBeTruthy();
  });
});

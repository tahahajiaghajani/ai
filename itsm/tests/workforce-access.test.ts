// Workforce and agent experience — the seed, the participant source (own rows, the team's rosters, the reference data),
// self-service (presence, skills, time off), skills ↔ member profiles and the platform's skills assignment method, time
// off ↔ out of office, the team board (time-off types for the person and overseers only), and the privacy of
// performance numbers: the agent's own view, a team lead without «hr» (team totals only), a workforce manager with
// «hr» (individuals), teams below the minimum size, another agent and a requester.
import { beforeAll, describe, expect, it } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import { absenceTick } from "@server/modules/workforce";
import { addDays } from "@shared/jalali";

type Who = "manager" | "lead" | "a1" | "a2" | "a3" | "other" | "req";
const ROLES: Record<Who, string[]> = { manager: ["workforce_manager"], lead: ["workforce_lead"], a1: ["agent"], a2: ["agent"], a3: ["agent"], other: ["agent"], req: ["requester"] };

let e: EngineOrg;
let P = "";
let o: Client;
const p = {} as Record<Who, { client: Client; userId: string }>;
let team = "";
let otherTeam = "";
let small = "";

const drain = async () => {
  for (let i = 0; i < 40; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
};
const q = (cond: unknown) => encodeURIComponent(JSON.stringify(cond));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  o = e.owner;
  for (const k of Object.keys(ROLES) as Who[]) p[k] = await e.member("member", `wfm-${k}@example.com`);
  team = (await o.post(`${P}/r/group`, { name: "میز خدمت", types: ["assignment"] })).row.id;
  otherTeam = (await o.post(`${P}/r/group`, { name: "شبکه و زیرساخت", types: ["assignment"] })).row.id;
  small = (await o.post(`${P}/r/group`, { name: "تیم کوچک", types: ["assignment"] })).row.id;
  const seeded = await o.post(`${P}/workforce/seed`, {});
  expect(seeded.skipped).toBe(false);
  for (const k of Object.keys(ROLES) as Who[]) await o.put(`${P}/access/members/${p[k].userId}`, { roles: ROLES[k], persona: k === "req" ? "requester" : "agent" });
  await o.post(`${P}/access/groups/${team}/members`, { user_ids: [p.a1.userId, p.a2.userId, p.a3.userId], kind: "member" });
  await o.post(`${P}/access/groups/${team}/members`, { user_ids: [p.lead.userId], kind: "lead" });
  await o.post(`${P}/access/groups/${otherTeam}/members`, { user_ids: [p.other.userId], kind: "member" });
  await o.post(`${P}/access/groups/${small}/members`, { user_ids: [p.a1.userId], kind: "member" });
  await drain();
}, 240_000);

describe("seed", () => {
  it("is idempotent and adds roles, the skills catalogue, shift patterns on calendars and coverage for existing teams", async () => {
    expect((await o.post(`${P}/workforce/seed`, {})).skipped).toBe(true);
    const roles = (await o.get(`${P}/r/role?size=80`)).rows.map((r: any) => r.key);
    expect(roles).toEqual(expect.arrayContaining(["workforce_manager", "workforce_lead"]));
    expect((await o.get(`${P}/r/wfm_skill?size=100`)).rows.length).toBeGreaterThan(10);
    const patterns = (await o.get(`${P}/r/wfm_shift_pattern?size=20`)).rows;
    expect(patterns.length).toBe(4);
    const office = patterns.find((x: any) => x.code === "ص");
    const cal = (await o.get(`${P}/r/calendar/${office.calendar_id}`)).row;
    expect(cal.hours[5]).toEqual([["08:00", "12:00"]]); // Thursday half day
    expect(cal.hours[6]).toEqual([]); // Friday off
    expect(cal.holiday_sets).toContain("ir");
    const coverage = (await o.get(`${P}/r/wfm_coverage?filter=${q({ f: "group_id", op: "eq", v: team })}`)).rows;
    expect(coverage.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the participant source and self-service", () => {
  it("lets every member read the reference data and their own rows, nothing of others", async () => {
    const skill = (await o.get(`${P}/r/wfm_skill?filter=${q({ f: "name", op: "eq", v: "شبکه" })}`)).rows[0];
    // a single row of the reference data opens to everyone; lists stay with the area's grants (agents use the route)
    expect((await p.req.client.get(`${P}/r/wfm_skill/${skill.id}`)).row.name).toBe("شبکه");
    await p.a1.client.get(`${P}/r/wfm_skill?size=5`, 403);
    expect((await p.a1.client.get(`${P}/workforce/skills/catalogue`)).skills.some((s: any) => s.id === skill.id)).toBe(true);
    const mine = await p.a1.client.post(`${P}/workforce/skills/mine`, { skill_id: skill.id, level: 3, evidence: "دورهٔ CCNA" });
    expect(mine.verified).toBe(false);
    const row = (await p.a1.client.get(`${P}/r/wfm_person_skill/${mine.id}`)).row;
    expect(row.level).toBe(3);
    await p.a2.client.get(`${P}/r/wfm_person_skill/${mine.id}`, 404);
    // a person never writes their workforce rows through the generic API (no area grant)
    await p.a1.client.patch(`${P}/r/wfm_person_skill/${mine.id}`, { level: 5 }, 403);
    await p.req.client.get(`${P}/workforce/home`, 403);
  });

  it("verifies skills by a lead of the person's team and keeps the member profile in step", async () => {
    const skill = (await o.get(`${P}/r/wfm_skill?filter=${q({ f: "name", op: "eq", v: "شبکه" })}`)).rows[0];
    const [mine] = (await p.a1.client.get(`${P}/workforce/skills/mine`)).skills;
    await p.other.client.post(`${P}/workforce/skills/${mine.id}/verify`, {}, 403);
    await p.a1.client.post(`${P}/workforce/skills/${mine.id}/verify`, {}, 403);
    await p.lead.client.post(`${P}/workforce/skills/${mine.id}/verify`, { level: 4 });
    const row = (await o.get(`${P}/r/wfm_person_skill/${mine.id}`)).row;
    expect(row.verified).toBe(true);
    expect(row.verified_by).toBe(p.lead.userId);
    expect(row.level).toBe(4);
    const profile = (await o.get(`${P}/r/member_profile?filter=${q({ f: "user_id", op: "eq", v: p.a1.userId })}`)).rows[0];
    expect(profile.skills).toContain(skill.name);
    // the platform's skills assignment method routes by it
    await o.post(`${P}/r/assignment_rule`, { name: "شبکه ← مهارت", table_key: "incident", group_id: team, method: "skills", skills: [skill.name], sort_order: 1, condition: { f: "short_description", op: "contains", v: "سوئیچ" } });
    const inc = (await o.post(`${P}/r/incident`, { short_description: "سوئیچ طبقهٔ دوم کار نمی‌کند" })).row;
    expect(inc.assigned_to).toBe(p.a1.userId);
  });

  it("sets presence, goes away when idle and comes back", async () => {
    let r = await p.a2.client.post(`${P}/workforce/presence`, { state: "available" });
    expect(r.presence).toBe("available");
    r = await p.a2.client.post(`${P}/workforce/heartbeat`, { idle_ms: 60 * 60_000 });
    expect(r.presence).toBe("away");
    expect(r.auto_away).toBe(true);
    r = await p.a2.client.post(`${P}/workforce/heartbeat`, { idle_ms: 0 });
    expect(r.presence).toBe("available");
    const team1 = await p.a3.client.get(`${P}/workforce/teams/${team}/presence`);
    expect(team1.people.find((x: any) => x.user_id === p.a2.userId).presence).toBe("available");
    await p.other.client.get(`${P}/workforce/teams/${team}/presence`, 403);
  });
});

describe("time off", () => {
  let id = "";
  it("is requested by the person, decided by the team's lead and puts the profile out of office", async () => {
    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const r = await p.a2.client.post(`${P}/workforce/absences`, { type: "sick", start_at: start, end_at: end, delegate_id: p.a3.userId, note: "بیماری", group_id: team });
    id = r.id;
    expect(r.state).toBe("requested");
    expect(r.approval).toBe("requested");
    // overlapping time off is refused
    await p.a2.client.post(`${P}/workforce/absences`, { type: "annual", start_at: start, end_at: end }, 400);
    await drain();
    const mine = await p.lead.client.get(`${P}/approvals/mine`);
    const ap = mine.approvals.find((x: any) => x.record_id === id);
    expect(ap).toBeTruthy();
    await p.lead.client.post(`${P}/approvals/${ap.id}/decide`, { decision: "approved" });
    const row = (await p.a2.client.get(`${P}/r/wfm_absence/${id}`)).row;
    expect(row.state).toBe("approved");
    const profile = (await o.get(`${P}/r/member_profile?filter=${q({ f: "user_id", op: "eq", v: p.a2.userId })}`)).rows[0];
    expect(profile.out_of_office).toBe(true);
    expect(profile.delegate_id).toBe(p.a3.userId);
    // someone else's time off does not exist for a teammate
    await p.a3.client.get(`${P}/r/wfm_absence/${id}`, 404);
  });

  it("shows on the team board as «غایب» to teammates, with its type to the person and the lead", async () => {
    const roster = (await p.lead.client.post(`${P}/r/wfm_roster`, { group_id: team, user_id: p.a3.userId, pattern_id: (await o.get(`${P}/r/wfm_shift_pattern?filter=${q({ f: "code", op: "eq", v: "ص" })}`)).rows[0].id, valid_from: addDays(today(), -7) })).row;
    expect(roster.number).toMatch(/^SCH/);
    // a member of the team may not plan rosters
    await p.a1.client.post(`${P}/r/wfm_roster`, { group_id: team, user_id: p.a1.userId, pattern_id: roster.pattern_id, valid_from: today() }, 403);
    // but reads the team's rosters
    expect((await p.a1.client.get(`${P}/r/wfm_roster/${roster.id}`)).row.id).toBe(roster.id);
    await p.other.client.get(`${P}/r/wfm_roster/${roster.id}`, 404);
    const cell = (board: any) => board.people.find((x: any) => x.user_id === p.a2.userId).cells[0];
    expect(cell(await p.a1.client.get(`${P}/workforce/teams/${team}/board?from=${today()}&days=7`)).absence).toBe("غایب");
    expect(cell(await p.a2.client.get(`${P}/workforce/teams/${team}/board?from=${today()}&days=7`)).absence).toContain("استعلاجی");
    const lead = await p.lead.client.get(`${P}/workforce/teams/${team}/board?from=${today()}&days=7`);
    expect(cell(lead).absence).toContain("استعلاجی");
    expect(lead.can_manage).toBe(true);
    await p.other.client.get(`${P}/workforce/teams/${team}/board`, 403);
  });

  it("restores the profile when it ends", async () => {
    const sys = await systemCtx(e.cfg, e.org);
    expect(await absenceTick(sys, id, Date.now() + 4 * 86_400_000)).toBe("ended");
    const profile = (await o.get(`${P}/r/member_profile?filter=${q({ f: "user_id", op: "eq", v: p.a2.userId })}`)).rows[0];
    expect(profile.out_of_office).toBe(false);
  });
});

describe("performance numbers", () => {
  beforeAll(async () => {
    // resolved work for the team
    for (const who of ["a1", "a2", "a3"] as const) {
      const inc = (await o.post(`${P}/r/incident`, { short_description: `کار ${who}`, assignment_group_id: team, assigned_to: p[who].userId })).row;
      await o.post(`${P}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "حل شد" } });
    }
    await drain();
  });

  it("gives everyone their own scorecard and points", async () => {
    const mine = await p.a3.client.get(`${P}/workforce/performance`);
    expect(mine.me.resolved).toBe(1);
    expect(mine.me.points).toBeGreaterThan(0);
    const coach = await p.a3.client.post(`${P}/workforce/coaching`, {});
    expect(coach.ai).toBe(false);
    expect(coach.text).toContain("فقط برای شماست");
  });

  it("refuses another person's individual numbers without «hr» and oversight", async () => {
    await p.a1.client.get(`${P}/workforce/performance?user=${p.a3.userId}`, 403);
    await p.lead.client.get(`${P}/workforce/performance?user=${p.a3.userId}`, 403);
    const m = await p.manager.client.get(`${P}/workforce/performance?user=${p.a3.userId}`);
    expect(m.person.metrics.resolved).toBe(1);
  });

  it("shows the team's totals to the lead without individuals, and individuals to the manager with «hr»", async () => {
    const lead = await p.lead.client.get(`${P}/workforce/performance?group=${team}`);
    expect(lead.teams[0].metrics.resolved).toBe(3);
    expect(lead.teams[0].people).toBeNull();
    expect(lead.teams[0].people_restricted).toBe(true);
    const mgr = await p.manager.client.get(`${P}/workforce/performance?group=${team}`);
    expect(mgr.teams[0].people.length).toBe(4);
    // a team below the minimum size shows nothing
    const tiny = await p.a1.client.get(`${P}/workforce/performance?group=${small}`);
    expect(tiny.teams[0].suppressed).toBe(true);
    expect(tiny.teams[0].metrics).toBeNull();
    await p.other.client.get(`${P}/workforce/performance?group=${team}`, 403);
  });
});

describe("capacity, home, kudos and the leaderboard", () => {
  it("shows the heatmap with people to the lead and totals to members", async () => {
    const lead = await p.lead.client.get(`${P}/workforce/capacity?days=7`);
    const row = lead.rows.find((r: any) => r.group_id === team);
    expect(row.cells.length).toBe(7);
    expect(row.people.length).toBe(4);
    const member = await p.a1.client.get(`${P}/workforce/capacity?days=7`);
    expect(member.rows.find((r: any) => r.group_id === team).people).toBeNull();
    expect(member.rows.some((r: any) => r.group_id === otherTeam)).toBe(false);
  });

  it("builds the agent home and records kudos with points for the receiver", async () => {
    const home = await p.a1.client.get(`${P}/workforce/home`);
    expect(home.work.items.some((i: any) => i.table === "incident")).toBe(true);
    expect(home.next.source).toBe("rules");
    await p.a1.client.post(`${P}/workforce/kudos`, { to_id: p.a1.userId, message: "ممنون" }, 400);
    await p.a1.client.post(`${P}/workforce/kudos`, { to_id: p.a3.userId, message: "ممنون از کمکت" });
    const a3 = await p.a3.client.get(`${P}/workforce/home`);
    expect(a3.kudos[0].message).toBe("ممنون از کمکت");
    expect(a3.points.recent.some((r: any) => r.reason === "kudos")).toBe(true);
  });

  it("lists only people who opted in, and the team totals", async () => {
    let board = await p.a1.client.get(`${P}/workforce/leaderboard?group=${team}`);
    expect(board.people.length).toBe(0);
    expect(board.teams[0].points).toBeGreaterThan(0);
    await p.a3.client.post(`${P}/workforce/prefs`, { leaderboard: true });
    board = await p.a1.client.get(`${P}/workforce/leaderboard?group=${team}`);
    expect(board.people.map((x: any) => x.user_id)).toEqual([p.a3.userId]);
    await p.other.client.get(`${P}/workforce/leaderboard?group=${team}`, 403);
  });
});

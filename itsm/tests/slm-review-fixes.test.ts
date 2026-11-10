// Review fixes of service level management and workforce (each case failed before its fix):
//   · a team lead files time off, rosters, capacity, skill needs and skill levels only for their own teams' people,
//     never names themselves someone's delegate and does not approve time off they filed for someone else
//   · time off writes its own delegate (or none) into the profile and takes it back when it ends; moved dates move the
//     profile's out of office
//   · the expert finder is for directory readers only, with presence of the caller's teams only
//   · the leaderboard shows no total of a team below the least team size
//   · skill-based suggestions follow the organisation's routing rule (verified skills only, least level)
//   · the capacity forecast of a future window is not dragged to zero by the days before it
//   · experience scores are read like survey answers (an agent reads their groups'), anchored to the record's domain
//   · customers do not read an agreement's measurement or internal parties
//   · a breach counts once, in the period it happened; quarterly agreements get a quarter's volume ceiling and their
//     manual values; a timer without a record left out by the ceiling does not empty the counts
//   · the sweep resumes after the last agreement it finished, and closes the last period of an agreement that ended
import { beforeAll, describe, expect, it, vi } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { createIn, systemCtx } from "@server/engine";
import { absenceTick } from "@server/modules/workforce";
import { slmSweep } from "@server/modules/slm";
import { measureTarget, timerCounts, windowOf } from "@server/modules/slm/measure";
import { addDays } from "@shared/jalali";
import { periodOf } from "@shared/slm/logic";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "@server/context";

vi.setConfig({ testTimeout: 180_000 });

type Who = "manager" | "lead" | "a1" | "a2" | "a3" | "other" | "vendor" | "req" | "slm";
const ROLES: Record<Who, string[]> = {
  manager: ["workforce_manager"], lead: ["workforce_lead"], a1: ["agent"], a2: ["agent"], a3: ["agent"], other: ["agent"], vendor: ["vendor_agent"], req: ["requester"], slm: ["service_level_manager"],
};

let e: EngineOrg;
let P = "";
let o: Client;
let sys: Ctx;
const p = {} as Record<Who, { client: Client; userId: string }>;
let team = "";
let otherTeam = "";
let small = "";
let svc: Record<string, any>;
let unit = "";
let skill = "";

const drain = async () => {
  for (let i = 0; i < 40; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const profileOf = async (userId: string) => (await e.db.one<Record<string, any>>(`select out_of_office, ooo_until, delegate_id from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [e.org, userId]))!;
async function status(c: Client, method: string, path: string, body?: unknown): Promise<number> {
  try {
    await c.req(method, path, body ?? (method === "GET" ? undefined : {}), 200);
    return 200;
  } catch (err) {
    return Number(/→ (\d{3})/.exec(String(err))?.[1] ?? 0);
  }
}

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  o = e.owner;
  await o.post(`${P}/cmdb/seed`, {});
  await o.post(`${P}/service_portfolio/seed`, {});
  await o.post(`${P}/slm/seed`, {});
  for (const k of Object.keys(ROLES) as Who[]) p[k] = await e.member("member", `rf-${k}@example.com`);
  team = (await o.post(`${P}/r/group`, { name: "میز خدمت آزمون", types: ["assignment"] })).row.id;
  otherTeam = (await o.post(`${P}/r/group`, { name: "شبکهٔ آزمون", types: ["assignment"] })).row.id;
  small = (await o.post(`${P}/r/group`, { name: "تیم دونفره", types: ["assignment"] })).row.id;
  await o.post(`${P}/workforce/seed`, {});
  for (const k of Object.keys(ROLES) as Who[]) await o.put(`${P}/access/members/${p[k].userId}`, { roles: ROLES[k], persona: k === "req" ? "requester" : "agent" });
  await o.post(`${P}/access/groups/${team}/members`, { user_ids: [p.a1.userId, p.a2.userId, p.a3.userId], kind: "member" });
  await o.post(`${P}/access/groups/${team}/members`, { user_ids: [p.lead.userId], kind: "lead" });
  await o.post(`${P}/access/groups/${otherTeam}/members`, { user_ids: [p.other.userId, p.vendor.userId], kind: "member" });
  await o.post(`${P}/access/groups/${small}/members`, { user_ids: [p.a1.userId, p.a2.userId], kind: "member" });
  unit = (await o.post(`${P}/r/org_unit`, { name: "واحد آزمون" })).row.id;
  svc = (await o.post(`${P}/r/service`, { name: "ایمیل آزمون", service_type: "business", description: "ایمیل", owner_id: p.slm.userId })).row;
  await o.post(`${P}/r/service/${svc.id}/transition`, { to: "approved" });
  skill = (await o.get(`${P}/r/wfm_skill?size=200`)).rows.find((s: any) => s.active !== false && s.routing !== false).id;
  sys = await systemCtx(e.cfg, e.org);
  await drain();
}, 300_000);

describe("workforce", () => {
  it("keeps a team lead to their own teams' people, off others' delegations and off approving what they filed", async () => {
    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 30 * 86_400_000).toISOString();
    // another team's agent, filed under the lead's team, with the lead as delegate
    expect([400, 403]).toContain(await status(p.lead.client, "POST", `${P}/r/wfm_absence`, { user_id: p.other.userId, group_id: team, type: "annual", start_at: start, end_at: end, delegate_id: p.lead.userId }));
    expect(await status(p.lead.client, "POST", `${P}/r/wfm_absence`, { user_id: p.other.userId, group_id: otherTeam, type: "annual", start_at: start, end_at: end })).toBe(403);
    expect(await status(p.lead.client, "POST", `${P}/r/wfm_person_skill`, { user_id: p.other.userId, skill_id: skill, level: 5, source: "self" })).toBe(403);
    expect(await status(p.lead.client, "POST", `${P}/r/wfm_capacity`, { group_id: otherTeam, max_open: 1 })).toBe(403);
    expect(await status(p.lead.client, "POST", `${P}/r/wfm_coverage`, { group_id: otherTeam, skill_id: skill, min_level: 2, min_people: 1 })).toBe(403);
    // their own team member: no self-delegation, and no approval of what they filed
    expect(await status(p.lead.client, "POST", `${P}/r/wfm_absence`, { user_id: p.a3.userId, group_id: team, type: "annual", start_at: start, end_at: end, delegate_id: p.lead.userId })).toBe(403);
    const filed = (await p.lead.client.post(`${P}/r/wfm_absence`, { user_id: p.a3.userId, group_id: team, type: "annual", start_at: addDays(today(), 40) + "T05:00:00Z", end_at: addDays(today(), 42) + "T05:00:00Z" })).row;
    await p.lead.client.post(`${P}/r/wfm_absence/${filed.id}/transition`, { to: "approved", version: filed.version }, 409);
    await p.manager.client.post(`${P}/r/wfm_absence/${filed.id}/transition`, { to: "approved", version: filed.version });
    expect((await profileOf(p.other.userId))?.delegate_id ?? null).toBeNull();
  });

  it("writes an absence's own delegate into the profile, moves its end with the dates and takes the delegate back", async () => {
    const start = new Date(Date.now() - 60_000).toISOString();
    const r = await p.a2.client.post(`${P}/workforce/absences`, { type: "sick", start_at: start, end_at: new Date(Date.now() + 10 * 86_400_000).toISOString(), delegate_id: p.a1.userId, group_id: team });
    const row = (await p.manager.client.get(`${P}/r/wfm_absence/${r.id}`)).row;
    await p.manager.client.post(`${P}/r/wfm_absence/${r.id}/transition`, { to: "approved", version: row.version });
    let prof = await profileOf(p.a2.userId);
    expect(prof.out_of_office).toBe(true);
    expect(prof.delegate_id).toBe(p.a1.userId);
    // shortened to two days: the profile's out of office follows
    const approved = (await p.manager.client.get(`${P}/r/wfm_absence/${r.id}`)).row;
    const shorter = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await p.manager.client.patch(`${P}/r/wfm_absence/${r.id}`, { end_at: shorter, version: approved.version });
    prof = await profileOf(p.a2.userId);
    expect(new Date(prof.ooo_until).getTime()).toBe(new Date(shorter).getTime());
    expect(await absenceTick(sys, r.id, Date.now() + 3 * 86_400_000)).toBe("ended");
    prof = await profileOf(p.a2.userId);
    expect(prof.out_of_office).toBe(false);
    expect(prof.delegate_id ?? null).toBeNull();
    // the next time off without a delegate brings no delegate back
    const again = await p.a2.client.post(`${P}/workforce/absences`, { type: "annual", start_at: new Date(Date.now() - 30_000).toISOString(), end_at: new Date(Date.now() + 86_400_000).toISOString(), group_id: team });
    const r2 = (await p.manager.client.get(`${P}/r/wfm_absence/${again.id}`)).row;
    await p.manager.client.post(`${P}/r/wfm_absence/${again.id}/transition`, { to: "approved", version: r2.version });
    prof = await profileOf(p.a2.userId);
    expect(prof.out_of_office).toBe(true);
    expect(prof.delegate_id ?? null).toBeNull();
  });

  it("finds experts only for directory readers, with presence of the caller's teams only", async () => {
    await p.a1.client.post(`${P}/workforce/skills/mine`, { skill_id: skill, level: 4 });
    await p.a1.client.post(`${P}/workforce/presence`, { state: "available" });
    await p.vendor.client.get(`${P}/workforce/experts?skill=${skill}&level=1`, 403);
    const far = (await p.other.client.get(`${P}/workforce/experts?skill=${skill}&level=1`)).people.find((x: any) => x.user_id === p.a1.userId);
    expect(far).toBeTruthy();
    expect(far.presence).toBeNull();
    const near = (await p.a3.client.get(`${P}/workforce/experts?skill=${skill}&level=1`)).people.find((x: any) => x.user_id === p.a1.userId);
    expect(near.presence).toBe("available");
  });

  it("shows no team total for a team below the least size", async () => {
    const board = await p.a1.client.get(`${P}/workforce/leaderboard?group=${small}`);
    expect(board.teams[0].members).toBe(2);
    expect(board.teams[0].points).toBeNull();
  });

  it("counts only verified skills in suggestions when the organisation asks for them", async () => {
    const cfg = (await o.get(`${P}/r/wfm_config`)).rows[0];
    await o.patch(`${P}/r/wfm_config/${cfg.id}`, { routing_needs_verified: true, version: cfg.version });
    await p.manager.client.post(`${P}/r/wfm_coverage`, { group_id: team, skill_id: skill, min_level: 2, min_people: 1 });
    const inc = (await o.post(`${P}/r/incident`, { short_description: "پرسش آزمون مسیریابی", assignment_group_id: team, priority: "3" })).row;
    const s = await p.lead.client.get(`${P}/workforce/routing/incident/${inc.id}`);
    const a1 = s.candidates.find((c: any) => c.user_id === p.a1.userId);
    const a3 = s.candidates.find((c: any) => c.user_id === p.a3.userId);
    expect(a1.match).toBe(a3.match);
    await o.patch(`${P}/r/wfm_config/${cfg.id}`, { routing_needs_verified: false, version: (await o.get(`${P}/r/wfm_config/${cfg.id}`)).row.version });
  });

  it("forecasts a future window from the real history, not from empty days before it", async () => {
    for (let i = 0; i < 24; i++) await o.post(`${P}/r/incident`, { short_description: `بار آزمون ${i}`, assignment_group_id: team, priority: "4" });
    await e.db.query(`update sm_incidents set created_at = now() - ((substring(short_description from '[0-9]+$'))::int + 1) * interval '1 day' where org_id = $1 and short_description like 'بار آزمون %'`, [e.org]);
    const mean = (v: any) => {
      const cells = v.rows.find((r: any) => r.group_id === team).cells;
      return cells.reduce((a: number, c: any) => a + Number(c.forecast), 0) / cells.length;
    };
    const now = mean(await p.lead.client.get(`${P}/workforce/capacity?days=7&groups=${team}`));
    const later = mean(await p.lead.client.get(`${P}/workforce/capacity?days=7&groups=${team}&from=${addDays(today(), 14)}`));
    expect(now).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(now * 0.5);
  });
});

describe("service level management", () => {
  it("lets agents read experience scores of their groups' records only, anchored to the record's domain", async () => {
    const inc = (await o.post(`${P}/r/incident`, { short_description: "رخداد امتیاز تجربه", assignment_group_id: team, assigned_to: p.a1.userId, priority: "3" })).row;
    await o.post(`${P}/slm/records/incident/${inc.id}/xla`, {});
    const score = await e.db.one<Record<string, any>>(`select id from sm_slm_xla_scores where org_id = $1 and record_id = $2`, [e.org, inc.id]);
    expect(score).toBeTruthy();
    const theirs = (await p.other.client.get(`${P}/r/slm_xla_score?size=200`)).rows.map((r: any) => r.id);
    expect(theirs).not.toContain(score!.id);
    const mine = (await p.a3.client.get(`${P}/r/slm_xla_score?size=200`)).rows.map((r: any) => r.id);
    expect(mine).toContain(score!.id);
  });

  it("offers nobody but the system «امتیاز تجربه تازه» or import (rowAccess.write NEVER), and still refuses the create", async () => {
    for (const who of [p.req, p.a3]) {
      const meta = await who.client.get(`${P}/meta/tables/slm_xla_score`);
      expect(meta.table.can.read).toBe(true);
      expect(meta.table.can.create).toBe(false);
      await who.client.post(`${P}/r/slm_xla_score`, { table_key: "incident", record_number: "INC-1", score: "0" }, 403);
    }
    // the owner sees a «… تازه» only where people write
    expect((await o.get(`${P}/meta/tables/incident`)).table.can.create).toBe(true);
  });

  it("does not show customers an agreement's measurement or its internal parties", async () => {
    const a = (await o.post(`${P}/r/service_agreement`, { name: "توافق مشتری آزمون", service_id: svc.id, customer_unit_id: unit, status: "active", valid_from: addDays(today(), -10), valid_to: addDays(today(), 300), supplier_name: "تأمین‌کنندهٔ پنهان", contract_ref: "UC-77" })).row;
    const seen = (await p.req.client.get(`${P}/r/service_agreement/${a.id}`)).row;
    for (const f of ["compliance_pct", "compliance_status", "experience_pct", "watermelon", "measured_at", "supplier_name", "contract_ref"]) expect(f in seen, f).toBe(false);
    const staff = (await p.slm.client.get(`${P}/r/service_agreement/${a.id}`)).row;
    expect(staff.supplier_name).toBe("تأمین‌کنندهٔ پنهان");
  });

  it("counts a breach once, in the period it happened, and gives a quarter its whole volume ceiling", async () => {
    const def = (await o.post(`${P}/r/sla_definition`, { name: "حل آزمون نقض", table_key: "problem", type: "sla", target: "resolution", duration_mode: "fixed", duration: 3600, warn_percents: [] })).row.id;
    const cur = periodOf(today(), "month");
    const prev = periodOf(addDays(cur.start, -1), "month");
    const at = (d: string, h: number) => new Date(Date.parse(`${d}T00:00:00Z`) + h * 3_600_000).toISOString();
    await sys.write(async (tx) => {
      // breached in the previous month, stopped in this one
      await createIn(tx, sys, "task_sla", { name: "ن", definition_id: def, table_key: "problem", record_id: uuidv7(), stage: "breached", active: false, breached: true, start_at: at(prev.start, 30), breached_at: at(prev.start, 60), stop_at: at(cur.start, 30) }, { trusted: true });
    });
    expect((await timerCounts(e.db, sys, [def], windowOf(sys, prev))).breached).toBe(1);
    expect((await timerCounts(e.db, sys, [def], windowOf(sys, cur))).breached).toBe(0);
    // a quarter of a 2-per-month ceiling allows 6 records
    const qdef = (await o.post(`${P}/r/sla_definition`, { name: "حل آزمون حجم", table_key: "problem", type: "sla", target: "resolution", duration_mode: "fixed", duration: 3600, warn_percents: [] })).row.id;
    const quarter = periodOf(today(), "quarter");
    await sys.write(async (tx) => {
      for (let i = 0; i < 5; i++) await createIn(tx, sys, "task_sla", { name: "ح", definition_id: qdef, table_key: "problem", record_id: uuidv7(), stage: "achieved", active: false, breached: false, start_at: at(quarter.start, 10 + i), stop_at: at(quarter.start, 11 + i) }, { trusted: true });
    });
    const m = await measureTarget(e.db, sys, { volume_limit: "2", review_period: "quarter" }, { kind: "timer", definition_id: qdef }, quarter, 1);
    expect(m.excluded).toBe(0);
    expect(m.over_limit).toBe(false);
    expect(m.met).toBe(5);
  });

  it("keeps the records within the volume ceiling counted when a timer without a record is left out", async () => {
    const def = (await o.post(`${P}/r/sla_definition`, { name: "حل آزمون بی‌رکورد", table_key: "problem", type: "sla", target: "resolution", duration_mode: "fixed", duration: 3600, warn_percents: [] })).row.id;
    const cur = periodOf(today(), "month");
    const at = (h: number) => new Date(Date.parse(`${cur.start}T00:00:00Z`) + h * 3_600_000).toISOString();
    await sys.write(async (tx) => {
      await createIn(tx, sys, "task_sla", { name: "ر", definition_id: def, table_key: "problem", record_id: uuidv7(), stage: "achieved", active: false, breached: false, start_at: at(10), stop_at: at(11) }, { trusted: true });
      // a running timer saved without its record, started later: the one beyond a ceiling of one record
      await createIn(tx, sys, "task_sla", { name: "ب", definition_id: def, table_key: "problem", stage: "in_progress", active: true, breached: false, start_at: at(12) }, { trusted: true });
    });
    const c = await timerCounts(e.db, sys, [def], windowOf(sys, cur), 1);
    expect(c.volume).toBe(2);
    expect(c.excluded).toBe(1);
    expect(c.over_limit).toBe(true);
    expect(c.met).toBe(1);
  });

  it("measures a quarterly agreement's manual target from the value recorded for the quarter", async () => {
    const a = (await o.post(`${P}/r/service_agreement`, { name: "توافق فصلی آزمون", service_id: svc.id, customer_unit_id: unit, status: "active", review_period: "quarter", valid_from: addDays(today(), -10), valid_to: addDays(today(), 300) })).row;
    const t = (await o.post(`${P}/r/slm_target`, { agreement_id: a.id, name: "رضایت دستی", kind: "manual", goal: "90" })).row;
    await o.post(`${P}/slm/targets/${t.id}/manual`, { value: 80 });
    expect(Number((await o.get(`${P}/r/slm_target/${t.id}`)).row.current_value)).toBe(80);
  });

  it("resumes the sweep after the last agreement it finished", async () => {
    for (let i = 0; i < 3; i++) await o.post(`${P}/r/service_agreement`, { name: `توافق پیمایش ${i}`, service_id: svc.id, customer_unit_id: unit, status: "active", valid_from: addDays(today(), -5), valid_to: addDays(today(), 200) });
    const past = Date.now() - 1;
    const r1 = await slmSweep(sys, { deadline: past });
    expect(r1.more).toBe(true);
    expect(r1.cursor).toBeTruthy();
    const r2 = await slmSweep(sys, { deadline: past, after: r1.cursor });
    expect(r2.cursor).toBeTruthy();
    expect(String(r2.cursor) > String(r1.cursor)).toBe(true);
  });

  it("closes the last period of an agreement that expired (final rows)", async () => {
    const a = (await o.post(`${P}/r/service_agreement`, { name: "توافق پایان‌یافتهٔ آزمون", service_id: svc.id, customer_unit_id: unit, status: "active", valid_from: addDays(today(), -75), valid_to: addDays(today(), -45) })).row;
    await o.post(`${P}/r/slm_target`, { agreement_id: a.id, name: "دسترس‌پذیری", kind: "availability", goal: "99" });
    const fresh = (await o.get(`${P}/r/service_agreement/${a.id}`)).row;
    await o.post(`${P}/r/service_agreement/${a.id}/transition`, { to: "expired", version: fresh.version });
    await slmSweep(sys, {});
    const finals = await e.db.query(`select id from sm_slm_compliance where org_id = $1 and agreement_id = $2 and final`, [e.org, a.id]);
    expect(finals.length).toBeGreaterThan(0);
  });
});

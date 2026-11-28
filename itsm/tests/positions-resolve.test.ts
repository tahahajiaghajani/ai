// F3 — resolveAssignees on the server (design F §3.4): the people a workflow step goes to when it opens, and the
// designer's preview, which is the very same resolver.
//   · positions by scope: the requester's unit, the nearest unit (of a kind) up the tree with a holder, a fixed unit, the
//     unit a form field names, anywhere; holders valid on the day only; `members` narrows (an empty intersection falls
//     back, then «if nobody»: wait, skip or the process managers);
//   · groups (members and leads, valid now), access roles (profile and group roles), named people, the manager to depth
//     3, the head of a unit, person fields, earlier actors, the requester;
//   · separation of duties (the requester, filer and beneficiary, never approves by default; earlier actors);
//   · delegation by action: approve reads «approvals» delegations, fill and review «assignments», the out-of-office
//     delegate otherwise; a delegate who is inactive or excluded never takes over;
//   · pools: more than 100 people (50 approvers when the quorum counts everyone) and the step waits for the managers;
//   · the preview and estimate API: the runtime's answer with names, for designers and the keepers of the structure.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, systemCtx, updateIn } from "@server/engine";
import { resolveAssignees, type ResolveInput } from "@server/modules/positions";
import { uuidv7 } from "@shared/id";
import { localDate } from "@shared/model/jalali-buckets";
import type { Ctx } from "@server/context";
import type { StepAssignees } from "@shared/process/assignees";

let e: EngineOrg;
let sys: Ctx;
let P: string;
const U: Record<string, string> = {};
const M: Record<string, string> = {};
const POS: Record<string, string> = {};
let credit: string;
let auditors: string;

const DAY = 86_400_000;
const day = (offset: number) => localDate(Date.now() + offset * DAY, "Asia/Tehran");

async function unit(name: string, kind: string, parent?: string, manager?: string): Promise<string> {
  return String((await sys.write((tx) => createIn(tx, sys, "org_unit", { name, kind, parent_id: parent ?? null, manager_id: manager ?? null }, { trusted: true }))).id);
}

/** A member (fast: the account and membership by SQL, the profile through the engine). */
async function person(name: string, o: { unit?: string | null; manager?: string | null; roles?: string[]; active?: boolean; role?: "member" | "viewer" | "owner" } = {}): Promise<string> {
  const id = uuidv7();
  await e.db.query(`insert into sm_users (id, email, full_name) values ($1, $2, $3)`, [id, `p${id.slice(-12)}@bank.test`, name]);
  await e.db.query(`insert into sm_org_members (id, org_id, user_id, role, is_active) values ($1, $2, $3, $4, $5)`, [uuidv7(), e.org, id, o.role ?? "member", o.active !== false]);
  await sys.write((tx) => createIn(tx, sys, "member_profile", { user_id: id, name, org_unit_id: o.unit ?? null, manager_id: o.manager ?? null, roles: o.roles ?? [], persona: "requester" }, { trusted: true }));
  return id;
}

async function position(key: string, name: string, unitKind: string | null): Promise<string> {
  return String((await sys.write((tx) => createIn(tx, sys, "position", { key, name, unit_kind: unitKind }, { trusted: true }))).id);
}

async function holder(position_id: string, user_id: string, org_unit_id: string | null, o: { kind?: string; valid_from?: string; valid_to?: string } = {}): Promise<string> {
  return String((await sys.write((tx) => createIn(tx, sys, "position_holder", { position_id, user_id, org_unit_id, kind: o.kind ?? "primary", valid_from: o.valid_from ?? null, valid_to: o.valid_to ?? null }, { trusted: true }))).id);
}

const resolve = (input: Partial<ResolveInput> & { step: StepAssignees }) => resolveAssignees(e.db, sys, { action: "fill", requestedBy: M.r1, ...input });
const users = (r: { people: { user: string }[] }) => r.people.map((p) => p.user).sort();
const sorted = (...ids: string[]) => [...ids].sort();

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  sys = await systemCtx(e.cfg, e.org);
  // the bank: head office → the northern region → branches (Vanak with a counter, Tajrish, Pasdaran) and finance
  M.regionHead = await person("مدیر منطقهٔ شمال");
  U.hq = await unit("بانک آفتاب", "company");
  U.north = await unit("مدیریت شعب شمال", "division", U.hq, M.regionHead);
  M.headV = await person("رئیس شعبهٔ ونک");
  U.vanak = await unit("شعبهٔ ونک", "branch", U.north, M.headV);
  const headProfile = (await e.db.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2`, [e.org, M.headV]))!.id;
  await sys.write((tx) => updateIn(tx, sys, "member_profile", headProfile, { org_unit_id: U.vanak }, { trusted: true }));
  U.counter = await unit("باجهٔ ونک", "team", U.vanak);
  U.tajrish = await unit("شعبهٔ تجریش", "branch", U.north);
  U.pasdaran = await unit("شعبهٔ پاسداران", "branch", U.north);
  U.finance = await unit("ادارهٔ مالی", "department", U.hq);
  // managers three deep, and requesters
  M.m3 = await person("معاون", { unit: U.hq });
  M.m2 = await person("مدیر", { unit: U.north, manager: M.m3 });
  M.m1 = await person("سرپرست", { unit: U.vanak, manager: M.m2 });
  M.r1 = await person("درخواست‌دهندهٔ باجه", { unit: U.counter, manager: M.m1 });
  M.r2 = await person("درخواست‌دهندهٔ پاسداران", { unit: U.pasdaran });
  M.r3 = await person("بی‌واحد");
  // positions and their holders: the Tajrish head acts (کفیل); Pasdaran's head left yesterday, the next starts tomorrow
  POS.head = await position("branch_head", "رئیس شعبه", "branch");
  POS.officer = await position("credit_officer", "کارشناس اعتبارات", null);
  POS.retired = await position("old_post", "سمت قدیمی", null);
  M.headT = await person("کفیل شعبهٔ تجریش", { unit: U.tajrish });
  M.headOld = await person("رئیس پیشین پاسداران", { unit: U.pasdaran });
  M.headNext = await person("رئیس بعدی پاسداران");
  M.officer1 = await person("کارشناس اعتبارات ستاد", { unit: U.finance });
  M.officer2 = await person("کارشناس اعتبارات ونک", { unit: U.vanak });
  await holder(POS.head, M.headV, U.vanak);
  await holder(POS.head, M.headT, U.tajrish, { kind: "acting", valid_from: day(-30) });
  await holder(POS.head, M.headOld, U.pasdaran, { valid_to: day(-1) });
  await holder(POS.head, M.headNext, U.pasdaran, { valid_from: day(1) });
  await holder(POS.officer, M.officer1, null);
  await holder(POS.officer, M.officer2, U.vanak);
  // a position switched off after it was held
  await holder(POS.retired, M.officer1, null);
  await sys.write((tx) => updateIn(tx, sys, "position", POS.retired, { active: false }, { trusted: true }));
  // a group with members, a lead and an observer; a group whose membership gives an access role
  M.lead = await person("سرپرست اعتبارات");
  M.observer = await person("ناظر");
  credit = String((await sys.write((tx) => createIn(tx, sys, "group", { name: "اعتبارات", types: ["assignment"] }, { trusted: true }))).id);
  auditors = String((await sys.write((tx) => createIn(tx, sys, "group", { name: "مدیران تغییر", types: ["assignment"], roles: ["change_manager"] }, { trusted: true }))).id);
  M.cm1 = await person("مدیر تغییر", { roles: ["change_manager"] });
  M.cm2 = await person("مدیر تغییر گروهی");
  await sys.write(async (tx) => {
    for (const [user_id, kind] of [[M.officer1, "member"], [M.officer2, "member"], [M.lead, "lead"], [M.observer, "observer"]] as const) await createIn(tx, sys, "group_member", { group_id: credit, user_id, kind }, { trusted: true });
    await createIn(tx, sys, "group_member", { group_id: auditors, user_id: M.cm2, kind: "member" }, { trusted: true });
  });
}, 600_000);

describe("positions by scope", () => {
  it("finds the branch head up the tree: the nearest unit of the kind with a holder", async () => {
    const r = await resolve({ step: { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }] } });
    expect(r).toMatchObject({ status: "ok", found: 1, limit: 100, fallbackUsed: false });
    expect(r.people).toEqual([{ user: M.headV, delegatedFrom: null, via: { rule: 0, kind: "position", position: "branch_head", unit: U.vanak, holderKind: "primary" } }]);
    // without a kind: the counter has no holder, its branch has
    expect(users(await resolve({ step: { assignees: [{ kind: "position", position: POS.head, where: "requester_unit_up" }] } }))).toEqual([M.headV]);
    // the requester's own unit only: the counter has nobody
    const own = await resolve({ step: { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit" }] } });
    expect(own.status).toBe("nobody");
    expect(own.notes).toEqual(["«رئیس شعبه» در «باجهٔ ونک» دارنده‌ای ندارد"]);
    // the case's recorded unit wins over the profile's
    expect(users(await resolve({ requesterUnit: U.tajrish, step: { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit" }] } }))).toEqual([M.headT]);
  });

  it("ignores holders outside their dates (an expired one, one not started yet)", async () => {
    const up = await resolve({ requestedBy: M.r2, step: { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }] } });
    expect(up.status).toBe("nobody");
    expect(up.notes).toEqual(["«رئیس شعبه» در واحدهای نوع «شعبه» از واحد درخواست‌دهنده تا بالا دارنده‌ای ندارد"]);
    expect(users(await resolve({ step: { assignees: [{ kind: "position", position: "branch_head", where: "anywhere" }] } }))).toEqual(sorted(M.headV, M.headT));
    // on a day the former head still held it, and once the next one starts
    expect(users(await resolve({ requestedBy: M.r2, at: Date.now() - 3 * DAY, step: { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit" }] } }))).toEqual([M.headOld]);
    expect(users(await resolve({ requestedBy: M.r2, at: Date.now() + 2 * DAY, step: { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit" }] } }))).toEqual([M.headNext]);
  });

  it("takes a fixed unit or the unit a form field names; an inactive position finds nobody", async () => {
    const fixed = await resolve({ step: { assignees: [{ kind: "position", position: "branch_head", where: "unit", unit: U.tajrish }] } });
    expect(fixed.people).toEqual([{ user: M.headT, delegatedFrom: null, via: { rule: 0, kind: "position", position: "branch_head", unit: U.tajrish, holderKind: "acting" } }]);
    expect(users(await resolve({ values: { u_branch: U.tajrish }, step: { assignees: [{ kind: "position", position: "branch_head", where: "unit_field", unitField: "u_branch" }] } }))).toEqual([M.headT]);
    const empty = await resolve({ values: {}, step: { assignees: [{ kind: "position", position: "branch_head", where: "unit_field", unitField: "u_branch" }] } });
    expect([empty.status, empty.notes]).toEqual(["nobody", ["فیلد واحد خالی است"]]);
    const retired = await resolve({ step: { assignees: [{ kind: "position", position: "old_post", where: "anywhere" }] } });
    expect([retired.status, retired.notes]).toEqual(["nobody", ["نقش سازمانی «سمت قدیمی» غیرفعال است"]]);
    // a position without a unit kind, held with and without a unit
    expect(users(await resolve({ step: { assignees: [{ kind: "position", position: "credit_officer", where: "anywhere" }] } }))).toEqual(sorted(M.officer1, M.officer2));
  });

  it("narrows to `members`; an empty intersection falls back, then «if nobody» decides", async () => {
    expect(users(await resolve({ step: { assignees: [{ kind: "position", position: "branch_head", where: "anywhere", members: [M.headT] }] } }))).toEqual([M.headT]);
    // only Tajrish's head, «if they are in that branch»: the requester's branch is Vanak
    const only = { kind: "position" as const, position: "branch_head", where: "requester_unit_up" as const, unitKind: "branch", members: [M.headT] };
    const fallback = await resolve({ step: { assignees: [only], fallback: [{ kind: "manager", of: "requester" }] } });
    expect(fallback).toMatchObject({ status: "ok", fallbackUsed: true });
    expect(fallback.people).toEqual([{ user: M.m1, delegatedFrom: null, via: { rule: 0, kind: "manager", fallback: true } }]);
    expect(fallback.notes).toEqual(["افراد برگزیده در میان دارندگان «رئیس شعبه» نیستند"]);
    const wait = await resolve({ label: "تأیید رئیس شعبه", step: { assignees: [only] } });
    expect(wait).toMatchObject({ status: "nobody", ifNobody: "wait", people: [], message: "برای «تأیید رئیس شعبه» کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند." });
    const skip = await resolve({ step: { assignees: [only], ifNobody: "skip" } });
    expect([skip.status, skip.message]).toEqual(["nobody", "برای این مرحله کسی پیدا نشد؛ از این مرحله گذشت."]);
    const managers = await resolve({ step: { assignees: [only], ifNobody: "managers" }, managers: [M.regionHead], managerGroups: [credit] });
    expect(managers.status).toBe("managers");
    expect(users(managers)).toEqual(sorted(M.regionHead, M.officer1, M.officer2, M.lead));
    expect(managers.people.every((p) => p.via.kind === "managers")).toBe(true);
  });
});

describe("the other rules", () => {
  it("groups (members and leads, not observers), access roles, named people, the requester", async () => {
    expect(users(await resolve({ step: { assignees: [{ kind: "group", group: credit }] } }))).toEqual(sorted(M.officer1, M.officer2, M.lead));
    expect(users(await resolve({ step: { assignees: [{ kind: "group", group: credit, leadsOnly: true }] } }))).toEqual([M.lead]);
    expect(users(await resolve({ step: { assignees: [{ kind: "group", group: credit, members: [M.officer2, M.observer] }] } }))).toEqual([M.officer2]);
    // an access role: on the profile, or through an active group's roles
    expect(users(await resolve({ step: { assignees: [{ kind: "role", role: "change_manager" }] } }))).toEqual(sorted(M.cm1, M.cm2));
    expect(users(await resolve({ step: { assignees: [{ kind: "role", role: "tenant_admin" }] } }))).toEqual([e.ownerId]);
    expect(users(await resolve({ step: { assignees: [{ kind: "users", users: [M.officer1, M.lead] }] } }))).toEqual(sorted(M.officer1, M.lead));
    expect(users(await resolve({ step: { assignees: [{ kind: "requester" }] } }))).toEqual([M.r1]);
    // rules are united, first rule first, each person once
    const union = await resolve({ step: { assignees: [{ kind: "users", users: [M.lead] }, { kind: "group", group: credit, leadsOnly: true }, { kind: "requester" }] } });
    expect(union.people.map((p) => [p.user, p.via.rule])).toEqual([[M.lead, 0], [M.r1, 2]]);
  });

  it("an access role is held as the access model reads roles: through a role containing it, and by members without roles through their membership's fallback", async () => {
    const plain = await person("بی‌نقش");
    const viewer = await person("بیننده", { role: "viewer" });
    const asker = await person("فقط درخواست‌دهنده", { roles: ["requester"] });
    const teamLead = await person("سرپرست گروه", { roles: ["team_lead"] });
    // a role of the organisation's own that contains agent
    const custom = { name: "کارمند شعبه", description: "", persona: "agent", grants: {}, field_groups: [], contains: ["agent"], workspaces: "member", domains: "own", active: true };
    await e.owner.put(`${P}/access/roles/branch_staff`, custom);
    const staff = await person("کارمند شعبه", { roles: ["branch_staff"] });
    const all = [plain, viewer, asker, teamLead, staff, M.cm1, M.cm2];
    const holders = async (role: string) => users(await resolve({ step: { assignees: [{ kind: "role", role, members: all }] } }));
    // agent: the fallback of a member without roles, and inside team_lead, change_manager (profile or group) and branch_staff
    expect(await holders("agent")).toEqual(sorted(plain, teamLead, staff, M.cm1, M.cm2));
    // auditor: the fallback of a viewer without roles
    expect(await holders("auditor")).toEqual([viewer]);
    // requester: inside agent, so every agent above holds it too (the closure is transitive)
    expect(await holders("requester")).toEqual(sorted(plain, asker, teamLead, staff, M.cm1, M.cm2));
    // a role switched off is held by nobody, and its holders do not fall back to their membership's role
    await e.owner.put(`${P}/access/roles/branch_staff`, { ...custom, active: false });
    expect(await holders("branch_staff")).toEqual([]);
    expect(await holders("agent")).toEqual(sorted(plain, teamLead, M.cm1, M.cm2));
  });

  it("the manager to depth three, of the requester or of the previous actor; the head of a unit", async () => {
    for (const [depth, who] of [[1, M.m1], [2, M.m2], [3, M.m3]] as const) expect(users(await resolve({ step: { assignees: [{ kind: "manager", of: "requester", depth }] } }))).toEqual([who]);
    expect(users(await resolve({ previousActor: M.m1, step: { assignees: [{ kind: "manager", of: "previous_actor" }] } }))).toEqual([M.m2]);
    const none = await resolve({ requestedBy: M.r3, step: { assignees: [{ kind: "manager", of: "requester" }] } });
    expect([none.status, none.notes]).toEqual(["nobody", ["درخواست‌دهنده مدیر مستقیم ندارد"]]);
    // the head of the requester's unit: the counter has none; its branch has; so has the region
    const counter = await resolve({ step: { assignees: [{ kind: "unit_head", of: "requester" }] } });
    expect([counter.status, counter.notes]).toEqual(["nobody", ["«باجهٔ ونک» رئیس ندارد"]]);
    const branch = await resolve({ step: { assignees: [{ kind: "unit_head", of: "requester", unitKind: "branch" }] } });
    expect(branch.people).toEqual([{ user: M.headV, delegatedFrom: null, via: { rule: 0, kind: "unit_head", unit: U.vanak } }]);
    expect(users(await resolve({ step: { assignees: [{ kind: "unit_head", of: "requester", unitKind: "division" }] } }))).toEqual([M.regionHead]);
    expect(users(await resolve({ values: { u_unit: U.north }, step: { assignees: [{ kind: "unit_head", of: "unit_field", unitField: "u_unit" }] } }))).toEqual([M.regionHead]);
  });

  it("person fields of the case (one, several, a group) and whoever did an earlier step", async () => {
    const values = { u_owner: M.officer1, u_reviewers: [M.officer2, M.lead], u_team: credit };
    const fieldTypes = { u_owner: "user", u_reviewers: "users", u_team: "group" };
    expect(users(await resolve({ values, fieldTypes, step: { assignees: [{ kind: "field", field: "u_owner" }] } }))).toEqual([M.officer1]);
    expect(users(await resolve({ values, fieldTypes, step: { assignees: [{ kind: "field", field: "u_reviewers" }] } }))).toEqual(sorted(M.officer2, M.lead));
    expect(users(await resolve({ values, fieldTypes, step: { assignees: [{ kind: "field", field: "u_team" }] } }))).toEqual(sorted(M.officer1, M.officer2, M.lead));
    expect(users(await resolve({ stepActors: { fill: [M.officer2] }, step: { assignees: [{ kind: "step_actor", step: "fill" }] } }))).toEqual([M.officer2]);
  });

  it("only active members stay", async () => {
    const gone = await person("کارمند رفته", { active: false });
    expect(users(await resolve({ step: { assignees: [{ kind: "users", users: [gone, M.lead] }] } }))).toEqual([M.lead]);
  });
});

describe("separation of duties", () => {
  const heads: StepAssignees = { assignees: [{ kind: "position", position: "branch_head", where: "anywhere" }] };
  it("an approve step never goes to the requester (who filed it, or for whom), unless the step says so", async () => {
    expect(users(await resolve({ action: "approve", requestedBy: M.headV, step: heads }))).toEqual([M.headT]);
    expect(users(await resolve({ action: "approve", requestedBy: M.r1, requestedFor: M.headT, step: heads }))).toEqual([M.headV]);
    expect(users(await resolve({ action: "fill", requestedBy: M.headV, step: heads }))).toEqual(sorted(M.headV, M.headT));
    expect(users(await resolve({ action: "approve", requestedBy: M.headV, step: { ...heads, exclude: [] } }))).toEqual(sorted(M.headV, M.headT));
    // the requester's own branch head is the requester: nobody, then the fallback
    const own = await resolve({ action: "approve", requestedBy: M.headV, step: { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit" }], fallback: [{ kind: "unit_head", of: "requester", unitKind: "division" }] } });
    expect(own).toMatchObject({ status: "ok", fallbackUsed: true });
    expect(users(own)).toEqual([M.regionHead]);
  });

  it("leaves out earlier actors, or one step's", async () => {
    const stepActors = { fill: [M.headT], review: [M.officer1] };
    expect(users(await resolve({ stepActors, step: { ...heads, exclude: ["earlier_actors"] } }))).toEqual([M.headV]);
    expect(users(await resolve({ stepActors, step: { assignees: [{ kind: "group", group: credit }], exclude: ["step:review"] } }))).toEqual(sorted(M.officer2, M.lead));
  });
});

describe("a rule with a wrong value (a draft not checked yet)", () => {
  it("finds nobody — never a wider pool — and an approve step keeps separation of duties", async () => {
    const somewhere = await resolve({ step: { assignees: [{ kind: "position", position: "branch_head", where: "somewhere" as never }] } });
    expect([somewhere.status, somewhere.notes]).toEqual(["nobody", ["محدودهٔ نقش سازمانی معتبر نیست"]]);
    // a members filter of no one known is nobody, not every holder
    const junk = await resolve({ step: { assignees: [{ kind: "position", position: "branch_head", where: "anywhere", members: ["not-an-id"] }] } });
    expect([junk.status, junk.notes]).toEqual(["nobody", ["افراد برگزیده در میان دارندگان «رئیس شعبه» نیستند"]]);
    expect(users(await resolve({ step: { assignees: [{ kind: "group", group: credit, leadsOnly: "yes" as never }] } }))).toEqual([M.lead]);
    const of = await resolve({ step: { assignees: [{ kind: "manager", of: "someone" as never }] } });
    expect([of.status, of.notes]).toEqual(["nobody", ["قاعدهٔ «مدیر مستقیم» معتبر نیست"]]);
    expect((await resolve({ step: { assignees: [{ kind: "manager", of: "requester", depth: 9 as never }] } })).status).toBe("nobody");
    const head = await resolve({ step: { assignees: [{ kind: "unit_head", of: "branch" as never, unitKind: "branch" }] } });
    expect([head.status, head.notes]).toEqual(["nobody", ["قاعدهٔ «رئیس واحد» معتبر نیست"]]);
    // an exclusion the rules do not know never lifts separation of duties
    const sod = await resolve({ action: "approve", requestedBy: M.headV, step: { assignees: [{ kind: "position", position: "branch_head", where: "anywhere" }], exclude: ["Requester" as never] } });
    expect(users(sod)).toEqual([M.headT]);
    // the preview refuses such a step with the validator's reason
    const refused = await e.owner.post(`${P}/positions/resolve`, { step: { assignees: [{ kind: "position", position: "branch_head", where: "somewhere" }] }, action: "fill", requester: M.r1 }, 400);
    expect(refused.error.details.problems).toEqual([{ path: "assignees.0", message: "محدودهٔ نقش سازمانی معتبر نیست" }]);
  });
});

describe("delegation by action", () => {
  let d1: string;
  let d2: string;
  let d3: string;
  beforeAll(async () => {
    d1 = await person("جانشین تأیید");
    d2 = await person("جانشین کارها");
    d3 = await person("جانشین مرخصی");
    const now = Date.now();
    await sys.write(async (tx) => {
      // Tajrish's head: approvals to d1, now; Vanak's head: assignments to d2; an ended one that no longer counts
      await createIn(tx, sys, "delegation", { from_user: M.headT, to_user: d1, starts_at: new Date(now - DAY).toISOString(), ends_at: new Date(now + DAY).toISOString(), scopes: ["approvals"], active: true }, { trusted: true });
      await createIn(tx, sys, "delegation", { from_user: M.headV, to_user: d2, starts_at: new Date(now - DAY).toISOString(), scopes: ["assignments"], active: true }, { trusted: true });
      await createIn(tx, sys, "delegation", { from_user: M.officer2, to_user: d2, starts_at: new Date(now - 3 * DAY).toISOString(), ends_at: new Date(now - DAY).toISOString(), scopes: ["approvals", "assignments"], active: true }, { trusted: true });
    });
  });

  it("approve reads «approvals» delegations; fill and review read «assignments»", async () => {
    const tajrish: StepAssignees = { assignees: [{ kind: "position", position: "branch_head", where: "unit", unit: U.tajrish }] };
    const approve = await resolve({ action: "approve", step: tajrish });
    expect(approve.people).toEqual([{ user: d1, delegatedFrom: M.headT, via: { rule: 0, kind: "position", position: "branch_head", unit: U.tajrish, holderKind: "acting" } }]);
    expect(approve.people[0].delegatedFrom).toBe(M.headT);
    expect(users(await resolve({ action: "fill", step: tajrish }))).toEqual([M.headT]);
    const vanak: StepAssignees = { assignees: [{ kind: "position", position: "branch_head", where: "unit", unit: U.vanak }] };
    expect((await resolve({ action: "review", step: vanak })).people.map((p) => [p.user, p.delegatedFrom])).toEqual([[d2, M.headV]]);
    expect(users(await resolve({ action: "approve", step: vanak }))).toEqual([M.headV]);
    // a delegation that ended counts no more
    expect(users(await resolve({ action: "fill", step: { assignees: [{ kind: "users", users: [M.officer2] }] } }))).toEqual([M.officer2]);
  });

  it("without a delegation row, the out-of-office delegate stands in — for every action, while the absence lasts", async () => {
    const officer1 = (await e.db.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2`, [e.org, M.officer1]))!.id;
    await sys.write((tx) => updateIn(tx, sys, "member_profile", officer1, { out_of_office: true, ooo_until: new Date(Date.now() + DAY).toISOString(), delegate_id: d3 }, { trusted: true }));
    const step: StepAssignees = { assignees: [{ kind: "users", users: [M.officer1] }] };
    for (const action of ["approve", "fill", "review"] as const) expect((await resolve({ action, step })).people.map((p) => [p.user, p.delegatedFrom])).toEqual([[d3, M.officer1]]);
    // the absence is over: the person again
    await sys.write((tx) => updateIn(tx, sys, "member_profile", officer1, { ooo_until: new Date(Date.now() - 60_000).toISOString() }, { trusted: true }));
    expect(users(await resolve({ action: "approve", step }))).toEqual([M.officer1]);
    await sys.write((tx) => updateIn(tx, sys, "member_profile", officer1, { out_of_office: false, ooo_until: null }, { trusted: true }));
  });

  it("never hands a step to an inactive delegate, nor to someone the step excludes", async () => {
    const tajrish: StepAssignees = { assignees: [{ kind: "position", position: "branch_head", where: "unit", unit: U.tajrish }] };
    // the requester is Tajrish's delegate: the approval stays with the head (separation of duties)
    expect(users(await resolve({ action: "approve", requestedBy: d1, step: tajrish }))).toEqual([M.headT]);
    await e.db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [e.org, d1]);
    expect(users(await resolve({ action: "approve", step: tajrish }))).toEqual([M.headT]);
    await e.db.query(`update sm_org_members set is_active = true where org_id = $1 and user_id = $2`, [e.org, d1]);
  });

  it("each person found keeps their place: a shared deputy stands in once for each, and a candidate who is another's delegate keeps their own", async () => {
    const [a, b, c, x, y] = [await person("الف"), await person("ب"), await person("جانشین مشترک"), await person("ج"), await person("د")];
    const away = async (user: string, delegate: string) => {
      const id = (await e.db.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2`, [e.org, user]))!.id;
      await sys.write((tx) => updateIn(tx, sys, "member_profile", id, { out_of_office: true, ooo_until: new Date(Date.now() + DAY).toISOString(), delegate_id: delegate }, { trusted: true }));
    };
    await away(a, c);
    await away(b, c);
    const both = await resolve({ action: "approve", quorum: "all", step: { assignees: [{ kind: "users", users: [a, b] }] } });
    expect(both.people.map((p) => [p.user, p.delegatedFrom])).toEqual([[c, a], [c, b]]);
    // x hands approvals to y, and both are candidates: y acts for x and for themselves, whatever the order
    await sys.write((tx) => createIn(tx, sys, "delegation", { from_user: x, to_user: y, starts_at: new Date(Date.now() - DAY).toISOString(), scopes: ["approvals"], active: true }, { trusted: true }));
    expect((await resolve({ action: "approve", step: { assignees: [{ kind: "users", users: [x, y] }] } })).people.map((p) => [p.user, p.delegatedFrom])).toEqual([[y, x], [y, null]]);
    expect((await resolve({ action: "approve", step: { assignees: [{ kind: "users", users: [y, x] }] } })).people.map((p) => [p.user, p.delegatedFrom])).toEqual([[y, null], [y, x]]);
  });
});

describe("pool limits", () => {
  let tellers: string[];
  beforeAll(async () => {
    POS.teller = await position("teller", "تحویلدار", null);
    tellers = [];
    for (let i = 0; i < 101; i++) {
      const id = uuidv7();
      tellers.push(id);
      await e.db.query(`insert into sm_users (id, email, full_name) values ($1, $2, $3)`, [id, `teller${i}-${id.slice(-6)}@bank.test`, `تحویلدار ${i}`]);
      await e.db.query(`insert into sm_org_members (id, org_id, user_id, role) values ($1, $2, $3, 'member')`, [uuidv7(), e.org, id]);
      await e.db.query(`insert into sm_position_holders (id, org_id, position_id, user_id, kind, source) values ($1, $2, $3, $4, 'primary', 'manual')`, [uuidv7(), e.org, POS.teller, id]);
    }
  }, 300_000);

  it("more than 100 people: the step waits for the process managers, who choose from the candidates", async () => {
    const r = await resolve({ step: { assignees: [{ kind: "position", position: "teller", where: "anywhere" }] } });
    expect(r).toMatchObject({ status: "too_many", found: 101, limit: 100, people: [], message: "بیش از ۱۰۰ نفر پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند" });
    expect(r.candidates).toHaveLength(101);
    expect(new Set(r.candidates)).toEqual(new Set(tellers));
    // exactly 100 is a round
    const hundred = await resolve({ step: { assignees: [{ kind: "position", position: "teller", where: "anywhere", members: tellers.slice(0, 100) }] } });
    expect([hundred.status, hundred.found]).toEqual(["ok", 100]);
  });

  it("an approve step whose quorum counts everyone takes at most 50 approvers", async () => {
    const fifty = { assignees: [{ kind: "position" as const, position: "teller", where: "anywhere" as const, members: tellers.slice(0, 50) }] };
    const fiftyOne = { assignees: [{ kind: "position" as const, position: "teller", where: "anywhere" as const, members: tellers.slice(0, 51) }] };
    for (const quorum of ["all", "count", "percent"] as const) {
      expect(await resolve({ action: "approve", quorum, step: fiftyOne })).toMatchObject({ status: "too_many", found: 51, limit: 50, message: "بیش از ۵۰ تأییدکننده پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند" });
      expect((await resolve({ action: "approve", quorum, step: fifty })).status).toBe("ok");
    }
    expect(await resolve({ action: "approve", quorum: "any", step: fiftyOne })).toMatchObject({ status: "ok", found: 51, limit: 100 });
  });
});

describe("the preview and estimate API", () => {
  const branchHead: StepAssignees = { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }], fallback: [{ kind: "manager", of: "requester" }] };

  it("is the runtime's resolution, with names and one line per person", async () => {
    for (const requester of [M.r1, M.r2, M.headV]) {
      const runtime = await resolveAssignees(e.db, sys, { step: branchHead, action: "approve", label: "تأیید رئیس شعبه", requestedBy: requester });
      const preview = await e.owner.post(`${P}/positions/resolve`, { step: branchHead, action: "approve", label: "تأیید رئیس شعبه", requester });
      expect({ status: preview.status, people: preview.people, found: preview.found, limit: preview.limit, fallbackUsed: preview.fallbackUsed, notes: preview.notes, message: preview.message }).toEqual({
        status: runtime.status, people: runtime.people, found: runtime.found, limit: runtime.limit, fallbackUsed: runtime.fallbackUsed, notes: runtime.notes, message: runtime.message,
      });
    }
    const p = await e.owner.post(`${P}/positions/resolve`, { step: branchHead, action: "approve", requester: M.r1 });
    expect(p.lines).toEqual(["رئیس شعبهٔ ونک — رئیس شعبه (شعبهٔ ونک)"]);
    // a delegate's line says for whom
    const tajrish = await e.owner.post(`${P}/positions/resolve`, { step: { assignees: [{ kind: "position", position: "branch_head", where: "unit", unit: U.tajrish }] }, action: "approve", requester: M.r1 });
    expect(tajrish.lines).toEqual(["جانشین تأیید — رئیس شعبه (شعبهٔ تجریش)، به جانشینی از کفیل شعبهٔ تجریش"]);
  });

  it("checks the step first, and answers only designers and the keepers of the structure", async () => {
    const bad = await e.owner.post(`${P}/positions/resolve`, { step: { assignees: [{ kind: "position", position: "ghost", where: "anywhere" }] }, action: "fill", requester: M.r1 }, 400);
    expect(bad.error.message).toBe("نقش سازمانی «ghost» پیدا نشد");
    expect(bad.error.details.problems).toEqual([{ path: "assignees.0", message: "نقش سازمانی «ghost» پیدا نشد" }]);
    const stranger = await e.owner.post(`${P}/positions/resolve`, { step: branchHead, action: "fill", requester: uuidv7() }, 404);
    expect(stranger.error.message).toBe("درخواست‌دهندهٔ نمونه عضو این سازمان نیست");
    const agent = await e.member("member");
    const refused = await agent.client.post(`${P}/positions/resolve`, { step: branchHead, action: "fill", requester: M.r1 }, 403);
    expect(refused.error.message).toBe("پیش‌نمایش انجام‌دهنده‌ها با طراحان گردش‌کار و نگه‌دارندگان ساختار سازمانی است");
    await agent.client.post(`${P}/positions/estimate`, { step: branchHead, action: "fill" }, 403);
  });

  it("estimates a step statically: one line per rule, the most people, the warnings", async () => {
    const est = await e.owner.post(`${P}/positions/estimate`, {
      step: { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }, { kind: "group", group: credit }, { kind: "position", position: "teller", where: "anywhere" }] },
      action: "approve",
      quorum: "all",
    });
    expect(est.rules.map((r: { line: string }) => r.line)).toEqual(["۲ نفر در ۲ شعبه؛ برای هر پرونده «رئیس شعبه» همان شعبه", "۳ نفر در گروه «اعتبارات»", "۱۰۱ نفر «تحویلدار» در همهٔ سازمان"]);
    expect(est.limit).toBe(50);
    expect(est.total).toBeNull();
    expect(est.warnings).toEqual(["تا ۱۰۴ نفر انجام‌دهندهٔ این مرحله می‌شوند؛ بیش از ۵۰ نفر که باشند مرحله منتظر می‌ماند تا مسئولان گردش‌کار برگزینند"]);
  });

  it("words «واحد درخواست‌دهنده» apart from «نزدیک‌ترین واحد بالادست»: only the holder of the requester's own unit takes it", async () => {
    // (1.1.5, RC1: the line read like the nearest unit up's, while a requester in a unit under the branch finds nobody)
    const line = async (rule: Record<string, unknown>) => (await e.owner.post(`${P}/positions/estimate`, { step: { assignees: [rule] }, action: "fill" })).rules[0].line;
    expect(await line({ kind: "position", position: "branch_head", where: "requester_unit" })).toBe("۲ نفر در ۲ شعبه؛ برای هر پرونده فقط «رئیس شعبه» خودِ واحد درخواست‌دهنده");
    expect(await line({ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" })).toBe("۲ نفر در ۲ شعبه؛ برای هر پرونده «رئیس شعبه» همان شعبه");
  });
});

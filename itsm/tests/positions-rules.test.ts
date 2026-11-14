// F3 — the pure side of organisational roles (design F §3.4, D11): the assignee rules of a workflow step as a draft
// stores them (cleaning), their validation with what the designer knows, the pool limits (100 per round, 50 approvers
// when the quorum counts everyone), separation of duties by default on approve steps, the delegation scope by action,
// the designer's static pool estimate and warnings, the static «may this step come to me?», and the directory planner's
// organisational roles: a mapping's position given in the unit it names, only under the approved mappings, taken back
// from the source's own holders when the person leaves the group, never doubling or touching a manual holder.
import { describe, it, expect } from "vitest";
import {
  APPROVER_LIMIT, MAX_RULES, POOL_LIMIT, POOL_WARNING, assigneeProblems, assigneeWarnings, cleanRule, cleanStepAssignees, delegationScope, exclusionsOf, ifNobodyOf,
  mayInclude, nobodyMessage, poolLimit, poolWarnings, ruleEstimate, tooManyMessage, type AssigneeFacts, type StepAssignees,
} from "@shared/process/assignees";
import { holderUnit, mappedAccess, planDirectorySync, planStats, unitOfDepartment, withoutRoleGrants, type DirEntry, type GroupMapping } from "@shared/integration/directory";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { a: id(1), b: id(2), c: id(3), d: id(4) };

describe("assignee rules as a draft stores them", () => {
  it("drop unknown kinds and keys, lower-case ids, keep only what the rule's «where» uses", () => {
    expect(cleanRule({ kind: "nobody" })).toBeNull();
    expect(cleanRule(null)).toBeNull();
    // an unset «where» is «همه‌جا»
    expect(cleanRule({ kind: "position", position: " branch_head ", unit: U.a, extra: 1 })).toEqual({ kind: "position", position: "branch_head", where: "anywhere" });
    expect(cleanRule({ kind: "position", position: "branch_head", where: "unit", unit: U.a.toUpperCase() })).toEqual({ kind: "position", position: "branch_head", where: "unit", unit: U.a });
    expect(cleanRule({ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch", unitField: "u_branch" })).toEqual({ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" });
    expect(cleanRule({ kind: "position", position: "branch_head", where: "unit_field", unitField: "u_branch" })).toMatchObject({ where: "unit_field", unitField: "u_branch" });
    // members: ids deduplicated, lower case; an empty list is no filter; «leads only» off is left out
    expect(cleanRule({ kind: "group", group: U.a.toUpperCase(), members: [U.b, U.b.toUpperCase()], leadsOnly: false })).toEqual({ kind: "group", group: U.a, members: [U.b] });
    expect(cleanRule({ kind: "group", group: U.a, members: [], leadsOnly: true })).toEqual({ kind: "group", group: U.a, leadsOnly: true });
    expect(cleanRule({ kind: "manager", of: "previous_actor", depth: 3 })).toEqual({ kind: "manager", of: "previous_actor", depth: 3 });
    // the requester's manager, one level up, unless the rule says otherwise
    expect(cleanRule({ kind: "manager", depth: 1 })).toEqual({ kind: "manager", of: "requester" });
    expect(cleanRule({ kind: "unit_head", of: "requester", unitField: "u_branch", unitKind: "branch" })).toEqual({ kind: "unit_head", of: "requester", unitKind: "branch" });
    // at most 100 named people
    const many = Array.from({ length: 140 }, (_, i) => id(100 + i));
    expect((cleanRule({ kind: "users", users: many }) as { users: string[] }).users).toHaveLength(100);
  });

  it("keep at most ten rules, each exclusion once and «if nobody» (either spelling)", () => {
    const step = cleanStepAssignees({
      assignees: [...Array.from({ length: 14 }, () => ({ kind: "requester" })), { kind: "bogus" }],
      exclude: ["requester", "requester", "step:fill_1"],
      fallback: [{ kind: "users", users: [U.a] }],
      if_nobody: "managers",
    });
    expect(step.assignees).toHaveLength(MAX_RULES);
    expect(step.exclude).toEqual(["requester", "step:fill_1"]);
    expect(step.fallback).toEqual([{ kind: "users", users: [U.a] }]);
    expect(step.ifNobody).toBe("managers");
    expect(ifNobodyOf(cleanStepAssignees({ assignees: [] }))).toBe("wait");
  });

  it("keep a wrong value for the validator to name — never another, wider rule", () => {
    // an unknown «where» is not «همه‌جا»; a members filter never vanishes; «leads only», the manager's «of» and depth,
    // the unit head's «of», an exclusion and «if nobody» stay as written
    const raw = {
      assignees: [
        { kind: "position", position: "branch_head", where: "somewhere", unit: U.a },
        { kind: "position", position: "branch_head", where: "anywhere", members: ["not-an-id"] },
        { kind: "group", group: U.a, members: [U.b, "not-an-id"], leadsOnly: "yes" },
        { kind: "manager", of: "someone", depth: 9 },
        { kind: "unit_head", of: "branch" },
      ],
      exclude: ["Requester"],
      ifNobody: "panic",
    };
    const step = cleanStepAssignees(raw);
    expect(step).toEqual({
      assignees: [
        { kind: "position", position: "branch_head", where: "somewhere" },
        { kind: "position", position: "branch_head", where: "anywhere", members: ["not-an-id"] },
        { kind: "group", group: U.a, members: [U.b, "not-an-id"], leadsOnly: "yes" },
        { kind: "manager", of: "someone", depth: 9 },
        { kind: "unit_head", of: "branch" },
      ],
      exclude: ["Requester"],
      ifNobody: "panic",
    });
    // a single id given as a string is a one-person filter, not none
    expect(cleanRule({ kind: "group", group: U.a, members: U.b.toUpperCase() })).toEqual({ kind: "group", group: U.a, members: [U.b] });
    // the validator names each one, with or without what the designer knows
    expect(assigneeProblems(step).map((p) => `${p.path}: ${p.message}`)).toEqual([
      "assignees.0: محدودهٔ نقش سازمانی معتبر نیست",
      "assignees.1: یکی از افراد برگزیده شناخته نیست",
      "assignees.2: «فقط سرپرستان گروه» بله یا خیر است",
      "assignees.2: یکی از افراد برگزیده شناخته نیست",
      "assignees.3: مدیر چه کسی؟ درخواست‌دهنده یا انجام‌دهندهٔ قبلی را برگزینید",
      "assignees.3: سطح مدیر از ۱ تا ۳ است",
      "assignees.4: رئیس کدام واحد؟ واحد درخواست‌دهنده یا فیلد فرم را برگزینید",
      "exclude: یکی از کنارگذاشته‌ها شناخته نیست",
      "ifNobody: «اگر کسی نبود» معتبر نیست",
    ]);
    // until it is fixed, the safe side holds: separation of duties on approve steps, and «wait»
    expect(exclusionsOf(step, "approve")).toEqual(["requester"]);
    expect(exclusionsOf({ exclude: ["earlier_actors", "everyone" as never] }, "approve")).toEqual(["earlier_actors", "requester"]);
    expect(exclusionsOf({ exclude: ["everyone" as never] }, "fill")).toEqual([]);
    expect(ifNobodyOf(step)).toBe("wait");
    // an empty list is the step's own choice: nobody is left out
    expect(exclusionsOf(cleanStepAssignees({ assignees: [], exclude: [] }), "approve")).toEqual([]);
  });
});

describe("validating a step's people with what the designer knows", () => {
  const facts: AssigneeFacts = {
    position: (k) => ({ branch_head: { name: "رئیس شعبه", active: true, unitKind: "branch" }, old_post: { name: "سمت قدیمی", active: false, unitKind: null } } as Record<string, { name: string; active: boolean; unitKind: string | null }>)[k],
    group: (g) => (g === U.a ? { name: "اعتبارات", active: true } : g === U.b ? { name: "گروه بایگانی", active: false } : null),
    role: (k) => (k === "agent" ? { name: "کارشناس" } : null),
    unit: (u) => (u === U.c ? { name: "ادارهٔ مالی", kind: "department", active: true } : u === U.d ? { name: "شعبهٔ ونک", kind: "branch", active: true } : null),
    member: (u) => u !== U.b,
    field: (f) => ({ u_branch: { label: "شعبه", type: "ref", ref: "org_unit" }, u_owner: { label: "مسئول", type: "user" }, u_note: { label: "شرح", type: "text" } } as Record<string, { label: string; type: string; ref?: string }>)[f],
    step: (s) => (s === "fill" ? { label: "ثبت درخواست" } : null),
    unitKinds: ["branch", "department", "team"],
  };
  const problems = (step: StepAssignees) => assigneeProblems(cleanStepAssignees(step), facts).map((p) => `${p.path}: ${p.message}`);

  it("accept a sound step", () => {
    expect(problems({ assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }, { kind: "field", field: "u_owner" }], fallback: [{ kind: "manager", of: "requester", depth: 2 }], exclude: ["step:fill"] })).toEqual([]);
  });

  it("say what is missing or wrong, rule by rule", () => {
    expect(problems({ assignees: [] })).toEqual(["assignees: این مرحله انجام‌دهنده ندارد"]);
    expect(problems({ assignees: [{ kind: "position", position: "", where: "anywhere" }] })).toEqual(["assignees.0: نقش سازمانی را انتخاب کنید"]);
    expect(problems({ assignees: [{ kind: "position", position: "ghost", where: "anywhere" }] })).toEqual(["assignees.0: نقش سازمانی «ghost» پیدا نشد"]);
    expect(problems({ assignees: [{ kind: "position", position: "old_post", where: "anywhere" }] })).toEqual(["assignees.0: نقش سازمانی «سمت قدیمی» غیرفعال است"]);
    expect(problems({ assignees: [{ kind: "position", position: "branch_head", where: "unit", unit: U.c }] })).toEqual(["assignees.0: «ادارهٔ مالی» از نوع واحدهای «رئیس شعبه» نیست"]);
    expect(problems({ assignees: [{ kind: "position", position: "branch_head", where: "unit", unit: U.d }] })).toEqual([]);
    expect(problems({ assignees: [{ kind: "position", position: "branch_head", where: "unit_field", unitField: "u_owner" }] })).toEqual(["assignees.0: «مسئول» فیلد واحد سازمانی نیست"]);
    expect(problems({ assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "department" }] })).toEqual([
      "assignees.0: «رئیس شعبه» در واحدهایی از نوع دیگری است؛ نوع واحد را همان بگذارید",
    ]);
    expect(problems({ assignees: [{ kind: "group", group: "IT" }] })).toEqual(["assignees.0: گروه را انتخاب کنید"]);
    expect(problems({ assignees: [{ kind: "group", group: U.b }] })).toEqual(["assignees.0: گروه «گروه بایگانی» غیرفعال است"]);
    expect(problems({ assignees: [{ kind: "role", role: "banker" }] })).toEqual(["assignees.0: نقش دسترسی «banker» پیدا نشد"]);
    expect(problems({ assignees: [{ kind: "users", users: [] }] })).toEqual(["assignees.0: دست‌کم یک نفر را برگزینید"]);
    expect(problems({ assignees: [{ kind: "users", users: [U.a, U.b] }] })).toEqual(["assignees.0: یکی از افراد برگزیده دیگر عضو فعال سازمان نیست"]);
    expect(problems({ assignees: [{ kind: "field", field: "u_note" }] })).toEqual(["assignees.0: «شرح» فیلد شخص، چند شخص یا گروه نیست"]);
    expect(problems({ assignees: [{ kind: "step_actor", step: "approve_2" }] })).toEqual(["assignees.0: مرحلهٔ برگزیده پیش از این مرحله نیست"]);
    expect(problems({ assignees: [{ kind: "requester" }], fallback: [{ kind: "unit_head", of: "unit_field", unitField: "u_missing" }] })).toEqual(["fallback.0: فیلد «u_missing» در فرم‌های این گردش‌کار نیست"]);
    expect(assigneeProblems({ assignees: [{ kind: "requester" }], exclude: ["step:approve_2" as const] }, facts).map((p) => p.message)).toEqual(["مرحلهٔ کنارگذاشته پیش از این مرحله نیست"]);
    expect(assigneeProblems({ assignees: [{ kind: "requester" }], ifNobody: "panic" as never }, facts).map((p) => p.message)).toEqual(["«اگر کسی نبود» معتبر نیست"]);
  });
});

describe("pools, separation of duties and delegation scopes", () => {
  it("cap a round at 100 people, and approvers at 50 when the quorum counts everyone", () => {
    expect([POOL_LIMIT, APPROVER_LIMIT, POOL_WARNING]).toEqual([100, 50, 30]);
    expect(poolLimit("approve", "all")).toBe(50);
    expect(poolLimit("approve", "count")).toBe(50);
    expect(poolLimit("approve", "percent")).toBe(50);
    expect(poolLimit("approve", "any")).toBe(100);
    expect(poolLimit("approve", "first")).toBe(100);
    expect(poolLimit("fill", "all")).toBe(100);
    expect(poolLimit("review", null)).toBe(100);
    expect(tooManyMessage(100)).toBe("بیش از ۱۰۰ نفر پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند");
    expect(tooManyMessage(50)).toBe("بیش از ۵۰ تأییدکننده پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند");
    expect(nobodyMessage("تأیید رئیس شعبه")).toBe("برای «تأیید رئیس شعبه» کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند.");
    expect(nobodyMessage(null, "skip")).toBe("برای این مرحله کسی پیدا نشد؛ از این مرحله گذشت.");
  });

  it("leave the requester out of approve steps unless the step says otherwise", () => {
    expect(exclusionsOf({}, "approve")).toEqual(["requester"]);
    expect(exclusionsOf({}, "fill")).toEqual([]);
    expect(exclusionsOf({}, "review")).toEqual([]);
    expect(exclusionsOf({ exclude: [] }, "approve")).toEqual([]);
    expect(exclusionsOf({ exclude: ["earlier_actors"] }, "fill")).toEqual(["earlier_actors"]);
    expect(assigneeWarnings({ assignees: [{ kind: "requester" }] }, "approve")).toEqual(["درخواست‌دهنده از این مرحله کنار گذاشته شده است؛ قاعدهٔ «درخواست‌دهنده» کسی را نمی‌یابد"]);
    expect(assigneeWarnings({ assignees: [{ kind: "requester" }] }, "fill")).toEqual([]);
  });

  it("read approvals delegations for approve steps and assignments for fill and review", () => {
    expect(delegationScope("approve")).toBe("approvals");
    expect(delegationScope("fill")).toBe("assignments");
    expect(delegationScope("review")).toBe("assignments");
  });

  it("estimate pools for the designer: static counts, warnings from 30, the limit the step passes", () => {
    const counts = { holders: (p: string, unit?: string | null) => (p === "branch_head" ? (unit ? 1 : 48) : 0), group: (_g: string, leads?: boolean) => (leads ? 2 : 35), role: () => 12 };
    expect(ruleEstimate({ kind: "position", position: "branch_head", where: "anywhere" }, counts)).toBe(48);
    expect(ruleEstimate({ kind: "position", position: "branch_head", where: "unit", unit: U.d }, counts)).toBe(1);
    expect(ruleEstimate({ kind: "position", position: "branch_head", where: "requester_unit_up" }, counts)).toBeNull();
    expect(ruleEstimate({ kind: "position", position: "branch_head", where: "requester_unit", members: [U.a, U.c] }, counts)).toBe(2);
    expect(ruleEstimate({ kind: "group", group: U.a, leadsOnly: true }, counts)).toBe(2);
    expect(ruleEstimate({ kind: "users", users: [U.a, U.b] }, counts)).toBe(2);
    expect(ruleEstimate({ kind: "manager", of: "requester" }, counts)).toBe(1);
    expect(poolWarnings({ assignees: [{ kind: "group", group: U.a }] }, "fill", null, counts)).toEqual(["تا ۳۵ نفر انجام‌دهندهٔ این مرحله می‌شوند؛ برای هر نفر یک کار ساخته می‌شود"]);
    expect(poolWarnings({ assignees: [{ kind: "position", position: "branch_head", where: "anywhere" }, { kind: "group", group: U.a }] }, "approve", "all", counts)).toEqual([
      "تا ۸۳ نفر انجام‌دهندهٔ این مرحله می‌شوند؛ بیش از ۵۰ نفر که باشند مرحله منتظر می‌ماند تا مسئولان گردش‌کار برگزینند",
    ]);
    expect(poolWarnings({ assignees: [{ kind: "role", role: "agent" }] }, "fill", null, counts)).toEqual([]);
    expect(assigneeWarnings({ assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", members: [U.a] }] }, "approve")).toEqual([
      "«فقط این افراد» با محدودهٔ پویا یعنی «اگر در آن واحد باشند»؛ ممکن است برای پرونده‌ای کسی نماند",
    ]);
  });

  it("tell statically whether a step may come to a person (positions, groups, roles, named people; never their own approval)", () => {
    const me = { user: U.a, positions: [{ position: "branch_head", unit: U.d }], groups: [U.c], leadGroups: [], roles: ["agent"] };
    expect(mayInclude({ assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up" }] }, "approve", me)).toBe(true);
    expect(mayInclude({ assignees: [{ kind: "position", position: "branch_head", where: "unit", unit: U.c }] }, "approve", me)).toBe(false);
    expect(mayInclude({ assignees: [{ kind: "group", group: U.c, leadsOnly: true }] }, "fill", me)).toBe(false);
    expect(mayInclude({ assignees: [{ kind: "role", role: "agent", members: [U.b] }] }, "fill", me)).toBe(false);
    expect(mayInclude({ assignees: [{ kind: "users", users: [U.a] }] }, "fill", me)).toBe(true);
    expect(mayInclude({ assignees: [{ kind: "manager", of: "requester" }] }, "fill", me)).toBe(false);
    expect(mayInclude({ assignees: [{ kind: "users", users: [U.a] }] }, "approve", me, U.a)).toBe(false);
  });
});

describe("Active Directory group mappings to organisational roles (the planner)", () => {
  const HEADS = "CN=Branch-Heads,OU=Groups,DC=corp,DC=test";
  const TELLERS = "CN=Tellers,OU=Groups,DC=corp,DC=test";
  const P = { head: id(50), teller: id(51), old: id(52), any: id(53) };
  const units = [
    { id: id(10), name: "شعبهٔ ونک", code: "1001", kind: "branch" },
    { id: id(11), name: "شعبهٔ تجریش", code: "1002", kind: "branch" },
    { id: id(12), name: "ادارهٔ مالی", code: "FIN", kind: "department" },
  ];
  const positions = [
    { id: P.head, name: "رئیس شعبه", unit_kind: "branch", active: true },
    { id: P.teller, name: "تحویلدار", unit_kind: "branch", active: true },
    { id: P.old, name: "سمت قدیمی", unit_kind: null, active: false },
    { id: P.any, name: "کارشناس اعتبارات", unit_kind: null, active: true },
  ];
  const mappings: GroupMapping[] = [
    { source: HEADS, group_id: null, position_id: P.head.toUpperCase(), unit_from: "department" },
    { source: TELLERS, group_id: null, position_id: P.teller, unit_from: id(11) },
  ];
  const options = { default_role: "requester", deactivate_missing: true, unit_from: "none" as const, auto_roles: false };
  const entry = (name: string, groups: string[], department: string | null, active = true): DirEntry => ({ external_id: `CN=${name},OU=Staff,DC=corp,DC=test`, email: `${name}@corp.test`, name, groups, department, active });
  const member = (n: number, email: string, unit_id: string | null = null) => ({ user_id: id(n), email, name: email, active: true, role: "member", roles: [], groups: [], unit_id });

  it("read a mapping's position and where its unit comes from", () => {
    expect(mappedAccess(mappings, [HEADS, TELLERS]).positions).toEqual([
      { position_id: P.head, unit_from: "department", source: HEADS },
      { position_id: P.teller, unit_from: id(11), source: TELLERS },
    ]);
    expect(unitOfDepartment(units, "  شعبهٔ   ونک ")?.id).toBe(id(10));
    expect(unitOfDepartment(units, "1002")?.id).toBe(id(11));
    const pos = positions[0];
    expect(holderUnit({ position_id: P.head, unit_from: "department", source: HEADS }, { department: "1001", personUnit: null, units, position: pos })).toEqual({ unit_id: id(10), problem: null });
    expect(holderUnit({ position_id: P.head, unit_from: "department", source: HEADS }, { department: "ادارهٔ مالی", personUnit: null, units, position: pos }).problem).toBe("«ادارهٔ مالی» از نوع واحدهای «رئیس شعبه» نیست");
    expect(holderUnit({ position_id: P.head, unit_from: "department", source: HEADS }, { department: "شعبهٔ پونک", personUnit: null, units, position: pos }).problem).toBe("واحدی به نام یا کد «شعبهٔ پونک» نیست");
    expect(holderUnit({ position_id: P.head, unit_from: "department", source: HEADS }, { department: "شعبهٔ پونک", personUnit: null, pendingUnit: "شعبهٔ پونک", units, position: pos }).problem).toBe(
      "واحد «شعبهٔ پونک» در همین اجرا ساخته می‌شود؛ «رئیس شعبه» در همگام‌سازی بعدی داده می‌شود",
    );
    expect(holderUnit({ position_id: P.head, unit_from: "department", source: HEADS }, { department: "", personUnit: null, units, position: pos }).problem).toBe("بخش (department) این شخص در فهرست کاربران خالی است");
    expect(holderUnit({ position_id: P.head, unit_from: null, source: HEADS }, { department: null, personUnit: id(11), units, position: pos })).toEqual({ unit_id: id(11), problem: null });
    expect(holderUnit({ position_id: P.head, unit_from: null, source: HEADS }, { department: null, personUnit: null, units, position: pos }).problem).toBe("«رئیس شعبه» در واحدهای یک نوع است و واحد این شخص معلوم نیست");
    expect(holderUnit({ position_id: P.any, unit_from: null, source: HEADS }, { department: null, personUnit: null, units, position: positions[3] })).toEqual({ unit_id: null, problem: null });
    expect(holderUnit({ position_id: P.old, unit_from: null, source: HEADS }, { department: null, personUnit: null, units, position: positions[2] }).problem).toBe("نقش سازمانی «سمت قدیمی» غیرفعال است");
    expect(holderUnit({ position_id: id(99), unit_from: null, source: HEADS }, { department: null, personUnit: null, units, position: undefined }).problem).toBe("نقش سازمانی نگاشت پیدا نشد");
  });

  it("plans holdings for new and existing members; an apply without confirmed roles gives none", () => {
    const plan = planDirectorySync({
      entries: [entry("ali", [HEADS], "1001"), entry("sara", [TELLERS, HEADS], "ادارهٔ مالی"), entry("reza", [], "1002")],
      members: [member(30, "sara@corp.test")],
      links: {},
      mappings,
      units,
      options,
      positions,
      holders: [],
    });
    expect(plan.position_adds).toEqual([
      { position_id: P.head, user: "ali@corp.test", email: "ali@corp.test", unit_id: id(10), source: HEADS },
      { position_id: P.teller, user: id(30), email: "sara@corp.test", unit_id: id(11), source: TELLERS },
    ]);
    // sara's department is no branch: that holding is skipped with the reason
    expect(plan.position_skipped).toEqual([{ email: "sara@corp.test", position_id: P.head, reason: "«ادارهٔ مالی» از نوع واحدهای «رئیس شعبه» نیست" }]);
    expect(planStats(plan)).toMatchObject({ position_adds: 2, position_removes: 0, position_skipped: 1 });
    // like role grants: an apply without the administrator's confirmation (or the approved mappings) gives no holding
    expect(withoutRoleGrants(plan).position_adds).toEqual([]);
  });

  it("never doubles a holding the person already has — kept by hand, by an import or by the source", () => {
    const plan = planDirectorySync({
      entries: [entry("ali", [HEADS], "1001")],
      members: [member(31, "ali@corp.test")],
      links: { "CN=ali,OU=Staff,DC=corp,DC=test": id(31) },
      mappings,
      units,
      options,
      positions,
      holders: [{ user_id: id(31), position_id: P.head, unit_id: id(10), ours: false }],
    });
    expect(plan.position_adds).toEqual([]);
    expect(plan.position_removes).toEqual([]);
  });

  it("takes back only the source's own holdings when the person left the group, switched off or gone", () => {
    const links = { "CN=ali,OU=Staff,DC=corp,DC=test": id(31), "CN=sara,OU=Staff,DC=corp,DC=test": id(32), "CN=gone,OU=Staff,DC=corp,DC=test": id(33) };
    const holders = [
      // ali: the source's «رئیس شعبه» in ونک and a manual «تحویلدار» (kept by hand)
      { user_id: id(31), position_id: P.head, unit_id: id(10), ours: true },
      { user_id: id(31), position_id: P.teller, unit_id: id(11), ours: false },
      // sara (switched off in the directory) and «gone» (no longer in it): the source's holdings
      { user_id: id(32), position_id: P.head, unit_id: id(11), ours: true },
      { user_id: id(33), position_id: P.any, unit_id: null, ours: true },
    ];
    const plan = planDirectorySync({
      entries: [entry("ali", [], "1001"), entry("sara", [HEADS], "1002", false)],
      members: [member(31, "ali@corp.test"), member(32, "sara@corp.test"), member(33, "gone@corp.test")],
      links,
      mappings,
      units,
      options,
      positions,
      holders,
    });
    expect(plan.position_removes).toEqual([
      { position_id: P.head, user: id(31), email: "ali@corp.test", unit_id: id(10) },
      { position_id: P.head, user: id(32), email: "sara@corp.test", unit_id: id(11) },
      { position_id: P.any, user: id(33), email: "gone@corp.test", unit_id: null },
    ]);
    // taking back is no grant: it stays in a plan applied without confirmed roles
    expect(withoutRoleGrants(plan).position_removes).toHaveLength(3);
  });

  it("waits for a department unit the run itself creates", () => {
    const plan = planDirectorySync({
      entries: [entry("nima", [HEADS], "شعبهٔ پونک")],
      members: [],
      links: {},
      mappings: [{ source: HEADS, group_id: null, position_id: P.any }],
      units,
      options: { ...options, unit_from: "department" },
      positions,
      holders: [],
    });
    expect(plan.units).toEqual(["شعبهٔ پونک"]);
    expect(plan.position_adds).toEqual([]);
    expect(plan.position_skipped?.[0].reason).toBe("واحد «شعبهٔ پونک» در همین اجرا ساخته می‌شود؛ «کارشناس اعتبارات» در همگام‌سازی بعدی داده می‌شود");
  });
});

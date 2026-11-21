// Release 1.1.5 — a workflow step that waits for people, on the organisation's own people (every edition's engine;
// the demo pack's side is tests/process-owner-path-scenario.ts):
//   · the journal says why a step found nobody (the resolver's reasons) and whether the managers were told — only when
//     the notice «مرحلهٔ بی‌انجام‌دهنده» is on and reaches someone; the notice carries the reasons (template 2) and an
//     organisation seeded before keeps what its administrator changed;
//   · the case page shows its managers the waiting step (`waiting`: why, the line, the reasons, the candidates when more
//     people were found than the step takes) and «دوباره پیدا کردن انجام‌دهنده» (`can.reresolve`); the requester reads
//     the line only;
//   · «دوباره پیدا کردن انجام‌دهنده» by the managers, with the case version's rules or the current version's (refused when
//     the step does something else there), journaled and audited; and by itself a little after holders, positions,
//     groups, roles or memberships change — only rounds that wait with nobody, never one the managers handled;
//   · «نزدیک‌ترین واحد بالادست» goes up past a unit whose holders cannot take the step (the requester, a member who
//     left), saying so; the requester's unit is the one the case began in;
//   · an approval passed by «از این مرحله بگذرد» says it counted as approved, and the designer warns of it; a «تکمیل
//     فرم» with nothing to fill is warned of; the publish summary names what changed in a step's people;
//   · a «گزارش به» escalation finds the holders by the organisation's day; «مسئولان گردش‌کار» left out are noted;
//   · whether I may start a process is what the start itself checks; a workflow step's task gets the workflows' own
//     notice, not the generic «ارجاع به کارشناس».
import { describe, it, expect, beforeAll } from "vitest";
import { createIn, updateIn } from "@server/engine";
import { resolveAssignees } from "@server/modules/positions";
import { caseDetail, myProcesses, pauseCase, processView, reassignStep, reresolveStep, seedNotices } from "@server/modules/process/api";
import { managersTold } from "@server/modules/process/engine/waiting";
import { RERESOLVE_JOB, reresolveWaiting } from "@server/modules/process/reresolve";
import { roundTimersIn } from "@server/modules/process/timers";
import { localDate } from "@shared/model/jalali-buckets";
import { act, edge, journal, kase, node, openTask, person, publish, start, tasks, users, world, type World } from "./process-engine-helpers";

let w: World;
let P = "";
const U: Record<string, string> = {};
const X: Record<string, string> = {};
const POS: Record<string, string> = {};
const values = { u_amount: "100" };
const rights = (fields: Record<string, string>, dflt = "read") => ({ default: dflt, fields });
const iso = (ms: number) => new Date(ms).toISOString();

/** start → «a» (the step given, labelled) → end; an approval leaves by «تأیید شد» to the end and by «رد شد» to «no». */
function line(step: Record<string, unknown>, label: string) {
  const approve = step.action === "approve";
  return {
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: rights({}, "edit") }, "ثبت درخواست"),
      node("a", "form_step", { action: "fill", form: w.forms.review, rights: rights({ u_finance_note: "edit" }), ...step }, label),
      node("ok", "end", { outcome: "completed" }),
      ...(approve ? [node("no", "end", { outcome: "rejected" })] : []),
    ],
    edges: [edge("t", "s"), edge("s", "a"), ...(approve ? [edge("a", "ok", "approved"), edge("a", "no", "rejected")] : [edge("a", "ok")])],
  } as any;
}

const position = async (key: string, name: string, more: Record<string, unknown> = {}) =>
  (POS[key] = String((await w.sys.write((tx) => createIn(tx, w.sys, "position", { key, name, ...more }, { trusted: true }))).id));
const hold = (key: string, user: string, unit: string | null, more: Record<string, unknown> = {}) =>
  w.sys.write((tx) => createIn(tx, w.sys, "position_holder", { position_id: POS[key], user_id: user, org_unit_id: unit, kind: "primary", ...more }, { trusted: true }));
const anywhere = (key: string) => ({ assignees: [{ kind: "position", position: key, where: "anywhere" }] });
const openAt = async (id: string, step = "a") => (await tasks(w, id)).filter((t) => t.step_key === step && t.status === "open").map((t) => t.assigned_to).sort();
const detail = async (user: string, id: string) => caseDetail(await w.o.ctxOf(user), id);
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return { status: (e as { status?: number }).status ?? null, message: String((e as Error).message) };
  }
};
/** The organisation's re-resolution brought forward and run (it waits a quiet half minute after a change). */
async function runReresolve() {
  await w.o.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = $2 and status = 'queued'`, [w.o.org, RERESOLVE_JOB]);
  await w.k.drain();
}
const queuedReresolve = () =>
  w.o.db.query<{ later: boolean }>(`select run_at > now() + interval '20 seconds' as later from sm_jobs where org_id = $1 and kind = $2 and status = 'queued'`, [w.o.org, RERESOLVE_JOB]);

beforeAll(async () => {
  w = await world();
  P = w.P;
  // the workflows' notices are seeded by a delayed job (a day-old organisation has them)
  await w.o.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'process.seed' and status = 'queued'`, [w.o.org]);
  await w.k.drain();
  const unit = async (name: string, kind: string, parent?: string) => String((await w.sys.write((tx) => createIn(tx, w.sys, "org_unit", { name, kind, parent_id: parent ?? null }, { trusted: true }))).id);
  U.region = await unit("مدیریت شعب شمال", "division");
  U.branch = await unit("شعبهٔ ونک", "branch", U.region);
  U.it = await unit("ادارهٔ کل فناوری اطلاعات", "department");
  X.mgr = await person(w, "مسئول گردش‌کار");
  X.req = await person(w, "درخواست‌دهندهٔ شعبه", { unit: U.branch });
  X.branchHead = await person(w, "رئیس شعبهٔ ونک", { unit: U.branch });
  X.regionHead = await person(w, "رئیس منطقهٔ شمال", { unit: U.region });
  X.clerk = await person(w, "کارمند شعبه", { unit: U.branch });
  X.leaver = await person(w, "رئیس پیشین", { unit: U.branch });
  X.desk = await person(w, "کارشناس میز", { unit: U.region });
  X.other = await person(w, "کارشناس دیگر", { unit: U.region });
  await position("approver_head", "رئیس");
  await hold("approver_head", X.branchHead, U.branch);
  await hold("approver_head", X.regionHead, U.region);
  await position("old_head", "رئیس با دارندهٔ رفته");
  await hold("old_head", X.leaver, U.branch);
  await hold("old_head", X.regionHead, U.region);
  // the branch's old head left: the membership is off, the holder row stays (as after a directory sync's lag)
  await w.o.db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [w.o.org, X.leaver]);
  await w.k.drain();
}, 600_000);

describe("why a step found nobody, and who was told", () => {
  it("the journal and the case page carry the resolver's reasons; the managers are told, with the reasons in the notice", async () => {
    await position("desk", "میز کار");
    const p = await publish(w, line(anywhere("desk"), "بررسی میز کار"), { managers: [X.mgr] });
    const id = (await start(w, X.req, p, { values })).case!;
    await w.k.drain();
    expect(await openAt(id)).toEqual([]);
    const line1 = "برای «بررسی میز کار» کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند.";
    expect(await journal(w, id)).toContain(`${line1} کسی «میز کار» نیست.`);
    // the managers' page: why, the line, the reasons, and the action
    const m = await detail(X.mgr, id);
    expect(m.waiting).toEqual({ a: { reason: "nobody", message: line1, notes: ["کسی «میز کار» نیست"] } });
    expect(m.can.reresolve).toBe(true);
    expect(m.demo).toBe(false);
    // the requester reads the line, not the reasons, and has no such action
    const r = await detail(X.req, id);
    expect(r.waiting).toEqual({ a: { reason: "nobody", message: line1, notes: [] } });
    expect(r.can.reresolve).toBe(false);
    // the managers' notice (template 2) says why
    const bells = await w.o.db.query<{ title: string; body: string }>(`select title, body from sm_notifications where org_id = $1 and user_id = $2 and record_id = $3`, [w.o.org, X.mgr, id]);
    expect(bells.map((b) => b.title)).toEqual(["برای «بررسی میز کار» کسی پیدا نشد"]);
    expect(bells[0].body).toContain("کسی پیدا نشد (کسی «میز کار» نیست)؛ مرحله را به کسی بسپارید یا «دوباره پیدا کردن انجام‌دهنده» را بزنید.");
  });

  it("with the notice switched off the journal does not claim the managers were told; nor when nobody is there to tell", async () => {
    await w.o.db.query(`update sm_notification_rules set active = false where org_id = $1 and custom_event = 'process_unassigned'`, [w.o.org]);
    try {
      const p = await publish(w, line(anywhere("desk"), "بررسی بی‌اعلان"), { managers: [X.mgr] });
      const id = (await start(w, X.req, p, { values })).case!;
      await w.k.drain();
      expect(await journal(w, id)).toContain(
        "برای «بررسی بی‌اعلان» کسی پیدا نشد؛ مرحله منتظر مسئولان گردش‌کار می‌ماند (اعلان «مرحلهٔ بی‌انجام‌دهنده» روشن نیست و کسی باخبر نشد). کسی «میز کار» نیست.",
      );
    } finally {
      await w.o.db.query(`update sm_notification_rules set active = true where org_id = $1 and custom_event = 'process_unassigned'`, [w.o.org]);
    }
    // a case managed by a group nobody is in: no one to tell
    const group = String((await w.sys.write((tx) => createIn(tx, w.sys, "group", { name: "گروه خالی" }, { trusted: true }))).id);
    expect(await managersTold(w.o.db, w.o.org, { id: "00000000-0000-7000-8000-000000000001", managers: [], manager_groups: [group] })).toBe("nobody");
  });

  it("an approval passed by «از این مرحله بگذرد» says it counted as approved; the designer warns of it", async () => {
    await position("vacant", "پست خالی");
    const g = line({ action: "approve", form: w.forms.review, rights: rights({}), quorum: "any", ifNobody: "skip", ...anywhere("vacant") }, "تأیید پست خالی");
    const p = await publish(w, g, { managers: [X.mgr] });
    const id = (await start(w, X.req, p, { values })).case!;
    await w.k.drain();
    expect(await journal(w, id)).toContain("برای «تأیید پست خالی» کسی پیدا نشد؛ از این مرحله گذشت و تأییدشده به شمار آمد. کسی «پست خالی» نیست.");
    expect((await kase(w, id)).state).toBe("completed");
    // the designer: a warning on «اگر کسی پیدا نشد»
    const made = await w.o.owner.post(`${P}/process/defs`, { name: "تأیید با گذر", key: "skip_approve" }, 201);
    const saved = await w.o.owner.put(`${P}/process/defs/${made.process.id}/draft`, { draft: { graph: g, starters: [], title_template: null, requester_view: [], managers: [], manager_groups: [], confidential: false } });
    expect(saved.problems).toContainEqual(
      expect.objectContaining({ level: "warning", node: "a", field: "ifNobody", message: "اگر برای این تأیید کسی پیدا نشود، مرحله تأییدشده به شمار می‌آید و پرونده از مسیر «تأیید شد» ادامه می‌یابد" }),
    );
  });

  it("«مسئولان گردش‌کار» who cannot take the step are noted (the requester manages the case)", async () => {
    const g = line({ action: "approve", form: w.forms.review, rights: rights({}), quorum: "any", ifNobody: "managers", ...users(X.req) }, "تأیید خود");
    const p = await publish(w, g, { managers: [X.req] });
    const id = (await start(w, X.req, p, { values })).case!;
    await w.k.drain();
    expect(await openAt(id)).toEqual([]);
    const m = await detail(X.req, id);
    expect(m.waiting.a.notes).toEqual(["درخواست‌دهنده خود از افراد برگزیده است و این مرحله را انجام نمی‌دهد", "درخواست‌دهنده خود از مسئولان گردش‌کار است و این مرحله را انجام نمی‌دهد"]);
  });

  it("more people than the step takes: the managers see whom to choose from; the requester does not", async () => {
    await position("crowd", "هیئت بزرگ");
    const crowd: string[] = [];
    for (let i = 0; i < 51; i++) crowd.push(await person(w, `عضو هیئت ${i + 1}`));
    for (const u of crowd) await hold("crowd", u, null);
    const p = await publish(w, line({ action: "approve", form: w.forms.review, rights: rights({}), quorum: "all", ...anywhere("crowd") }, "تأیید هیئت"), { managers: [X.mgr] });
    const id = (await start(w, X.req, p, { values })).case!;
    await w.k.drain();
    const m = await detail(X.mgr, id);
    expect(m.waiting.a.reason).toBe("too_many");
    expect(m.waiting.a.message).toBe("بیش از ۵۰ تأییدکننده پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند");
    expect(m.waiting.a.candidates?.map((c) => c.id).sort()).toEqual([...crowd].sort());
    expect(m.waiting.a.candidates?.find((c) => c.id === crowd[0])).toEqual({ id: crowd[0], name: "عضو هیئت 1", demo: false });
    const r = await detail(X.req, id);
    expect(r.waiting.a).toEqual({ reason: "too_many", message: m.waiting.a.message, notes: [] });
    // the organisation's re-resolution leaves a round with more people than it takes to the managers
    await reresolveWaiting(w.o.cfg, w.o.org);
    expect(await openAt(id)).toEqual([]);
  });
});

describe("«دوباره پیدا کردن انجام‌دهنده»", () => {
  it("by the managers: the case version's rules with today's holders, or the current version's; journaled and audited", async () => {
    await position("clerk_desk", "میز ثبت");
    const g1 = line(anywhere("clerk_desk"), "ثبت در میز");
    const p = await publish(w, g1, { managers: [X.mgr] });
    const c1 = (await start(w, X.req, p, { values })).case!;
    const c2 = (await start(w, X.req, p, { values })).case!;
    await w.k.drain();
    const mgr = await w.o.ctxOf(X.mgr);
    // only the managers; only a step of the case that waits for people
    expect(await refusal(reresolveStep(await w.o.ctxOf(X.req), c1, { step: "a" }))).toMatchObject({ status: 403 });
    expect(await refusal(reresolveStep(mgr, c1, { step: "nope" }))).toEqual({ status: 400, message: "این مرحله در پرونده نیست" });
    expect(await refusal(reresolveStep(mgr, c1, { step: "s" }))).toEqual({ status: 409, message: "این مرحله منتظر انجام‌دهنده نیست؛ یا باز نیست یا کارش به کسی سپرده شده است" });
    // nobody yet: said so, with the reasons
    const none = await reresolveStep(mgr, c1, { step: "a" });
    expect(none).toEqual({ status: "nobody", people: [], message: "برای «ثبت در میز» کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند.", notes: ["کسی «میز ثبت» نیست"] });
    expect(await journal(w, c1)).toContain("مسئول گردش‌کار (مسئول گردش‌کار) انجام‌دهندهٔ «ثبت در میز» را دوباره جست؛ کسی پیدا نشد. کسی «میز ثبت» نیست.");
    // version 2 gives the step to a named person: the current version's rules, the case staying on version 1
    await publish(w, line(users(X.desk), "ثبت در میز"), { managers: [X.mgr], process: p.process });
    const ok = await reresolveStep(mgr, c1, { step: "a", rules: "current" });
    expect(ok).toEqual({ status: "ok", people: [{ id: X.desk, name: "کارشناس میز", demo: false }], message: null, notes: [] });
    expect(await openAt(c1)).toEqual([X.desk]);
    expect((await w.o.db.one<{ version_id: string }>(`select version_id from sm_process_cases where id = $1`, [c1]))!.version_id).toBe(p.version);
    expect(await journal(w, c1)).toContain("مسئول گردش‌کار (مسئول گردش‌کار) انجام‌دهندهٔ «ثبت در میز» را با قاعده‌های نسخهٔ جاری دوباره جست؛ مرحله به کارشناس میز سپرده شد.");
    expect((await detail(X.mgr, c1)).waiting).toEqual({});
    const audit = await w.o.db.query<{ data: any }>(`select data from sm_audit where org_id = $1 and action = 'process.reresolve' and entity_id = $2 order by id`, [w.o.org, c1]);
    expect(audit.map((a) => [a.data.rules, a.data.status])).toEqual([["case", "nobody"], ["current", "ok"]]);
    // the step does something else in version 3: its rules do not apply to this case
    await publish(w, line({ action: "approve", form: w.forms.review, rights: rights({}), quorum: "any", ...users(X.desk) }, "ثبت در میز"), { managers: [X.mgr], process: p.process });
    expect(await refusal(reresolveStep(mgr, c2, { step: "a", rules: "current" }))).toEqual({
      status: 400,
      message: "«ثبت در میز» در نسخهٔ جاری کار دیگری است («تأیید» به جای «تکمیل فرم»)؛ قاعده‌های نسخهٔ جاری برای این پرونده به کار نمی‌روند",
    });
    expect((await reresolveStep(mgr, c2, { step: "a" })).status).toBe("nobody");
    // today's holders with the case's own rules
    await hold("clerk_desk", X.other, U.region);
    const found = await reresolveStep(mgr, c2, { step: "a" });
    expect(found.people.map((x) => x.id)).toEqual([X.other]);
    expect(await openAt(c2)).toEqual([X.other]);
  });

  it("by itself, a little after a holder is added: rounds that wait with nobody, never one the managers handled or paused", async () => {
    await position("auto_desk", "میز خودکار");
    const p = await publish(w, line(anywhere("auto_desk"), "میز خودکار"), { managers: [X.mgr] });
    const d1 = (await start(w, X.req, p, { values })).case!;
    const d2 = (await start(w, X.req, p, { values })).case!;
    const d3 = (await start(w, X.req, p, { values })).case!;
    await w.k.drain();
    // the managers give d2 to someone, and pause d3
    await reassignStep(await w.o.ctxOf(X.mgr), d2, { step: "a", to: [X.other] });
    await pauseCase(await w.o.ctxOf(X.mgr), d3, { comment: "تا روشن شدن بودجه" });
    expect(await openAt(d2)).toEqual([X.other]);
    await w.o.db.query(`delete from sm_jobs where org_id = $1 and kind = $2`, [w.o.org, RERESOLVE_JOB]);
    await hold("auto_desk", X.desk, U.region);
    await w.k.drain();
    // queued once, a quiet half minute later
    expect(await queuedReresolve()).toEqual([{ later: true }]);
    expect(await openAt(d1)).toEqual([]);
    await runReresolve();
    expect(await openAt(d1)).toEqual([X.desk]);
    expect(await journal(w, d1)).toContain("با تغییر دارندگان نقش‌ها، گروه‌ها یا نقش‌های دسترسی، انجام‌دهندهٔ «میز خودکار» دوباره جسته شد؛ مرحله به کارشناس میز سپرده شد.");
    // the people found are told as when a step opens
    const bells = await w.o.db.query<{ title: string }>(`select title from sm_notifications where org_id = $1 and user_id = $2 and record_id = $3`, [w.o.org, X.desk, d1]);
    expect(bells.map((b) => b.title)).toEqual(["مرحله‌ای منتظر شماست: «میز خودکار»"]);
    // the round the managers handled stays theirs, and the paused case waits for them
    expect(await openAt(d2)).toEqual([X.other]);
    expect(await openAt(d3)).toEqual([]);
  });

  it("by itself after a member is made active again", async () => {
    await position("returning", "میز بازگشته");
    const back = await person(w, "کارشناس بازگشته", { unit: U.region });
    await hold("returning", back, U.region);
    await w.o.db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [w.o.org, back]);
    const p = await publish(w, line(anywhere("returning"), "میز بازگشته"), { managers: [X.mgr] });
    const id = (await start(w, X.req, p, { values })).case!;
    await w.k.drain();
    expect((await detail(X.mgr, id)).waiting.a.notes).toEqual(["۱ نفر از دارندگان «میز بازگشته» عضو فعال سازمان نیست"]);
    await w.o.db.query(`delete from sm_jobs where org_id = $1 and kind = $2`, [w.o.org, RERESOLVE_JOB]);
    const member = (await w.o.db.one<{ id: string }>(`select id::text from sm_org_members where org_id = $1 and user_id = $2`, [w.o.org, back]))!.id;
    await w.o.owner.patch(`${P}/members/${member}`, { is_active: true });
    expect(await queuedReresolve()).toEqual([{ later: true }]);
    await runReresolve();
    expect(await openAt(id)).toEqual([back]);
  });
});

describe("whom a step goes to", () => {
  const up = (key: string) => ({ assignees: [{ kind: "position" as const, position: key, where: "requester_unit_up" as const }] });

  it("«نزدیک‌ترین واحد بالادست» goes past a unit whose holder requested the approval, and says so", async () => {
    const p = await publish(w, line({ action: "approve", form: w.forms.review, rights: rights({}), quorum: "any", ...up("approver_head") }, "تأیید رئیس"), { managers: [X.mgr] });
    const id = (await start(w, X.branchHead, p, { values })).case!;
    await w.k.drain();
    expect(await openAt(id)).toEqual([X.regionHead]);
    const r = await resolveAssignees(w.o.db, w.sys, { step: up("approver_head"), action: "approve", requestedBy: X.branchHead, real: true });
    expect(r.notes).toEqual(["«رئیس» در «شعبهٔ ونک» خود درخواست‌دهنده است؛ مرحله به «مدیریت شعب شمال» رسید"]);
  });

  it("… and past a unit whose holder is no longer an active member", async () => {
    const r = await resolveAssignees(w.o.db, w.sys, { step: up("old_head"), action: "fill", requestedBy: X.clerk, real: true });
    expect(r.people.map((x) => x.user)).toEqual([X.regionHead]);
    expect(r.notes).toEqual(["«رئیس با دارندهٔ رفته» در «شعبهٔ ونک» عضو فعال سازمان نیست؛ مرحله به «مدیریت شعب شمال» رسید"]);
    // nobody up the tree at all: each unit passed is said, then that there is no other
    await position("lone_head", "رئیس تنها");
    await hold("lone_head", X.clerk, U.branch);
    const none = await resolveAssignees(w.o.db, w.sys, { step: up("lone_head"), action: "approve", requestedBy: X.clerk, real: true });
    expect(none.status).toBe("nobody");
    expect(none.notes).toEqual(["«رئیس تنها» در «شعبهٔ ونک» خود درخواست‌دهنده است", "«رئیس تنها» در واحد درخواست‌دهنده و واحدهای بالاتر دارندهٔ دیگری ندارد"]);
  });

  it("the requester's unit is the one the case began in, though the requester has moved since", async () => {
    await position("unit_desk", "میز واحد");
    const inBranch = await person(w, "میز شعبه");
    const inRegion = await person(w, "میز منطقه");
    await hold("unit_desk", inBranch, U.branch);
    await hold("unit_desk", inRegion, U.region);
    const mover = await person(w, "درخواست‌دهندهٔ جابه‌جاشده", { unit: U.branch });
    const g = {
      nodes: [
        node("t", "trigger"),
        node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: rights({}, "edit") }, "ثبت درخواست"),
        node("x", "form_step", { action: "fill", form: w.forms.review, rights: rights({ u_finance_note: "edit" }), ...users(X.clerk) }, "بررسی اول"),
        node("a", "form_step", { action: "fill", form: w.forms.review, rights: rights({ u_finance_note: "edit" }), assignees: [{ kind: "position", position: "unit_desk", where: "requester_unit" }] }, "میز واحد"),
        node("ok", "end", { outcome: "completed" }),
      ],
      edges: [edge("t", "s"), edge("s", "x"), edge("x", "a"), edge("a", "ok")],
    } as any;
    const p = await publish(w, g, { managers: [X.mgr] });
    const id = (await start(w, mover, p, { values })).case!;
    await w.k.drain();
    const prof = (await w.o.db.one<{ id: string }>(`select id::text from sm_member_profiles where org_id = $1 and user_id = $2`, [w.o.org, mover]))!.id;
    await w.sys.write((tx) => updateIn(tx, w.sys, "member_profile", prof, { org_unit_id: U.region }, { trusted: true }));
    await act(w, X.clerk, await openTask(w, id, "x", X.clerk), { values: { u_finance_note: "دیده شد" } });
    await w.k.drain();
    expect(await openAt(id)).toEqual([inBranch]);
  });

  it("a «گزارش به» escalation finds the holders by the organisation's day (Tehran is past midnight, UTC is not)", async () => {
    const parent = await position("tz_parent", "سرپرست نیمه‌شب");
    await position("tz_child", "کارشناس نیمه‌شب", { reports_to: parent });
    const doer = await person(w, "کارشناس شب");
    const boss = await person(w, "سرپرست شب");
    await hold("tz_child", doer, null);
    const at = Date.parse(`${new Date().toISOString().slice(0, 10)}T21:00:00Z`);
    // the boss holds the parent from the organisation's day of `at` (the next day in UTC terms)
    await hold("tz_parent", boss, null, { valid_from: localDate(at, "Asia/Tehran") });
    const g = line({ ...anywhere("tz_child"), business: false, escalate: [{ after: { amount: 1, unit: "hour" }, action: "notify", to: "reports_to" }] }, "کار شبانه");
    const p = await publish(w, g, { managers: [X.mgr] });
    const id = (await start(w, X.req, p, { values })).case!;
    await w.k.drain();
    await w.o.db.query(`update sm_process_tasks set opened_at = $2 where case_id = $1 and step_key = 'a'`, [id, iso(at - 2 * 3_600_000)]);
    await w.sys.write((tx) => roundTimersIn(tx, w.sys, { cal: null }, id, "a", 1, at));
    expect(await journal(w, id)).toContain("مهلت گذشت؛ «کار شبانه» به سرپرست شب اطلاع داده شد");
  });

  it("whether I may start a process is what the start checks (a holder of the starters' role in another unit may not)", async () => {
    await position("starter_pos", "آغازگر");
    const elsewhere = await person(w, "آغازگر در جای دیگر", { unit: U.branch });
    const here = await person(w, "آغازگر در واحد خود", { unit: U.region });
    await hold("starter_pos", elsewhere, U.region);
    await hold("starter_pos", here, U.region);
    const p = await publish(w, line(users(X.desk), "پس از آغاز"), { managers: [X.mgr], starters: [{ kind: "position", position: "starter_pos", where: "requester_unit" }] });
    const view = async (u: string) => (await processView(await w.o.ctxOf(u), p.key)).start.can_start;
    const mine = async (u: string) => (await myProcesses(await w.o.ctxOf(u))).processes.find((x) => x.key === p.key)?.can_start ?? false;
    expect([await view(here), await mine(here)]).toEqual([true, true]);
    expect([await view(elsewhere), await mine(elsewhere)]).toEqual([false, false]);
    expect(await refusal(start(w, elsewhere, p, { values }))).toEqual({ status: 409, message: "شما اجازهٔ آغاز این گردش‌کار را ندارید" });
    expect((await start(w, here, p, { values })).case).toBeTruthy();
  });

  it("a workflow step's task gets the workflows' own notice, not the generic «ارجاع به کارشناس»", async () => {
    const doer = await person(w, "انجام‌دهندهٔ مرحله");
    const p = await publish(w, line(users(doer), "مرحلهٔ با اعلان"), { managers: [X.mgr] });
    const id = (await start(w, X.req, p, { values })).case!;
    await w.k.drain();
    const bells = await w.o.db.query<{ title: string; table_key: string }>(`select title, table_key from sm_notifications where org_id = $1 and user_id = $2`, [w.o.org, doer]);
    expect(bells).toEqual([{ title: "مرحله‌ای منتظر شماست: «مرحلهٔ با اعلان»", table_key: "process_case" }]);
    expect(await openAt(id)).toEqual([doer]);
  });
});

describe("the designer", () => {
  it("a «تکمیل فرم» step with nothing to fill is warned of", async () => {
    const made = await w.o.owner.post(`${P}/process/defs`, { name: "فرم خواندنی", key: "read_only_fill" }, 201);
    const g = line({ action: "fill", form: w.forms.review, rights: rights({}), ...users(X.desk) }, "مرحلهٔ فرم");
    const saved = await w.o.owner.put(`${P}/process/defs/${made.process.id}/draft`, { draft: { graph: g, starters: [], title_template: null, requester_view: [], managers: [], manager_groups: [], confidential: false } });
    expect(saved.problems).toContainEqual({ level: "warning", message: "در «مرحلهٔ فرم» فیلدی برای پر کردن نیست", node: "a", field: "rights" });
    // a step with a field to fill: no such warning
    const ok = await w.o.owner.put(`${P}/process/defs/${made.process.id}/draft`, {
      draft: { graph: line({ action: "fill", form: w.forms.review, rights: rights({ u_finance_note: "edit" }), ...users(X.desk) }, "مرحلهٔ فرم"), starters: [], title_template: null, requester_view: [], managers: [], manager_groups: [], confidential: false },
    });
    expect(ok.problems.filter((x: { field?: string }) => x.field === "rights")).toEqual([]);
  });

  it("the publish summary names what changed in a step's people", async () => {
    const made = await w.o.owner.post(`${P}/process/defs`, { name: "گردش کار پروژه", key: "people_diff" }, 201);
    const id = made.process.id;
    const draft = (step: Record<string, unknown>) => ({
      draft: { graph: line({ action: "fill", form: w.forms.review, rights: rights({ u_finance_note: "edit" }), ...step }, "مرحلهٔ فرم"), starters: [], title_template: null, requester_view: [], managers: [X.mgr], manager_groups: [], confidential: false },
    });
    await w.o.owner.put(`${P}/process/defs/${id}/draft`, draft({ assignees: [{ kind: "position", position: "approver_head", where: "requester_unit" }] }));
    await w.o.db.query(`update sm_sessions set reauth_at = now()`);
    await w.o.owner.post(`${P}/process/defs/${id}/publish`, { note: "نسخهٔ ۱" });
    await w.o.owner.put(`${P}/process/defs/${id}/draft`, draft({ assignees: [{ kind: "position", position: "old_head", where: "anywhere" }], ifNobody: "managers" }));
    const { diff } = await w.o.owner.get(`${P}/process/defs/${id}/diff`);
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        "انجام‌دهندگان «مرحلهٔ فرم»، نقش سازمانی: «رئیس» ← «رئیس با دارندهٔ رفته»",
        "انجام‌دهندگان «مرحلهٔ فرم»، کجا: واحد درخواست‌دهنده ← همه‌جا",
        expect.stringMatching(/^انجام‌دهندگان «مرحلهٔ فرم»، اگر کسی پیدا نشد: .+ ← .+$/),
      ]),
    );
  });
});

describe("the managers' notice of an organisation seeded before 1.1.5", () => {
  it("takes the new template where its administrator left the old one; what they changed or deleted stays so", async () => {
    const org = w.o.org;
    const tpl = async (name: string) => (await w.o.db.one<{ id: string; body: string }>(`select id::text, body from sm_notification_templates where org_id = $1 and name = $2 and deleted_at is null`, [org, `گردش‌کارها — ${name}`]))!;
    const OLD = "برای مرحلهٔ «{{event.label}}» از پروندهٔ {{record.number}} «{{record.title}}» کسی پیدا نشد؛ مرحله را به کسی بسپارید.\n\n[دیدن پرونده]({{link}})";
    const unassigned = await tpl("مرحلهٔ بی‌انجام‌دهنده");
    const waiting = await tpl("مرحله‌ای منتظر شماست");
    await w.o.db.query(`update sm_notification_templates set body = $2 where id = $1`, [unassigned.id, OLD]);
    await w.o.db.query(`update sm_notification_templates set body = 'متن خود سازمان' where id = $1`, [waiting.id]);
    await w.o.db.query(`update sm_notification_rules set deleted_at = now() where org_id = $1 and table_key = 'process_case' and name = 'گردش‌کار شما رد شد'`, [org]);
    await w.o.db.query(`update sm_kv set value = '{"version": 1}'::jsonb where key = $1`, [`process.notices:${org}`]);
    const r = await seedNotices(w.o.cfg, org);
    expect(r).toEqual({ skipped: false, created: { templates: 0, rules: 0 } });
    expect((await tpl("مرحلهٔ بی‌انجام‌دهنده")).body).toContain("کسی پیدا نشد{{#if event.reason}} ({{event.reason}}){{/if}}؛");
    expect((await tpl("مرحله‌ای منتظر شماست")).body).toBe("متن خود سازمان");
    expect(await w.o.db.query(`select 1 from sm_notification_rules where org_id = $1 and table_key = 'process_case' and name = 'گردش‌کار شما رد شد' and deleted_at is null`, [org])).toEqual([]);
    expect((await seedNotices(w.o.cfg, org)).skipped).toBe(true);
  });
});

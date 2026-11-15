// The demo pack and the organisation's own workflow cases (docs/DEMO_FA.md, design F): demo accounts approve no real
// record. A step of a case of the organisation's own never goes to the pack's people, whatever names them — a role the
// pack's groups carry, a group of the pack, a delegation — and a step left with nobody follows its «ifNobody»; nor do
// the process managers' «ارجاع» and the designer's preview offer them. The pack's own cases keep them. And a process
// of the pack is started by the pack's people only: a real case standing on the pack's process, version and form would
// lose them all at the purge.
import { describe, it, expect, beforeAll } from "vitest";
import { createIn } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { DEMO_PEOPLE_REAL_WORK, previewResolve } from "@server/modules/positions";
import { reassignStep } from "@server/modules/process/api";
import { DEMO_PROCESS_START } from "@server/modules/process/engine";
import { edge, journal, kase, node, person, publish, start, tasks, users, world, type Published, type World } from "./process-engine-helpers";

let w: World;
let requester: string;
let analyst: string;
let approver: string;
let manager: string;
let packAnalyst: string;
let packRequester: string;
let packGroup: string;
let ROLE: Published;
let GROUP: Published;
let AWAY: Published;

const rights = (fields: Record<string, string>, dflt = "read") => ({ default: dflt, fields });
const values = { u_amount: "5" };

/** One of the pack's people, as the loader adds them: an account marked with the organisation's pack, a member. */
async function packPerson(name: string): Promise<string> {
  const id = await person(w, name);
  await w.o.db.query(`update sm_users set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('demo_org', $2::text) where id = $1`, [id, w.o.org]);
  await w.o.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users') on conflict do nothing`, [w.o.org, id]);
  return id;
}

/** start → «تأیید امنیت اطلاعات» (the rule given) → end. */
const graph = (step: Record<string, unknown>) => ({
  nodes: [
    node("t", "trigger"),
    node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: rights({}, "edit") }),
    node("sec", "form_step", { action: "approve", form: w.forms.review, rights: rights({}), ...step }, "تأیید امنیت اطلاعات"),
    node("ok", "end", { outcome: "completed" }),
    node("no", "end", { outcome: "rejected" }),
  ],
  edges: [edge("t", "s"), edge("s", "sec"), edge("sec", "ok", "approved"), edge("sec", "no", "rejected")],
});
const openAt = async (caseId: string) => (await tasks(w, caseId)).filter((t) => t.step_key === "sec" && t.status === "open");

beforeAll(async () => {
  w = await world();
  requester = await person(w, "درخواست‌دهندهٔ واقعی");
  analyst = await person(w, "تحلیل‌گر امنیت واقعی");
  approver = await person(w, "تأییدکنندهٔ واقعی");
  manager = await person(w, "مسئول گردش‌کار");
  await w.o.owner.put(`${w.P}/access/members/${analyst}`, { roles: ["security_analyst"] });
  packAnalyst = await packPerson("تحلیل‌گر نمایشی");
  packRequester = await packPerson("درخواست‌دهندهٔ نمایشی");
  // the pack's security group, written by demo work as the load writes it: its member holds the role through it
  packGroup = await inDemoScope(w.o.org, () =>
    w.sys.write(async (tx) => {
      const g = await createIn(tx, w.sys, "group", { name: "عملیات امنیت (نمایشی)", roles: ["security_analyst"] }, { trusted: true });
      await createIn(tx, w.sys, "group_member", { group_id: g.id, user_id: packAnalyst, kind: "member" }, { trusted: true });
      return String(g.id);
    }),
  );
  // a real approver who is away, with the pack's analyst as their out-of-office delegate
  await w.o.db.query(`update sm_member_profiles set out_of_office = true, delegate_id = $2 where org_id = $1 and user_id = $3`, [w.o.org, packAnalyst, approver]);
  ROLE = await publish(w, graph({ assignees: [{ kind: "role", role: "security_analyst" }] }), { managers: [manager] });
  GROUP = await publish(w, graph({ assignees: [{ kind: "group", group: packGroup }], ifNobody: "skip" }));
  AWAY = await publish(w, graph(users(approver)));
}, 300_000);

describe("a case of the organisation's own never goes to the demo pack's people", () => {
  it("a role the pack's groups carry: the organisation's own holder only", async () => {
    const id = (await start(w, requester, ROLE, { values })).case!;
    await w.k.drain();
    expect((await openAt(id)).map((t) => t.assigned_to)).toEqual([analyst]);
  }, 120_000);

  it("a group of the pack finds nobody: the step follows its «ifNobody» (skip) and the case goes on", async () => {
    const id = (await start(w, requester, GROUP, { values })).case!;
    await w.k.drain();
    expect((await tasks(w, id)).filter((t) => t.step_key === "sec")).toEqual([]);
    expect(await kase(w, id)).toMatchObject({ state: "completed" });
    expect((await journal(w, id)).join(" | ")).toContain("تأیید امنیت اطلاعات");
  }, 120_000);

  it("a delegate of the pack does not stand in: the away approver keeps the step", async () => {
    const id = (await start(w, requester, AWAY, { values })).case!;
    await w.k.drain();
    expect((await openAt(id)).map((t) => ({ to: t.assigned_to, for: t.delegated_from }))).toEqual([{ to: approver, for: null }]);
  }, 120_000);

  it("the process managers' «ارجاع» refuses the pack's people", async () => {
    const id = (await start(w, requester, ROLE, { values })).case!;
    await w.k.drain();
    await expect(reassignStep(await w.o.ctxOf(manager), id, { step: "sec", to: [packAnalyst] })).rejects.toThrow(DEMO_PEOPLE_REAL_WORK);
    expect((await openAt(id)).map((t) => t.assigned_to)).toEqual([analyst]);
  }, 120_000);

  it("the designer's preview finds what the step would: real work for a real requester, the pack's for the pack's", async () => {
    const owner = await w.o.ctxOf(w.o.ownerId);
    const step = { assignees: [{ kind: "role", role: "security_analyst" }] };
    expect((await previewResolve(owner, { step, action: "approve", requester })).people.map((p) => p.user)).toEqual([analyst]);
    expect((await previewResolve(owner, { step, action: "approve", requester: packRequester })).people.map((p) => p.user).sort()).toEqual([analyst, packAnalyst].sort());
  }, 120_000);

  it("a case of the pack's keeps them: its step goes to the pack's analyst too", async () => {
    const id = (await inDemoScope(w.o.org, () => start(w, packRequester, ROLE, { values }))).case!;
    await w.k.drain();
    expect(await w.o.db.one(`select 1 as x from sm_demo_rows where org_id = $1 and row_id = $2`, [w.o.org, id])).toBeTruthy();
    expect((await openAt(id)).map((t) => t.assigned_to).sort()).toEqual([analyst, packAnalyst].sort());
  }, 120_000);
});

describe("a process of the demo pack is started by the pack's people only", () => {
  it("a real member's start is refused, with nothing written; the pack's person starts it", async () => {
    const pack = await publish(w, graph(users(analyst)));
    await w.o.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_processes')`, [w.o.org, pack.process]);
    const cases = async () => (await w.o.db.one<{ n: number }>(`select count(*)::int as n from sm_process_cases where org_id = $1 and process_id = $2`, [w.o.org, pack.process]))!.n;
    await expect(start(w, requester, pack, { values })).rejects.toThrow(DEMO_PROCESS_START);
    expect(await cases()).toBe(0);
    const id = (await inDemoScope(w.o.org, () => start(w, packRequester, pack, { values }))).case!;
    await w.k.drain();
    expect(await cases()).toBe(1);
    expect((await openAt(id)).map((t) => t.assigned_to)).toEqual([analyst]);
  }, 120_000);
});

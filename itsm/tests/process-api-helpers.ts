// Helpers of the F4c suites (tests/process-api-*.test.ts, tests/process-publish-*.test.ts): the bank of design F §3.7
// — units, positions and their holders, «امور مالی» — with signed-in members for the API (designer, publisher,
// clerk, branch deputy and head, a manager) and engine-made people for the finance deputies and payers, and the §3.7
// «درخواست تنخواهِ شعبه» as a designer's draft.
import { createIn, updateIn } from "@server/engine";
import type { Client } from "./helpers";
import { edge, node, person, world, type World } from "./process-engine-helpers";

export interface Member {
  client: Client;
  userId: string;
}

export interface Bank {
  w: World;
  U: Record<string, string>;
  /** signed-in members: designer, publisher, clerk, deputy, head, mgr, dlg */
  M: Record<string, Member>;
  /** engine-made people: fd1, fd2, fdOther, pay1, pay2 */
  X: Record<string, string>;
  financeGroup: string;
}

let seq = 0;

/** A signed-in member with roles, a profile unit and a full name. */
async function member(w: World, name: string, roles: string[], unit: string | null): Promise<Member> {
  const m = await w.o.member("member", `api-${++seq}-${Date.now()}@bank.test`);
  await w.o.owner.put(`${w.P}/access/members/${m.userId}`, { roles });
  await w.o.db.query(`update sm_users set full_name = $2 where id = $1`, [m.userId, name]);
  const prof = await w.o.db.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [w.o.org, m.userId]);
  await w.sys.write((tx) =>
    prof
      ? updateIn(tx, w.sys, "member_profile", prof.id, { org_unit_id: unit, name }, { trusted: true })
      : createIn(tx, w.sys, "member_profile", { user_id: m.userId, name, org_unit_id: unit, roles, persona: "requester" }, { trusted: true }),
  );
  return m;
}

/** The bank of §3.7 (see the header). */
export async function bank(): Promise<Bank> {
  const w = await world();
  const U: Record<string, string> = {};
  const unit = async (name: string, kind: string, parent?: string) => String((await w.sys.write((tx) => createIn(tx, w.sys, "org_unit", { name, kind, parent_id: parent ?? null }, { trusted: true }))).id);
  U.hq = await unit("بانک آفتاب", "company");
  U.north = await unit("مدیریت شعب شمال", "division", U.hq);
  U.vanak = await unit("شعبهٔ ونک", "branch", U.north);
  U.counter = await unit("باجهٔ ونک", "team", U.vanak);
  U.finance = await unit("ادارهٔ مالی", "department", U.hq);
  const M: Record<string, Member> = {};
  M.designer = await member(w, "دنیا طراح", ["process_designer"], U.hq);
  M.publisher = await member(w, "پرویز مسئول انتشار", ["process_publisher"], U.hq);
  M.clerk = await member(w, "سارا کارمند باجه", ["requester"], U.counter);
  M.deputy = await member(w, "بهرام معاون شعبه", ["requester"], U.vanak);
  M.head = await member(w, "حسین رئیس شعبه", ["requester"], U.vanak);
  M.mgr = await member(w, "مینا مسئول تنخواه", ["requester"], U.finance);
  M.dlg = await member(w, "داوود جانشین", ["requester"], U.vanak);
  const X: Record<string, string> = {};
  X.fd1 = await person(w, "فرهاد معاون مالی", { unit: U.finance });
  X.fd2 = await person(w, "فریبا معاون مالی", { unit: U.finance });
  X.fdOther = await person(w, "فرید معاون مالی دیگر", { unit: U.finance });
  X.pay1 = await person(w, "پریسا امور مالی", { unit: U.finance });
  X.pay2 = await person(w, "پرویز امور مالی", { unit: U.finance });
  const position = (key: string, name: string, kind: string | null = null) => w.sys.write((tx) => createIn(tx, w.sys, "position", { key, name, unit_kind: kind }, { trusted: true }));
  await position("branch_staff", "کارمند شعبه");
  await position("branch_deputy", "معاون شعبه");
  await position("branch_head", "رئیس شعبه", "branch");
  await position("finance_deputy", "معاون مالی");
  const holds = async (key: string, user: string, at: string) => {
    const pos = (await w.o.db.one<{ id: string }>(`select id from sm_positions where org_id = $1 and key = $2`, [w.o.org, key]))!.id;
    await w.sys.write((tx) => createIn(tx, w.sys, "position_holder", { position_id: pos, user_id: user, org_unit_id: at, kind: "primary" }, { trusted: true }));
  };
  await holds("branch_staff", M.clerk.userId, U.counter);
  await holds("branch_deputy", M.deputy.userId, U.vanak);
  await holds("branch_head", M.head.userId, U.vanak);
  for (const u of [X.fd1, X.fd2, X.fdOther]) await holds("finance_deputy", u, U.finance);
  const financeGroup = String((await w.sys.write((tx) => createIn(tx, w.sys, "group", { name: "امور مالی", types: ["assignment"] }, { trusted: true }))).id);
  await w.sys.write(async (tx) => {
    for (const u of [X.pay1, X.pay2]) await createIn(tx, w.sys, "group_member", { group_id: financeGroup, user_id: u, kind: "member" }, { trusted: true });
  });
  return { w, U, M, X, financeGroup };
}

/** «درخواست تنخواهِ شعبه» (§3.7) as a designer's draft. */
export function pettyDraft(b: Bank, more: { managers?: string[]; confidential?: boolean; headRights?: Record<string, string> } = {}) {
  const F = b.w.forms;
  return {
    graph: {
      nodes: [
        node("t", "trigger"),
        node("s", "form_step", { action: "fill", start: true, form: F.req, rights: { default: "edit", fields: {} } }, "ثبت درخواست"),
        node("a1", "form_step", {
          action: "approve", form: F.review, rights: { default: "read", fields: more.headRights ?? {} }, quorum: "any",
          assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }],
          due: { amount: 1, unit: "day" }, escalate: [{ after: { amount: 2, unit: "day" }, action: "notify", to: "reports_to" }],
        }, "تأیید رئیس شعبه"),
        node("b", "branch", { mode: "data", rules: [{ left: "{{case.u_amount}}", op: "gt", right: "500000000" }] }, "شرط مبلغ"),
        node("a2", "form_step", {
          action: "approve", form: F.review, rights: { default: "read", fields: {} }, quorum: "any",
          assignees: [{ kind: "position", position: "finance_deputy", where: "anywhere", members: [b.X.fd1, b.X.fd2] }],
        }, "تأیید معاونت مالی"),
        node("pay", "form_step", {
          action: "fill", form: F.review, rights: { default: "read", fields: { u_finance_note: "required" } },
          assignees: [{ kind: "group", group: b.financeGroup }],
        }, "بررسی و پرداخت"),
        node("ok", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        node("no", "end", { outcome: "rejected" }, "پایان (ردشده)"),
      ],
      edges: [
        edge("t", "s"), edge("s", "a1"),
        edge("a1", "b", "approved"), edge("a1", "no", "rejected"), edge("a1", "s", "returned"),
        edge("b", "a2", "yes"), edge("b", "pay", "no"),
        edge("a2", "pay", "approved"), edge("a2", "no", "rejected"), edge("a2", "s", "returned"),
        edge("pay", "ok"),
      ],
    },
    starters: [{ kind: "position", position: "branch_staff", where: "anywhere" }, { kind: "position", position: "branch_deputy", where: "anywhere" }],
    title_template: "تنخواه {{case.u_branch}} — {{case.u_amount}}",
    requester_view: [],
    managers: more.managers ?? [],
    manager_groups: [],
    confidential: more.confidential ?? false,
  };
}

/** Make a member's session old: sensitive actions then ask for re-authentication. */
export const ageSession = (b: Bank, user: string) =>
  b.w.o.db.query(`update sm_sessions set reauth_at = now() - interval '3 hours', created_at = now() - interval '3 hours' where user_id = $1`, [user]);

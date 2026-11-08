// The approvals service's plug-ins for modules (docs/spec/services/sla.md §4, §8): the level rule `first` (the first
// answer, approval or rejection, settles the level), `onApprovalSettled` (same transaction as the decision, expiry or
// withdrawal), `cancelApprovalsIn` inside the caller's transaction and `rerunApprovalRules` (approvals planned again
// when what they depend on changed).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerTable } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { levelOutcome, levelsProblem, roundOutcome } from "@shared/sla/approvals";
import { cancelApprovalsIn, onApprovalSettled, rerunApprovalRulesIn, type ApprovalSettled } from "@server/modules/sla";
import { systemCtx } from "@server/engine";
import type { Client } from "./helpers";
import { engineOrg, type EngineOrg } from "./engine-helpers";

const CASE: TableDef = {
  key: "apv_hook",
  table: "sm_apv_hooks",
  label: "درخواست بودجه",
  plural: "درخواست‌های بودجه",
  icon: "wallet",
  module: "test",
  area: "work",
  extends: "task",
  display: "short_description",
  fields: [{ name: "kind", label: "نوع", type: "string", maxLength: 40 }],
  scope: {},
};
registerTable(CASE);

describe("the level rule `first`", () => {
  it("settles a level with the first answer, approval or rejection", () => {
    const rows = (...s: [string, string?][]) => s.map(([state, decided_at]) => ({ state, decided_at }));
    expect(levelOutcome(rows(["requested"], ["requested"]), "first")).toBe("pending");
    expect(levelOutcome(rows(["approved", "2026-01-01T10:00:00Z"], ["requested"]), "first")).toBe("approved");
    expect(levelOutcome(rows(["rejected", "2026-01-01T10:00:00Z"], ["requested"]), "first")).toBe("rejected");
    // should two answers exist, the earlier one decides
    expect(levelOutcome(rows(["approved", "2026-01-01T11:00:00Z"], ["rejected", "2026-01-01T10:00:00Z"]), "first")).toBe("rejected");
    expect(roundOutcome([{ state: "rejected", level: 1, rule: "first" }, { state: "no_longer_required", level: 1, rule: "first" }])).toBe("rejected");
    expect(levelsProblem([{ sources: [{ kind: "manager" }], rule: "first" }], () => undefined)).toBeNull();
  });
});

describe("approvals: hooks for modules", () => {
  let e: EngineOrg;
  let P = "";
  const who: Record<"R" | "A1" | "A2", { client: Client; userId: string }> = {} as never;
  const id = (k: keyof typeof who) => who[k].userId;
  const settled: ApprovalSettled[] = [];
  let off: () => void = () => {};
  let failNext = false;

  const rowsOf = (recId: string) =>
    e.db.query<Record<string, any>>(`select * from sm_approvals where org_id = $1 and record_id = $2 and deleted_at is null order by round, level, created_at, id`, [e.org, recId]);
  const file = async (kind: string) => (await who.R.client.post(`${P}/r/apv_hook`, { short_description: `بودجهٔ ${kind}`, kind })).row;
  const record = async (recId: string) => (await e.owner.get(`${P}/r/apv_hook/${recId}`)).row;

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    for (const k of ["R", "A1", "A2"] as const) who[k] = await e.member("member", `hook-${k.toLowerCase()}@example.com`);
    for (const k of ["R", "A1", "A2"] as const) await e.owner.put(`${P}/access/members/${id(k)}`, { roles: ["requester"] });
    for (const kind of ["first", "pair"]) {
      await e.owner.post(`${P}/r/approval_rule`, {
        name: `بودجه ${kind}`, table_key: "apv_hook", condition: { f: "kind", op: "eq", v: kind }, mode: "parallel",
        levels: [{ name: "مالی", sources: [{ kind: "users", users: [id("A1"), id("A2")] }], rule: kind === "first" ? "first" : "all" }],
      });
    }
    off = onApprovalSettled("apv_hook", (s) => {
      if (failNext) {
        failNext = false;
        throw new Error("module refused");
      }
      settled.push(s);
    });
  });

  afterAll(() => off());

  it("`first`: one rejection settles the round, withdraws the others and calls the module in the decision's transaction", async () => {
    const rec = await file("first");
    expect(rec.approval).toBe("requested");
    const [a1] = (await rowsOf(rec.id)).filter((r) => r.approver_id === id("A1"));
    // a module that refuses rolls the decision back with it (same transaction)
    failNext = true;
    await who.A1.client.post(`${P}/approvals/${a1.id}/decide`, { decision: "rejected", comment: "بودجه ندارد" }, 500);
    expect((await rowsOf(rec.id)).every((r) => r.state === "requested")).toBe(true);
    const before = settled.length;
    await who.A1.client.post(`${P}/approvals/${a1.id}/decide`, { decision: "rejected", comment: "بودجه ندارد" });
    const rows = await rowsOf(rec.id);
    expect(rows.find((r) => r.approver_id === id("A1"))!.state).toBe("rejected");
    expect(rows.find((r) => r.approver_id === id("A2"))!.state).toBe("no_longer_required");
    expect((await record(rec.id)).approval).toBe("rejected");
    expect(settled.length).toBe(before + 1);
    expect(settled.at(-1)).toMatchObject({ outcome: "rejected", aggregate: "rejected", round: 1, by: id("A1") });
    expect(settled.at(-1)!.record.approval).toBe("rejected");
  });

  it("an `all` level settles only with the last approval", async () => {
    const rec = await file("pair");
    const rows = await rowsOf(rec.id);
    const before = settled.length;
    await who.A1.client.post(`${P}/approvals/${rows.find((r) => r.approver_id === id("A1"))!.id}/decide`, { decision: "approved" });
    expect(settled.length).toBe(before);
    await who.A2.client.post(`${P}/approvals/${rows.find((r) => r.approver_id === id("A2"))!.id}/decide`, { decision: "approved" });
    expect(settled.length).toBe(before + 1);
    expect(settled.at(-1)).toMatchObject({ outcome: "approved", aggregate: "approved", by: id("A2") });
  });

  it("cancelApprovalsIn withdraws inside the caller's transaction and settles the round as canceled", async () => {
    const rec = await file("pair");
    const sys = await systemCtx(e.cfg, e.org);
    const before = settled.length;
    const out = await sys.write(async (tx) => {
      const r = await cancelApprovalsIn(tx, sys, "apv_hook", rec.id, { state: "no_longer_required", comment: "دیگر لازم نیست" });
      // the same transaction sees its own withdrawal
      const open = await tx.query(`select 1 from sm_approvals where record_id = $1 and state = 'requested'`, [rec.id]);
      expect(open.length).toBe(0);
      return r;
    });
    expect(out.canceled).toBe(2);
    const rows = await rowsOf(rec.id);
    expect(rows.every((r) => r.state === "no_longer_required" && r.comments === "دیگر لازم نیست")).toBe(true);
    expect(settled.length).toBe(before + 1);
    expect(settled.at(-1)).toMatchObject({ outcome: "canceled", round: 1 });
    // a rolled-back transaction leaves the approvals as they were
    const again = await file("pair");
    await expect(sys.write(async (tx) => {
      await cancelApprovalsIn(tx, sys, "apv_hook", again.id);
      throw new Error("rolled back");
    })).rejects.toThrow("rolled back");
    expect((await rowsOf(again.id)).every((r) => r.state === "requested")).toBe(true);
  });

  it("rerunApprovalRules asks the open round again (a new round with the reason) without settling the old one", async () => {
    const rec = await file("pair");
    const [a1] = (await rowsOf(rec.id)).filter((r) => r.approver_id === id("A1"));
    await who.A1.client.post(`${P}/approvals/${a1.id}/decide`, { decision: "approved" });
    const sys = await systemCtx(e.cfg, e.org);
    const before = settled.length;
    const out = await sys.write((tx) => rerunApprovalRulesIn(tx, sys, "apv_hook", rec.id, { comment: "مبلغ تغییر کرد" }));
    expect(out).toMatchObject({ canceled: 1, started: 2, aggregate: "requested" });
    expect(settled.length).toBe(before);
    const rows = await rowsOf(rec.id);
    expect(rows.filter((r) => r.round === 1).map((r) => r.state).sort()).toEqual(["approved", "canceled"]);
    const fresh = rows.filter((r) => r.round === 2);
    expect(fresh.map((r) => r.state)).toEqual(["requested", "requested"]);
    expect(fresh.every((r) => r.comments === "مبلغ تغییر کرد")).toBe(true);
    expect((await record(rec.id)).approval).toBe("requested");
    // a rule whose condition no longer holds just loses its open round
    await e.owner.patch(`${P}/r/apv_hook/${rec.id}`, { kind: "other" });
    const gone = await sys.write((tx) => rerunApprovalRulesIn(tx, sys, "apv_hook", rec.id));
    expect(gone).toMatchObject({ canceled: 2, started: 0 });
  });
});

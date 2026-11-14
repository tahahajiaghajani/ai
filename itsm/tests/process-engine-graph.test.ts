// F4a — the pure side of workflows (design F §3.5–3.7): the process graph's validator (one «آغاز» followed by one
// «ثبت درخواست»; «بازگشت برای اصلاح» only back to an earlier form step on the same branch, «ثبت درخواست» included,
// never across a «موازی»/«پیوستن» boundary; every other cycle refused; an «any» join must cancel the rest; ports wired;
// the step settings), its warnings (a field two parallel branches edit, a pool over 30, a title pill a step hides, a
// required field no step edits), the diagram's statuses (`stepStatuses`) and the title template.
import { describe, it, expect } from "vitest";
import type { FieldDef } from "@shared/model/types";
import type { FormLayoutV2 } from "@shared/forms/layout";
import {
  defaultReturnTarget, hasProcessErrors, processPorts, processSteps, renderTitle, restartTargets, returnTargets, stepStatuses, structureOf, titlePills, validateProcess,
  type CaseProgress, type ProcessGraph, type ProcessValidateContext,
} from "@shared/process";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { head: id(1), deputy: id(2), finance: id(3), requester: id(4), other: id(5) };

type N = ProcessGraph["nodes"][number];
const node = (nid: string, type: N["type"], config: Record<string, unknown> = {}, label?: string): N => ({ id: nid, type, config, ...(label ? { label } : {}) });
const edge = (source: string, target: string, port?: string) => ({ id: `${source}.${port ?? "out"}.${target}`, source, target, ...(port ? { port } : {}) });
const people = (...users: string[]) => ({ assignees: [{ kind: "users", users }] });
const step = (action: "fill" | "review" | "approve", form: string, extra: Record<string, unknown> = {}) => ({ action, form, rights: { default: "read", fields: {} }, ...people(U.head), ...extra });

/** «درخواست تنخواهِ شعبه» (§3.7). */
function bank(): ProcessGraph {
  return {
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: "f_req", rights: { default: "edit", fields: {} } }),
      node("a1", "form_step", step("approve", "f_req", { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }], quorum: "any", due: { amount: 1, unit: "day" } }), "تأیید رئیس شعبه"),
      node("b", "branch", { mode: "data", rules: [{ left: "{{case.u_amount}}", op: "gt", right: "500000000" }] }),
      node("a2", "form_step", step("approve", "f_review", { assignees: [{ kind: "position", position: "finance_deputy", where: "anywhere", members: [U.deputy, U.finance] }] }), "تأیید معاونت مالی"),
      node("f", "form_step", step("fill", "f_review", { rights: { default: "read", fields: { u_note: "required" } } }), "بررسی و پرداخت"),
      node("ok", "end", { outcome: "completed" }),
      node("no", "end", { outcome: "rejected" }),
    ],
    edges: [
      edge("t", "s"), edge("s", "a1"),
      edge("a1", "b", "approved"), edge("a1", "no", "rejected"), edge("a1", "s", "returned"),
      edge("b", "a2", "yes"), edge("b", "f", "no"),
      edge("a2", "f", "approved"), edge("a2", "no", "rejected"), edge("a2", "s", "returned"),
      edge("f", "ok"),
    ],
  };
}

/** «بررسی حقوقی» ∥ «بررسی مالی» after the start, then «تأیید نهایی». */
function parallel(joinMode: "all" | "any" = "all", cancelRest = true): ProcessGraph {
  return {
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: "f_req", rights: { default: "edit", fields: {} } }),
      node("p", "parallel"),
      node("l1", "form_step", step("fill", "f_legal"), "تکمیل حقوقی"),
      node("l2", "form_step", step("review", "f_legal"), "بررسی حقوقی"),
      node("m", "form_step", step("review", "f_fin"), "بررسی مالی"),
      node("j", "join", { mode: joinMode, ...(joinMode === "any" && cancelRest ? { cancel_rest: true } : {}) }),
      node("fin", "form_step", step("approve", "f_req"), "تأیید نهایی"),
      node("ok", "end"),
      node("no", "end", { outcome: "rejected" }),
    ],
    edges: [
      edge("t", "s"), edge("s", "p"), edge("p", "l1"), edge("p", "m"), edge("l1", "l2"), edge("l2", "j"), edge("m", "j"), edge("j", "fin"),
      edge("fin", "ok", "approved"), edge("fin", "no", "rejected"),
    ],
  };
}

const errors = (g: unknown, ctx?: ProcessValidateContext) => validateProcess(g, ctx).filter((p) => p.level === "error");
const warnings = (g: unknown, ctx?: ProcessValidateContext) => validateProcess(g, ctx).filter((p) => p.level === "warning");
const withEdges = (g: ProcessGraph, ...edges: ReturnType<typeof edge>[]): ProcessGraph => ({ ...g, edges: [...g.edges, ...edges] });

describe("validateProcess: the start and the shape", () => {
  it("accepts the bank's «درخواست تنخواه» (§3.7)", () => {
    expect(errors(bank())).toEqual([]);
    expect(hasProcessErrors(validateProcess(bank()))).toBe(false);
  });

  it("refuses what is not a graph, a missing or second «آغاز», a step that is not a process step", () => {
    expect(errors(null)[0].message).toBe("طرح گردش‌کار معتبر نیست");
    const g = bank();
    expect(errors({ ...g, nodes: g.nodes.filter((n) => n.id !== "t"), edges: g.edges.filter((e) => e.source !== "t") }).map((p) => p.message)).toContain("گام «آغاز» پیدا نشد");
    expect(errors({ ...g, nodes: [...g.nodes, node("t2", "trigger")] }).map((p) => p.message)).toContain("گردش‌کار فقط یک «آغاز» دارد");
    const flowStep = errors({ ...g, nodes: [...g.nodes, node("u", "update_record" as N["type"])] });
    expect(flowStep.find((p) => p.node === "u")?.message).toMatch(/در گردش‌کارها به کار نمی‌رود/);
  });

  it("wants «ثبت درخواست» directly after «آغاز», only one, and a fill step", () => {
    const g = bank();
    // «آغاز» straight to the branch head's approval
    const skipped = { ...g, edges: g.edges.map((e) => (e.source === "t" ? edge("t", "a1") : e)) };
    expect(errors(skipped).map((p) => p.message)).toContain("«آغاز» فقط به «ثبت درخواست» وصل می‌شود");
    const two = { ...g, nodes: g.nodes.map((n) => (n.id === "f" ? { ...n, config: { ...n.config, start: true } } : n)) };
    expect(errors(two).find((p) => p.node === "f")?.message).toBe("گردش‌کار فقط یک «ثبت درخواست» دارد");
    const approving = { ...g, nodes: g.nodes.map((n) => (n.id === "s" ? { ...n, config: { ...n.config, action: "approve" } } : n)) };
    expect(errors(approving).find((p) => p.node === "s" && p.field === "action")?.message).toBe("«ثبت درخواست» مرحلهٔ تکمیل فرم است");
    // reaching the start step by a forward edge (not a return)
    expect(errors(withEdges(g, edge("b", "s", "no"))).map((p) => p.message)).toContain("به «ثبت درخواست» فقط از «آغاز» یا با «بازگشت برای اصلاح» می‌رسند");
  });
});

describe("validateProcess: «بازگشت برای اصلاح»", () => {
  it("allows a return to an earlier step on the same branch, and to «ثبت درخواست»", () => {
    // a2 → a1: every path to a2 passes a1
    const g = { ...bank(), edges: bank().edges.map((e) => (e.source === "a2" && e.port === "returned" ? edge("a2", "a1", "returned") : e)) };
    expect(errors(g)).toEqual([]);
    // the default target is the nearest earlier step; «ثبت درخواست» is always among them
    expect(returnTargets(bank(), "a2")).toEqual(["a1", "s"]);
    expect(defaultReturnTarget(bank(), "a2")).toBe("a1");
    expect(defaultReturnTarget(bank(), "a1")).toBe("s");
  });

  it("returns twice to «ثبت درخواست» (two steps, one target) and stays valid", () => {
    expect(bank().edges.filter((e) => e.port === "returned" && e.target === "s")).toHaveLength(2);
    expect(errors(bank())).toEqual([]);
  });

  it("refuses a return to a step on another branch, or to a step that is not a form step", () => {
    // a review on the «no» path returning to the finance deputy's approval (only on the «yes» path)
    const g = bank();
    g.nodes.push(node("r", "form_step", step("review", "f_review"), "بررسی کارشناس"));
    g.edges = g.edges.filter((e) => !(e.source === "b" && e.port === "no")).concat([edge("b", "r", "no"), edge("r", "f"), edge("r", "a2", "returned")]);
    const e1 = errors(g).find((p) => p.edge === "r.returned.a2");
    expect(e1?.message).toBe("«بازگشت برای اصلاح» فقط به مرحله‌ای پیشین در همین مسیر می‌رود");
    const toBranch = { ...bank(), edges: bank().edges.map((e) => (e.source === "a2" && e.port === "returned" ? edge("a2", "b", "returned") : e)) };
    expect(errors(toBranch).find((p) => p.edge === "a2.returned.b")?.message).toBe("«بازگشت برای اصلاح» فقط به مرحلهٔ فرمی پیشین می‌رود");
  });

  it("refuses every other edge back (a cycle), and «بازگشت» from a fill step (no such port)", () => {
    const loop = withEdges(bank(), edge("f", "a1", "timeout"));
    expect(errors(loop).map((p) => p.message)).toContain("این اتصال دور می‌سازد؛ تنها بازگشت مجاز «بازگشت برای اصلاح» از مرحلهٔ بررسی یا تأیید به مرحله‌ای پیشین است");
    const fillBack = withEdges(bank(), edge("f", "a1", "returned"));
    expect(errors(fillBack).find((p) => p.edge === "f.returned.a1")?.message).toBe("«بررسی و پرداخت» خروجی «returned» ندارد");
  });

  it("refuses a return across a «موازی»/«پیوستن» boundary, allows one inside a branch", () => {
    // inside the legal branch: «بررسی حقوقی» back to «تکمیل حقوقی»
    expect(errors(withEdges(parallel(), edge("l2", "l1", "returned")))).toEqual([]);
    // out of the branch to «ثبت درخواست»
    const out = errors(withEdges(parallel(), edge("m", "s", "returned")));
    expect(out.find((p) => p.edge === "m.returned.s")?.message).toBe("«بازگشت برای اصلاح» از مرز «موازی» و «پیوستن» نمی‌گذرد");
    // after the join into a branch: not every path passes it
    const into = errors(withEdges(parallel(), edge("fin", "l2", "returned")));
    expect(into.find((p) => p.edge === "fin.returned.l2")?.message).toBe("«بازگشت برای اصلاح» فقط به مرحله‌ای پیشین در همین مسیر می‌رود");
    // after the join back to «ثبت درخواست» (outside any block): allowed
    expect(errors(withEdges(parallel(), edge("fin", "s", "returned")))).toEqual([]);
    expect(returnTargets(parallel(), "m")).toEqual([]);
    expect(restartTargets(parallel())).toEqual(["s", "fin"]);
  });
});

describe("validateProcess: joins, ports and settings", () => {
  it("wants `cancel_rest` on an «any» join", () => {
    expect(errors(parallel("all"))).toEqual([]);
    expect(errors(parallel("any", true))).toEqual([]);
    const e = errors(parallel("any", false)).find((p) => p.node === "j");
    expect(e).toMatchObject({ field: "cancel_rest", message: "«پیوستن» با «نخستین شاخه» باید شاخه‌های دیگر را لغو کند" });
  });

  it("reports unwired ports (timeout, «بازگشت» and the error path may stay open)", () => {
    const g = { ...bank(), edges: bank().edges.filter((e) => !(e.source === "a1" && e.port === "rejected")) };
    expect(errors(g).find((p) => p.node === "a1")?.message).toBe("خروجی «رد شد» به گامی وصل نیست");
    expect(processPorts({ type: "form_step", config: { action: "review" } }).map((p) => [p.key, !!p.optional])).toEqual([["out", false], ["returned", true], ["timeout", true]]);
    expect(processPorts({ type: "form_step", config: { action: "fill", start: true } }).map((p) => p.key)).toEqual(["out", "timeout"]);
  });

  it("refuses branches that meet before their join, and paths into a block from outside", () => {
    // the legal branch runs into the finance step: «بررسی مالی» would run once per branch
    const meet = withEdges({ ...parallel(), edges: parallel().edges.filter((e) => !(e.source === "l2")) }, edge("l2", "m"));
    expect(errors(meet).find((p) => p.node === "m")?.message).toBe("شاخه‌های «موازی» پیش از «پیوستن» به هم رسیده‌اند؛ این گام برای هر شاخه یک بار اجرا می‌شود");
    // a branch skipping the join to the final approval
    const around = { ...parallel(), edges: parallel().edges.map((e) => (e.source === "m" ? edge("m", "fin") : e)) };
    expect(errors(around).find((p) => p.node === "fin")?.message).toMatch(/هم از درون و هم از بیرون شاخه‌های موازی/);
  });

  it("checks each step's settings: form, people, quorum, durations, escalations", () => {
    const g = bank();
    const a1 = g.nodes.find((n) => n.id === "a1")!;
    a1.config = { ...a1.config, form: null, assignees: [], quorum: "count", threshold: 0, due: { amount: -1, unit: "day" }, escalate: [{ after: { amount: 2, unit: "day" }, action: "auto", outcome: "submitted" }] };
    const msgs = errors(g).filter((p) => p.node === "a1").map((p) => `${p.field}: ${p.message}`);
    expect(msgs).toEqual(expect.arrayContaining([
      "form: فرم این مرحله را انتخاب کنید",
      "assignees: این مرحله انجام‌دهنده ندارد",
      "threshold: تعداد تأیید لازم باید عددی میان ۱ و ۵۰ باشد",
      "due: مهلت معتبر نیست",
      "escalate: نتیجهٔ خودکار با کار این مرحله نمی‌خواند",
    ]));
    // a branch compares the case's values, never a record condition
    const b = bank();
    b.nodes.find((n) => n.id === "b")!.config = { mode: "record", condition: { f: "x", op: "eq", v: 1 } };
    expect(errors(b).find((p) => p.node === "b")?.message).toBe("در گردش‌کار، «شرط» مقدارهای پرونده را مقایسه می‌کند");
    // forms that do not exist (when the caller knows them)
    expect(errors(bank(), { forms: (fid) => (fid === "f_req" ? { name: "فرم درخواست", layout: { tabs: [] } } : null) }).filter((p) => p.message === "فرم این مرحله پیدا نشد").map((p) => p.node)).toEqual(["a2", "f"]);
  });

  it("gives «انتخاب» one port per case plus «هیچ‌کدام», all of them wired", () => {
    const g = bank();
    g.nodes.push(node("c", "choice", { cases: [{ key: "small", label: "کم", rules: [{ left: "{{case.u_amount}}", op: "lt", right: "1000" }] }, { key: "big", label: "زیاد", rules: [{ left: "{{case.u_amount}}", op: "gte", right: "1000" }] }] }));
    g.edges = g.edges.filter((e) => !(e.source === "b")).concat([edge("b", "c", "yes"), edge("b", "f", "no"), edge("c", "a2", "small"), edge("c", "f", "big")]);
    expect(processPorts(g.nodes.find((n) => n.id === "c")!).map((p) => p.key)).toEqual(["small", "big", "else"]);
    expect(errors(g).find((p) => p.node === "c")?.message).toBe("خروجی «هیچ‌کدام» به گامی وصل نیست");
    g.edges.push(edge("c", "f", "else"));
    expect(errors(g)).toEqual([]);
  });

  it("takes each step's settings out for the version (`processSteps`)", () => {
    const steps = processSteps(bank());
    expect(Object.keys(steps)).toEqual(["s", "a1", "a2", "f"]);
    expect(steps.s).toMatchObject({ action: "fill", start: true, form: "f_req" });
    expect(steps.a1).toMatchObject({ action: "approve", quorum: "any", due: { amount: 1, unit: "day" } });
    expect(steps.a1.assignees[0]).toMatchObject({ kind: "position", position: "branch_head" });
  });
});

describe("validateProcess: warnings from the forms", () => {
  const fields: Record<string, FieldDef> = {
    u_amount: { name: "u_amount", label: "مبلغ درخواستی", type: "money" },
    u_need: { name: "u_need", label: "شرح نیاز", type: "text" },
    u_note: { name: "u_note", label: "نظر مالی", type: "text" },
    u_legal: { name: "u_legal", label: "نظر حقوقی", type: "text" },
  };
  const layout = (...items: { field: string; required?: boolean }[]): FormLayoutV2 => ({ tabs: [{ label: "اصلی", sections: [{ label: null, items }] }] });
  const forms: Record<string, { name: string; layout: FormLayoutV2 }> = {
    f_req: { name: "فرم درخواست", layout: layout({ field: "u_amount" }, { field: "u_need" }) },
    f_review: { name: "فرم بررسی مالی", layout: layout({ field: "u_amount" }, { field: "u_need" }, { field: "u_note", required: true }) },
    f_legal: { name: "فرم حقوقی", layout: layout({ field: "u_legal" }, { field: "u_amount" }) },
    f_fin: { name: "فرم مالی", layout: layout({ field: "u_note" }, { field: "u_amount" }) },
  };
  const ctx = (extra: Partial<ProcessValidateContext> = {}): ProcessValidateContext => ({ forms: (fid) => forms[fid], fields, ...extra });

  it("warns about a field two parallel branches may both change («آخرین ثبت می‌ماند»)", () => {
    const g = parallel();
    for (const n of g.nodes) if (n.id === "l2" || n.id === "m") n.config = { ...n.config, rights: { default: "read", fields: { u_amount: "edit" } } };
    expect(warnings(g, ctx()).find((p) => p.node === "p")?.message).toBe("فیلد «مبلغ درخواستی» در دو شاخهٔ موازی ویرایش‌پذیر است؛ آخرین ثبت می‌ماند");
    expect(warnings(parallel(), ctx()).some((p) => p.node === "p")).toBe(false);
  });

  it("checks the title: start-form fields and the requester only; warns where a step hides a pill", () => {
    expect(errors(bank(), ctx({ titleTemplate: "تنخواه {{case.u_amount}} برای {{case.requested_by}}" }))).toEqual([]);
    expect(errors(bank(), ctx({ titleTemplate: "{{case.u_note}}" })).map((p) => p.message)).toContain("الگوی عنوان فقط فیلدهای فرم «ثبت درخواست» و درخواست‌دهنده را می‌پذیرد («نظر مالی»)");
    expect(errors(bank(), ctx({ titleTemplate: "{{trigger.record.x}}" })).map((p) => p.field)).toContain("title_template");
    const g = bank();
    g.nodes.find((n) => n.id === "a2")!.config.rights = { default: "read", fields: { u_amount: "hidden" } };
    expect(warnings(g, ctx({ titleTemplate: "تنخواه {{case.u_amount}}" })).find((p) => p.node === "a2")?.message).toBe("عنوان پرونده «مبلغ درخواستی» را نشان می‌دهد که این مرحله پنهان می‌کند");
  });

  it("warns about a required field no step can edit, and pools over 30", () => {
    const g = bank();
    g.nodes.find((n) => n.id === "f")!.config.rights = { default: "read", fields: {} };
    expect(warnings(g, ctx()).map((p) => p.message)).toContain("فیلد الزامی «نظر مالی» در هیچ مرحله‌ای ویرایش‌پذیر نیست");
    expect(warnings(bank(), ctx()).map((p) => p.message)).not.toContain("فیلد الزامی «نظر مالی» در هیچ مرحله‌ای ویرایش‌پذیر نیست");
    const big = warnings(bank(), ctx({ poolCounts: { holders: (pos) => (pos === "finance_deputy" ? 2 : null) } }));
    expect(big.some((p) => p.node === "a2" && /نفر/.test(p.message))).toBe(false);
    const pool = bank();
    pool.nodes.find((n) => n.id === "f")!.config.assignees = [{ kind: "group", group: id(9) }];
    expect(warnings(pool, ctx({ poolCounts: { group: () => 40 } })).find((p) => p.node === "f")?.message).toBe("تا ۴۰ نفر انجام‌دهندهٔ این مرحله می‌شوند؛ برای هر نفر یک کار ساخته می‌شود");
  });
});

describe("stepStatuses", () => {
  const head = { user: U.head, positions: [{ position: "branch_head", unit: id(20) }], groups: [], roles: [] };
  const deputy = { user: U.deputy, positions: [{ position: "finance_deputy", unit: null }], groups: [], roles: [] };
  const started: CaseProgress = { t: { status: "done", round: 1 }, s: { status: "done", outcome: "submitted", round: 1 }, a1: { status: "active", round: 1, waiting: 2 } };

  it("marks done, active, mine_open and the steps still to come", () => {
    const st = stepStatuses({ graph: bank() }, { state: "active", progress: started, requested_by: U.requester }, [{ step_key: "a1", status: "open", round: 1 }], head);
    expect(st.t.status).toBe("done");
    expect(st.s).toMatchObject({ status: "done", outcome: "submitted" });
    expect(st.a1).toMatchObject({ status: "mine_open", waiting: 2 });
    expect(st.b.status).toBe("future");
    // «بررسی و پرداخت» names the branch head among its people
    expect(st.f.status).toBe("mine_expected");
    expect(st.ok.status).toBe("future");
    // another reader sees the step active with two people waiting
    expect(stepStatuses({ graph: bank() }, { state: "active", progress: started }, [], null).a1).toMatchObject({ status: "active", waiting: 2 });
    // the requester did the start
    expect(stepStatuses({ graph: bank() }, { state: "active", progress: started, requested_by: U.requester }, [{ step_key: "s", status: "done", outcome: "submitted", round: 1 }], { user: U.requester, positions: [], groups: [], roles: [] }).s.status).toBe("mine_done");
  });

  it("marks a future step whose people may include me (statically, or by the server's dry run)", () => {
    const st = stepStatuses({ graph: bank() }, { state: "active", progress: started, requested_by: U.requester }, [], deputy);
    expect(st.a2.status).toBe("mine_expected");
    expect(st.f.status).toBe("future");
    expect(stepStatuses({ graph: bank() }, { state: "active", progress: started }, [], deputy, { expected: ["f"] }).f.status).toBe("mine_expected");
  });

  it("skips the path not taken and everything once the case ends", () => {
    const tookNo: CaseProgress = { ...started, a1: { status: "done", outcome: "approved", round: 1 }, b: { status: "done", port: "no", round: 1 }, f: { status: "active", round: 1, waiting: 1 } };
    const st = stepStatuses({ graph: bank() }, { state: "active", progress: tookNo }, [], deputy);
    expect(st.a2.status).toBe("skipped");
    expect(st.no.status).toBe("skipped");
    expect(st.ok.status).toBe("future");
    expect(st.a1).toMatchObject({ status: "done", outcome: "approved" });
    const ended: CaseProgress = { ...tookNo, f: { status: "done", outcome: "submitted", round: 1 }, ok: { status: "done", outcome: "completed", round: 1 } };
    const fin = stepStatuses({ graph: bank() }, { state: "completed", progress: ended }, [], deputy);
    expect(fin.ok).toMatchObject({ status: "done", outcome: "completed" });
    expect(fin.a2.status).toBe("skipped");
    expect(fin.no.status).toBe("skipped");
  });

  it("shows everything ahead for a start still in the queue", () => {
    const st = stepStatuses({ graph: bank() }, { state: "active", progress: {} }, [], null);
    expect(Object.values(st).every((v) => v.status === "future")).toBe(true);
  });
});

describe("the structure helpers and the title", () => {
  it("knows each node's parallel block and dominators", () => {
    const s = structureOf(parallel());
    expect(s.blocks.get("l1")).toEqual(["p"]);
    expect(s.blocks.get("j")).toEqual(["p"]);
    expect(s.blocks.get("fin")).toEqual([]);
    expect([...s.dom.get("fin")!].sort()).toEqual(["fin", "j", "p", "s", "t"]);
  });

  it("fills the title from the start form and the requester", () => {
    expect(titlePills("تنخواه {{case.u_amount}} — {{ case.requested_by }} {{now}}")).toEqual({ keys: ["u_amount", "requested_by"], other: ["now"] });
    const text = (k: string) => ({ u_amount: "۵۰۰٬۰۰۰ ریال", requested_by: "علی احمدی" } as Record<string, string>)[k];
    expect(renderTitle("تنخواه {{case.u_amount}} برای {{case.requested_by}}", text, "تنخواه")).toBe("تنخواه ۵۰۰٬۰۰۰ ریال برای علی احمدی");
    expect(renderTitle("تنخواه — {{case.u_missing}}", text, "درخواست تنخواه")).toBe("تنخواه");
    expect(renderTitle("", text, "درخواست تنخواه")).toBe("درخواست تنخواه");
    expect(renderTitle("{{case.u_missing}}", text, "درخواست تنخواه")).toBe("درخواست تنخواه");
  });
});

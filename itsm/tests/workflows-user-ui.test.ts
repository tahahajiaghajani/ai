// The person's «گردش‌کارها» (design F §5, §8.6, package F7; src/ui/modules/workflows/user): the routes and the nav row
// with its count, the record link of a case, the four tabs and their filters in the address, the rows of «کارتابل» and
// their notes, the click budget, the due pill, a process's marks, the state channel and the path a case took, the
// decisions each step kind offers and the reasons they ask for, the consequences and the messages after a decision,
// what a submission sends (files as `{ upload: n }`), where a form starts, the required fields left empty — and on a
// real organisation, through the pages' own API module: the §3.7 bank process started by a clerk, the head's
// «کارتابل» and case, a return to the requester with its consequence, a draft kept and refilled, the requester's
// second round, the approval; a pool step taken by one («در دست …»), the other's late decision kept with its message;
// a delegate's «به جانشینی از …»; the printable view; a reader of no case gets an empty «پرونده‌ها».
import { describe, it, expect, beforeAll } from "vitest";
import { matchRoutes } from "react-router";
import { create } from "@server/engine";
import { seedNotices } from "@server/modules/process/api";
import type { ProcessGraph } from "@shared/process";
import type { FieldDef } from "@shared/model/types";
import type { FormLayoutV2, Right } from "@shared/forms/layout";
import { STEP_STATUS } from "../src/ui/modules/workflows/kit/model";
import { ROUTES, NAV } from "../src/ui/modules/registry";
import { userPart } from "../src/ui/modules/workflows/user/routes";
import { userApi, casesQuery, type CaseDetail, type InboxRow, type MyStep, type StepView } from "../src/ui/modules/workflows/user/api";
import {
  CASE_PATH, PORTAL_WF_PATH, PRINT_PATH, PROCESS_PATH, RECORD_CASE_PATH, START_PATH, STEP_PATH, WF_PATH, caseFiltersOf, caseStateView, consequence, defaultReturn,
  draftValues, dueView, fieldProblems, filtered, headerStep, inboxRowView, initialValues, mapLink, missingRequired, myPart, newCaseId, openSteps, packValues, processMarks,
  resultMessage, rowLink, sendLabel, startMessage, startValues, stateChannel, stepActions, stepNotes, tabOf, takenFromStatuses, waitingText, wfPaths, withCaseFilter,
} from "../src/ui/modules/workflows/user/model";
import type { OrgApi } from "../src/ui/lib/api";
import type { Client } from "./helpers";
import { edge, node } from "./process-engine-helpers";
import { bank, pettyDraft, type Bank } from "./process-api-helpers";

// ---------------------------------------------------------------------------------------------------------------
// helpers

const CREATED = /^\/process\/defs$|^\/process\/start$/;
const orgApiOf = (c: Client, P: string) =>
  ({
    get: (path: string, q?: Record<string, string | number | null | undefined>) => {
      // as the app's client: empty values are left out of the query
      const kept = Object.entries(q ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]);
      return c.get(`${P}${path}${kept.length ? `?${new URLSearchParams(kept)}` : ""}`);
    },
    post: (path: string, body?: unknown) => c.post(`${P}${path}`, body, CREATED.test(path) ? 201 : 200),
    put: (path: string, body?: unknown) => c.put(`${P}${path}`, body),
    patch: (path: string, body?: unknown) => c.patch(`${P}${path}`, body),
    del: (path: string) => c.del(`${P}${path}`),
  }) as unknown as OrgApi;

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  kind: "process_step", id: "t1", case_id: "c1", table: "process_case", record_id: "c1", number: "PRC0000123", title: "تنخواه ۱۲۰٬۰۰۰٬۰۰۰ تومان — سمیرا رضایی", source: "درخواست تنخواه شعبه",
  process_id: "p1", step: "تأیید رئیس شعبه", action: "approve", from: "u-samira", since: "2026-11-14T08:00:00.000Z", due_at: null, on_behalf_of: null, claimed_by: null, queued: false,
  paused: false, can_act: true, link: "workflows/c/c1/s/t1", ...over,
});
const display = { "u-samira": "سمیرا رضایی", "u-ali": "علی احمدی", "u-head": "حسین رئیس شعبه" };
const step = (over: Partial<MyStep> = {}): MyStep => ({
  id: "t1", step_key: "a1", label: "تأیید رئیس شعبه", action: "approve", round: 1, opened_at: null, due_at: null, delegated_from: null, claimed_by: null, queued: false, refused: null,
  form: "f1", rights: {}, outcomes: ["approved", "rejected", "returned"], return_targets: [{ key: "s", label: "ثبت درخواست", default: true, to: "u-samira" }],
  next: { approved: "بررسی مالی", rejected: "پایان" }, draft: null, ...over,
});

/** The §3.7 graph (ids as in pettyDraft). */
const N = node;
const E = edge;
const petty: ProcessGraph = {
  nodes: [
    N("t", "trigger"), N("s", "form_step", { action: "fill", start: true, form: "f1" }, "ثبت درخواست"), N("a1", "form_step", { action: "approve", form: "f2" }, "تأیید رئیس شعبه"),
    N("b", "branch", { mode: "data", rules: [] }, "شرط مبلغ"), N("a2", "form_step", { action: "approve", form: "f2" }, "تأیید معاونت مالی"), N("pay", "form_step", { action: "fill", form: "f2" }, "بررسی و پرداخت"),
    N("ok", "end", { outcome: "completed" }, "پایان (انجام‌شده)"), N("no", "end", { outcome: "rejected" }, "پایان (ردشده)"),
  ],
  edges: [
    E("t", "s"), E("s", "a1"), E("a1", "b", "approved"), E("a1", "no", "rejected"), E("a1", "s", "returned"), E("b", "a2", "yes"), E("b", "pay", "no"), E("a2", "pay", "approved"),
    E("a2", "no", "rejected"), E("a2", "s", "returned"), E("pay", "ok"),
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// routes and the nav row

describe("the routes, the nav row and the record link", () => {
  it("the part's routes are registered once in the app; «گردش‌کارها» sits in the home space with its live count", () => {
    const paths = ROUTES.map((r) => r.path);
    for (const p of [WF_PATH, PROCESS_PATH, START_PATH, CASE_PATH, STEP_PATH, PRINT_PATH, RECORD_CASE_PATH]) expect(paths.filter((x) => x === p)).toHaveLength(1);
    expect(userPart.segments).toEqual({ workflows: "home" });
    const group = NAV.find((g) => g.key === "workflows" && g.space === "home");
    const item = group?.items.find((i) => i.path === WF_PATH);
    expect(item).toMatchObject({ label: "گردش‌کارها", workspace: true });
    expect(item?.access).toBeUndefined();
    expect(item?.count).toMatchObject({ key: "workflows:waiting", tables: ["process_task", "approval"] });
  });

  it("the record page of a case (the seeded notifications' link) opens the case here; other record pages stay the record engine's", () => {
    const routes = ROUTES.map((r) => ({ path: r.path }));
    expect(matchRoutes(routes, "/r/process_case/0b9c")?.[0].route.path).toBe(RECORD_CASE_PATH);
    expect(matchRoutes(routes, "/r/incident/0b9c")?.[0].route.path).toBe("r/:table/:id");
    expect(matchRoutes(routes, "/workflows/c/c1/s/t1")?.[0].route.path).toBe(STEP_PATH);
    expect(matchRoutes(routes, "/workflows/c/c1/print")?.[0].route.path).toBe(PRINT_PATH);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// addresses, tabs, filters

describe("addresses, tabs and the filters of «پرونده‌ها»", () => {
  it("the pages under the app and under the portal; the API's links mapped onto each", () => {
    const app = wfPaths(WF_PATH);
    const portal = wfPaths(PORTAL_WF_PATH);
    expect([app.home(), app.home("mine"), app.process("petty_cash"), app.start("petty_cash"), app.kase("c1"), app.step("c1", "t1"), app.print("c1")]).toEqual([
      "workflows", "workflows?tab=mine", "workflows/p/petty_cash", "workflows/start/petty_cash", "workflows/c/c1", "workflows/c/c1/s/t1", "workflows/c/c1/print",
    ]);
    expect(portal.step("c1", "t1")).toBe("portal/workflows/c/c1/s/t1");
    expect(mapLink("workflows/c/c1/s/t1", WF_PATH)).toBe("workflows/c/c1/s/t1");
    expect(mapLink("workflows/c/c1/s/t1", PORTAL_WF_PATH)).toBe("portal/workflows/c/c1/s/t1");
    expect(mapLink("r/todo/x1", WF_PATH)).toBe("r/todo/x1");
    expect(mapLink("r/todo/x1", PORTAL_WF_PATH)).toBe("portal/t/todo/x1");
  });

  it("a row opens my step's form; a record approval opens the record (the portal's approval page in the portal)", () => {
    expect(rowLink(row(), WF_PATH)).toBe("workflows/c/c1/s/t1");
    const approval = row({ kind: "record_approval", id: "ap1", case_id: null, table: "todo", record_id: "x1", link: "r/todo/x1" });
    expect(rowLink(approval, WF_PATH)).toBe("r/todo/x1");
    expect(rowLink(approval, PORTAL_WF_PATH)).toBe("portal/approvals/ap1");
    expect(rowLink(row(), PORTAL_WF_PATH)).toBe("portal/workflows/c/c1/s/t1");
  });

  it("the click budget: from «کارتابل» the nav row and the row (2 clicks); by process at most 4", () => {
    // nav → «گردش‌کارها» (1) → the row: its link is the step's form (2)
    expect(rowLink(row(), WF_PATH)).toMatch(/^workflows\/c\/[^/]+\/s\/[^/]+$/);
    // nav (1) → the process chip: the diagram (2) → my step: its queue, or with one case its form at once (3) → the case's form (4)
    const chip = wfPaths(WF_PATH).process("p1");
    expect(matchRoutes([{ path: PROCESS_PATH }], `/${chip}`)).not.toBeNull();
    const queue: StepView = { key: "a1", label: "تأیید رئیس شعبه", action: "approve", start: false, people: [], mine: true, queue: [{ task_id: "t1", case_id: "c1", number: null, title: null, since: null, due_at: null }] };
    expect(wfPaths(WF_PATH).step(queue.queue[0].case_id, queue.queue[0].task_id)).toBe("workflows/c/c1/s/t1");
  });

  it("the tab comes from the address, else «کارتابل» when something waits, else «گردش‌کارهای من»", () => {
    expect(tabOf(new URLSearchParams(""), "inbox")).toBe("inbox");
    expect(tabOf(new URLSearchParams(""), "mine")).toBe("mine");
    expect(tabOf(new URLSearchParams("tab=cases"), "inbox")).toBe("cases");
    expect(tabOf(new URLSearchParams("tab=nonsense"), "mine")).toBe("mine");
    expect(waitingText(5)).toBe("۵ مورد منتظر شما");
    expect(waitingText(0)).toBe("");
  });

  it("«پرونده‌ها»' filters live in the address: in progress, finished, started by me, process (its step goes with it), dates, search, page", () => {
    let p = new URLSearchParams("tab=cases");
    p = withCaseFilter(p, "state", "open");
    p = withCaseFilter(p, "mine", true);
    p = withCaseFilter(p, "process", "petty_cash");
    p = withCaseFilter(p, "step", "a1");
    p = withCaseFilter(p, "page", 3);
    expect(caseFiltersOf(p)).toEqual({ state: "open", mine: true, process: "petty_cash", step: "a1", page: 3 });
    // another process forgets the step and goes back to page 1
    p = withCaseFilter(p, "process", "leave");
    expect(caseFiltersOf(p)).toEqual({ state: "open", mine: true, process: "leave" });
    expect(casesQuery(caseFiltersOf(p))).toEqual({ state: "open", mine: "1", process: "leave" });
    expect(filtered(caseFiltersOf(new URLSearchParams("tab=cases")))).toBe(false);
    expect(caseFiltersOf(new URLSearchParams("state=everything"))).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------------------------
// «کارتابل»

describe("the rows of «کارتابل»", () => {
  const now = Date.parse("2026-11-14T10:00:00.000Z");

  it("a row says the number, the title, the process, the step and its action, from whom and the due pill", () => {
    const v = inboxRowView(row({ due_at: "2026-11-14T15:00:00.000Z" }), display, WF_PATH, now);
    expect(v).toMatchObject({ number: "PRC0000123", source: "درخواست تنخواه شعبه", action: "تأیید", step: "تأیید رئیس شعبه", from: "سمیرا رضایی", kind: null, notes: [] });
    expect(v.due).toEqual({ text: "۵ ساعت مانده", tone: "neutral", late: false });
    expect(inboxRowView(row({ kind: "record_approval", step: "سطح ۱", source: "رخداد" }), display, WF_PATH, now).kind).toBe("تأیید رکورد");
  });

  it("delegated, taken, queued and paused rows say so in words", () => {
    expect(stepNotes(row({ on_behalf_of: "u-head" }), display)).toEqual(["به جانشینی از حسین رئیس شعبه"]);
    expect(stepNotes(row({ claimed_by: "u-ali" }), display)).toEqual(["در دست علی احمدی"]);
    expect(stepNotes({ claimed_by: "u-ali" }, display, "u-ali")).toEqual([]);
    expect(stepNotes(row({ queued: true, paused: true }), display)).toEqual(["در صف ارسال", "پرونده موقتاً متوقف است"]);
  });

  it("the due pill: hours or days left, a warning within four hours, overdue in danger", () => {
    expect(dueView(null)).toBeNull();
    expect(dueView("2026-11-14T12:00:00.000Z", now)).toEqual({ text: "۲ ساعت مانده", tone: "warning", late: false });
    expect(dueView("2026-11-17T10:00:00.000Z", now)?.text).toBe("۳ روز مانده");
    expect(dueView("2026-11-14T08:00:00.000Z", now)).toEqual({ text: "۲ ساعت از مهلت گذشته", tone: "danger", late: true });
    expect(dueView("2026-11-14T10:20:00.000Z", now)?.text).toBe("۲۰ دقیقه مانده");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// diagrams and the case

describe("diagrams and the case", () => {
  it("a process's diagram marks my steps with a word — «نوبت شما» where cases wait, «مرحلهٔ آیندهٔ شما» otherwise — and names the others' people", () => {
    const steps: StepView[] = [
      { key: "s", label: "ثبت درخواست", action: "fill", start: true, people: ["درخواست‌دهنده"], mine: true, queue: [] },
      { key: "a1", label: "تأیید رئیس شعبه", action: "approve", start: false, people: ["نقش سازمانی: رئیس شعبه"], mine: true, queue: [{ task_id: "t1", case_id: "c1", number: null, title: null, since: null, due_at: null }] },
      { key: "pay", label: "بررسی و پرداخت", action: "fill", start: false, people: ["گروه: امور مالی"], mine: false, queue: [] },
    ];
    const m = processMarks(steps);
    expect(m.statuses).toEqual({ s: { status: "mine_expected" }, a1: { status: "mine_open" } });
    expect(m.notes).toEqual({ pay: "گروه: امور مالی" });
    // distinguishable without colour: each mark is an icon and a word
    expect(STEP_STATUS.mine_open).toMatchObject({ label: "نوبت شما", icon: "hand" });
    expect(STEP_STATUS.mine_expected.label).toBe("مرحلهٔ آیندهٔ شما");
  });

  it("the state channel: the form steps in order, those passed by left out, then «پایان»", () => {
    const statuses = { s: { status: "done" as const }, a1: { status: "mine_open" as const }, a2: { status: "skipped" as const }, pay: { status: "future" as const } };
    expect(stateChannel(petty, statuses, false).map((x) => `${x.label}:${x.state}`)).toEqual(["ثبت درخواست:done", "تأیید رئیس شعبه:mine", "بررسی و پرداخت:future", "پایان:future"]);
    expect(stateChannel(petty, statuses, true).at(-1)).toMatchObject({ label: "پایان", state: "done" });
  });

  it("the path a case took: from a passed step only by the way its decision leads", () => {
    const statuses = {
      t: { status: "done" as const }, s: { status: "mine_done" as const, outcome: "submitted" as const }, a1: { status: "done" as const, outcome: "approved" as const },
      b: { status: "done" as const }, pay: { status: "active" as const }, a2: { status: "skipped" as const }, no: { status: "skipped" as const }, ok: { status: "future" as const },
    };
    expect([...takenFromStatuses(petty, statuses)].sort()).toEqual(["a1.approved.b", "b.no.pay", "s.out.a1", "t.out.s"]);
  });

  it("a case's state in words (a paused case says so); its open steps with their people; my part; the header's step", () => {
    expect(caseStateView("active")).toEqual({ label: "در جریان", kind: "progress" });
    expect(caseStateView("attention")).toEqual({ label: "نیاز به بررسی", kind: "hold" });
    expect(caseStateView("active", "2026-11-14T08:00:00.000Z")).toEqual({ label: "متوقف‌شده", kind: "hold" });
    expect(caseStateView("rejected").label).toBe("ردشده");
    const detail = {
      case: { requested_by: "u-samira", requested_for: null, current_steps: [{ key: "a1", label: "تأیید رئیس شعبه" }] },
      history: {
        tasks: [
          { id: "1", step_key: "s", step_label: "ثبت درخواست", action: "fill", status: "done", assigned_to: "u-samira", acted_by: "u-samira", acted_for: null, delegated_from: null },
          { id: "2", step_key: "a1", step_label: "تأیید رئیس شعبه", action: "approve", status: "open", assigned_to: "u-head", acted_by: null, acted_for: null, delegated_from: null },
          { id: "3", step_key: "a1", step_label: "تأیید رئیس شعبه", action: "approve", status: "open", assigned_to: "u-ali", acted_by: null, acted_for: null, delegated_from: null },
        ],
      },
      my_steps: [],
    } as unknown as CaseDetail;
    expect(openSteps(detail)).toEqual([{ key: "a1", label: "تأیید رئیس شعبه", people: ["u-head", "u-ali"] }]);
    expect(myPart(detail, "u-samira")).toEqual(["درخواست‌دهنده", "انجام‌دهنده در «ثبت درخواست»"]);
    expect(myPart(detail, "u-ali")).toEqual(["تأییدکننده در «تأیید رئیس شعبه»"]);
    expect(headerStep([step({ id: "q", queued: true }), step({ id: "x" })])?.id).toBe("x");
    expect(headerStep([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// the step form

describe("the step form", () => {
  it("each step kind offers §5's decisions; «رد» and «بازگشت» ask for a reason; «ارسال» names the next step", () => {
    const words = (s: MyStep) => stepActions(s).map((a) => `${a.label}${a.needsComment ? "*" : ""}${a.primary ? "!" : ""}`);
    expect(words(step())).toEqual(["تأیید!", "رد*", "بازگشت برای اصلاح*"]);
    expect(words(step({ action: "review", outcomes: ["submitted", "returned"] }))).toEqual(["ادامهٔ گردش‌کار!", "بازگشت برای اصلاح*"]);
    expect(words(step({ action: "fill", outcomes: ["submitted"], next: { submitted: "تأیید رئیس شعبه" } }))).toEqual(["ارسال برای «تأیید رئیس شعبه»!"]);
    // a step without a way back offers no «بازگشت»
    expect(words(step({ outcomes: ["approved", "rejected"] }))).toEqual(["تأیید!", "رد*"]);
    expect([sendLabel(null), sendLabel("پایان"), sendLabel("بررسی مالی")]).toEqual(["ارسال", "ارسال و پایان", "ارسال برای «بررسی مالی»"]);
    expect(stepActions(step()).find((a) => a.outcome === "rejected")?.danger).toBe(true);
  });

  it("the confirmation names the consequence: whom a «بازگشت» reaches, where a «رد» leads", () => {
    const s = step({ return_targets: [{ key: "s", label: "ثبت درخواست", default: true, to: "u-samira" }, { key: "a1", label: "تأیید رئیس شعبه", default: false, to: null }] });
    expect(defaultReturn(s)).toBe("s");
    expect(consequence(s, "returned", "s", display)).toBe("پرونده برای «ثبت درخواست» به سمیرا رضایی بازمی‌گردد");
    expect(consequence(s, "returned", "a1", display)).toBe("پرونده برای اصلاح به «تأیید رئیس شعبه» بازمی‌گردد");
    expect(consequence(s, "rejected", null, display)).toBe("با «رد»، پرونده رد می‌شود و پایان می‌یابد");
  });

  it("what the person is told after a decision (§8.6's strings): sent, queued offline, returned, late", () => {
    const s = step({ action: "fill", outcomes: ["submitted"], next: { submitted: "بررسی مالی" } });
    expect(resultMessage({ result: "applied", note: null }, "submitted", s, null, display)).toEqual({ tone: "ok", text: "مرحله ثبت شد؛ پرونده به «بررسی مالی» رفت." });
    expect(resultMessage({ result: "pending", note: null }, "submitted", s, null, display)).toEqual({ tone: "info", text: "در صف ارسال؛ با برقراری اتصال فرستاده می‌شود." });
    expect(resultMessage({ result: "applied", note: null }, "returned", step(), "s", display).text).toBe("پرونده برای اصلاح به سمیرا رضایی بازگشت.");
    expect(resultMessage({ result: "late", note: null }, "approved", step(), null, display)).toEqual({
      tone: "warning", text: "این مرحله را همکارتان پیش‌تر انجام داده بود؛ آنچه نوشتید نگه داشته شد ولی در پرونده ثبت نشد.",
    });
    expect(resultMessage({ result: "applied", note: null }, "submitted", step({ next: { submitted: "پایان" } }), null, display).text).toBe("مرحله ثبت شد؛ پرونده به پایان رسید.");
    expect(startMessage({ result: "applied", note: null }, "تأیید رئیس شعبه").text).toBe("پرونده ثبت شد؛ پرونده به «تأیید رئیس شعبه» رفت.");
    expect(startMessage({ result: "pending", note: null }, null).tone).toBe("info");
  });

  const fields: Record<string, FieldDef> = {
    u_amount: { name: "u_amount", label: "مبلغ درخواستی", type: "money" } as FieldDef,
    u_need: { name: "u_need", label: "شرح نیاز", type: "text" } as FieldDef,
    u_invoice: { name: "u_invoice", label: "فاکتور پیش", type: "json", check: "attachments", max: 3 } as unknown as FieldDef,
    u_note: { name: "u_note", label: "نظر مالی", type: "text" } as FieldDef,
  };
  const layout: FormLayoutV2 = {
    tabs: [{ label: "فرم", sections: [{ label: null, items: [{ field: "u_amount" }, { field: "u_need" }, { field: "u_invoice" }, { field: "u_note", showIf: { f: "u_amount", op: "gt", v: 100 } }] }] }],
  };
  const rights: Record<string, Right> = { u_amount: "required", u_need: "read", u_invoice: "edit", u_note: "edit" };

  it("a submission sends only what I may enter now; new files go as { upload: n }, earlier ones by id; a draft never keeps the unsent files", () => {
    const a = new File(["x"], "invoice-a.pdf");
    const b = new File(["y"], "invoice-b.pdf");
    const local = new Map([["local-1", a], ["local-2", b]]);
    const values = { u_amount: "120000000", u_need: "changed by hand", u_invoice: ["0b9c0000-0000-4000-8000-000000000001", "local-1", "local-2"], u_note: "ok" };
    const packed = packValues(values, rights, fields, local);
    expect(packed.values).toEqual({ u_amount: "120000000", u_invoice: ["0b9c0000-0000-4000-8000-000000000001", { upload: 0 }, { upload: 1 }], u_note: "ok" });
    expect(packed.files.map((f) => f.name)).toEqual(["invoice-a.pdf", "invoice-b.pdf"]);
    // a field «نمایش وقتی…» hides is not sent
    const hidden = packValues({ ...values, u_amount: "50" }, { ...rights, u_note: "hidden" }, fields, local);
    expect(hidden.values).not.toHaveProperty("u_note");
    expect(draftValues(values, rights, fields)).toEqual({ u_amount: "120000000", u_invoice: ["0b9c0000-0000-4000-8000-000000000001"], u_note: "ok" });
  });

  it("the form starts from my refused values, else my draft, over the case's values I may read", () => {
    const data = { u_amount: "100", u_need: "از پرونده", u_secret: "x" };
    const r = { u_amount: "edit", u_need: "read" } as Record<string, Right>;
    expect(initialValues(step({ rights: r }), data)).toEqual({ u_amount: "100", u_need: "از پرونده" });
    expect(initialValues(step({ rights: r, draft: { u_amount: "200", u_need: "draft cannot set a read field" } }), data)).toEqual({ u_amount: "200", u_need: "از پرونده" });
    expect(initialValues(step({ rights: r, draft: { u_amount: "200" }, refused: { id: "s1", note: "مبلغ بیش از سقف است", submitted_at: null, values: { u_amount: "300" } } }), data).u_amount).toBe("300");
  });

  it("the required fields shown and left empty are named before sending; the server's field messages are read back", () => {
    expect(missingRequired(layout, rights, {}, fields)).toEqual({ u_amount: "«مبلغ درخواستی» را پر کنید" });
    expect(missingRequired(layout, rights, { u_amount: "10" }, fields)).toEqual({});
    expect(fieldProblems({ fields: { u_amount: "مبلغ بیش از سقف است", x: 3 } })).toEqual({ u_amount: "مبلغ بیش از سقف است" });
    expect(fieldProblems(null)).toEqual({});
  });

  it("a start form begins with the simple defaults («من», today) and my draft; a new case's id is a uuid", () => {
    const f: Record<string, FieldDef> = { a: { name: "a", label: "a", type: "user", default: "$me" } as FieldDef, b: { name: "b", label: "b", type: "date", default: "$today" } as FieldDef, c: { name: "c", label: "c", type: "unit", default: "$my_unit" } as unknown as FieldDef };
    const v = startValues(f, { a: "edit", b: "edit", c: "edit" }, "u1", "Asia/Tehran", { c: "unit-1" });
    expect(v.a).toBe("u1");
    expect(String(v.b)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.c).toBe("unit-1");
    expect(newCaseId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// on a real organisation

describe("«گردش‌کارها» on a real organisation (§3.7)", () => {
  let b: Bank;
  let P = "";
  let caseId = "";
  const as = (who: keyof Bank["M"]) => orgApiOf(b.M[who].client, P);

  beforeAll(async () => {
    b = await bank();
    P = b.w.P;
    await seedNotices(b.w.o.cfg, b.w.o.org);
    const own = b.w.o.owner;
    const made = await own.post(`${P}/process/defs`, { name: "درخواست تنخواهِ شعبه", key: "petty_cash", category: "مالی" }, 201);
    await own.put(`${P}/process/defs/${made.process.id}/draft`, { draft: pettyDraft(b, { managers: [b.M.mgr.userId] }) });
    await own.post(`${P}/process/defs/${made.process.id}/publish`, { note: "نسخهٔ نخست" });
    // a pool step of two signed-in people (a review by the head or the deputy)
    const pool = await own.post(`${P}/process/defs`, { name: "بازدید شعبه", key: "branch_visit" }, 201);
    await own.put(`${P}/process/defs/${pool.process.id}/draft`, {
      draft: {
        graph: {
          nodes: [
            node("t", "trigger"),
            node("s", "form_step", { action: "fill", start: true, form: b.w.forms.req, rights: { default: "edit", fields: {} } }, "ثبت درخواست"),
            node("r", "form_step", { action: "review", form: b.w.forms.review, rights: { default: "read", fields: { u_finance_note: "edit" } }, assignees: [{ kind: "users", users: [b.M.head.userId, b.M.deputy.userId] }] }, "بررسی بازدید"),
            node("ok", "end", { outcome: "completed" }, "پایان"),
          ],
          edges: [edge("t", "s"), edge("s", "r"), edge("r", "ok"), edge("r", "s", "returned")],
        },
        starters: [], title_template: null, requester_view: [], managers: [], manager_groups: [], confidential: false,
      },
    });
    await own.post(`${P}/process/defs/${pool.process.id}/publish`, {});
  }, 900_000);

  it("a clerk sees what she may start, the diagram with her start step, and the start form naming the next step", async () => {
    const mine = await userApi.mine(as("clerk"));
    const petty = mine.processes.find((p) => p.key === "petty_cash");
    expect(petty).toMatchObject({ can_start: true, link: "workflows/p/petty_cash" });
    expect(petty?.parts).toContain("آغازکننده");
    const view = await userApi.view(as("clerk"), "petty_cash");
    expect(view.start).toMatchObject({ can_start: true, label: "ثبت درخواست", next: "تأیید رئیس شعبه" });
    expect(sendLabel(view.start.next)).toBe("ارسال برای «تأیید رئیس شعبه»");
    expect(processMarks(view.steps).statuses.s).toEqual({ status: "mine_expected" });
    expect(Object.keys(view.start.rights)).toContain("u_amount");
    expect(view.start.fields.u_amount?.type).toBe("money");
  });

  it("she keeps a draft of the start, it comes back in the form, and the start opens the case she chose the id of", async () => {
    const view = await userApi.view(as("clerk"), "petty_cash");
    await userApi.saveDraft(as("clerk"), { process_id: view.process.id }, { u_need: "پیش‌نویس" });
    await userApi.saveDraft(as("clerk"), { process_id: view.process.id }, { u_need: "پیش‌نویس دوم" });
    const again = await userApi.view(as("clerk"), "petty_cash");
    expect(again.start.draft).toEqual({ u_need: "پیش‌نویس دوم" });
    expect(startValues(again.start.fields, again.start.rights, b.M.clerk.userId, "Asia/Tehran", again.start.draft).u_need).toBe("پیش‌نویس دوم");
    const id = newCaseId();
    const r = await userApi.start(as("clerk"), b.w.o.org, { process: "petty_cash", values: { u_amount: "750000000", u_need: "دستگاه شمارش اسکناس", u_branch: b.U.vanak }, case_id: id });
    expect(r).toMatchObject({ result: "applied", case: id });
    expect(startMessage(r, again.start.next).text).toBe("پرونده ثبت شد؛ پرونده به «تأیید رئیس شعبه» رفت.");
    await userApi.dropDraft(as("clerk"), { process_id: view.process.id });
    expect((await userApi.view(as("clerk"), "petty_cash")).start.draft).toBeNull();
    caseId = id;
    await b.w.k.drain();
  });

  it("the head's «کارتابل» row opens the step's form; the case marks his step and offers approve, reject and return", async () => {
    const box = await userApi.inbox(as("head"));
    const r = box.rows.find((x) => x.case_id === caseId)!;
    expect(rowLink(r, WF_PATH)).toBe(`workflows/c/${caseId}/s/${r.id}`);
    expect(inboxRowView(r, box.display, WF_PATH).from).toBe("سارا کارمند باجه");
    expect(box.chips.find((c) => c.name === "درخواست تنخواهِ شعبه")?.count).toBe(1);
    expect(await userApi.count(as("head"))).toBeGreaterThanOrEqual(1);
    const detail = await userApi.kase(as("head"), caseId);
    expect(detail.statuses.a1).toMatchObject({ status: "mine_open" });
    expect(stateChannel(detail.graph, detail.statuses, false).map((x) => x.state).slice(0, 2)).toEqual(["done", "mine"]);
    const mine = detail.my_steps[0];
    expect(mine).toMatchObject({ id: r.id, label: "تأیید رئیس شعبه", action: "approve" });
    expect(stepActions(mine).map((a) => a.label)).toEqual(["تأیید", "رد", "بازگشت برای اصلاح"]);
    expect(consequence(mine, "returned", defaultReturn(mine), detail.display)).toBe("پرونده برای «ثبت درخواست» به سارا کارمند باجه بازمی‌گردد");
    expect(myPart(detail, b.M.head.userId)).toEqual(["تأییدکننده در «تأیید رئیس شعبه»"]);
    expect(headerStep(detail.my_steps)?.id).toBe(r.id);
  });

  it("a «بازگشت» needs its reason, reaches the requester as a second round, and her draft and values come back in the form", async () => {
    const detail = await userApi.kase(as("head"), caseId);
    const mine = detail.my_steps[0];
    const refused = await b.M.head.client.post(`${P}/process/tasks/${mine.id}/submit`, { outcome: "returned" }, 400);
    expect(refused.error.message).toBeTruthy();
    const r = await userApi.submit(as("head"), b.w.o.org, mine.id, { outcome: "returned", comment: "شرح نیاز را کامل کنید", return_to: defaultReturn(mine) });
    expect(resultMessage(r, "returned", mine, defaultReturn(mine), detail.display).text).toBe("پرونده برای اصلاح به سارا کارمند باجه بازگشت.");
    await b.w.k.drain();
    const box = await userApi.inbox(as("clerk"));
    const back = box.rows.find((x) => x.case_id === caseId)!;
    expect(back).toMatchObject({ step: "ثبت درخواست", action: "fill" });
    await userApi.saveDraft(as("clerk"), { task_id: back.id }, { u_need: "دستگاه شمارش اسکناس برای باجه" });
    const hers = await userApi.kase(as("clerk"), caseId);
    const s2 = hers.my_steps[0];
    expect(s2).toMatchObject({ round: 2, draft: { u_need: "دستگاه شمارش اسکناس برای باجه" } });
    const start = initialValues(s2, hers.data);
    expect(start.u_need).toBe("دستگاه شمارش اسکناس برای باجه");
    expect(String(start.u_amount)).toBe("750000000");
    const packed = packValues(start, s2.rights, hers.forms?.fields ?? {}, new Map());
    expect(packed.files).toEqual([]);
    const sent = await userApi.submit(as("clerk"), b.w.o.org, s2.id, { outcome: "submitted", values: packed.values });
    expect(resultMessage(sent, "submitted", s2, null, hers.display).text).toBe("مرحله ثبت شد؛ پرونده به «تأیید رئیس شعبه» رفت.");
    await userApi.dropDraft(as("clerk"), { task_id: s2.id });
    await b.w.k.drain();
    const history = await userApi.kase(as("clerk"), caseId);
    expect(history.history.tasks.find((t) => t.outcome === "returned")?.comment).toBe("شرح نیاز را کامل کنید");
    expect(myPart(history, b.M.clerk.userId)[0]).toBe("درخواست‌دهنده");
  });

  it("the head approves; the case moves on and «انجام‌شده‌ها» lists it; the printable view has the decisions in words", async () => {
    const detail = await userApi.kase(as("head"), caseId);
    const mine = detail.my_steps[0];
    const r = await userApi.submit(as("head"), b.w.o.org, mine.id, { outcome: "approved", comment: "تأیید" });
    expect(resultMessage(r, "approved", mine, null, detail.display).tone).toBe("ok");
    await b.w.k.drain();
    const done = await userApi.done(as("head"));
    expect(done.rows.filter((x) => x.case_id === caseId).map((x) => x.outcome).sort()).toEqual(["approved", "returned"]);
    const print = await userApi.print(as("clerk"), caseId);
    expect(print.decisions.map((d) => d.outcome)).toEqual(expect.arrayContaining(["تأیید شد", "بازگشت برای اصلاح"]));
    expect(print.values.find((v) => v.field === "u_need")?.text).toBe("دستگاه شمارش اسکناس برای باجه");
    const cases = await userApi.cases(as("clerk"), { mine: true, state: "open" });
    expect(cases.rows.map((x) => x.id)).toContain(caseId);
  });

  it("a pool step taken by one is «در دست …» for the other, whose decision online is refused; after the taker decides, the other's is late and kept", async () => {
    const r = await userApi.start(as("clerk"), b.w.o.org, { process: "branch_visit", values: { u_amount: "1000", u_branch: b.U.vanak }, case_id: newCaseId() });
    await b.w.k.drain();
    const id = r.case!;
    const head = (await userApi.kase(as("head"), id)).my_steps[0];
    await userApi.claim(as("head"), head.id);
    const other = await userApi.kase(as("deputy"), id);
    const dep = other.my_steps[0];
    expect(stepNotes(dep, other.display, b.M.deputy.userId)).toEqual(["در دست حسین رئیس شعبه"]);
    const refused = await b.M.deputy.client.post(`${P}/process/tasks/${dep.id}/submit`, { outcome: "submitted" }, 409);
    expect(refused.error.message).toBe("این مرحله در دست حسین رئیس شعبه است");
    await userApi.release(as("head"), head.id);
    await userApi.submit(as("head"), b.w.o.org, head.id, { outcome: "submitted", values: { u_finance_note: "بازدید انجام شد" } });
    const late = await userApi.submit(as("deputy"), b.w.o.org, dep.id, { outcome: "submitted", values: { u_finance_note: "نظر من" } });
    expect(late.result).toBe("late");
    expect(resultMessage(late, "submitted", dep, null, other.display)).toMatchObject({ tone: "warning" });
  });

  it("a delegate sees «به جانشینی از …» and acts for the head", async () => {
    const now = Date.now();
    await create(b.w.sys, "delegation", { from_user: b.M.head.userId, to_user: b.M.dlg.userId, starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + 3_600_000).toISOString(), scopes: ["approvals"] }, { trusted: true });
    const r = await userApi.start(as("clerk"), b.w.o.org, { process: "petty_cash", values: { u_amount: "2000000", u_branch: b.U.vanak }, case_id: newCaseId() });
    await b.w.k.drain();
    const box = await userApi.inbox(as("dlg"));
    const row1 = box.rows.find((x) => x.case_id === r.case)!;
    expect(inboxRowView(row1, box.display, WF_PATH).notes).toEqual(["به جانشینی از حسین رئیس شعبه"]);
    const detail = await userApi.kase(as("dlg"), r.case!);
    expect(stepNotes(detail.my_steps[0], detail.display)).toEqual(["به جانشینی از حسین رئیس شعبه"]);
  });

  it("someone who reads no case gets an empty «پرونده‌ها», and the conversation takes a comment from a reader", async () => {
    const page = await userApi.cases(as("designer"), {});
    expect(page.rows).toEqual([]);
    await userApi.say(as("clerk"), caseId, "سلام؛ فاکتور را فرستادم");
    const talk = await userApi.talk(as("clerk"), caseId);
    expect(talk.entries.map((e) => e.body)).toContain("سلام؛ فاکتور را فرستادم");
  });
});

// The person's «گردش‌کارها» (design F §5, §8.6, package F7; src/ui/modules/workflows/user): the routes and the nav row
// with its count, the record link of a case, the four tabs and their filters in the address, the rows of «کارتابل» and
// their notes, the click budget, the due pill, a process's marks, the state channel and the path a case took, a case
// dialog that keeps what the manager entered while the case refreshes live, the
// decisions each step kind offers and the reasons they ask for, the consequences and the messages after a decision,
// what a submission sends (files as `{ upload: n }`; a start or a step sends only the fields «نمایش وقتی…» shows, their
// files included), where a form starts, the required fields left empty; a read that fails («گردش‌کارهای من» and the
// start menu, «گفت‌وگو») is said so, never shown as an empty list — and on a
// real organisation, through the pages' own API module: the §3.7 bank process started by a clerk, the head's
// «کارتابل» and case, a return to the requester with its consequence, a draft kept and refilled, the requester's
// second round, the approval; a pool step taken by one («در دست …»), the other's late decision kept with its message;
// a requester's «لغو پرونده» that arrives after the case ended («late», never «پرونده لغو شد.»);
// a delegate's «به جانشینی از …» and, for the head who delegated it, «سپرده به …»; the printable view; a reader of no
// case gets an empty «پرونده‌ها» — and the review's
// cases: a case's files open by name from «داده‌ها», «آنچه پیش‌تر ثبت شده» and the step form; «امروز» in «پرونده‌ها»
// finds today's cases; a start sent again after its answer was lost opens one case; the portal's «کارهای من» counts and
// lists the steps waiting for the person.
import { describe, it, expect, beforeAll } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, matchRoutes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { create } from "@server/engine";
import { seedNotices } from "@server/modules/process/api";
import { startCase } from "@server/modules/process/engine";
import type { ProcessGraph } from "@shared/process";
import type { FieldDef } from "@shared/model/types";
import type { FormLayoutV2, Right } from "@shared/forms/layout";
import type { FormsSnapshot } from "@shared/forms/snapshot";
import { DEFAULT_TIMEZONE } from "@shared/constants";
import { localDate } from "@shared/model/jalali-buckets";
import { STEP_STATUS } from "../src/ui/modules/workflows/kit/model";
import { fileIds } from "../src/ui/modules/workflows/kit/files";
import { ROUTES, NAV } from "../src/ui/modules/registry";
import { userPart } from "../src/ui/modules/workflows/user/routes";
import { USER_KEYS, userApi, casesQuery, dayEnd, type CaseDetail, type Inbox, type InboxRow, type MyStep, type StepView } from "../src/ui/modules/workflows/user/api";
import {
  CASE_PATH, PORTAL_WF_PATH, PRINT_PATH, PROCESS_PATH, RECORD_CASE_PATH, START_PATH, STEP_PATH, WF_PATH, cancelMessage, caseFiltersOf, caseIdHolder, caseStateView, consequence,
  defaultReturn, delegationNote,
  draftValues, dueView, fieldProblems, filtered, headerStep, inboxRowView, initialValues, managerForm, mapLink, missingRequired, myPart, newCaseId, openSteps, packShown, packValues,
  processMarks,
  resultMessage, rowLink, sendLabel, startMessage, startValues, stateChannel, stepActions, stepNotes, tabOf, takenFromStatuses, waitingSteps, waitingText, wfPaths,
  withCaseFilter,
} from "../src/ui/modules/workflows/user/model";
import { CaseValues, ProcessForm } from "../src/ui/modules/workflows/user/parts";
import PortalSteps from "../src/ui/modules/workflows/user/PortalSteps";
import WorkflowsPage from "../src/ui/modules/workflows/user/WorkflowsPage";
import { Talk } from "../src/ui/modules/workflows/user/CasePage";
import { useWaitingSteps } from "../src/ui/modules/workflows/user/waiting";
import { OrgProvider, type OrgInfo } from "../src/ui/lib/org";
import { ApiError, type OrgApi } from "../src/ui/lib/api";
import type { Schema } from "../src/ui/records/model/schema";
import type { Client } from "./helpers";
import { PNG } from "./engine-helpers";
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

/** A part of the pages rendered statically in their providers: the organisation, react-query (seeded) and a router. */
const orgInfo = (id: string): OrgInfo => ({
  org: { id, name: "بانک آفتاب", legal_name: null, modules: [], phone: null, email: null, website: null, city: null, address: null, logo: null, settings: {} },
  member: { role: "member", title: "", permissions: {} as OrgInfo["member"]["permissions"] },
  counts: { members: 1 },
});
function render(org: string, el: ReactElement, seed: (qc: QueryClient) => void = () => undefined): string {
  const qc = new QueryClient();
  seed(qc);
  return renderIn(qc, org, el);
}
function renderIn(qc: QueryClient, org: string, el: ReactElement): string {
  const routed = createElement(MemoryRouter, null, el);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(OrgProvider, { orgId: org, info: orgInfo(org), children: routed })));
}
/**
 * A query client whose reads have failed as the app's would after its retry: the read's error kept, not fetched again
 * while the page renders.
 */
async function failedReads(keys: readonly (readonly unknown[])[], error: unknown): Promise<QueryClient> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  for (const queryKey of keys) await qc.prefetchQuery({ queryKey, queryFn: () => Promise.reject(error) });
  return qc;
}
/** A link that opens `text` at `href`. */
const linkTo = (href: string, text: string) => new RegExp(`<a [^>]*href="${href.replace(/[.?]/g, "\\$&")}"[^>]*>${text.replace(/[.]/g, "\\.")}</a>`);

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

  it("the date range covers its last day whole: `to` goes as that day's last instant in the organisation's zone", () => {
    // «امروز» on 1405/08/22: from = to = 2026-11-13; Tehran's day ends at 20:30 UTC
    expect(casesQuery({ from: "2026-11-13", to: "2026-11-13" }, "Asia/Tehran")).toEqual({ from: "2026-11-13", to: "2026-11-13T20:29:59.999Z" });
    expect(dayEnd("2026-11-13", "UTC")).toBe("2026-11-13T23:59:59.999Z");
    // the address keeps the bare date; an instant goes as it is
    expect(caseFiltersOf(withCaseFilter(new URLSearchParams(), "to", "2026-11-13")).to).toBe("2026-11-13");
    expect(casesQuery({ to: "2026-11-13T10:00:00.000Z" }, "Asia/Tehran").to).toBe("2026-11-13T10:00:00.000Z");
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

  it("the portal's «کارهای من» adds my open steps, not my record approvals (it lists those itself)", () => {
    const approval = row({ kind: "record_approval", id: "ap1", case_id: null, table: "todo", record_id: "x1", link: "r/todo/x1" });
    expect(waitingSteps({ rows: [row(), approval, row({ id: "t2" })] }).map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(waitingSteps(null)).toEqual([]);
  });

  it("delegated, taken, queued and paused rows say so in words", () => {
    expect(stepNotes(row({ on_behalf_of: "u-head" }), display)).toEqual(["به جانشینی از حسین رئیس شعبه"]);
    expect(stepNotes(row({ claimed_by: "u-ali" }), display)).toEqual(["در دست علی احمدی"]);
    expect(stepNotes({ claimed_by: "u-ali" }, display, "u-ali")).toEqual([]);
    expect(stepNotes(row({ queued: true, paused: true }), display)).toEqual(["در صف ارسال", "پرونده موقتاً متوقف است"]);
  });

  it("the step form's delegation line: the delegate acts «به جانشینی از …»; the head who delegated it reads whom it is with, never his own name", () => {
    const tasks = [{ id: "t1", assigned_to: "u-ali" }, { id: "t2", assigned_to: "u-head" }];
    const delegated = step({ id: "t1", delegated_from: "u-head" });
    expect(delegationNote(delegated, tasks, "u-ali", display)).toBe("به جانشینی از حسین رئیس شعبه");
    // the case lists the step among the head's own (he may still do it), with his id as delegated_from
    expect(delegationNote(delegated, tasks, "u-head", display)).toBe("سپرده به علی احمدی");
    expect(delegationNote(step({ id: "t2" }), tasks, "u-head", display)).toBeNull();
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

  it("a case dialog starts afresh when it opens; the case read again while it is open (the live refresh) keeps what the manager entered", () => {
    const detailOf = (open: { id: string; key: string; label: string; to: string }[]) =>
      ({
        case: { current_steps: [...new Map(open.map((t) => [t.key, { key: t.key, label: t.label }])).values()] },
        history: { tasks: open.map((t) => ({ id: t.id, step_key: t.key, step_label: t.label, action: "approve", status: "open", assigned_to: t.to })) },
        restart_targets: [{ key: "s", label: "ثبت درخواست" }],
      }) as unknown as CaseDetail;
    const before = detailOf([{ id: "1", key: "a1", label: "تأیید رئیس شعبه", to: "u-head" }, { id: "2", key: "pay", label: "بررسی و پرداخت", to: "u-ali" }]);
    const opened = managerForm(null, "reassign", before);
    expect(opened).toEqual({ action: "reassign", comment: "", step: "a1", task: null, to: [], node: "s" });
    // «ارجاع مرحله»: the manager picks the second step, two people and writes a note …
    const typed = { ...opened, step: "pay", task: "2", to: ["u-samira", "u-ali"], comment: "به جای همکار در مرخصی" };
    // … while the head approves: the page reads the case again (a new detail, its first step gone) and keeps it all
    const after = detailOf([{ id: "2", key: "pay", label: "بررسی و پرداخت", to: "u-ali" }]);
    expect(managerForm(typed, "reassign", after)).toBe(typed);
    // closed and opened again, or for another action: afresh, from the case as it is now
    const closed = managerForm(typed, null, after);
    expect(closed).toMatchObject({ action: null, comment: "", task: null, to: [] });
    expect(managerForm(closed, "reassign", after)).toEqual({ action: "reassign", comment: "", step: "pay", task: null, to: [], node: "s" });
    expect(managerForm(closed, "pause", after)).toMatchObject({ action: "pause", comment: "" });
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

  it("«لغو پرونده» says «پرونده لغو شد.» only when it was applied; a case that ended first is a warning with the server's note", () => {
    expect(cancelMessage({ result: "applied", note: null })).toEqual({ tone: "ok", text: "پرونده لغو شد." });
    expect(cancelMessage({ result: "pending", note: null })).toEqual({ tone: "info", text: "در صف ارسال؛ با برقراری اتصال فرستاده می‌شود." });
    expect(cancelMessage({ result: "late", note: "این پرونده پیش‌تر بسته شده است" })).toEqual({ tone: "warning", text: "این پرونده پیش‌تر بسته شده است" });
    expect(cancelMessage({ result: "late" })).toEqual({ tone: "warning", text: "این پرونده پیش‌تر بسته شده است." });
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

  it("a start or a step sends what the form shows now: a letter picked for «وام» is neither sent nor uploaded once «تنخواه» hides its field", () => {
    const defs: Record<string, FieldDef> = {
      u_kind: { name: "u_kind", label: "نوع درخواست", type: "choice", choices: [{ value: "loan", label: "وام" }, { value: "petty", label: "تنخواه" }] } as FieldDef,
      u_letter: { name: "u_letter", label: "ضمانت‌نامه", type: "json", check: "attachments", max: 1 } as unknown as FieldDef,
      u_need: { name: "u_need", label: "شرح نیاز", type: "text" } as FieldDef,
    };
    const form: FormLayoutV2 = {
      tabs: [{ label: "فرم", sections: [{ label: null, items: [{ field: "u_kind" }, { field: "u_letter", showIf: { f: "u_kind", op: "eq", v: "loan" } }, { field: "u_need" }] }] }],
    };
    // the start's rights: the requester enters all three (the condition decides what is shown)
    const startRights: Record<string, Right> = { u_kind: "required", u_letter: "edit", u_need: "edit" };
    const letter = new File(["guarantee"], "ضمانت‌نامه.pdf");
    const local = new Map([["local-1", letter]]);
    const loan = packShown(form, startRights, { u_kind: "loan", u_letter: ["local-1"], u_need: "خرید دستگاه" }, defs, local);
    expect(loan.values).toEqual({ u_kind: "loan", u_letter: [{ upload: 0 }], u_need: "خرید دستگاه" });
    expect(loan.files).toEqual([letter]);
    // switched to «تنخواه»: the letter's field is hidden — its value stays in the form, but nothing of it is sent
    const petty = packShown(form, startRights, { u_kind: "petty", u_letter: ["local-1"], u_need: "خرید دستگاه" }, defs, local);
    expect(petty.values).toEqual({ u_kind: "petty", u_need: "خرید دستگاه" });
    expect(petty.files).toEqual([]);
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

  it("a start's case id is kept for every retry until the server has answered; the next start gets a new one", () => {
    let n = 0;
    const ids = caseIdHolder(() => `case-${++n}`);
    // «ارسال», no answer (a timeout, a proxy's 502, the network gone), «ارسال» again: the same case
    expect([ids.take(), ids.take()]).toEqual(["case-1", "case-1"]);
    ids.answered();
    expect(ids.take()).toBe("case-2");
  });

  it("a «پیوست» value names the case's files, each a link that opens it: in an editable field, read-only and in «داده‌ها»", () => {
    const id = "0b9c0000-0000-4000-8000-000000000001";
    const known = [{ id, name: "invoice.pdf", size: 2048 }];
    const href = `/api/o/org-1/attachments/${id}/content`;
    const values = { u_invoice: [id] };
    const only = (r: Right) => ({ u_amount: "hidden", u_need: "hidden", u_invoice: r, u_note: "hidden" }) as Record<string, Right>;
    const form = (r: Right, onChange?: (name: string, v: unknown) => void) =>
      render("org-1", createElement(ProcessForm, { layout, fields, rights: only(r), values, onChange, schema: {} as Schema, tz: "Asia/Tehran", unit: "rial", known, idPrefix: "t", label: "فرم" }));
    for (const html of [form("edit", () => undefined), form("read")]) {
      expect(html).toMatch(linkTo(href, "invoice.pdf"));
      expect(html).not.toContain("پیوستی که دیگر در این رکورد نیست");
    }
    // while the case's files load, an editable field does not call its file gone
    const loading = render("org-1", createElement(ProcessForm, { layout, fields, rights: only("edit"), values, onChange: () => undefined, schema: {} as Schema, tz: "Asia/Tehran", unit: "rial", knownLoading: true, idPrefix: "t" }));
    expect(loading).not.toContain("پیوستی که دیگر در این رکورد نیست");
    const forms = { forms: { f1: { id: "f1", name: "فرم", layout } }, fields } as unknown as FormsSnapshot;
    const data = (files?: { id: string; name: string }[]) => render("org-1", createElement(CaseValues, { forms, data: values, schema: {} as Schema, tz: "Asia/Tehran", unit: "rial", files }));
    expect(data(known)).toMatch(linkTo(href, "invoice.pdf"));
    // before the names are read: how many, as «پیوست» (here «پرونده» is a case)
    expect(data()).toContain("۱ پیوست");
    expect(data()).not.toContain("پرونده");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// a read that fails

describe("a read that fails is said so, never shown as an empty list", () => {
  const ORG = "org-1";
  const down = new ApiError(500, "error", "سامانه پاسخ نداد؛ کمی بعد دوباره تلاش کنید");
  const inbox = (over: Partial<Inbox> = {}): Inbox => ({ rows: [], chips: [], counts: { waiting: 0, steps: 0, approvals: 0 }, default_tab: "mine", display: {}, ...over });

  it("«گردش‌کارهای من» whose list failed shows the failure, not «هنوز در گردش‌کاری نقش ندارید»; on «کارتابل» the page says «شروع گردش‌کار» was not read", async () => {
    const mineTab = await failedReads([USER_KEYS.mine(ORG)], down);
    mineTab.setQueryData(USER_KEYS.inbox(ORG), inbox());
    const html = renderIn(mineTab, ORG, createElement(WorkflowsPage));
    expect(html).toContain("گردش‌کارهای شما خوانده نشد");
    expect(html).toContain("سامانه پاسخ نداد؛ کمی بعد دوباره تلاش کنید");
    expect(html).toContain("تلاش دوباره");
    expect(html).not.toContain("هنوز در گردش‌کاری نقش ندارید");
    // something waits: the page opens on «کارتابل», and the missing start menu is explained there
    const inboxTab = await failedReads([USER_KEYS.mine(ORG)], down);
    inboxTab.setQueryData(USER_KEYS.inbox(ORG), inbox({ default_tab: "inbox", counts: { waiting: 1, steps: 1, approvals: 0 }, rows: [row()], display }));
    const onInbox = renderIn(inboxTab, ORG, createElement(WorkflowsPage));
    expect(onInbox).toContain("فهرست گردش‌کارهای شما و «شروع گردش‌کار» خوانده نشد: سامانه پاسخ نداد؛ کمی بعد دوباره تلاش کنید");
    // a list read fine but empty keeps its own words, and no failure is shown
    const fine = new QueryClient();
    fine.setQueryData(USER_KEYS.inbox(ORG), inbox());
    fine.setQueryData(USER_KEYS.mine(ORG), { processes: [] });
    const empty = renderIn(fine, ORG, createElement(WorkflowsPage));
    expect(empty).toContain("هنوز در گردش‌کاری نقش ندارید");
    expect(empty).not.toContain("خوانده نشد");
  });

  it("«گفت‌وگو» whose comments failed to load shows the failure, not «هنوز گفت‌وگویی نیست»", async () => {
    const failed = await failedReads([USER_KEYS.talk(ORG, "c1")], down);
    const html = renderIn(failed, ORG, createElement(Talk, { caseId: "c1" }));
    expect(html).toContain("گفت‌وگو خوانده نشد");
    expect(html).toContain("سامانه پاسخ نداد؛ کمی بعد دوباره تلاش کنید");
    expect(html).not.toContain("هنوز گفت‌وگویی نیست");
    const fine = new QueryClient();
    fine.setQueryData(USER_KEYS.talk(ORG, "c1"), { entries: [], display: {} });
    const none = renderIn(fine, ORG, createElement(Talk, { caseId: "c1" }));
    expect(none).toContain("هنوز گفت‌وگویی نیست");
    expect(none).not.toContain("خوانده نشد");
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

  it("«امروز» in «پرونده‌ها» finds the case started today: the range's last day is whole", async () => {
    const today = localDate(Date.now(), DEFAULT_TIMEZONE);
    const ids = async (f: { from?: string; to?: string }) => (await userApi.cases(as("clerk"), f, DEFAULT_TIMEZONE)).rows.map((r) => r.id);
    // the server reads a bare `to` as that day's first instant: sent as the chip keeps it, today's case is left out
    const bare = await as("clerk").get<{ rows: { id: string }[] }>("/process/cases", { from: today, to: today });
    expect(bare.rows.map((r) => r.id)).not.toContain(caseId);
    expect(await ids({ from: today, to: today })).toContain(caseId);
    expect(await ids({ to: today })).toContain(caseId);
    // a range that ends yesterday leaves it out
    expect(await ids({ to: localDate(Date.now() - 86_400_000, DEFAULT_TIMEZONE) })).not.toContain(caseId);
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
    // in the portal, where she works: «کارهای من» counts the step and lists it, opening its form there
    expect(waitingSteps(box).map((x) => x.id)).toEqual([back.id]);
    const seeded = (qc: QueryClient) => qc.setQueryData<Inbox>(USER_KEYS.inbox(b.w.o.org), box);
    const Badge = () => createElement("output", null, String(useWaitingSteps().count));
    expect(render(b.w.o.org, createElement(Badge), seeded)).toBe("<output>1</output>");
    const listed = render(b.w.o.org, createElement(PortalSteps), seeded);
    expect(listed).toContain("گردش‌کارهای منتظر شما");
    expect(listed).toContain(`href="/${b.w.o.org}/portal/workflows/c/${caseId}/s/${back.id}"`);
    expect(listed).toContain("ثبت درخواست");
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

  it("the invoice attached at the start opens by name for the head who decides on it, from «داده‌ها» and before his form", async () => {
    const id = newCaseId();
    const values = { u_amount: "5000000", u_need: "خرید چاپگر", u_branch: b.U.vanak, u_invoice: [{ upload: 0 }] };
    const started = await startCase(await b.w.o.ctxOf(b.M.clerk.userId), { process: "petty_cash", case_id: id, values, files: [{ name: "پیش‌فاکتور.png", data: PNG }] });
    expect(started.result).toBe("applied");
    await b.w.k.drain();
    const detail = await userApi.kase(as("head"), id);
    expect(detail.my_steps[0]).toMatchObject({ label: "تأیید رئیس شعبه" });
    // the case's files the head may open: the invoice his step shows (F4b's filterSide)
    const files = await userApi.files(as("head"), id);
    expect(files.map((f) => f.name)).toEqual(["پیش‌فاکتور.png"]);
    expect(fileIds(detail.data.u_invoice)).toEqual([files[0].id]);
    const html = render(b.w.o.org, createElement(CaseValues, { forms: detail.forms, data: detail.data, schema: {} as Schema, tz: DEFAULT_TIMEZONE, unit: "rial", files, only: (k: string) => k === "u_invoice" }));
    expect(html).toMatch(linkTo(`/api/o/${b.w.o.org}/attachments/${files[0].id}/content`, "پیش‌فاکتور.png"));
    // the requester reads her own file
    expect((await userApi.files(as("clerk"), id)).map((f) => f.id)).toEqual([files[0].id]);
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

  it("the requester's «لغو پرونده» sent after the last step completed the case comes back «late»: she is not told it was cancelled", async () => {
    const r = await userApi.start(as("clerk"), b.w.o.org, { process: "branch_visit", values: { u_amount: "1000", u_branch: b.U.vanak }, case_id: newCaseId() });
    await b.w.k.drain();
    const id = r.case!;
    // she opens «لغو پرونده» (nothing after the start is done yet) …
    expect((await userApi.kase(as("clerk"), id)).can).toMatchObject({ cancel: true, manage: false });
    // … while the head does the last step and the case ends
    const head = (await userApi.kase(as("head"), id)).my_steps[0];
    await userApi.submit(as("head"), b.w.o.org, head.id, { outcome: "submitted", values: { u_finance_note: "بازدید انجام شد" } });
    await b.w.k.drain();
    const cancel = await userApi.cancel(as("clerk"), id, "دیگر لازم نیست");
    expect(cancel).toMatchObject({ result: "late", by: "requester", note: "این پرونده پیش‌تر بسته شده است" });
    expect(cancelMessage(cancel)).toEqual({ tone: "warning", text: "این پرونده پیش‌تر بسته شده است" });
    expect((await userApi.kase(as("clerk"), id)).case).toMatchObject({ state: "completed", outcome: "completed" });
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
    expect(delegationNote(detail.my_steps[0], detail.history.tasks, b.M.dlg.userId, detail.display)).toBe("به جانشینی از حسین رئیس شعبه");
    // the head opens the case from a notification: the step is listed among his, delegated from him — the form names
    // the delegate it went to, not «به جانشینی از» himself
    const his = await userApi.kase(as("head"), r.case!);
    const own = his.my_steps.find((s) => s.id === detail.my_steps[0].id)!;
    expect(own.delegated_from).toBe(b.M.head.userId);
    expect(delegationNote(own, his.history.tasks, b.M.head.userId, his.display)).toBe("سپرده به داوود جانشین");
  });

  it("someone who reads no case gets an empty «پرونده‌ها», and the conversation takes a comment from a reader", async () => {
    const page = await userApi.cases(as("designer"), {});
    expect(page.rows).toEqual([]);
    await userApi.say(as("clerk"), caseId, "سلام؛ فاکتور را فرستادم");
    const talk = await userApi.talk(as("clerk"), caseId);
    expect(talk.entries.map((e) => e.body)).toContain("سلام؛ فاکتور را فرستادم");
  });

  it("a start applied whose answer was lost, sent again, opens one case: the retry keeps its id and comes back «late» with it", async () => {
    const ids = caseIdHolder();
    const body = { process: "petty_cash", values: { u_amount: "3000000", u_need: "پاسخی که نرسید", u_branch: b.U.vanak } };
    const first = await userApi.start(as("clerk"), b.w.o.org, { ...body, case_id: ids.take() });
    // the page never heard that answer: the second «ارسال» sends the same id
    const again = await userApi.start(as("clerk"), b.w.o.org, { ...body, case_id: ids.take() });
    expect(first.result).toBe("applied");
    expect(again).toMatchObject({ result: "late", case: first.case });
    expect(startMessage(again, null).tone).toBe("warning");
    const made = await b.w.o.db.one<{ n: string }>(`select count(*)::text as n from sm_process_cases where org_id = $1 and data->>'u_need' = $2`, [b.w.o.org, "پاسخی که نرسید"]);
    expect(made?.n).toBe("1");
    // answered: the next start is a new case
    ids.answered();
    expect(ids.take()).not.toBe(first.case);
    await b.w.k.drain();
  });
});

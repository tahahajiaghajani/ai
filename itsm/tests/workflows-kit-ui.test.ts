// The workflows UI kit (design F §8.4, §8.6, package F5k; src/ui/modules/workflows/kit): the process canvas's pure
// logic (dagre layout with «بازگشت» edges out of the ranks, the edges a designer may draw, adding, removing and
// re-pointing, the keyboard's moves, node summaries), a case's diagram (statuses as icon + word, the path taken, the
// phone's numbered list and «مرحلهٔ ۲ از ۴»), the rights matrix, the role-then-people picker's rules and members, the
// files input's checks, the module's parts and its registration, and the static markup of the legend, the step list
// and the rights matrix (labels a screen reader reads); a stored files value by name with links, and rules narrowed
// to a scope (a process's starters) with a rule outside it told apart.
import { describe, it, expect } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanRule, ASSIGNEE_KINDS, type AssigneeRule, type ProcessGraph, type ProcessNode } from "@shared/process";
import { validateProcess } from "@shared/process";
import {
  ARROWS, LEGEND_ORDER, NODE_H, NODE_W, STEP_STATUS, acceptAttr, acceptText, addStep, allRead, assigneesText, connect, connectProblem, connectTargets,
  defaultProcessConfig, defaultScope, defaultStepRights, disconnect, estimateBody, estimateRequest, estimateView, fileIds, fileProblem, filesMax, holderGroups,
  ifNobodyOptions, isCaseScope, isDefaultScope, isPlaced, layoutProcess, listSteps, memberOptions, neighbour, newNodeId, newRule, nodeSummary, outcomeLabel, pickPosition,
  previewLines, previewVerdict, problemsByNode, readingOrder, removeSteps, rightsRows, ruleComplete, ruleFields, ruleInScope, scopeNote, scopedRule, setDefaultRight,
  setFieldRight, sizeText, statusLine, stepCounter, strayRights, takenEdges, validHolder, withMembers, type PositionRule, type RuleScope,
} from "../src/ui/modules/workflows/kit/model";
import { AssigneePicker } from "../src/ui/modules/workflows/kit/AssigneePicker";
import { demoSet, isDemo, DEMO_PEOPLE_KEY } from "../src/ui/modules/workflows/kit/demo";
import type { MemberRow } from "../src/ui/modules/workflows/kit/api";
import { OrgProvider, type OrgInfo } from "../src/ui/lib/org";
import type { StepAssignees } from "@shared/process";
import { SAMPLE_FIELDS, SAMPLE_FORM, SAMPLE_PROGRESS, sampleProcess, sampleStatuses } from "../src/ui/modules/workflows/kit/sample";
import { StepLegend, StepList } from "../src/ui/modules/workflows/kit/StepLegend";
import { RightsMatrix } from "../src/ui/modules/workflows/kit/RightsMatrix";
import { FilesValue } from "../src/ui/modules/workflows/kit/FilesInput";
import { AssigneeRules as AssigneeRulesList } from "../src/ui/modules/workflows/kit/AssigneePicker";
import { assemble, HOME_GROUP, SETTINGS_GROUP } from "../src/ui/modules/workflows/parts";

const at = (g: ProcessGraph, id: string) => g.nodes.find((n) => n.id === id)!.position!;
const N = (id: string, type: ProcessNode["type"], config: Record<string, unknown> = {}): ProcessNode => ({ id, type, config });

describe("the process canvas: layout", () => {
  it("lays the §3.7 process out top to bottom, every node placed and «بازگشت» edges out of the ranks", () => {
    const g = sampleProcess();
    expect(isPlaced(g)).toBe(true);
    expect(g.layout?.direction).toBe("TB");
    // the returns of a1 and a2 go back to «ثبت درخواست» but the start stays above them
    expect(at(g, "t").y).toBeLessThan(at(g, "s").y);
    expect(at(g, "s").y).toBeLessThan(at(g, "a1").y);
    expect(at(g, "a1").y).toBeLessThan(at(g, "b").y);
    expect(at(g, "b").y).toBeLessThan(at(g, "a2").y);
    expect(at(g, "a2").y).toBeLessThan(at(g, "f").y);
    expect(at(g, "f").y).toBeLessThan(at(g, "ok").y);
    // no two cards overlap
    for (const a of g.nodes)
      for (const b of g.nodes) {
        if (a.id >= b.id) continue;
        const overlap = Math.abs(a.position!.x - b.position!.x) < NODE_W && Math.abs(a.position!.y - b.position!.y) < NODE_H;
        expect(overlap, `${a.id} and ${b.id}`).toBe(false);
      }
    expect(isPlaced({ ...g, nodes: [...g.nodes, N("x", "end")] })).toBe(false);
  });

  it("the sample is a valid process (no errors from the shared validator)", () => {
    expect(validateProcess(sampleProcess()).filter((p) => p.level === "error")).toEqual([]);
  });
});

describe("the process canvas: drawing edges", () => {
  const g = sampleProcess();
  it("refuses an edge into «آغاز», to itself, from an unknown port, twice, or from a used single port", () => {
    expect(connectProblem(g, "a1", "approved", "t")).toMatch(/آغاز/);
    expect(connectProblem(g, "f", "out", "f")).toMatch(/خودش/);
    expect(connectProblem(g, "f", "nope", "ok")).toMatch(/وجود ندارد/);
    expect(connectProblem(g, "f", "out", "ok")).toMatch(/هست/);
    expect(connectProblem(g, "a1", "approved", "f")).toMatch(/فقط یک اتصال/);
  });

  it("lets «بازگشت برای اصلاح» go only back to an earlier form step on the same branch", () => {
    const free = disconnect(g, "a2", "returned");
    expect(connectProblem(free, "a2", "returned", "a1")).toBeNull();
    expect(connectProblem(free, "a2", "returned", "s")).toBeNull();
    expect(connectProblem(free, "a2", "returned", "b")).toMatch(/مرحلهٔ فرم/);
    expect(connectProblem(free, "a2", "returned", "f")).toMatch(/پیش از همین مرحله/);
  });

  it("refuses any other edge back (a cycle), pointing to «بازگشت برای اصلاح»", () => {
    const loose = disconnect(g, "f", "out");
    expect(connectProblem(loose, "f", "out", "s")).toMatch(/دور می‌سازد/);
    expect(connectProblem(loose, "f", "out", "no")).toBeNull();
  });

  it("offers the targets a port may go to, judging a used single port as re-pointed", () => {
    const targets = connectTargets(g, "f", "out");
    expect(targets).toContain("no");
    expect(targets).toContain("ok");
    expect(targets).not.toContain("s");
    expect(targets).not.toContain("t");
    expect(connectTargets(g, "a2", "returned").sort()).toEqual(["a1", "s"]);
  });

  it("re-points a single port, adds to a fanning-out one, and removes a port's edges", () => {
    const moved = connect(g, "f", "out", "no");
    expect(moved.edges.filter((e) => e.source === "f").map((e) => e.target)).toEqual(["no"]);
    const par: ProcessGraph = { nodes: [N("t", "trigger"), N("p", "parallel"), N("x", "end"), N("y", "end")], edges: [] };
    const two = connect(connect(par, "p", "out", "x"), "p", "out", "y");
    expect(two.edges.filter((e) => e.source === "p").map((e) => e.target)).toEqual(["x", "y"]);
    expect(disconnect(two, "p", "out").edges).toEqual([]);
  });
});

describe("the process canvas: adding, removing, moving by keyboard", () => {
  it("adds a step below the chosen one, from its first free required port, with a unique id and starting settings", () => {
    const base = disconnect(sampleProcess(), "f", "out");
    const r = addStep(base, "form_step", { after: "f" });
    expect(r.id).toBe(newNodeId(base, "form_step"));
    expect(r.graph.edges.some((e) => e.source === "f" && e.target === r.id)).toBe(true);
    expect(at(r.graph, r.id).y).toBeGreaterThan(at(base, "f").y);
    // 1.1.5: a new «تکمیل فرم» step's fields are for filling (it used to read everything and had nothing to fill, B1)
    expect(defaultProcessConfig("form_step")).toMatchObject({ action: "fill", form: null, rights: { default: "edit", fields: {} }, assignees: [] });
    // a step whose ports are all used is added without an edge
    const full = addStep(sampleProcess(), "end", { after: "f" });
    expect(full.graph.edges.filter((e) => e.target === full.id)).toEqual([]);
  });

  it("removes steps with their edges and never «آغاز»", () => {
    const g = removeSteps(sampleProcess(), ["b", "t"]);
    expect(g.nodes.map((n) => n.id)).not.toContain("b");
    expect(g.nodes.map((n) => n.id)).toContain("t");
    expect(g.edges.some((e) => e.source === "b" || e.target === "b")).toBe(false);
  });

  it("moves the focus to the nearest node in an arrow's direction", () => {
    const nodes = [
      { id: "top", position: { x: 300, y: 0 } },
      { id: "left", position: { x: 0, y: 200 } },
      { id: "right", position: { x: 600, y: 200 } },
      { id: "below", position: { x: 300, y: 420 } },
    ];
    // straight below beats diagonally below
    expect(neighbour(nodes, "top", "down")).toBe("below");
    expect(neighbour(nodes, "left", "right")).toBe("right");
    expect(neighbour(nodes, "right", "left")).toBe("left");
    expect(neighbour(nodes, "left", "up")).toBe("top");
    expect(neighbour(nodes, "top", "up")).toBeNull();
    expect(neighbour(nodes, "below", "up")).toBe("top");
    expect(ARROWS.ArrowDown).toBe("down");
    // the sample: down from «آغاز» is «ثبت درخواست», then the branch head
    const g = sampleProcess();
    expect(neighbour(g.nodes, "t", "down")).toBe("s");
    expect(neighbour(g.nodes, "s", "down")).toBe("a1");
    expect(neighbour(g.nodes, "a1", "up")).toBe("s");
  });

  it("reads the nodes in order: «آغاز» first, every node once", () => {
    const g = sampleProcess();
    const order = readingOrder(g);
    expect(order[0]).toBe("t");
    expect(new Set(order).size).toBe(g.nodes.length);
    expect(order.indexOf("s")).toBeLessThan(order.indexOf("a1"));
  });
});

describe("what a node says", () => {
  const g = sampleProcess();
  const node = (id: string) => g.nodes.find((n) => n.id === id)!;
  it("summarises steps, conditions, waits and ends in Persian", () => {
    expect(nodeSummary(node("s"))).toBe("درخواست‌دهنده فرم را پر می‌کند");
    expect(nodeSummary(node("a1"))).toBe("نقش سازمانی · یک نفر کافی است");
    expect(nodeSummary(node("f"))).toBe("تکمیل فرم · گروه");
    expect(nodeSummary(node("b"))).toContain("۱ مقایسه");
    expect(nodeSummary(node("no"))).toBe("پایان پرونده: ردشده");
    // 1.1.5: business time only when the step says so — the engine counts calendar time when `business` is missing
    expect(nodeSummary(N("w", "wait_duration", { duration: { amount: 2, unit: "day" }, business: true }))).toBe("۲ روز کاری");
    expect(nodeSummary(N("w", "wait_duration", { duration: { amount: 2, unit: "day" } }))).toBe("۲ روز");
    expect(assigneesText([])).toBe("انجام‌دهنده تعیین نشده");
    expect(assigneesText([{ kind: "requester" }, { kind: "manager", of: "requester" }])).toBe("درخواست‌دهنده و ۱ قاعدهٔ دیگر");
  });

  it("counts problems per node, errors before warnings", () => {
    const m = problemsByNode([
      { level: "warning", message: "هشدار", node: "a1" },
      { level: "error", message: "ایراد", node: "a1" },
      { level: "error", message: "بی‌گره" },
    ]);
    expect(m.get("a1")).toEqual({ errors: 1, warnings: 1, first: "ایراد" });
    expect(m.size).toBe(1);
  });
});

describe("a case's diagram", () => {
  const g = sampleProcess();
  const st = sampleStatuses(g);
  it("gives every status its own icon and word (never colour alone)", () => {
    const icons = LEGEND_ORDER.map((s) => STEP_STATUS[s].icon);
    const words = LEGEND_ORDER.map((s) => STEP_STATUS[s].label);
    expect(new Set(icons).size).toBe(LEGEND_ORDER.length);
    expect(new Set(words).size).toBe(LEGEND_ORDER.length);
    expect(STEP_STATUS.mine_open.label).toBe("نوبت شما");
  });

  it("marks the branch head's open step «نوبت شما», what came before done and what lies ahead next", () => {
    expect(st.a1.status).toBe("mine_open");
    expect(statusLine(st.a1)).toBe("نوبت شما · ۱ نفر");
    expect(st.s.status).toBe("done");
    expect(statusLine(st.s, "form_step")).toBe("انجام‌شده · ثبت شد");
    for (const id of ["b", "a2", "f", "ok", "no"]) expect(st[id].status).toBe("future");
    expect(outcomeLabel("rejected", "end")).toBe("ردشده");
    expect(outcomeLabel("approved")).toBe("تأیید شد");
  });

  it("draws the path taken: from every node passed, by the port it left", () => {
    const taken = takenEdges(g, SAMPLE_PROGRESS);
    expect([...taken].sort()).toEqual(["s.out.a1", "t.out.s"]);
    const later = { ...SAMPLE_PROGRESS, a1: { status: "done" as const, outcome: "approved" as const, round: 1 }, b: { status: "done" as const, port: "no", round: 1 }, f: { status: "active" as const, round: 1, waiting: 2 } };
    const t2 = takenEdges(g, later);
    expect(t2.has("a1.approved.b")).toBe(true);
    expect(t2.has("b.no.f")).toBe(true);
    expect(t2.has("b.yes.a2")).toBe(false);
    expect(t2.has("a1.rejected.no")).toBe(false);
  });

  it("lists the steps for a phone (no «آغاز») and counts «مرحلهٔ ۲ از ۴»", () => {
    const steps = listSteps(g).map((n) => n.id);
    expect(steps[0]).toBe("s");
    expect(steps).not.toContain("t");
    expect(stepCounter(g, st)).toEqual({ at: 2, of: 4 });
  });
});

describe("the rights matrix", () => {
  it("shows every field of the form in layout order with what the step gives, chips and locked choices", () => {
    const rows = rightsRows(SAMPLE_FORM, SAMPLE_FIELDS, { default: "read", fields: { u_note: "edit", u_ref_no: "edit" } });
    expect(rows.map((r) => r.field)).toEqual(["u_amount", "u_need_date", "u_reason", "u_iban", "u_docs", "u_note", "u_ref_no"]);
    const by = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(by.u_note).toMatchObject({ stated: "edit", effective: "edit" });
    expect(by.u_amount).toMatchObject({ stated: null, effective: "read" });
    expect(by.u_amount.chips.map((c) => c.label)).toEqual(["گروه: مالی", "الزامی در فرم"]);
    // a system field is never editable: the step's «ویرایش» falls back to read
    expect(by.u_ref_no).toMatchObject({ stated: "edit", effective: "read", disabled: ["edit", "required"] });
    expect(by.u_ref_no.chips.some((c) => c.kind === "lock")).toBe(true);
    expect(by.u_note.section).toBe("جزئیات › بررسی");
  });

  it("states a field's right, changes the default, «همه خواندنی», and finds rights of fields no longer in the form", () => {
    const v = setFieldRight(null, "u_amount", "required");
    expect(v).toEqual({ default: "read", fields: { u_amount: "required" } });
    expect(setDefaultRight(v, "edit")).toEqual({ default: "edit", fields: { u_amount: "required" } });
    expect(rightsRows(SAMPLE_FORM, SAMPLE_FIELDS, setDefaultRight(v, "edit")).find((r) => r.field === "u_need_date")!.effective).toBe("edit");
    expect(allRead()).toEqual({ default: "read", fields: {} });
    expect(strayRights(SAMPLE_FORM, { default: "read", fields: { u_gone: "edit", u_note: "read" } })).toEqual(["u_gone"]);
  });

  it("renders a table with a caption, a radio group per field (named per matrix) and Persian labels", () => {
    const html = renderToStaticMarkup(createElement(RightsMatrix, { form: SAMPLE_FORM, fields: SAMPLE_FIELDS, value: { default: "read", fields: {} }, onChange: () => undefined, stepLabel: "تأیید رئیس شعبه" }));
    expect(html).toContain("<caption");
    expect(html).toContain("تأیید رئیس شعبه");
    expect(html).toMatch(/name="wfk-right-[^"]*-u_amount"/);
    expect(html).toContain('aria-label="مبلغ درخواستی: خواندنی (پیش‌فرض)"');
    expect(html).toContain("همه خواندنی");
    // the system field's «ویرایش» and «الزامی» are disabled
    expect((html.match(/name="wfk-right-[^"]*-u_ref_no"/g) ?? []).length).toBe(4);
    expect((html.match(/disabled=""[^>]*aria-label="شمارهٔ سند پرداخت: (ویرایش|الزامی)"/g) ?? []).length).toBe(2);
    // two matrices on one page never share a radio group
    const two = renderToStaticMarkup(createElement("div", null, createElement(RightsMatrix, { form: SAMPLE_FORM, fields: SAMPLE_FIELDS, value: null }), createElement(RightsMatrix, { form: SAMPLE_FORM, fields: SAMPLE_FIELDS, value: null })));
    expect(new Set([...two.matchAll(/name="(wfk-right-[^"]*-u_amount)"/g)].map((m) => m[1])).size).toBe(2);
  });
});

describe("the role-then-people picker", () => {
  it("starts every kind of rule with settings the shared rules keep as they are", () => {
    for (const k of ASSIGNEE_KINDS) {
      const r = newRule(k);
      expect(r.kind).toBe(k);
      expect(cleanRule(r)).toEqual(r);
    }
    // 1.1.5: a new position rule no longer starts at «واحد درخواست‌دهنده» (the requester's own profile unit: the
    // owner's «کسی پیدا نشد»); its scope follows the position once one is picked (pickPosition)
    expect(newRule("position")).toEqual({ kind: "position", position: "", where: "anywhere" });
  });

  it("ticks people into the members filter (lower case, once) and back to every holder", () => {
    const r = newRule("position");
    const only = withMembers(r, ["AAAAAAAA-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000001"]);
    expect((only as { members?: string[] }).members).toEqual(["aaaaaaaa-0000-4000-8000-000000000001"]);
    expect("members" in withMembers(only, null)).toBe(false);
    expect(withMembers({ kind: "requester" }, ["x"])).toEqual({ kind: "requester" });
  });

  it("keeps holders valid today and offers the form's people and unit fields", () => {
    expect(validHolder({ valid_from: "1405-01-01", valid_to: null }, "1405-02-01")).toBe(true);
    expect(validHolder({ valid_from: "2026-12-01" }, "2026-11-14")).toBe(false);
    expect(validHolder({ valid_to: "2026-11-14" }, "2026-11-14")).toBe(true);
    expect(validHolder({ valid_to: "2026-11-13" }, "2026-11-14")).toBe(false);
    const fields = [
      { name: "u_who", type: "user" },
      { name: "u_team", type: "group" },
      { name: "u_branch", type: "ref", ref: "org_unit" },
      { name: "u_ci", type: "ref", ref: "ci" },
    ];
    expect(ruleFields(fields, "people").map((f) => f.name)).toEqual(["u_who", "u_team"]);
    expect(ruleFields(fields, "unit").map((f) => f.name)).toEqual(["u_branch"]);
  });

  it("narrows the rules to a scope: a new position starts at a «کجا» offered; a rule outside it is told apart", () => {
    const scope: RuleScope = { kinds: ["position", "role", "users"], wheres: ["anywhere", "unit"] };
    expect(scopedRule("position", scope)).toEqual({ kind: "position", position: "", where: "anywhere" });
    expect(scopedRule("users", scope)).toEqual(newRule("users"));
    expect(scopedRule("position")).toEqual(newRule("position"));
    expect(ruleInScope({ kind: "users", users: [] }, scope)).toBe(true);
    expect(ruleInScope({ kind: "position", position: "branch_head", where: "unit", unit: "u1" }, scope)).toBe(true);
    expect(ruleInScope({ kind: "position", position: "branch_head", where: "requester_unit" }, scope)).toBe(false);
    expect(ruleInScope({ kind: "manager", of: "requester" }, scope)).toBe(false);
    expect(ruleInScope({ kind: "manager", of: "requester" })).toBe(true);
    // in the list, a rule outside the scope says it finds nobody; one inside does not
    const warn = "این قاعده این‌جا کسی را نمی‌یابد";
    const list = (value: AssigneeRule[], s?: RuleScope) => renderToStaticMarkup(createElement(AssigneeRulesList, { value, onChange: () => undefined, plain: true, scope: s }));
    expect(list([{ kind: "manager", of: "requester" }], scope)).toContain(warn);
    expect(list([{ kind: "role", role: "agent" }], scope)).not.toContain(warn);
    expect(list([{ kind: "manager", of: "requester" }])).not.toContain(warn);
  });
});

describe("the files input", () => {
  const field = { label: "پیوست‌ها", max: 2, accept: ["pdf", "image"] };
  it("reads the ids of a value (ids or { id }), once each", () => {
    const a = "aaaaaaaa-0000-4000-8000-000000000001";
    expect(fileIds([a, { id: a.toUpperCase() }, "", 3])).toEqual([a]);
    expect(fileIds("x")).toEqual([]);
  });

  it("checks a file's kind and the count, in Persian", () => {
    expect(fileProblem(field, "scan.PDF", 1)).toBeNull();
    expect(fileProblem(field, "photo.jpg", 2)).toBeNull();
    expect(fileProblem(field, "virus.exe", 1)).toMatch(/پذیرفته نیست.*تصویر/);
    expect(fileProblem(field, "third.pdf", 3)).toMatch(/حداکثر ۲ پرونده/);
    expect(fileProblem({ label: "x" }, "a.exe", 1)).toBeNull();
    expect(filesMax({})).toBe(5);
    expect(filesMax({ max: 500 })).toBe(50);
  });

  it("builds the picker's accept list and the kinds in words; sizes in Persian", () => {
    expect(acceptAttr(["pdf"])).toBe(".pdf");
    expect(acceptAttr(["image"]).split(",")).toContain(".png");
    expect(acceptAttr(null)).toBe("");
    expect(acceptText(["pdf", "image"])).toBe("PDF، تصویر");
    expect(sizeText(900)).toBe("۹۰۰ بایت");
    expect(sizeText(2048)).toBe("۲ کیلوبایت");
    expect(sizeText(2.5 * 1024 * 1024)).toBe("۲٫۵ مگابایت");
  });

  it("shows a stored value's files by name, each a link when it opens; without their names, how many as «پیوست»", () => {
    const a = "aaaaaaaa-0000-4000-8000-000000000001";
    const b = "bbbbbbbb-0000-4000-8000-000000000002";
    const display = { [a]: "invoice.pdf", [b]: "scan.png" };
    const linked = renderToStaticMarkup(createElement(FilesValue, { value: [a, b], display, hrefOf: (id: string) => `/files/${id}` }));
    expect(linked).toMatch(new RegExp(`<a [^>]*href="/files/${a}"[^>]*>invoice\\.pdf</a>`));
    expect(linked).toMatch(new RegExp(`<a [^>]*href="/files/${b}"[^>]*>scan\\.png</a>`));
    expect(renderToStaticMarkup(createElement(FilesValue, { value: [a], display }))).not.toContain("<a ");
    // a file of this window's memory that is gone opens nothing
    expect(renderToStaticMarkup(createElement(FilesValue, { value: [a], display, hrefOf: () => "" }))).not.toContain("<a ");
    const counted = renderToStaticMarkup(createElement(FilesValue, { value: [a, b] }));
    expect(counted).toContain("۲ پیوست");
    expect(counted).not.toContain("پرونده");
  });
});

describe("the legend and the step list (markup)", () => {
  it("names the legend and gives each entry its word", () => {
    const html = renderToStaticMarkup(createElement(StepLegend, {}));
    expect(html).toContain('aria-label="راهنمای وضعیت مرحله‌ها"');
    for (const s of LEGEND_ORDER) expect(html).toContain(STEP_STATUS[s].label);
    const only = renderToStaticMarkup(createElement(StepLegend, { only: ["done"] }));
    expect(only).toContain("انجام‌شده");
    expect(only).not.toContain("نوبت شما");
  });

  it("numbers the steps in Persian with their status, as buttons when they open", () => {
    const g = sampleProcess();
    const html = renderToStaticMarkup(createElement(StepList, { graph: g, statuses: sampleStatuses(g), onOpen: () => undefined }));
    expect(html).toContain("<ol");
    expect(html).toContain("۱");
    expect(html).toContain("تأیید رئیس شعبه");
    expect(html).toContain("نوبت شما · ۱ نفر");
    expect((html.match(/<button/g) ?? []).length).toBe(listSteps(g).length);
  });
});

describe("the module's parts", () => {
  it("leaves out groups without rows, keeps every route once, merges segments", () => {
    const ui = assemble([{ routes: [{ path: "a", element: null }] }, { home: [{ key: "x", label: "x", path: "workflows" }], routes: [{ path: "workflows", element: null }], segments: { workflows: "home" } }]);
    expect(ui.nav.map((g) => g.key)).toEqual([HOME_GROUP.key]);
    expect(ui.nav[0].space).toBe("home");
    expect(ui.routes.map((r) => r.path)).toEqual(["a", "workflows"]);
    expect(ui.segments).toEqual({ workflows: "home" });
    expect(SETTINGS_GROUP.label).toBe("فرم‌ها و گردش‌کارها");
    expect(() => assemble([{ routes: [{ path: "a", element: null }] }, { routes: [{ path: "a", element: null }] }])).toThrow(/twice/);
  });

  it("is registered: the kit's page is a route of the app", async () => {
    const { ROUTES } = await import("../src/ui/modules/registry");
    expect(ROUTES.some((r) => r.path === "settings/workflows-kit")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Release 1.1.5: the owner's «کسی پیدا نشد» (RC1, B4, B1) and the demo pack's people in the kit

const ORG = "org-1";
const orgInfo = (id: string): OrgInfo => ({
  org: { id, name: "بانک آفتاب", legal_name: null, modules: [], phone: null, email: null, website: null, city: null, address: null, logo: null, settings: {} },
  member: { role: "member", title: "", permissions: {} as OrgInfo["member"]["permissions"] },
  counts: { members: 1 },
});
/** A part of the screens rendered statically in their providers, react-query seeded as the API would answer. */
function renderOrg(el: ReactElement, seed: (qc: QueryClient) => void): string {
  const qc = new QueryClient();
  seed(qc);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(OrgProvider, { orgId: ORG, info: orgInfo(ORG), children: createElement(MemoryRouter, null, el) })));
}

describe("1.1.5: a position rule's scope («کجا»)", () => {
  const fresh = newRule("position") as PositionRule;
  const manager = { key: "group_manager", unit_kind: null };
  const head = { key: "branch_head", unit_kind: "branch" };

  it("a new rule follows the position it gets: «همه‌جا», or up the requester's tree to a unit of the position's kind — never «واحد درخواست‌دهنده»", () => {
    expect(defaultScope(null)).toEqual({ where: "anywhere" });
    expect(defaultScope("branch")).toEqual({ where: "requester_unit_up", unitKind: "branch" });
    expect(pickPosition(fresh, manager, { chosen: false, was: null })).toEqual({ kind: "position", position: "group_manager", where: "anywhere" });
    expect(pickPosition(fresh, head, { chosen: false, was: null })).toEqual({ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" });
    // the owner's step: before 1.1.5 the rule kept «واحد درخواست‌دهنده» and found nobody for his persona
    expect(pickPosition(fresh, manager, { chosen: false, was: null }).where).not.toBe("requester_unit");
    // a picked position whose scope was never chosen follows the next position picked …
    const auto = pickPosition(fresh, manager, { chosen: false, was: null });
    expect(pickPosition(auto, head, { chosen: false, was: { unit_kind: null } })).toEqual({ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" });
    // … the same as the positions page's preview starts (admin/positions previewStep)
    expect(isDefaultScope({ where: "requester_unit_up" }, "branch")).toBe(true);
    expect(isDefaultScope({ where: "requester_unit_up", unitKind: "team" }, "branch")).toBe(false);
    expect(isDefaultScope({ where: "anywhere" }, null)).toBe(true);
  });

  it("an explicit choice is kept: chosen here, or a saved rule's own scope; a fixed unit and the members filter go with the previous position", () => {
    // the person chose «واحد مشخص» before the position
    expect(pickPosition({ ...fresh, where: "unit" }, head, { chosen: true, was: null })).toEqual({ kind: "position", position: "branch_head", where: "unit" });
    // a saved rule at «واحد درخواست‌دهنده» (not what its position starts with) keeps it
    const saved: PositionRule = { kind: "position", position: "group_manager", where: "requester_unit", members: ["u1"] };
    expect(pickPosition(saved, head, { chosen: false, was: { unit_kind: null } })).toEqual({ kind: "position", position: "branch_head", where: "requester_unit" });
    // a form field and a chosen kind of unit stay; the unit does not
    expect(pickPosition({ kind: "position", position: "x", where: "unit_field", unitField: "u_branch" }, head, { chosen: true, was: null })).toEqual({ kind: "position", position: "branch_head", where: "unit_field", unitField: "u_branch" });
    expect(pickPosition({ kind: "position", position: "x", where: "requester_unit_up", unitKind: "team" }, head, { chosen: false, was: { unit_kind: "branch" } })).toMatchObject({ where: "requester_unit_up", unitKind: "team" });
    expect(pickPosition({ kind: "position", position: "x", where: "unit", unit: "u-1" }, head, { chosen: true, was: null })).not.toHaveProperty("unit");
    // the previous position not known yet: nothing to compare with, the scope stays
    expect(pickPosition({ kind: "position", position: "x", where: "anywhere" }, head, { chosen: false, was: null })).toMatchObject({ where: "anywhere" });
  });

  it("a process's starters (only «همه‌جا» and «واحد مشخص» offered) never get a scope they do not offer", () => {
    const starters: RuleScope = { kinds: ["position", "group", "role", "users"], wheres: ["anywhere", "unit"] };
    expect(scopedRule("position", starters)).toEqual({ kind: "position", position: "", where: "anywhere" });
    const picked = pickPosition(fresh, head, { chosen: false, was: null, wheres: starters.wheres });
    expect(picked).toEqual({ kind: "position", position: "branch_head", where: "anywhere" });
    expect(ruleInScope(picked, starters)).toBe(true);
  });

  it("says who of the holders a scope that depends on each case gives the step to; none for «همه‌جا» and «واحد مشخص»", () => {
    expect(["requester_unit", "requester_unit_up", "unit_field"].every((w) => isCaseScope(w as PositionRule["where"]))).toBe(true);
    expect(isCaseScope("anywhere") || isCaseScope("unit")).toBe(false);
    expect(scopeNote({ where: "requester_unit" })).toBe("فقط دارندهٔ واحد درخواست‌دهنده (واحدِ پروندهٔ کاربری او) کار را می‌گیرد.");
    expect(scopeNote({ where: "requester_unit_up", unitKind: "branch" }, { kind: () => "شعبه" })).toBe("فقط دارندهٔ نزدیک‌ترین «شعبه» در بالادستِ واحد درخواست‌دهنده (واحدِ پروندهٔ کاربری او) کار را می‌گیرد.");
    expect(scopeNote({ where: "unit_field", unitField: "u_branch" }, { field: () => "شعبهٔ مقصد" })).toBe("فقط دارندهٔ واحدی که «شعبهٔ مقصد» در پرونده می‌گوید کار را می‌گیرد.");
    expect(scopeNote({ where: "anywhere" })).toBeNull();
    expect(scopeNote({ where: "unit" })).toBeNull();
  });

  it("the holders by unit: valid today, each person once per unit, units by name, holders without a unit last", () => {
    const names: Record<string, string> = { a: "امور شعب استان البرز", b: "امور شعب استان لرستان" };
    const groups = holderGroups(
      [
        { user_id: "U2", org_unit_id: "b", valid_from: null, valid_to: null },
        { user_id: "u1", org_unit_id: "A", valid_from: "2026-01-01", valid_to: null },
        { user_id: "u1", org_unit_id: "a", valid_from: null, valid_to: null },
        { user_id: "u3", org_unit_id: null, valid_from: null, valid_to: null },
        { user_id: "u4", org_unit_id: "a", valid_from: null, valid_to: "2026-01-01" },
      ],
      "2026-11-21",
      (id) => names[id] ?? id,
    );
    expect(groups).toEqual([{ unit: "a", people: ["u1"] }, { unit: "b", people: ["u2"] }, { unit: null, people: ["u3"] }]);
  });
});

describe("1.1.5: the «افراد» list honours «کجا» (the owner's two holders under «واحد درخواست‌دهنده»)", () => {
  const position = { id: "p1", key: "group_manager", name: "مدیر گروه", unit_kind: null, active: true };
  const holders = {
    rows: [
      { id: "h1", user_id: "u-negar", org_unit_id: "unit-alborz", kind: "primary", valid_from: null, valid_to: null },
      { id: "h2", user_id: "u-babak", org_unit_id: "unit-lorestan", kind: "primary", valid_from: null, valid_to: null },
    ],
    display: { "u-negar": "نگار کارشناس‌پور", "u-babak": "بابک طاهری", "unit-alborz": "امور شعب استان البرز", "unit-lorestan": "امور شعب استان لرستان" },
  };
  const seed = (qc: QueryClient) => {
    qc.setQueryData(["wfk-positions-of", ORG, "key", ["group_manager"]], [position]);
    qc.setQueryData(["wfk-holders", ORG, "p1", null], holders);
    qc.setQueryData(DEMO_PEOPLE_KEY(ORG), { users: ["U-NEGAR"] });
  };
  const picker = (where: PositionRule["where"], members?: string[]) =>
    renderOrg(createElement(AssigneePicker, { value: { assignees: [{ kind: "position", position: "group_manager", where, ...(members ? { members } : {}) }] } as StepAssignees, onChange: () => undefined, action: "fill" }), seed);
  // the holders' part of the picker (the exclusions below it have checkboxes of their own)
  const holdersOf = (html: string) => html.slice(html.indexOf("افراد</span>"), html.indexOf('aria-label="کنار گذاشته‌ها"'));
  const checkboxes = (html: string) => (holdersOf(html).match(/type="checkbox"/g) ?? []).length;
  const checked = (html: string) => (holdersOf(html).match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []).filter((x) => /checked=""/.test(x)).length;
  const demoTags = (html: string) => (holdersOf(html).match(/>نمایشی</g) ?? []).length;

  it("«همه‌جا»: every holder takes the step, listed ticked; the pack's person marked «نمایشی»", () => {
    const html = picker("anywhere");
    expect(checkboxes(html)).toBe(2);
    expect(checked(html)).toBe(2);
    expect(html).toContain("نگار کارشناس‌پور");
    expect(html).toContain("بابک طاهری");
    expect(demoTags(html)).toBe(1);
    expect(html).not.toContain("کار را می‌گیرد");
  });

  it("«واحد درخواست‌دهنده»: a line says only the requester's unit's holder gets it, the holders by unit, none ticked as if all were included", () => {
    const html = picker("requester_unit");
    // before 1.1.5 both holders were listed ticked under «همهٔ دارندگان», as if both would get the step
    expect(checkboxes(html)).toBe(0);
    expect(html).toContain("فقط دارندهٔ واحد درخواست‌دهنده (واحدِ پروندهٔ کاربری او) کار را می‌گیرد.");
    expect(html).toContain("امور شعب استان البرز");
    expect(html).toContain("امور شعب استان لرستان");
    expect(html.indexOf("امور شعب استان البرز")).toBeLessThan(html.indexOf("نگار کارشناس‌پور"));
    expect(demoTags(html)).toBe(1);
  });

  it("«فقط این افراد» under a scope that depends on the case: the ticks are a filter, with its warning", () => {
    const html = picker("requester_unit_up", ["u-babak"]);
    expect(checkboxes(html)).toBe(2);
    expect(checked(html)).toBe(1);
    expect(html).toContain("فقط این افراد، اگر در آن واحد باشند");
  });

  it("a position without holders no longer promises that the step will reach a future holder (it is never re-resolved by itself)", () => {
    const html = renderOrg(createElement(AssigneePicker, { value: { assignees: [{ kind: "position", position: "group_manager", where: "anywhere" }] }, onChange: () => undefined, action: "fill" }), (qc) => {
      qc.setQueryData(["wfk-positions-of", ORG, "key", ["group_manager"]], [position]);
      qc.setQueryData(["wfk-holders", ORG, "p1", null], { rows: [], display: {} });
    });
    expect(html).toContain("این نقش اکنون دارنده‌ای ندارد.");
    expect(html).not.toContain("با پیدا شدن دارنده");
  });

  it("«اگر کسی پیدا نشد» on an approval says that passing counts as approved", () => {
    expect(ifNobodyOptions("approve").find((o) => o.value === "skip")?.label).toContain("«تأیید شد» به حساب می‌آید");
    expect(ifNobodyOptions("fill").find((o) => o.value === "skip")?.label).toBe("از این مرحله بگذرد");
  });
});

describe("1.1.5: the estimate (B4: a 400 with the body before the position was picked)", () => {
  it("asks only with the body it sends: the debounced body of an empty position is not ready although the rule on the screen is", () => {
    const empty = newRule("position") as PositionRule;
    const picked = pickPosition(empty, { key: "group_manager", unit_kind: null }, { chosen: false, was: null });
    // the screen already shows the picked position …
    expect(ruleComplete(picked)).toBe(true);
    // … while the debounced body still names the empty one: nothing is asked (before 1.1.5 it was, and answered 400)
    const stale = estimateRequest(estimateBody({ assignees: [empty] }, "fill"));
    expect(stale.ready).toBe(false);
    const fresh = estimateRequest(estimateBody({ assignees: [picked] }, "approve", "any"));
    expect(fresh).toEqual({ ready: true, input: { step: { assignees: [picked] }, action: "approve", quorum: "any" } });
    expect(estimateRequest("{").ready).toBe(false);
    expect(estimateRequest(estimateBody({ assignees: [] }, "fill")).ready).toBe(false);
  });

  it("counts the demo pack's people apart: per rule and the real against the demo people", () => {
    const v = estimateView({
      rules: [
        { index: 0, kind: "position", estimate: 2, line: "۲ نفر «مدیر گروه» در همهٔ سازمان", demo: 2 },
        { index: 1, kind: "group", estimate: 5, line: "۵ نفر در گروه «میز خدمت»", demo: 1 },
        { index: 2, kind: "users", estimate: 1, line: "۱ نفر مشخص" },
      ],
      total: 8,
      demo: 3,
      warnings: ["۳ نفر از این افراد حساب نمایشی‌اند؛ فقط پرونده‌هایی که حساب‌های نمایشی آغاز کنند به آن‌ها می‌رسد"],
    });
    expect(v.rules.map((r) => r.demo)).toEqual(["همه نمایشی", "۱ نفر نمایشی", null]);
    expect(v.total).toBe("۵ نفر واقعی و ۳ نفر نمایشی");
    expect(v.warnings).toHaveLength(1);
    expect(estimateView({ rules: [], total: 4, warnings: [] }).total).toBeNull();
    expect(estimateView({ rules: [], total: null, demo: 2, warnings: [] }).total).toBe("۲ نفر از آن‌ها نمایشی");
  });
});

describe("1.1.5: a new step's rights and «انتظار»'s time", () => {
  it("a «تکمیل فرم» starts with its fields to fill, a review and an approval with theirs to read", () => {
    expect(defaultStepRights("fill")).toEqual({ default: "edit", fields: {} });
    expect(defaultStepRights("review")).toEqual({ default: "read", fields: {} });
    expect(defaultStepRights("approve")).toEqual({ default: "read", fields: {} });
  });
});

describe("1.1.5: the demo pack's people in the people pickers and the preview", () => {
  const row = (id: string, name: string, over: Partial<MemberRow> = {}): MemberRow => ({ id, name, email: `${id}@aftab-bank.example`, title: null, active: true, ...over });
  const demo = demoSet(["U-NEGAR", "u-babak", 7, ""]);
  const rows = [row("u-owner", "مالک"), row("u-negar", "نگار کارشناس‌پور"), row("u-ali", "علی احمدی")];

  it("reads the pack's people as lower-case ids; marks nobody without a pack", () => {
    expect([...demo].sort()).toEqual(["u-babak", "u-negar"]);
    expect(isDemo(demo, "U-Negar")).toBe(true);
    expect(isDemo(demoSet(null), "u-negar")).toBe(false);
    expect(isDemo(demo, null)).toBe(false);
  });

  it("a real case's picker leaves the pack's people out (a current value stays, to be taken off); the pack's marks them", () => {
    const hidden = memberOptions({ rows, value: [], demo, mode: "hide", searching: false });
    expect(hidden).toHaveLength(1);
    expect(hidden[0].options.map((o) => o.value)).toEqual(["u-owner", "u-ali"]);
    expect(memberOptions({ rows, value: ["u-negar"], demo, mode: "hide", searching: false })[0].options.map((o) => o.value)).toContain("u-negar");
    const marked = memberOptions({ rows, value: [], demo, mode: "mark", searching: false })[0].options;
    expect(marked.find((o) => o.value === "u-negar")?.demo).toBe(true);
    expect(marked.find((o) => o.value === "u-ali")?.demo).toBe(false);
  });

  it("a sample requester while a pack is loaded: «حساب‌های نمایشی» first, then the members with «من» first; a search lists one group", () => {
    const pack = [row("u-negar", "نگار کارشناس‌پور"), row("u-babak", "بابک طاهری")];
    const groups = memberOptions({ rows, pack, value: ["u-owner"], demo, mode: "first", me: "u-owner", meFirst: true, searching: false });
    expect(groups.map((g) => g.label)).toEqual(["حساب‌های نمایشی", "اعضا"]);
    expect(groups[0].options.map((o) => o.value)).toEqual(["u-negar", "u-babak"]);
    expect(groups[1].options.map((o) => o.value)).toEqual(["u-owner", "u-ali"]);
    expect(groups[1].options[0].me).toBe(true);
    expect(memberOptions({ rows, pack, value: [], demo, mode: "first", searching: true })).toHaveLength(1);
    // a value not among the rows keeps its known name
    expect(memberOptions({ rows: [], value: ["u-x"], display: { "u-x": "زهرا" }, demo, mode: "mark", searching: false })[0].options[0]).toMatchObject({ value: "u-x", label: "زهرا" });
  });

  it("the preview says when nobody is found and what the step then does, in a preview's words; a step's people marked", () => {
    expect(previewVerdict({ status: "ok" }, { action: "fill" })).toBeNull();
    expect(previewVerdict({ status: "nobody", message: "برای «مرحلهٔ فرم» کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند." }, { action: "fill" })).toEqual({
      tone: "danger",
      text: "با این درخواست‌دهنده برای این مرحله کسی پیدا نمی‌شود؛ پرونده منتظر می‌ماند تا مسئولان گردش‌کار کسی را برگزینند.",
    });
    expect(previewVerdict({ status: "nobody" }, { action: "approve", ifNobody: "skip" })?.text).toContain("«تأیید شد» به حساب می‌آید");
    expect(previewVerdict({ status: "managers" }, { action: "fill" })?.text).toBe("کسی پیدا نمی‌شود؛ مرحله به مسئولان گردش‌کار می‌رسد.");
    expect(previewVerdict({ status: "too_many", message: "بیش از ۱۰۰ نفر پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند" }, { action: "fill" })?.tone).toBe("warning");
    expect(
      previewLines({ people: [{ user: "u-negar" }, { user: "u-ali" }], lines: ["نگار — مدیر گروه (البرز)", "علی — مدیر گروه (لرستان)"], display: { demo: ["U-NEGAR"] } }),
    ).toEqual([
      { line: "نگار — مدیر گروه (البرز)", demo: true },
      { line: "علی — مدیر گروه (لرستان)", demo: false },
    ]);
    expect(previewLines({ people: [{ user: "u-negar" }], lines: ["نگار"] })).toEqual([{ line: "نگار", demo: false }]);
  });
});

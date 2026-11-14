// The process designer (design F §3.5, §8.4, package F6 part b; src/ui/modules/workflows/admin/process): who opens it
// and what it offers; the draft as F4c keeps it and what the autosave sends; the palette and adding a step (after one,
// between two, on a way out, a new approval's rejection); «مسیرها»; removing a step; changing an action; the case's
// values for conditions, titles and «درخواست‌دهنده چه می‌بیند»; the notices of a step; the problems kept current
// between autosaves and where each is fixed; «نسخه‌ها»; «پیش‌نمایش»'s notes — and on a real organisation: the bank's
// «درخواست تنخواهِ شعبه» (§3.7) built with the designer's own moves (no JSON) and saved without an error, a stale save
// refused, the preview's people per step, publish with the access settings, the versions and a restore, and who is
// offered what (a designer, a publisher, a requester).
import { describe, it, expect, beforeAll } from "vitest";
import { composeEffective, gateAllows, roleCatalog, type AccessGate, type FullGrant } from "@shared/access";
import { LEVEL_ORDER, type Level } from "@shared/permissions";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import { rialFromInput } from "@shared/forms/fieldtypes";
import { newRule, ruleInScope, scopedRule, setFieldRight } from "../src/ui/modules/workflows/kit/model";
import type { FieldDef } from "@shared/model/types";
import type { FlowProblem } from "@shared/flows/types";
import {
  ASSIGNEE_KINDS, assigneeProblems, formStepOf, mayInclude, outEdges, processNodeLabel, startOf, validateProcess, type AssigneeRule, type PersonFacts, type ProcessGraph,
  type ProcessNode,
} from "@shared/process";
import { cleanDraft as serverCleanDraft, defaultDraft as serverDefaultDraft } from "@server/modules/process/publish";
import { ROUTES } from "../src/ui/modules/registry";
import { processPart } from "../src/ui/modules/workflows/admin/process/routes";
import { designerPath, publishVerdict, routeMatches } from "../src/ui/modules/workflows/admin/hub/model";
import { hubApi } from "../src/ui/modules/workflows/admin/hub/api";
import { designerApi, type ProcessDetail, type ProcessDraft, type ResolveResult } from "../src/ui/modules/workflows/admin/process/api";
import {
  DESIGNER_PATH, END_PRESETS, GAP_Y, NEW_STEP_OPTIONS, PALETTE_GROUPS, PALETTE_ITEMS, STARTER_SCOPE, addFromPort, assigneesPatch, bridgeRemoved, caseFields, casePill, caseRules,
  cleanDraft, countProblems, defaultGraph, designerAccess, designerDraft, designerOffers, earlierSteps, formInfoOf, formPatch, graphForms, insertAfter, insertText, itemConfig,
  joinPatch, liveProblems, mainPort, moveKey, nameProblem, newCaseKey, newEscalation, newStepOf, paletteItem, patchConfig, phoneNotes, pillField, portRows, previewBlocked, previewNote,
  previewSteps, problemGroups, problemTarget, problemsText, processForms, rawCases, removeNode, requesterViewOptions, resolveBody, resolvedPeople, savePatch, setAction,
  setCases, setLabel, setPortTarget, stableJson, startFields, startingDraft, startersNote, startersText, statusChip, stepNotices, stepTitles, structureKey, tabProblems, titleFields,
  titleSample, unitFromRial, versionMeta, versionTitle, wireRejection, type FormInfo,
} from "../src/ui/modules/workflows/admin/process/model";
import type { OrgApi } from "../src/ui/lib/api";
import type { Client } from "./helpers";
import { bank, type Bank } from "./process-api-helpers";

// ---------------------------------------------------------------------------------------------------------------
// helpers

const catalog = roleCatalog([]);
const grantsOf = (...roles: string[]) => composeEffective({ role: "member", levels: { work: "edit" }, explicit: roles, catalog }).grants;
const DESIGNER: Record<string, FullGrant> = { [PROCESS_DESIGN_AREA]: { read: "all", create: true, write: "all", delete: "none", approve: false, admin: false } };
const allowsOf = (grants: Record<string, FullGrant>) => ({ allows: (g: AccessGate) => gateAllows(grants, g) });
const CREATED = /^\/process\/defs$|^\/forms$/;
const orgApiOf = (c: Client, P: string) =>
  ({
    get: (path: string, q?: Record<string, string>) => c.get(`${P}${path}${q ? `?${new URLSearchParams(q)}` : ""}`),
    post: (path: string, body?: unknown) => c.post(`${P}${path}`, body, CREATED.test(path) ? 201 : 200),
    put: (path: string, body?: unknown) => c.put(`${P}${path}`, body),
    patch: (path: string, body?: unknown) => c.patch(`${P}${path}`, body),
    del: (path: string) => c.del(`${P}${path}`),
  }) as unknown as OrgApi;
async function probeOf(c: Client, P: string) {
  const me = await c.get(P);
  const perms = (me.member?.permissions ?? {}) as Record<string, Level>;
  return { can: (area: "settings", level: Level) => LEVEL_ORDER.indexOf(perms[area] ?? "none") >= LEVEL_ORDER.indexOf(level), allows: (g: AccessGate) => gateAllows(me.access?.grants, g), writable: true };
}
const N = (id: string, type: ProcessNode["type"], config: Record<string, unknown> = {}, label?: string, position?: { x: number; y: number }): ProcessNode => ({ id, type, config, ...(label ? { label } : {}), ...(position ? { position } : {}) });
const E = (source: string, target: string, port?: string) => ({ id: `${source}.${port ?? "out"}.${target}`, source, target, ...(port ? { port } : {}) });
const node = (g: ProcessGraph, id: string) => g.nodes.find((n) => n.id === id)!;
const targets = (g: ProcessGraph, id: string, port = "out") => outEdges(g, id, port).map((e) => e.target);
/** A graph's connections by the steps' names: «from|port|to». */
const wiring = (g: ProcessGraph) => g.edges.map((e) => `${processNodeLabel(node(g, e.source))}|${e.port ?? "out"}|${processNodeLabel(node(g, e.target))}`).sort();
const draftOf = (graph: ProcessGraph, more: Partial<ProcessDraft> = {}): ProcessDraft => ({ graph, starters: [], title_template: null, requester_view: [], managers: [], manager_groups: [], confidential: false, ...more });
const detailOf = (draft: ProcessDraft, more: Partial<ProcessDetail["process"]> = {}): ProcessDetail => ({
  process: { id: "p1", key: "petty", name: "تنخواه", icon: null, category: "مالی", description: null, status: "draft", version_no: 0, current_version_id: null, published_at: null, published_by: null, updated_at: null, version: 3, ...more },
  draft, problems: [], unpublished: true, open_cases: 0, can: { read: true, write: true, create: true, publish: false }, display: {},
});
const f = (name: string, label: string, type: FieldDef["type"], extra: Partial<FieldDef> = {}) => ({ name, label, type, ...extra }) as FieldDef;
const FIELDS: Record<string, FieldDef> = {
  u_amount: f("u_amount", "مبلغ درخواستی", "money"),
  u_need: f("u_need", "شرح نیاز", "text"),
  u_branch: f("u_branch", "شعبه", "ref", { ref: "org_unit" }),
  u_owner: f("u_owner", "مسئول", "user"),
  u_kind: f("u_kind", "نوع", "choice", { choices: [{ value: "a", label: "الف" }, { value: "b", label: "ب" }] }),
  u_note: f("u_note", "نظر مالی", "text"),
};
const layout = (...items: string[]) => ({ tabs: [{ label: "جزئیات", sections: [{ label: null, items: items.map((field) => ({ field })) }] }] });
const REQ: FormInfo = { id: "f-req", name: "فرم درخواست", layout: layout("u_amount", "u_need", "u_branch"), fields: { u_amount: FIELDS.u_amount, u_need: FIELDS.u_need, u_branch: FIELDS.u_branch } };
const REVIEW: FormInfo = { id: "f-review", name: "فرم بررسی", layout: layout("u_amount", "u_need", "u_branch", "u_owner", "u_kind", "u_note"), fields: FIELDS };

/** The start of every new process, its start step given a form. */
const startGraph = (): ProcessGraph => {
  const g = defaultGraph();
  return patchConfig(g, "request", formPatch(node(g, "request").config, REQ.id));
};

// ---------------------------------------------------------------------------------------------------------------

describe("who opens the designer, and what it offers", () => {
  it("the route is F4c's editor address, registered once; it has no menu row (the hub leads there)", () => {
    expect(processPart.routes.map((r) => r.path)).toEqual([DESIGNER_PATH]);
    expect(ROUTES.filter((r) => r.path === DESIGNER_PATH)).toHaveLength(1);
    expect(processPart.settings ?? []).toEqual([]);
    expect(routeMatches(ROUTES.map((r) => r.path), designerPath("0193a1b2-0000-7000-8000-000000000001"))).toBe(true);
  });

  it("`process_design` read opens it; «پیش‌نمایش» is for designers and the keepers of the structure (F3's rule)", () => {
    expect(designerAccess(allowsOf(DESIGNER))).toEqual({ read: true, preview: true });
    expect(designerAccess(allowsOf(grantsOf("process_publisher")))).toEqual({ read: true, preview: false });
    expect(designerAccess(allowsOf(grantsOf("agent"))).read).toBe(false);
    expect(designerAccess(allowsOf(grantsOf("requester"))).read).toBe(false);
  });

  it("edit for writers in a writable organisation off phones; publish and retire for approvers on the authority; retire only while published", () => {
    const d = detailOf(draftOf(defaultGraph()));
    const o = { writable: true, phone: false, authority: true, preview: true };
    expect(designerOffers(d, o)).toEqual({ edit: true, publish: false, retire: false, restore: true, preview: true });
    const pub = { ...d, can: { ...d.can, write: false, publish: true }, process: { ...d.process, status: "published" as const } };
    expect(designerOffers(pub, o)).toMatchObject({ edit: false, publish: true, retire: true, restore: false });
    // a Windows app linked to the web version, a read-only organisation, a phone
    expect(designerOffers(pub, { ...o, authority: false })).toMatchObject({ publish: false, retire: false });
    expect(designerOffers(d, { ...o, writable: false })).toMatchObject({ edit: false });
    expect(designerOffers(d, { ...o, phone: true })).toMatchObject({ edit: false, preview: false });
    expect(designerOffers({ ...pub, process: { ...pub.process, status: "retired" } }, o)).toMatchObject({ publish: true, retire: false });
  });

  it("the toolbar's state: a draft, a published version, a retired process", () => {
    expect(statusChip({ status: "draft", version_no: 0 })).toEqual({ label: "پیش‌نویس", tone: "neutral" });
    expect(statusChip({ status: "published", version_no: 2 })).toEqual({ label: "منتشرشده، نسخهٔ ۲", tone: "in" });
    expect(statusChip({ status: "retired", version_no: 3 }).label).toBe("بازنشسته، نسخهٔ ۳");
  });
});

describe("the draft and the autosave", () => {
  it("the draft is cleaned exactly as F4c cleans it", () => {
    const messy = {
      graph: { nodes: [{ id: "a", type: "trigger", config: {}, label: "  آغاز  ", position: { x: 1.4, y: 2.6 }, extra: 1 }, { id: "b", type: "end", config: { outcome: "rejected" } }], edges: [{ id: "a.out.b", source: "a", target: "b", port: "out" }] },
      starters: [{ kind: "position", position: "branch_staff", where: "anywhere" }, { kind: "nope" }],
      title_template: "  تنخواه {{case.u_amount}}  ",
      requester_view: ["u_note", "u_note", "Bad", 3],
      managers: ["0193A1B2-0000-7000-8000-000000000001", "x", "0193a1b2-0000-7000-8000-000000000001"],
      manager_groups: [],
      confidential: "yes",
      junk: true,
    };
    expect(cleanDraft(messy)).toEqual(serverCleanDraft(messy));
    expect(cleanDraft(null)).toEqual(serverCleanDraft(null));
    // a new process's graph is F4c's
    expect(stableJson(defaultGraph())).toBe(stableJson(serverDefaultDraft().graph));
  });

  it("an empty graph (a process made elsewhere) starts with «آغاز» and «ثبت درخواست»", () => {
    expect(startingDraft(draftOf({ nodes: [], edges: [] })).graph.nodes.map((n) => n.type)).toEqual(["trigger", "form_step"]);
    const g = startGraph();
    expect(startingDraft(draftOf(g)).graph).toBe(g);
    const d = designerDraft(detailOf(draftOf({ nodes: [], edges: [] })));
    expect(d).toMatchObject({ name: "تنخواه", category: "مالی", description: "" });
    expect(d.draft.graph.nodes).toHaveLength(2);
  });

  it("the autosave sends nothing when only key order or spaces differ; the whole draft and its version otherwise; an empty name is not sent", () => {
    const g = startGraph();
    const saved = detailOf(draftOf(g, { title_template: "تنخواه" }));
    const same: ProcessDraft = JSON.parse(JSON.stringify(saved.draft));
    // the same draft with its keys in another order and a label being typed with a space
    same.graph = { edges: same.graph.edges, nodes: same.graph.nodes.map((n) => ({ config: n.config, type: n.type, id: n.id, ...(n.label ? { label: `${n.label} ` } : {}) })) } as ProcessGraph;
    same.title_template = " تنخواه ";
    expect(savePatch(saved, { name: "تنخواه", category: "مالی ", description: "", draft: same })).toBeNull();
    const moved = { ...same, graph: { ...same.graph, nodes: same.graph.nodes.map((n) => ({ ...n, position: { x: 10, y: 20 } })) } };
    const p = savePatch(saved, { name: "تنخواه", category: "مالی", description: "", draft: moved })!;
    expect(p.version).toBe(3);
    expect(p.draft.graph.nodes[0].position).toEqual({ x: 10, y: 20 });
    expect(p).not.toHaveProperty("name");
    expect(savePatch(saved, { name: "  ", category: "مالی", description: "", draft: saved.draft })).toBeNull();
    expect(savePatch(saved, { name: "تنخواه شعبه", category: "", description: "شرح", draft: saved.draft })).toMatchObject({ name: "تنخواه شعبه", category: null, description: "شرح" });
    expect(nameProblem(" ")).toBeTruthy();
    expect(nameProblem("تنخواه")).toBe("");
  });

  it("a drag is one step to undo: only positions changed gives a key; anything else none", () => {
    const g = startGraph();
    const moved = { ...g, nodes: g.nodes.map((n) => (n.id === "request" ? { ...n, position: { x: 5, y: 5 } } : n)) };
    expect(moveKey(g, moved)).toBe("move:request");
    expect(moveKey(g, setLabel(g, "request", "ثبت"))).toBeNull();
    expect(moveKey(g, g)).toBeNull();
    expect(structureKey(g)).toBe(structureKey(moved));
  });
});

describe("the palette and adding steps", () => {
  it("§8.4's groups in order; an approval starts with «یک نفر کافی است»", () => {
    expect(PALETTE_GROUPS.map((g) => [g.group, g.items.map((i) => i.label)])).toEqual([
      ["مرحله‌ها", ["مرحلهٔ فرم", "بررسی", "تأیید"]],
      ["مسیر", ["شرط", "انتخاب", "موازی", "پیوستن"]],
      ["دیگر", ["انتظار", "اعلان", "جریان خودکار", "تعیین مقدار", "پایان"]],
    ]);
    expect(PALETTE_ITEMS.some((i) => i.type === "trigger")).toBe(false);
    expect(itemConfig(paletteItem("approve")!)).toMatchObject({ action: "approve", quorum: "any", form: null, assignees: [] });
    expect(itemConfig(paletteItem("review")!)).toMatchObject({ action: "review" });
    expect(itemConfig(paletteItem("fill")!)).toMatchObject({ action: "fill" });
    expect(itemConfig(paletteItem("branch")!)).toMatchObject({ mode: "data" });
  });

  it("after a step: on its free way on; between it and the step it led to; a branch of «موازی»; unconnected below the rest", () => {
    let g = startGraph();
    const first = insertAfter(g, "request", paletteItem("approve")!);
    g = first.graph;
    expect(targets(g, "request")).toEqual([first.id]);
    expect(node(g, first.id).position!.y).toBe(node(g, "request").position!.y + GAP_Y);
    // between: request → fill → approve; the steps below move down a rank
    const before = node(g, first.id).position!.y;
    const mid = insertAfter(g, "request", paletteItem("fill")!);
    expect(targets(mid.graph, "request")).toEqual([mid.id]);
    expect(targets(mid.graph, mid.id)).toEqual([first.id]);
    expect(node(mid.graph, first.id).position!.y).toBe(before + GAP_Y);
    // «موازی» put between keeps the way on as its first branch, and gains a branch each time
    const par = insertAfter(mid.graph, mid.id, paletteItem("parallel")!);
    expect(targets(par.graph, mid.id)).toEqual([par.id]);
    expect(targets(par.graph, par.id, "out")).toEqual([first.id]);
    const b1 = insertAfter(par.graph, par.id, paletteItem("fill")!);
    const b2 = insertAfter(b1.graph, par.id, paletteItem("review")!);
    expect(targets(b2.graph, par.id, "out").sort()).toEqual([first.id, b1.id, b2.id].sort());
    // a «پایان» goes on nowhere; without a step chosen the new one is unconnected
    const end = insertAfter(startGraph(), null, paletteItem("end")!);
    expect(end.graph.edges).toHaveLength(1);
    expect(mainPort(node(end.graph, end.id))).toBeNull();
    // a drop keeps its own position
    expect(node(insertAfter(startGraph(), null, paletteItem("notify")!, { position: { x: 7, y: 9 } }).graph, "notify1").position).toEqual({ x: 7, y: 9 });
  });

  it("a new approval's «رد شد» leads to the process's «پایان (ردشده)»; a new step on a way out", () => {
    let g = startGraph();
    const a1 = insertAfter(g, "request", paletteItem("approve")!);
    g = a1.graph;
    expect(targets(g, a1.id, "rejected")).toEqual([]);
    const no = addFromPort(g, a1.id, "rejected", newStepOf("new:end:rejected")!.item, { label: END_PRESETS[1].label, config: { outcome: "rejected" } });
    g = no.graph;
    expect(node(g, no.id)).toMatchObject({ type: "end", label: "پایان (ردشده)", config: { outcome: "rejected" } });
    expect(targets(g, a1.id, "rejected")).toEqual([no.id]);
    const a2 = insertAfter(g, a1.id, paletteItem("approve")!);
    expect(targets(a2.graph, a2.id, "rejected")).toEqual([no.id]);
    expect(wireRejection(a2.graph, "request")).toBe(a2.graph);
    expect(NEW_STEP_OPTIONS.map((o) => newStepOf(o.value)?.item.key)).toEqual(["end", "end", "fill", "approve", "review", "branch"]);
    expect(newStepOf("t1")).toBeNull();
  });

  it("«مسیرها»: each way out with where it leads and may lead; re-pointing, a «بازگشت» only back on its branch, a branch taken off", () => {
    let g = startGraph();
    const a = insertAfter(g, "request", paletteItem("approve")!);
    g = a.graph;
    const ok = insertAfter(g, a.id, paletteItem("end")!);
    g = ok.graph;
    const rows = portRows(g, a.id);
    expect(rows.map((r) => r.port.key)).toEqual(["approved", "rejected", "returned", "timeout"]);
    expect(rows[0].targets).toEqual([ok.id]);
    expect(rows.find((r) => r.port.key === "returned")!.options.map((o) => o.value)).toEqual(["request"]);
    g = setPortTarget(g, a.id, "returned", "request");
    expect(targets(g, a.id, "returned")).toEqual(["request"]);
    // a «بازگشت» cannot go forward, nor anything make a cycle
    expect(setPortTarget(g, a.id, "returned", ok.id)).toBe(g);
    g = setPortTarget(g, a.id, "rejected", ok.id);
    expect(targets(g, a.id, "rejected")).toEqual([ok.id]);
    g = setPortTarget(g, a.id, "rejected", null);
    expect(targets(g, a.id, "rejected")).toEqual([]);
    // titles in the lists are unique
    const twice = insertAfter(g, null, paletteItem("approve")!).graph;
    expect([...stepTitles(twice).values()].filter((t) => t.startsWith("تأیید"))).toEqual(["تأیید", "تأیید (۲)"]);
  });

  it("removing a step reconnects its one way in to its one way on; «آغاز» stays", () => {
    let g = startGraph();
    const a = insertAfter(g, "request", paletteItem("fill")!);
    const b = insertAfter(a.graph, a.id, paletteItem("end")!);
    g = removeNode(b.graph, a.id);
    expect(targets(g, "request")).toEqual([b.id]);
    expect(removeNode(g, "start").nodes).toHaveLength(g.nodes.length);
    // an approval with two ways on is not bridged
    const ap = insertAfter(startGraph(), "request", paletteItem("approve")!);
    const okEnd = insertAfter(ap.graph, ap.id, paletteItem("end")!);
    const noEnd = addFromPort(okEnd.graph, ap.id, "rejected", paletteItem("end")!);
    expect(targets(removeNode(noEnd.graph, ap.id), "request")).toEqual([]);
    // the canvas's own delete is bridged the same way
    expect(targets(bridgeRemoved(b.graph, { ...b.graph, nodes: b.graph.nodes.filter((n) => n.id !== a.id), edges: b.graph.edges.filter((e) => e.source !== a.id && e.target !== a.id) }), "request")).toEqual([b.id]);
  });

  it("an action changes keep the way on («بعدی» ↔ «تأیید شد») and drop what the new action lacks", () => {
    let g = startGraph();
    const s = insertAfter(g, "request", paletteItem("fill")!);
    const end = insertAfter(s.graph, s.id, paletteItem("end")!);
    const no = insertAfter(end.graph, null, paletteItem("end")!, { config: { outcome: "rejected" } });
    g = no.graph;
    g = setAction(g, s.id, "approve");
    expect(formStepOf(node(g, s.id).config)).toMatchObject({ action: "approve", quorum: "any" });
    expect(targets(g, s.id, "approved")).toEqual([end.id]);
    expect(targets(g, s.id, "rejected")).toEqual([no.id]);
    g = setPortTarget(g, s.id, "returned", "request");
    g = patchConfig(g, s.id, { escalate: [newEscalation("auto", "approve")] });
    expect(formStepOf(node(g, s.id).config).escalate![0]).toMatchObject({ action: "auto", outcome: "approved" });
    g = setAction(g, s.id, "review");
    expect(targets(g, s.id)).toEqual([end.id]);
    expect(targets(g, s.id, "returned")).toEqual(["request"]);
    expect(targets(g, s.id, "rejected")).toEqual([]);
    expect(node(g, s.id).config).not.toHaveProperty("quorum");
    expect(formStepOf(node(g, s.id).config).escalate ?? []).toEqual([]);
    g = setAction(g, s.id, "fill");
    expect(targets(g, s.id, "returned")).toEqual([]);
    // the start step keeps its action
    expect(setAction(g, "request", "approve")).toBe(g);
  });

  it("the people an earlier step may name are the steps every path passes; joins and «انتخاب» cases", () => {
    let g = startGraph();
    const a = insertAfter(g, "request", paletteItem("approve")!);
    const par = insertAfter(a.graph, a.id, paletteItem("parallel")!);
    const b1 = insertAfter(par.graph, par.id, paletteItem("fill")!);
    const b2 = insertAfter(b1.graph, par.id, paletteItem("fill")!);
    g = b2.graph;
    expect(earlierSteps(g, b2.id).map((s) => s.id)).toEqual(["request", a.id]);
    expect(joinPatch("any")).toEqual({ mode: "any", cancel_rest: true });
    expect(joinPatch("all")).toEqual({ mode: "all", cancel_rest: undefined });
    const ch = insertAfter(g, b1.id, paletteItem("choice")!);
    const cases = [{ key: newCaseKey([]), label: "کم", rules: [] }, { key: "c2", label: "زیاد ", rules: [] }];
    let h = setCases(ch.graph, ch.id, cases);
    expect(rawCases(node(h, ch.id).config).map((c) => c.label)).toEqual(["کم", "زیاد "]);
    expect(newCaseKey(cases)).toBe("c3");
    const end = insertAfter(h, null, paletteItem("end")!);
    h = setPortTarget(end.graph, ch.id, "c1", end.id);
    expect(targets(h, ch.id, "c1")).toEqual([end.id]);
    // a case taken out takes its connections
    expect(outEdges(setCases(h, ch.id, [cases[1]]), ch.id, "c1")).toEqual([]);
  });
});

describe("the case's values: conditions, the title, what the requester reads", () => {
  it("every field of the process's forms once, with the type and target the people rules read", () => {
    const fields = caseFields([REQ, REVIEW]);
    expect(fields.map((x) => x.name)).toEqual(["u_amount", "u_need", "u_branch", "u_owner", "u_kind", "u_note"]);
    expect(fields[0].forms).toEqual(["فرم درخواست", "فرم بررسی"]);
    expect(fields.find((x) => x.name === "u_branch")).toMatchObject({ type: "ref", ref: "org_unit" });
    expect(fields.find((x) => x.name === "u_kind")!.options.map((o) => o.value)).toEqual(["a", "b"]);
    const a = insertAfter(startGraph(), "request", paletteItem("approve")!);
    expect(a.id).toBe("formStep1");
    expect(graphForms(patchConfig(a.graph, a.id, { form: REVIEW.id }))).toEqual([REQ.id, REVIEW.id]);
  });

  it("a comparison names a value by its pill; amounts are typed in the organisation's unit and kept in Rial", () => {
    expect(casePill("u_amount")).toBe("{{case.u_amount}}");
    expect(pillField(" {{ case.u_amount }} ")).toBe("u_amount");
    expect(pillField("{{case.u_amount}} + 1")).toBeNull();
    expect(caseRules([{ left: "{{case.u_amount}}", op: "gt", right: 500000000 }, "x"])).toEqual([{ left: "{{case.u_amount}}", op: "gt", right: "500000000" }]);
    // «۵۰ میلیون تومان» is 500,000,000 Rial
    expect(rialFromInput("50000000", "toman")).toBe("500000000");
    expect(unitFromRial("500000000", "toman")).toBe("50000000");
    expect(unitFromRial("500000005", "toman")).toBe("50000000.5");
    expect(unitFromRial("500000000", "rial")).toBe("500000000");
  });

  it("the title names the start form's fields and the requester; its sample; a pill goes in at the caret", () => {
    const g = startGraph();
    const forms = new Map([[REQ.id, REQ]]);
    expect(titleFields(g, forms).map((x) => x.name)).toEqual(["u_amount", "u_need", "u_branch", "requested_by", "requested_for"]);
    const labels = new Map(titleFields(g, forms).map((x) => [x.name, x.label]));
    expect(titleSample("تنخواه {{case.u_branch}} — {{case.u_amount}}", (k) => labels.get(k), "درخواست تنخواه")).toBe("تنخواه «شعبه» — «مبلغ درخواستی»");
    expect(titleSample(null, () => undefined, "درخواست تنخواه")).toBe("درخواست تنخواه");
    expect(insertText("تنخواه ", 7, 7, "{{case.u_amount}}")).toEqual({ value: "تنخواه {{case.u_amount}}", caret: 24 });
    expect(insertText("ab", 1, 2, "X")).toEqual({ value: "aX", caret: 2 });
    // what the requester may read beyond the start form
    expect(requesterViewOptions(caseFields([REQ, REVIEW]), startFields(g, forms)).map((x) => x.name)).toEqual(["u_owner", "u_kind", "u_note"]);
    expect(startersText([])).toContain("همهٔ اعضای سازمان");
  });
});

describe("notices, problems, versions, the preview", () => {
  it("a step's messages: the seeded rules it calls for and its timers'; a «پایان» tells the requester", () => {
    let g = startGraph();
    const a = insertAfter(g, "request", paletteItem("approve")!);
    g = setPortTarget(a.graph, a.id, "returned", "request");
    expect(stepNotices(g, "request").map((x) => x.name)).toEqual(["پرونده برای اصلاح به شما بازگشت"]);
    expect(stepNotices(g, a.id).map((x) => [x.name, x.rule])).toEqual([["مرحله‌ای منتظر شماست", true], ["مرحلهٔ بی‌انجام‌دهنده", true]]);
    g = patchConfig(g, a.id, { due: { amount: 1, unit: "day" }, remind_every: { amount: 4, unit: "hour" }, ifNobody: "skip" });
    expect(stepNotices(g, a.id).map((x) => [x.name, x.rule])).toEqual([["مرحله‌ای منتظر شماست", true], ["یادآوری مرحله", false], ["مهلت گذشت", false]]);
    expect(stepNotices(g, a.id)[1].when).toContain("۴ ساعت");
    const no = insertAfter(g, null, paletteItem("end")!, { config: { outcome: "rejected" } });
    expect(stepNotices(no.graph, no.id)).toEqual([{ name: "گردش‌کار شما رد شد", when: "به درخواست‌دهنده، وقتی پرونده به این پایان می‌رسد", rule: true }]);
  });

  it("the server's problems stay while their step or setting is as it was saved; the live check's always show", () => {
    const g = insertAfter(startGraph(), "request", paletteItem("approve")!).graph;
    const saved = draftOf(g, { managers: [] });
    const server: FlowProblem[] = [
      { level: "error", message: "نقش سازمانی «x» پیدا نشد", node: "formStep1", field: "assignees" },
      { level: "warning", message: "این گردش‌کار مسئولی ندارد", field: "managers" },
      { level: "warning", message: "هشدار کلی" },
    ];
    expect(liveProblems([], server, saved, saved)).toEqual(server);
    // the step changed: its server problems wait for the next save; a label typed counts as a change
    const now = draftOf(setLabel(g, "formStep1", "تأیید رئیس"), { managers: [] });
    expect(liveProblems([], server, saved, now).map((p) => p.message)).toEqual(["این گردش‌کار مسئولی ندارد"]);
    // a position moved is no change
    const moved = draftOf({ ...g, nodes: g.nodes.map((n) => ({ ...n, position: { x: 1, y: 1 } })) });
    expect(liveProblems([], server, saved, moved)).toHaveLength(3);
    // the managers set: their warning goes
    expect(liveProblems([], server, saved, draftOf(g, { managers: ["0193a1b2-0000-7000-8000-000000000001"] })).map((p) => p.message)).toEqual(["نقش سازمانی «x» پیدا نشد", "هشدار کلی"]);
    // the live check is always there, once
    const local: FlowProblem[] = [{ level: "error", message: "این مرحله انجام‌دهنده ندارد", node: "formStep1", field: "assignees" }];
    expect(liveProblems(local, [...local, ...server], saved, saved).filter((p) => p.message === local[0].message)).toHaveLength(1);
  });

  it("where a problem is fixed: the step and its tab, or the settings; the drawer's groups; the toolbar's words", () => {
    expect(problemTarget({ node: "a", field: "assignees" })).toEqual({ node: "a", tab: "people", settings: false });
    expect(problemTarget({ node: "a", field: "form" }).tab).toBe("form");
    expect(problemTarget({ node: "a", field: "escalate" }).tab).toBe("time");
    expect(problemTarget({ node: "a" }).tab).toBeNull();
    expect(problemTarget({ field: "starters" })).toEqual({ node: null, tab: null, settings: true });
    const g = insertAfter(startGraph(), "request", paletteItem("approve")!).graph;
    const problems = validateProcess(g, { forms: (id) => (id === REQ.id ? REQ : undefined), fields: FIELDS });
    expect(countProblems(problems).errors).toBeGreaterThan(0);
    const groups = problemGroups([...problems, { level: "warning", message: "کلی" }], g);
    expect(groups[0]).toMatchObject({ node: null, title: "گردش‌کار" });
    expect(groups.find((x) => x.node === "formStep1")!.items.map((p) => p.message)).toContain("این مرحله انجام‌دهنده ندارد");
    expect(tabProblems(problems.filter((p) => p.node === "formStep1"))).toMatchObject({ people: 1, form: 1 });
    expect(problemsText([{ level: "error", message: "a" }, { level: "error", message: "b" }, { level: "warning", message: "c" }])).toBe("۲ ایراد، ۱ هشدار");
    expect(problemsText([])).toBe("");
    expect(phoneNotes(problems).formStep1).toMatch(/^[۰-۹]+ ایراد: /);
  });

  it("«نسخه‌ها»: the version's title and who published it when", () => {
    expect(versionTitle({ version_no: 3 })).toBe("نسخهٔ ۳");
    expect(versionMeta({ published_at: "2026-11-14T06:30:00Z", published_by: "u1" }, { u1: "پرویز" }, "Asia/Tehran")).toBe("۱۴۰۵/۰۸/۲۳ ۱۰:۰۰، پرویز");
    expect(versionMeta({ published_at: null, published_by: null }, {})).toBe("");
  });

  it("«پیش‌نمایش»: the steps after the start in order; what resolve is asked; the line a step shows", () => {
    let g = startGraph();
    const a = insertAfter(g, "request", paletteItem("approve")!);
    const b = insertAfter(a.graph, a.id, paletteItem("fill")!);
    g = patchConfig(b.graph, a.id, assigneesPatch({ assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }] }));
    expect(previewSteps(g).map((n) => n.id)).toEqual([a.id, b.id]);
    // a step that names nobody is not asked about: the preview says so in resolve's own words
    expect(previewBlocked(node(g, a.id))).toBeNull();
    expect(previewBlocked(node(g, b.id))).toBe("این مرحله انجام‌دهنده ندارد");
    const body = resolveBody(node(g, a.id), { requester: "r1", values: { u_amount: "600000000" }, fields: caseFields([REQ]), draft: { managers: ["m1"], manager_groups: [] }, stepActors: { request: ["r1"] }, previous: "r1" });
    expect(body).toMatchObject({ action: "approve", quorum: "any", label: "تأیید", requester: "r1", step: { assignees: [{ kind: "position", position: "branch_head" }] }, managers: ["m1"], step_actors: { request: ["r1"] } });
    expect(body.fields!.u_branch).toEqual({ type: "ref", ref: "org_unit", label: "شعبه" });
    const r = (p: Partial<ResolveResult>): ResolveResult => ({ status: "ok", people: [], found: 0, limit: 100, fallbackUsed: false, notes: [], message: null, warnings: [], lines: [], display: { users: {}, positions: {}, units: {}, groups: {} }, ...p });
    expect(previewNote(r({ lines: ["علی احمدی — رئیس شعبه (شعبهٔ ونک)"] }))).toBe("علی احمدی — رئیس شعبه (شعبهٔ ونک)");
    expect(previewNote(r({ lines: ["الف", "ب", "پ"] }))).toBe("الف و ۲ نفر دیگر");
    expect(previewNote(r({ status: "nobody", message: "برای «تأیید» کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند." }))).toContain("کسی پیدا نشد");
    expect(previewNote(r({}))).toBe("کسی پیدا نشد");
    expect(resolvedPeople(r({ people: [{ user: "u1", delegatedFrom: null, via: { kind: "users" } }, { user: "u1", delegatedFrom: null, via: { kind: "group" } }] }))).toEqual(["u1"]);
  });

  it("forms for a step: the process forms by name; a new form starts the step's rights afresh", () => {
    expect(processForms([{ kind: "system", id: null, name: "رخداد" }, { kind: "process", id: "2", name: "ب", status: "published" }, { kind: "process", id: "1", name: "الف" }])).toEqual([
      { id: "1", name: "الف", status: "draft" },
      { id: "2", name: "ب", status: "published" },
    ]);
    expect(formPatch({ form: "x", rights: { default: "edit", fields: { u_a: "required" } } }, "y")).toEqual({ form: "y", rights: { default: "edit", fields: {} } });
    const info = formInfoOf({ form: { id: "f", name: "فرم", layout: REQ.layout }, fields: { u_amount: { label: "مبلغ", def: FIELDS.u_amount }, u_gone: { label: "رفته", def: null } } });
    expect(Object.keys(info.fields)).toEqual(["u_amount"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// «چه کسانی آغاز می‌کنند»

describe("who may start a process", () => {
  // a head of the Vanak branch: a position held in a unit, a group, an access role
  const me: PersonFacts = { user: "u-head", positions: [{ position: "branch_head", unit: "unit-vanak" }], groups: ["g-heads"], roles: ["agent"] };
  const starts = (rule: AssigneeRule) => mayInclude({ assignees: [rule] }, "fill", me);

  it("offers only rules «شروع» can answer before any case exists: my positions (anywhere or in a fixed unit), groups, roles, named people", () => {
    expect(starts({ kind: "position", position: "branch_head", where: "anywhere" })).toBe(true);
    expect(starts({ kind: "position", position: "branch_head", where: "unit", unit: "unit-vanak" })).toBe(true);
    expect(starts({ kind: "group", group: "g-heads" })).toBe(true);
    expect(starts({ kind: "role", role: "agent" })).toBe(true);
    expect(starts({ kind: "users", users: ["u-head"] })).toBe(true);
    expect(STARTER_SCOPE.kinds).toEqual(["position", "group", "role", "users"]);
    // a new position rule starts at «همه‌جا», not at the requester's unit there is none of yet
    expect(scopedRule("position", STARTER_SCOPE)).toMatchObject({ kind: "position", where: "anywhere" });
  });

  it("leaves out every rule that depends on a case: the draft check passes it, and nobody could ever start (the review's case)", () => {
    const filled: Partial<Record<string, Partial<AssigneeRule>>> = { field: { field: "u_who" }, step_actor: { step: "s" } };
    const left = ASSIGNEE_KINDS.filter((k) => !STARTER_SCOPE.kinds!.includes(k));
    expect(left).toEqual(["manager", "unit_head", "field", "step_actor", "requester"]);
    for (const k of left) {
      const rule = { ...newRule(k), ...filled[k] } as AssigneeRule;
      expect(assigneeProblems({ assignees: [rule] }), k).toEqual([]);
      expect(starts(rule), k).toBe(false);
      expect(ruleInScope(rule, STARTER_SCOPE), k).toBe(false);
    }
    expect(ruleInScope({ kind: "position", position: "branch_head", where: "requester_unit" }, STARTER_SCOPE)).toBe(false);
  });

  it("«فقط این نقش‌ها و افراد» with no rule says it still means every member; rules that find nobody say so", () => {
    expect(startersNote([], true)).toMatch(/همهٔ اعضای سازمان/);
    expect(startersNote([], false)).toBeNull();
    expect(startersNote([{ kind: "users", users: ["u-head"] }], true)).toBeNull();
    expect(startersNote([{ kind: "manager", of: "requester" }], true)).toMatch(/کسی این گردش‌کار را آغاز نمی‌کند/);
    expect(startersNote([{ kind: "manager", of: "requester" }, { kind: "users", users: ["u-head"] }], true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The bank of §3.7 on a real organisation

describe("the designer on a real organisation (§3.7)", () => {
  let b: Bank;
  let P = "";
  let api: OrgApi;
  let id = "";
  let built: ProcessDraft;
  let detail: ProcessDetail;
  const names: Record<string, string> = {};

  beforeAll(async () => {
    b = await bank();
    P = b.w.P;
    api = orgApiOf(b.w.o.owner, P);
  }, 900_000);

  it("an administrator builds «درخواست تنخواهِ شعبه» with the designer's own moves — no JSON — and saves it without an error", async () => {
    const made = await hubApi.create(api, { name: "درخواست تنخواهِ شعبه", key: "petty_cash_ui", category: "مالی" });
    id = made.process.id;
    detail = await designerApi.detail(api, id);
    const d = designerDraft(detail);
    let g = d.draft.graph;
    const F = b.w.forms;
    // «ثبت درخواست» fills «فرم درخواست»
    const start = startOf(g).start!.id;
    g = patchConfig(g, start, formPatch(node(g, start).config, F.req));
    // «تأیید رئیس شعبه»: the head of the requester's branch, one day, escalated after two to the role above
    let r = insertAfter(g, start, paletteItem("approve")!);
    const head = r.id;
    g = setLabel(r.graph, head, "تأیید رئیس شعبه");
    g = patchConfig(g, head, formPatch(node(g, head).config, F.review));
    g = patchConfig(g, head, assigneesPatch({ assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }] }));
    g = patchConfig(g, head, { due: { amount: 1, unit: "day" }, escalate: [{ ...newEscalation("notify", "approve"), to: "reports_to" }] });
    // its rejection ends the case; its return goes back to the requester
    const made2 = newStepOf(`new:${END_PRESETS[1].key}`)!;
    r = addFromPort(g, head, "rejected", made2.item, { label: made2.label, config: { ...itemConfig(made2.item), ...made2.config } });
    const no = r.id;
    g = setPortTarget(r.graph, head, "returned", start);
    // the condition on the amount: over 50 million Toman
    r = insertAfter(g, head, paletteItem("branch")!);
    const cond = r.id;
    g = setLabel(r.graph, cond, "شرط مبلغ");
    g = patchConfig(g, cond, { mode: "data", rules: [{ left: casePill("u_amount"), op: "gt", right: rialFromInput("50000000", "toman") }] });
    // yes: the finance deputy's approval, two named deputies; its rejection is wired to the same end at once
    r = insertAfter(g, cond, paletteItem("approve")!);
    const deputy = r.id;
    g = setLabel(r.graph, deputy, "تأیید معاونت مالی");
    g = patchConfig(g, deputy, formPatch(node(g, deputy).config, F.review));
    g = patchConfig(g, deputy, assigneesPatch({ assignees: [{ kind: "position", position: "finance_deputy", where: "anywhere", members: [b.X.fd1, b.X.fd2] }] }));
    expect(targets(g, deputy, "rejected")).toEqual([no]);
    g = setPortTarget(g, deputy, "returned", start);
    // review and payment by «امور مالی», with «نظر مالی» required; no: straight to it
    r = insertAfter(g, deputy, paletteItem("fill")!);
    const pay = r.id;
    g = setLabel(r.graph, pay, "بررسی و پرداخت");
    g = patchConfig(g, pay, formPatch(node(g, pay).config, F.review));
    g = patchConfig(g, pay, assigneesPatch({ assignees: [{ kind: "group", group: b.financeGroup }] }));
    g = patchConfig(g, pay, { rights: setFieldRight(formStepOf(node(g, pay).config).rights, "u_finance_note", "required") });
    g = setPortTarget(g, cond, "no", pay);
    r = insertAfter(g, pay, paletteItem("end")!, { label: "پایان (انجام‌شده)" });
    g = r.graph;
    // the settings: managers, starters, the title
    built = {
      ...d.draft,
      graph: g,
      managers: [b.M.mgr.userId],
      starters: [{ kind: "position", position: "branch_staff", where: "anywhere" }, { kind: "position", position: "branch_deputy", where: "anywhere" }],
      title_template: `تنخواه ${casePill("u_branch")} — ${casePill("u_amount")}`,
    };
    Object.assign(names, { start, head, no, cond, deputy, pay });

    // the same wiring as the engine's reference draft (tests/process-api-helpers.ts)
    expect(wiring(g)).toEqual(
      [
        "آغاز|out|ثبت درخواست", "ثبت درخواست|out|تأیید رئیس شعبه",
        "تأیید رئیس شعبه|approved|شرط مبلغ", "تأیید رئیس شعبه|rejected|پایان (ردشده)", "تأیید رئیس شعبه|returned|ثبت درخواست",
        "شرط مبلغ|yes|تأیید معاونت مالی", "شرط مبلغ|no|بررسی و پرداخت",
        "تأیید معاونت مالی|approved|بررسی و پرداخت", "تأیید معاونت مالی|rejected|پایان (ردشده)", "تأیید معاونت مالی|returned|ثبت درخواست",
        "بررسی و پرداخت|out|پایان (انجام‌شده)",
      ].sort(),
    );

    const patch = savePatch(detail, { ...d, draft: built })!;
    expect(patch.version).toBe(detail.process.version);
    detail = await designerApi.save(api, id, patch);
    expect(detail.problems.filter((p) => p.level === "error")).toEqual([]);
    // the server keeps what the designer sent: nothing left to save
    expect(savePatch(detail, { ...d, draft: built })).toBeNull();
    // the designer's live check, with the forms as the designer loads them, agrees: no error
    const forms = new Map<string, FormInfo>();
    for (const fid of graphForms(g)) forms.set(fid, formInfoOf(await b.w.o.owner.get(`${P}/forms/${fid}`)));
    const defs = Object.assign({}, ...[...forms.values()].map((x) => x.fields));
    expect(validateProcess(g, { forms: (fid) => forms.get(fid), fields: defs, titleTemplate: built.title_template }).filter((p) => p.level === "error")).toEqual([]);
  });

  it("a save from an older version is refused, so two designers never overwrite each other unseen", async () => {
    const stale = { ...detail, process: { ...detail.process, version: detail.process.version - 1 } };
    const changed = { ...designerDraft(detail), draft: { ...built, graph: setLabel(built.graph, names.pay, "پرداخت") } };
    const r = await b.w.o.owner.put(`${P}/process/defs/${id}/draft`, savePatch(stale, changed), 409);
    expect(r.error.code).toBe("version_conflict");
    expect((await designerApi.detail(api, id)).process.version).toBe(detail.process.version);
  });

  it("«پیش‌نمایش»: for a clerk of the Vanak branch, each step's people by the same resolver the step runs", async () => {
    const fields = caseFields(await Promise.all(graphForms(built.graph).map(async (fid) => formInfoOf(await b.w.o.owner.get(`${P}/forms/${fid}`)))));
    const actors: Record<string, string[]> = { [names.start]: [b.M.clerk.userId] };
    const found: Record<string, ResolveResult> = {};
    let previous: string | null = b.M.clerk.userId;
    for (const n of previewSteps(built.graph)) {
      const res = await designerApi.resolve(api, resolveBody(n, { requester: b.M.clerk.userId, values: { u_amount: "600000000" }, fields, draft: built, stepActors: actors, previous }));
      found[n.id] = res;
      actors[n.id] = resolvedPeople(res);
      previous = actors[n.id][0] ?? previous;
    }
    expect(previewSteps(built.graph).map((n) => n.id)).toEqual([names.head, names.deputy, names.pay]);
    expect(previewNote(found[names.head])).toBe("حسین رئیس شعبه — رئیس شعبه (شعبهٔ ونک)");
    expect(found[names.deputy].people.map((p) => p.user).sort()).toEqual([b.X.fd1, b.X.fd2].sort());
    expect(previewNote(found[names.deputy])).toMatch(/ و ۱ نفر دیگر$/);
    expect(found[names.pay].people.map((p) => p.user).sort()).toEqual([b.X.pay1, b.X.pay2].sort());
    // the words the preview shows without asking are the very ones resolve refuses a step without people with
    const pay = node(built.graph, names.pay);
    const nobody = { ...pay, config: { ...pay.config, assignees: [] } };
    const refused = await b.w.o.owner.post(`${P}/positions/resolve`, resolveBody(nobody, { requester: b.M.clerk.userId, values: {}, fields, draft: built, stepActors: actors, previous }), 400);
    expect(refused.error.message).toBe(previewBlocked(nobody));
  });

  it("publish shows the diff with the access settings; «نسخه‌ها» lists it; a restore brings it back to the draft", async () => {
    const pre = await hubApi.diff(api, id);
    expect(pre.diff.first).toBe(true);
    expect(pre.diff.access).toEqual(["مسئولان: + مینا مسئول تنخواه"]);
    expect(publishVerdict(pre, { canPublish: true, authority: true, retired: false }).ok).toBe(true);
    expect((await hubApi.publish(api, id, "نخستین انتشار")).version.version_no).toBe(1);
    detail = await designerApi.detail(api, id);
    expect(detail.process).toMatchObject({ status: "published", version_no: 1 });
    expect(statusChip(detail.process).label).toBe("منتشرشده، نسخهٔ ۱");
    expect(detail.unpublished).toBe(false);

    // a change: renamed step, confidential with its managers
    const d = designerDraft(detail);
    const next = { ...d, draft: { ...d.draft, graph: setLabel(d.draft.graph, names.pay, "پرداخت"), confidential: true } };
    detail = await designerApi.save(api, id, savePatch(detail, next)!);
    expect(detail.unpublished).toBe(true);
    const diff = await hubApi.diff(api, id);
    expect(diff.diff.changes).toContain("نام مرحلهٔ «بررسی و پرداخت» به «پرداخت» تغییر کرد");
    expect(diff.diff.access).toEqual(["محرمانه: روشن"]);

    const v = await designerApi.versions(api, id);
    expect(v.versions).toHaveLength(1);
    expect(v.versions[0]).toMatchObject({ version_no: 1, note: "نخستین انتشار", current: true, diff: { first: true } });
    expect(versionMeta(v.versions[0], v.display)).toContain(v.display[v.versions[0].published_by!]);

    const restored = await designerApi.restore(api, id, v.versions[0].id);
    const back = designerDraft(restored);
    expect(processNodeLabel(node(back.draft.graph, names.pay))).toBe("بررسی و پرداخت");
    expect(back.draft.confidential).toBe(false);
    // nothing to save after a restore: the designer starts from what the server holds
    expect(savePatch(restored, back)).toBeNull();
    expect(restored.unpublished).toBe(false);
  });

  it("a designer edits and previews but does not publish; a publisher publishes but neither edits nor previews; a requester has no designer", async () => {
    const des = b.M.designer;
    const dp = await probeOf(des.client, P);
    expect(designerAccess(dp)).toEqual({ read: true, preview: true });
    const dd = await designerApi.detail(orgApiOf(des.client, P), id);
    expect(dd.can).toMatchObject({ write: true, publish: false });
    expect(designerOffers(dd, { writable: true, phone: false, authority: true, preview: true })).toMatchObject({ edit: true, publish: false, preview: true });
    const head = node(built.graph, names.head);
    await des.client.post(`${P}/positions/resolve`, resolveBody(head, { requester: b.M.clerk.userId, values: {}, fields: [], draft: built, stepActors: {}, previous: null }));

    const pub = b.M.publisher;
    const pp = await probeOf(pub.client, P);
    expect(designerAccess(pp)).toEqual({ read: true, preview: false });
    const pd = await designerApi.detail(orgApiOf(pub.client, P), id);
    expect(pd.can).toMatchObject({ write: false, publish: true });
    expect(designerOffers(pd, { writable: true, phone: false, authority: true, preview: false })).toMatchObject({ edit: false, publish: true, retire: true, preview: false });
    // F3's rule behind the hidden «پیش‌نمایش»
    await pub.client.post(`${P}/positions/resolve`, resolveBody(head, { requester: b.M.clerk.userId, values: {}, fields: [], draft: built, stepActors: {}, previous: null }), 403);

    const clerk = b.M.clerk;
    expect(designerAccess(await probeOf(clerk.client, P)).read).toBe(false);
    await clerk.client.get(`${P}/process/defs/${id}`, 403);
  });
});

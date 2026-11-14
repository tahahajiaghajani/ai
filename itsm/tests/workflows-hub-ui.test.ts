// «گردش‌کارها» and the lifecycle editor (design F §4, §8.3, §8.5, package F6 part a; src/ui/modules/workflows/admin/
// {hub,lifecycle}): who is offered the hub and where it lives in the menu, its kinds, search and rows (the default
// lifecycles folded in «همه»), each row's words and the editor it opens, a new process's key, what the publish dialog
// allows and says, the retire line, a linked Windows app; the lifecycle editor's draft, the overlay it saves (labels
// only for change requests), what differs from the module's default, F1's own problems and the preview — and the
// same calls on a real organisation: the hub's nine kinds with every row opening a route the UI registers, a process
// made, refused publishing with its errors, published, retired and published again; a designer reading the hub
// without publishing; a lifecycle saved from the editor's draft and back to the module's, refused for the reasons the
// editor shows, and the change requests' labels-only lifecycle.
import { describe, it, expect, beforeAll } from "vitest";
import { composeEffective, gateAllows, roleCatalog, type AccessGate, type FullGrant } from "@shared/access";
import { LEVEL_ORDER, type Level } from "@shared/permissions";
import { tableDef } from "@shared/tables";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import type { TableDef } from "@shared/model/types";
import { seedChangeDefaults } from "@server/modules/change";
import { seedRequestDefaults } from "@server/modules/request";
import { seedEsmDefaults } from "@server/modules/esm";
import { seedSecurityDefaults } from "@server/modules/security";
import { NAV, ROUTES } from "../src/ui/modules/registry";
import { hubPart } from "../src/ui/modules/workflows/admin/hub/routes";
import { lifecyclePart } from "../src/ui/modules/workflows/admin/lifecycle/routes";
import { hubApi, type DiffPreview, type Hub, type HubRow } from "../src/ui/modules/workflows/admin/hub/api";
import {
  CONNECTION_NEEDED, DEFAULT_LIFECYCLE, HUB_GATE, KIND_ORDER, KIND_SHORT, NO_CHANGE, PUBLISH_REFUSAL, authorityHere, categoryText, designerPath, editableText, fieldErrors,
  filterRows, hubAccess, keyProblem, kindOf, lifecyclePath, listRows, moreText, newProcessBody, newProcessProblems, ownerIds, processActions, processCategories, processTarget,
  publishVerdict, publishedText, retireText, roleLine, routeMatches, rowLink, statusView, suggestKey, visibleRules, whereText, KEY_RE,
} from "../src/ui/modules/workflows/admin/hub/model";
import { lifecycleApi, type LifecycleView } from "../src/ui/modules/workflows/admin/lifecycle/api";
import {
  LIFECYCLE_REFUSAL, channel, defaultDraft, draftDiff, draftOf, draftProblems, isDefault, isDirty, lifecycleAccess, overlayOf, previewButtons, requirableFields, scopeChip,
  setPrimary, setState, setTransition, summaryText, transitionPath, type DiffNames,
} from "../src/ui/modules/workflows/admin/lifecycle/model";
import type { OrgApi } from "../src/ui/lib/api";
import type { TableMeta } from "../src/ui/records/model/types";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";

// ---------------------------------------------------------------------------------------------------------------
// helpers

const catalog = roleCatalog([]);
const grantsOf = (...roles: string[]) => composeEffective({ role: "member", levels: { work: "edit" }, explicit: roles, catalog }).grants;
const DESIGNER: Record<string, FullGrant> = { [PROCESS_DESIGN_AREA]: { read: "all", create: true, write: "all", delete: "none", approve: false, admin: false } };
const probe = (grants: Record<string, FullGrant>, settings: Level = "view", writable = true) => ({
  can: (_: "settings", level: Level) => LEVEL_ORDER.indexOf(settings) >= LEVEL_ORDER.indexOf(level),
  allows: (g: AccessGate) => gateAllows(grants, g),
  writable,
});
const ROUTE_PATHS = ROUTES.map((r) => r.path);
const routed = (path: string) => routeMatches(ROUTE_PATHS, path);
const NO_DOT_BEFORE_DIGIT = /·\s*[۰-۹0-9]/;
/** The calls that answer 201 Created (the browser's client takes any 2xx). */
const CREATED = /^\/process\/defs$/;
/** The UI's organisation client over a test client (the pages' own calls, on the in-memory server). */
const orgApiOf = (c: Client, P: string) =>
  ({
    get: (path: string, q?: Record<string, string>) => c.get(`${P}${path}${q ? `?${new URLSearchParams(q)}` : ""}`),
    post: (path: string, body?: unknown) => c.post(`${P}${path}`, body, CREATED.test(path) ? 201 : 200),
    put: (path: string, body?: unknown) => c.put(`${P}${path}`, body),
    patch: (path: string, body?: unknown) => c.patch(`${P}${path}`, body),
    del: (path: string) => c.del(`${P}${path}`),
  }) as unknown as OrgApi;
const row = (p: Partial<HubRow> & { kind: HubRow["kind"]; id: string; name: string }): HubRow => ({
  table: null, table_label: null, category: null, status: "فعال", active: true, updated_at: null, owner: null, module: "", editable: "all", editor: "", ...p,
});
const preview = (p: Partial<DiffPreview> = {}): DiffPreview => ({ diff: { first: false, changes: ["مرحلهٔ «تأیید» افزوده شد"], access: [] }, problems: [], can_publish: true, next_version: 2, display: {}, ...p });

// ---------------------------------------------------------------------------------------------------------------

describe("who is offered «گردش‌کارها», and where it lives", () => {
  it("the row is in «فرم‌ها و گردش‌کارها» after «فرم‌ها», for «طراحی فرم و گردش‌کار»; the module serves the hub and the lifecycle editor", () => {
    const rows = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
    const hub = rows.find((i) => i.key === "workflows:hub")!;
    expect(hub).toMatchObject({ label: "گردش‌کارها", path: "settings/workflows", group: "فرم‌ها و گردش‌کارها", access: HUB_GATE });
    expect(gateAllows(DESIGNER, HUB_GATE)).toBe(true);
    for (const r of ["agent", "requester"]) expect(gateAllows(grantsOf(r), HUB_GATE)).toBe(false);
    expect(gateAllows(grantsOf("process_publisher"), HUB_GATE)).toBe(true);
    // the settings group in the order the administrator builds: fields, forms, workflows, then the organisational roles
    expect(rows.filter((i) => i.group === "فرم‌ها و گردش‌کارها").map((i) => i.label)).toEqual(["فیلدها", "فرم‌ها", "گردش‌کارها", "نقش‌های سازمانی"]);
    expect(hubPart.routes.map((r) => r.path)).toEqual(["settings/workflows"]);
    expect(lifecyclePart.routes.map((r) => r.path)).toEqual(["settings/workflows/states/:table"]);
    for (const p of [...hubPart.routes, ...lifecyclePart.routes].map((r) => r.path)) expect(ROUTES.filter((r) => r.path === p)).toHaveLength(1);
    expect(routed(lifecyclePath("incident"))).toBe(true);
  });

  it("the hub opens for designers and `settings` editors (F4c's rule); «افزودن حق» is for `users` admin", () => {
    expect(hubAccess(probe(DESIGNER))).toEqual({ read: true, grantWork: false });
    expect(hubAccess(probe(grantsOf("agent"), "edit")).read).toBe(true);
    expect(hubAccess(probe(grantsOf("agent"))).read).toBe(false);
    expect(hubAccess(probe(grantsOf("tenant_admin"), "full"))).toEqual({ read: true, grantWork: true });
    // a read-only organisation is offered no writes
    expect(hubAccess(probe(grantsOf("tenant_admin"), "full", false)).grantWork).toBe(false);
  });

  it("a Windows app linked to the web version for this organisation does not publish; the web, the server and a standalone app do", () => {
    expect(authorityHere({ mode: "cloud" }, "o1")).toBe(true);
    expect(authorityHere(undefined, "o1")).toBe(true);
    expect(authorityHere({ mode: "desktop", desktop: { cloud: { linked: false, org_id: null } } }, "o1")).toBe(true);
    expect(authorityHere({ mode: "desktop", desktop: { cloud: { linked: true, org_id: "o1" } } }, "o1")).toBe(false);
    expect(authorityHere({ mode: "desktop", desktop: { cloud: { linked: true, org_id: "o2" } } }, "o1")).toBe(true);
  });
});

describe("the hub's list", () => {
  const rows: HubRow[] = [
    row({ kind: "flow", id: "f1", name: "یادآوری روزانه", category: "schedule", status: "پیش‌نویس", active: false, module: "جریان‌های خودکار", editor: "flows/f1/design" }),
    row({ kind: "lifecycle", id: "incident", name: "چرخهٔ عمر «رخدادها»", table: "incident", table_label: "رخدادها", status: "سفارشی‌شده", editable: "safe", editor: "settings/workflows/states/incident", updated_at: "2026-11-01T10:00:00Z", owner: "u1" }),
    row({ kind: "process", id: "p1", name: "درخواست تنخواه شعبه", category: "مالی", status: "منتشرشده نسخهٔ ۳", open_cases: 4, editor: "settings/workflows/p/p1", owner: "u2" }),
    row({ kind: "lifecycle", id: "todo", name: "چرخهٔ عمر «کارها»", table: "todo", table_label: "کارها", status: DEFAULT_LIFECYCLE, editable: "safe", editor: "settings/workflows/states/todo" }),
    row({ kind: "lifecycle", id: "change_request", name: "چرخهٔ عمر «درخواست‌های تغییر»", table: "change_request", table_label: "درخواست‌های تغییر", status: DEFAULT_LIFECYCLE, editable: "labels", editor: "settings/workflows/states/change_request" }),
    row({ kind: "change_model", id: "m1", name: "تغییر عادی", table: "change_request", table_label: "درخواست‌های تغییر", category: "normal", editor: "changes/models", owner: "u1" }),
    row({ kind: "process", id: "p2", name: "مرخصی", status: "پیش‌نویس", active: false, open_cases: 0, editor: "settings/workflows/p/p2" }),
  ];

  it("kinds in the hub's order, a kind chip from the address, and a search over name, table, category and module (Arabic letters as Persian)", () => {
    expect(KIND_ORDER).toEqual(["process", "lifecycle", "change_model", "approval_rule", "flow", "catalog_flow", "catalog_tasks", "journey", "playbook"]);
    expect(kindOf(new URLSearchParams("kind=lifecycle"))).toBe("lifecycle");
    expect(kindOf(new URLSearchParams("kind=nope"))).toBeNull();
    expect(filterRows(rows, { kind: null, q: "" }).map((r) => r.id)).toEqual(["p1", "p2", "incident", "todo", "change_request", "m1", "f1"]);
    expect(filterRows(rows, { kind: "process", q: "" }).map((r) => r.id)).toEqual(["p1", "p2"]);
    // the lifecycles the organisation changed come before the ones on their module's default
    expect(filterRows([...rows].reverse(), { kind: "lifecycle", q: "" }).map((r) => r.id)).toEqual(["incident", "change_request", "todo"]);
    expect(filterRows(rows, { kind: null, q: "مالي" }).map((r) => r.id)).toEqual(["p1"]);
    expect(filterRows(rows, { kind: null, q: "رخداد" }).map((r) => r.id)).toEqual(["incident"]);
    expect(filterRows(rows, { kind: null, q: "جریان‌های خودکار" }).map((r) => r.id)).toEqual(["f1"]);
  });

  it("«همه» folds the lifecycles still on their module's default into one line; a kind or a search lists them", () => {
    const all = listRows(rows, { kind: null, q: "" });
    expect(all.map((r) => (r.type === "row" ? r.row.id : `more:${r.count}`))).toEqual(["p1", "p2", "incident", "more:2", "m1", "f1"]);
    expect(moreText(2)).toBe("۲ چرخهٔ عمر دیگر با تنظیم پیش‌فرض ماژول");
    expect(listRows(rows, { kind: "lifecycle", q: "" }).every((r) => r.type === "row")).toBe(true);
    expect(listRows(rows, { kind: null, q: "کارها" }).map((r) => (r.type === "row" ? r.row.id : "more"))).toEqual(["todo"]);
  });

  it("each row's words: a chip only for a draft or an organisation's change, what may change, its table or category in Persian", () => {
    expect(statusView(rows[2])).toEqual({ text: "منتشرشده نسخهٔ ۳", chip: null, quiet: false });
    expect(statusView(rows[6])).toMatchObject({ chip: "neutral" });
    expect(statusView(rows[1])).toMatchObject({ chip: "info" });
    expect(statusView(rows[3])).toMatchObject({ chip: null, quiet: true });
    expect(statusView(row({ kind: "approval_rule", id: "a", name: "x", status: "غیرفعال", active: false }))).toMatchObject({ chip: null, quiet: true });
    expect([editableText(rows[1]), editableText(rows[4]), editableText(rows[2])]).toEqual(["تغییرهای امن", "فقط برچسب و رنگ", ""]);
    expect(whereText(rows[0])).toBe("زمان‌بندی");
    expect(whereText(rows[2])).toBe("مالی");
    // a change model's type comes from its choice list (the schema's choices)
    expect(whereText(rows[5], { "change_request.type": [{ value: "normal", label: "عادی" }] })).toBe("درخواست‌های تغییر، عادی");
    expect(categoryText(row({ kind: "catalog_flow", id: "c", name: "x", category: "catalog" }))).toBe("");
    expect(categoryText(row({ kind: "catalog_tasks", id: "c", name: "x", category: "۳ کار" }))).toBe("۳ کار");
    expect(KIND_SHORT.playbook).toBe("پاسخ امنیتی");
    for (const r of rows) expect(`${statusView(r).text} ${whereText(r)}`).not.toMatch(NO_DOT_BEFORE_DIGIT);
  });

  it("a row opens its editor — a model, a rule, a journey or a playbook its own record when the list has that route", () => {
    expect(rowLink(rows[5], (p) => p === "changes/models/m1")).toBe("changes/models/m1");
    expect(rowLink(rows[5], () => false)).toBe("changes/models");
    expect(rowLink(rows[0], () => true)).toBe("flows/f1/design");
    expect(rowLink(rows[2], () => true)).toBe(designerPath("p1"));
    expect(routeMatches(["settings/forms/:id", "flows/:id/design"], "flows/x/design")).toBe(true);
    expect(routeMatches(["settings/forms/:id"], "settings/forms")).toBe(false);
  });

  it("who to name, the categories a new process is offered, the rules the person can open", () => {
    expect(ownerIds(rows)).toEqual(["u1", "u2"]);
    expect(processCategories(rows)).toEqual(["مالی"]);
    const rules = [{ label: "قاعده‌های کسب‌وکار", link: "sla/business-rules" }, { label: "کشیک و تشدید", link: "oncall/policies" }];
    expect(visibleRules(rules, (p) => p.startsWith("sla/")).map((r) => r.link)).toEqual(["sla/business-rules"]);
    expect(roleLine({ name: "کارشناس فقط‌خواندنی", holders: 3 })).toBe("کارشناس فقط‌خواندنی (۳ عضو)");
    expect(roleLine({ name: "x", holders: 0 })).toBe("x");
  });
});

describe("a new process", () => {
  it("the key follows F4c's rule; one is spelt from the name", () => {
    expect(keyProblem("")).toBe("کلید را بنویسید");
    expect(keyProblem("Petty")).toMatch(/حرف لاتین کوچک/);
    expect(keyProblem("1cash")).toMatch(/حرف لاتین کوچک/);
    expect(keyProblem("petty_cash")).toBe("");
    expect(suggestKey("درخواست تنخواه شعبه")).toBe("drkhvast_tnkhvah_shbh");
    expect(suggestKey("VPN access ۲")).toBe("vpn_access_2");
    expect(suggestKey("۱۲")).toBe("");
    for (const n of ["مرخصی", "درخواست خرید کالا و خدمات با مبلغ بالای ۵۰ میلیون تومان برای شعبه‌ها", "Ünïcode name"]) {
      const k = suggestKey(n);
      expect(k === "" || KEY_RE.test(k)).toBe(true);
    }
  });

  it("what the dialog asks for and sends; a duplicate's message lands on its field", () => {
    expect(newProcessProblems({ name: " ", key: "", category: "", description: "" })).toEqual({ name: "نام را بنویسید", key: "کلید را بنویسید" });
    expect(newProcessBody({ name: " تنخواه ", key: " petty_cash ", category: " ", description: "" })).toEqual({ name: "تنخواه", key: "petty_cash", category: null, description: null });
    expect(fieldErrors({ fields: { key: "ترکیب «کلید» تکراری است" } })).toEqual({ key: "ترکیب «کلید» تکراری است" });
    expect(fieldErrors(null)).toEqual({});
  });
});

describe("publishing and retiring from the hub", () => {
  it("a process row offers publish to approvers on the authority, and retire while it is published", () => {
    const o = { canPublish: true, authority: true, writable: true };
    expect(processActions({ kind: "process", status: "منتشرشده نسخهٔ ۱", active: true }, o)).toEqual(["publish", "retire"]);
    expect(processActions({ kind: "process", status: "پیش‌نویس", active: false }, o)).toEqual(["publish"]);
    expect(processActions({ kind: "process", status: "بازنشسته", active: false }, o)).toEqual(["publish"]);
    expect(processActions({ kind: "process", status: "پیش‌نویس", active: false }, { ...o, canPublish: false })).toEqual([]);
    expect(processActions({ kind: "process", status: "پیش‌نویس", active: false }, { ...o, authority: false })).toEqual([]);
    expect(processActions({ kind: "flow", status: "پیش‌نویس", active: false }, o)).toEqual([]);
    expect(processTarget({ id: "p", name: "x", status: "بازنشسته", open_cases: 2 })).toEqual({ id: "p", name: "x", retired: true, open_cases: 2 });
  });

  it("the dialog's verdict: the authority, the right, the draft's errors, nothing to publish (a retired process may come back unchanged)", () => {
    const o = { canPublish: true, authority: true, retired: false };
    expect(publishVerdict(preview(), o)).toMatchObject({ ok: true, reason: null });
    expect(publishVerdict(preview(), { ...o, authority: false }).reason).toBe(CONNECTION_NEEDED);
    expect(publishVerdict(preview({ can_publish: false }), { ...o, canPublish: false }).reason).toBe(PUBLISH_REFUSAL);
    const bad = publishVerdict(preview({ problems: [{ level: "error", message: "این مرحله انجام‌دهنده ندارد" }, { level: "warning", message: "مسئولی ندارد" }], can_publish: false }), o);
    expect(bad).toMatchObject({ ok: false, reason: "پیش از انتشار ۱ ایراد را برطرف کنید" });
    expect([bad.errors.length, bad.warnings.length]).toEqual([1, 1]);
    const same = preview({ diff: { first: false, changes: [NO_CHANGE], access: [] } });
    expect(publishVerdict(same, o)).toMatchObject({ ok: false, unchanged: true });
    expect(publishVerdict(same, { ...o, retired: true })).toMatchObject({ ok: true, unchanged: true });
    // an access change alone is a change
    expect(publishVerdict(preview({ diff: { first: false, changes: [NO_CHANGE], access: ["محرمانه: روشن"] } }), o).ok).toBe(true);
    expect(publishVerdict(preview({ diff: { first: true, changes: ["نخستین نسخهٔ این گردش‌کار"], access: [] }, next_version: 1 }), o).ok).toBe(true);
  });

  it("what publishing and retiring say", () => {
    expect(publishedText({ message: "نسخهٔ ۲ منتشر شد؛ پرونده‌های تازه با آن آغاز می‌شوند", propagated: 3 })).toEqual({
      title: "نسخهٔ ۲ منتشر شد؛ پرونده‌های تازه با آن آغاز می‌شوند",
      detail: "تنظیمات دسترسی به ۳ پروندهٔ این گردش‌کار رسید",
    });
    expect(publishedText({ message: "x", propagated: 0 }).detail).toBeNull();
    expect(retireText(2)).toBe("پروندهٔ تازه با آن آغاز نمی‌شود؛ ۲ پروندهٔ باز با نسخهٔ خود به پایان می‌رسد.");
    expect(retireText(0)).toBe("پروندهٔ تازه با آن آغاز نمی‌شود؛ پرونده‌ای باز نیست.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The lifecycle editor

const view = (p: Partial<LifecycleView> = {}): LifecycleView => ({
  table: "todo",
  labels_only: false,
  notes: [],
  states: [
    { value: "new", category: "new", default_label: "جدید", default_color: "indigo", label: "جدید", color: "indigo" },
    { value: "in_progress", category: "active", default_label: "در جریان", default_color: "teal", label: "در جریان", color: "teal" },
    { value: "done", category: "resolved", default_label: "انجام‌شده", default_color: null, label: "انجام‌شده", color: null },
  ],
  transitions: [
    { key: "new>in_progress", from: ["new"], to: "in_progress", default_label: "شروع", requires: [], roles: null, guard: false, optional: false, label: "شروع", primary: false, needs: [], also: [], when: null, message: null, off: false },
    { key: "in_progress>done", from: ["in_progress"], to: "done", default_label: "پایان", requires: ["resolution"], roles: null, guard: true, optional: false, label: "پایان", primary: false, needs: [], also: [], when: null, message: null, off: false },
    { key: "*>new", from: "*", to: "new", default_label: "بازگشایی", requires: [], roles: null, guard: false, optional: true, label: "بازگشایی", primary: false, needs: [], also: [], when: null, message: null, off: false },
  ],
  overlay: null,
  ...p,
});
const names: DiffNames = { field: (n) => ({ priority: "اولویت", due_at: "موعد" })[n] ?? n, role: (k) => ({ agent: "کارشناس" })[k] ?? k, cond: () => "اولویت برابر بحرانی" };

describe("the lifecycle editor's draft", () => {
  it("`settings` view reads, `settings` full changes (the membership or the grant); a read-only organisation changes nothing", () => {
    expect(lifecycleAccess(probe({}, "view"))).toEqual({ read: true, write: false });
    expect(lifecycleAccess(probe({}, "full"))).toEqual({ read: true, write: true });
    expect(lifecycleAccess(probe(grantsOf("tenant_admin"), "none"))).toEqual({ read: true, write: true });
    expect(lifecycleAccess(probe({}, "none")).read).toBe(false);
    expect(lifecycleAccess(probe({}, "full", false)).write).toBe(false);
    expect(LIFECYCLE_REFUSAL).toBe("چرخهٔ عمر رکوردها را مدیر سازمان تغییر می‌دهد");
  });

  it("a draft saves only what differs from the module; the module's own lifecycle saves nothing", () => {
    const v = view();
    const d0 = draftOf(v);
    expect(overlayOf(v, d0)).toBeNull();
    expect([isDirty(v, d0), isDefault(v, d0)]).toEqual([false, true]);
    let d = setState(d0, "new", { label: "تازه", color: "blue" });
    d = setState(d, "in_progress", { label: "در جریان" });
    d = setTransition(d, "new>in_progress", { label: "  آغاز  کار ", needs: ["priority"], also: ["agent"], when: { f: "priority", op: "eq", v: "1" }, message: "فقط بحرانی‌ها" });
    d = setPrimary(d, "new>in_progress");
    d = setTransition(d, "*>new", { off: true });
    // a non-optional transition is never switched off
    d = setTransition(d, "in_progress>done", { off: true });
    expect(overlayOf(v, d)).toEqual({
      states: { new: { label: "تازه", color: "blue" } },
      transitions: [
        { key: "new>in_progress", label: "آغاز کار", primary: true, requires: ["priority"], also: ["agent"], when: { f: "priority", op: "eq", v: "1" }, message: "فقط بحرانی‌ها" },
        { key: "*>new", off: true },
      ],
    });
    expect(isDirty(v, d)).toBe(true);
    // «اصلی» is one per table: choosing another moves it, choosing it again clears it
    const moved = setPrimary(d, "in_progress>done");
    expect(Object.entries(moved.transitions).filter(([, t]) => t.primary).map(([k]) => k)).toEqual(["in_progress>done"]);
    expect(Object.values(setPrimary(moved, "in_progress>done").transitions).some((t) => t.primary)).toBe(false);
    // what is stored comes back as the same draft
    const stored = view({
      states: v.states.map((s) => (s.value === "new" ? { ...s, label: "تازه", color: "blue" } : s)),
      transitions: v.transitions.map((t) =>
        t.key === "new>in_progress" ? { ...t, label: "آغاز کار", primary: true, needs: ["priority"], also: ["agent"], when: { f: "priority", op: "eq", v: "1" }, message: "فقط بحرانی‌ها" } : t.key === "*>new" ? { ...t, off: true } : t,
      ),
      overlay: overlayOf(v, d),
    });
    expect(overlayOf(stored, draftOf(stored))).toEqual(overlayOf(v, d));
    expect(isDirty(stored, d)).toBe(false);
    expect(isDefault(stored, defaultDraft(stored))).toBe(true);
  });

  it("a lifecycle a module configures elsewhere keeps labels, colours and the primary transition only", () => {
    const v = view({ table: "change_request", labels_only: true });
    let d = setTransition(draftOf(v), "new>in_progress", { label: "ارزیابی", needs: ["priority"], also: ["agent"], when: { f: "priority", op: "eq", v: "1" } });
    d = setPrimary(d, "new>in_progress");
    d = setTransition(d, "*>new", { off: true });
    expect(overlayOf(v, d)).toEqual({ transitions: [{ key: "new>in_progress", label: "ارزیابی", primary: true }] });
    expect(scopeChip(v)).toBe("فقط برچسب، رنگ و انتقال اصلی");
    expect(scopeChip(view())).toBe("سامانه‌ای — تغییرهای امن");
  });

  it("«تفاوت با پیش‌فرض» and what a save sends, line by line", () => {
    const v = view();
    let d = setState(draftOf(v), "new", { label: "تازه", color: "blue" });
    d = setTransition(d, "new>in_progress", { needs: ["priority"], also: ["agent"], when: { f: "priority", op: "eq", v: "1" } });
    d = setPrimary(d, "new>in_progress");
    d = setTransition(d, "*>new", { off: true });
    const lines = draftDiff(v, defaultDraft(v), d, names);
    expect(lines).toEqual([
      { what: "برچسب وضعیت «جدید»", from: "جدید", to: "تازه" },
      { what: "رنگ «تازه»", from: "نیلی", to: "آبی" },
      { what: "انتقال اصلی", from: "هیچ", to: "شروع" },
      { what: "فیلدهای لازم «شروع» (تازه ← در جریان)", from: "هیچ", to: "اولویت" },
      { what: "فقط با نقش «شروع» (تازه ← در جریان)", from: "بدون شرط نقش", to: "کارشناس" },
      { what: "شرط «شروع» (تازه ← در جریان)", from: "بدون شرط", to: "اولویت برابر بحرانی" },
      { what: "«بازگشایی» (هر وضعیت ← تازه)", from: "روشن", to: "خاموش" },
    ]);
    expect(draftDiff(v, d, d, names)).toEqual([]);
    expect(summaryText(v, lines.length)).toBe("۳ وضعیت، ۳ انتقال، ۷ تفاوت با پیش‌فرض");
    expect(transitionPath(v, d, v.transitions[2])).toBe("هر وضعیت ← تازه");
  });

  it("F1's own validator: fields that are not there or hidden from the form, unknown roles, a condition on another table", () => {
    const base = tableDef("todo")!;
    const v = view({ states: base.states!.states.map((s) => ({ value: s.value, category: s.category, default_label: s.label, default_color: s.color ?? null, label: s.label, color: s.color ?? null })), transitions: [] });
    const t = base.states!.transitions[0];
    const key = `${t.from === "*" ? "*" : [...t.from].sort().join(",")}>${t.to}`;
    const vt = view({
      ...v,
      transitions: [{ key, from: t.from, to: t.to, default_label: t.label, requires: t.requires ?? [], roles: null, guard: !!t.guard, optional: !!t.optional, label: t.label, primary: false, needs: [], also: [], when: null, message: null, off: false }],
    });
    const hidden: TableDef = { ...base, fields: base.fields.map((f) => (f.name === "due_at" ? { ...f, formHidden: true } : f)) };
    const env = { base, def: hidden, roles: new Set(["agent"]) };
    const d = setTransition(draftOf(vt), key, { needs: ["due_at", "nope"], also: ["agent", "ghost"] });
    const p = draftProblems(vt, d, env);
    expect(p.some((x) => x.includes("در فرم پنهان است"))).toBe(true);
    expect(p.some((x) => x.includes("«nope»"))).toBe(true);
    expect(p.some((x) => x.includes("«ghost»"))).toBe(true);
    expect(p.some((x) => x.includes("«agent»"))).toBe(false);
    // roles not known (the caller may not read them): the server decides
    expect(draftProblems(vt, setTransition(draftOf(vt), key, { also: ["ghost"] }), { ...env, roles: null })).toEqual([]);
    expect(draftProblems(vt, setTransition(draftOf(vt), key, { when: { f: "caller_id.title", op: "eq", v: "x" } }), env).length).toBeGreaterThan(0);
  });

  it("the fields a transition may ask for, and the preview of the states and a state's buttons", () => {
    const base = tableDef("todo")!;
    const fields = requirableFields({ ...base, fields: base.fields.map((f) => (f.name === "due_at" ? { ...f, formHidden: true } : f)) });
    expect(fields.some((f) => f.name === "state" || f.name === "number")).toBe(false);
    expect(fields.find((f) => f.name === "due_at")?.blocked).toMatch(/در فرم پنهان است/);
    expect(fields.find((f) => f.name === "short_description")?.blocked).toBeNull();
    const v = view();
    let d = setState(draftOf(v), "new", { label: "تازه", color: "blue" });
    d = setPrimary(d, "new>in_progress");
    expect(channel(v, d).map((s) => [s.label, s.color, s.category])).toEqual([
      ["تازه", "blue", "جدید"],
      ["در جریان", "teal", "در جریان"],
      ["انجام‌شده", null, "حل‌شده"],
    ]);
    expect(previewButtons(v, d, "new")).toEqual([{ key: "new>in_progress", label: "شروع", primary: true }]);
    expect(previewButtons(v, d, "in_progress").map((b) => b.label)).toEqual(["پایان", "بازگشایی"]);
    expect(previewButtons(v, setTransition(d, "*>new", { off: true }), "in_progress").map((b) => b.label)).toEqual(["پایان"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The same calls on a real organisation

/** A member's probe, from what the shell reads (GET /o/:org). */
async function probeOf(c: Client, P: string, writable = true) {
  const me = await c.get(P);
  const perms = (me.member?.permissions ?? {}) as Record<string, Level>;
  return { can: (area: "settings", level: Level) => LEVEL_ORDER.indexOf(perms[area] ?? "none") >= LEVEL_ORDER.indexOf(level), allows: (g: AccessGate) => gateAllows(me.access?.grants, g), writable };
}

describe("the screens' calls on a real organisation", () => {
  let e: EngineOrg;
  let P: string;
  let api: OrgApi;
  let procId = "";
  const meta = async (t: string): Promise<TableMeta> => (await e.owner.get(`${P}/meta/tables/${t}`)).table;
  const hub = (): Promise<Hub> => hubApi.hub(api);

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    api = orgApiOf(e.owner, P);
    await seedRequestDefaults(e.cfg, e.org);
    await seedChangeDefaults(e.cfg, e.org);
    await seedEsmDefaults(e.cfg, e.org);
    await seedSecurityDefaults(e.cfg, e.org);
    await e.owner.post(`${P}/r/flow`, { name: "یادآوری روزانه", trigger: "manual", trigger_table: "todo", run_as: "trigger_user", graph: { nodes: [{ id: "trigger", type: "trigger", config: {} }], edges: [] } });
  }, 900_000);

  it("the hub lists the nine kinds; every row opens a route the UI registers, a process row the designer", async () => {
    const made = await hubApi.create(api, newProcessBody({ name: "درخواست تنخواه شعبه", key: suggestKey("درخواست تنخواه شعبه"), category: "مالی", description: "" }));
    procId = made.process.id;
    expect(made.process).toMatchObject({ key: "drkhvast_tnkhvah_shbh", status: "draft" });
    const h = await hub();
    expect(h.kinds.map((k) => k.key)).toEqual(KIND_ORDER);
    for (const k of ["process", "lifecycle", "change_model", "flow", "catalog_flow", "journey", "playbook"] as const) expect(h.kinds.find((x) => x.key === k)!.count).toBeGreaterThan(0);
    expect(h).toMatchObject({ empty: false, can: { create: true, publish: true } });
    const broken = h.rows.filter((r) => !routed(rowLink(r, routed))).map((r) => `${r.kind}:${rowLink(r, routed)}`);
    expect(broken).toEqual([]);
    // the record kinds open their own records
    const model = h.rows.find((r) => r.kind === "change_model")!;
    expect(rowLink(model, routed)).toBe(`changes/models/${model.id}`);
    // the process row opens the designer at the address the UI registers
    const p = h.rows.find((r) => r.id === procId)!;
    expect(p).toMatchObject({ kind: "process", status: "پیش‌نویس", category: "مالی", open_cases: 0, editable: "all" });
    expect(p.editor).toBe(designerPath(procId));
    expect(routed(p.editor)).toBe(true);
    expect(statusView(p).chip).toBe("neutral");
    // «همه» folds every lifecycle still on its default
    const lifecycles = h.rows.filter((r) => r.kind === "lifecycle");
    expect(lifecycles.every((r) => r.status === DEFAULT_LIFECYCLE)).toBe(true);
    expect(listRows(h.rows, { kind: null, q: "" }).filter((r) => r.type === "more")).toEqual([{ type: "more", key: "more:lifecycle", count: lifecycles.length }]);
    // categories in Persian (the schema's choice lists)
    const { choices } = await e.owner.get(`${P}/meta/tables`);
    for (const r of h.rows.filter((x) => x.kind === "change_model" || x.kind === "journey" || x.kind === "flow")) expect(categoryText(r, choices)).not.toMatch(/^[a-z_]+$/);
    // who changed each row, by name
    const names = await hubApi.people(api, ownerIds(h.rows));
    expect(names[e.ownerId]).toBeTruthy();
    // «قاعده‌ها»: every link is a page of the menu
    for (const r of h.rules) expect(NAV.some((g) => g.items.some((i) => r.link === i.path || r.link.startsWith(`${i.path}/`)))).toBe(true);
  });

  it("a new process's duplicate key is refused on the key field", async () => {
    await hubApi.create(api, newProcessBody({ name: "مرخصی", key: suggestKey("مرخصی"), category: "", description: "" }));
    const r = await e.owner.post(`${P}/process/defs`, newProcessBody({ name: "مرخصی ساعتی", key: suggestKey("مرخصی"), category: "", description: "" }), 409);
    expect(fieldErrors(r.error.details).key).toBeTruthy();
  });

  it("publish from the hub: refused with the draft's errors, published, unchanged, retired, and published again", async () => {
    // the new draft's «ثبت درخواست» has no form yet: the dialog shows why and the server refuses with the same problems
    const d0 = await hubApi.diff(api, procId);
    const v0 = publishVerdict(d0, { canPublish: true, authority: true, retired: false });
    expect(v0.ok).toBe(false);
    expect(v0.errors.length).toBeGreaterThan(0);
    const refused = await e.owner.post(`${P}/process/defs/${procId}/publish`, {}, 400);
    expect(refused.error.code).toBe("invalid_process");
    expect(refused.error.details.problems.filter((x: { level: string }) => x.level === "error").map((x: { message: string }) => x.message).sort()).toEqual(v0.errors.map((x) => x.message).sort());

    // a form for the step, and the draft the designer would save
    await e.owner.post(`${P}/fields/library`, { name: "u_reason", label: "علت", type: "text" }, 201);
    const form = (await e.owner.post(`${P}/forms`, { name: "درخواست تنخواه" }, 201)).form;
    await e.owner.patch(`${P}/forms/${form.id}`, { layout: { tabs: [{ label: "جزئیات", sections: [{ label: null, items: [{ field: "u_reason" }] }] }] } });
    const detail = await e.owner.get(`${P}/process/defs/${procId}`);
    const graph = {
      nodes: [
        { id: "start", type: "trigger", config: {} },
        { id: "request", type: "form_step", label: "ثبت درخواست", config: { action: "fill", start: true, form: form.id, rights: { default: "edit", fields: {} }, assignees: [{ kind: "requester" }] } },
        { id: "done", type: "end", label: "پایان", config: { outcome: "completed" } },
      ],
      edges: [{ id: "start.out.request", source: "start", target: "request" }, { id: "request.out.done", source: "request", target: "done" }],
    };
    const saved = await e.owner.put(`${P}/process/defs/${procId}/draft`, { draft: { ...detail.draft, graph, managers: [e.ownerId] }, version: detail.process.version });
    expect(saved.problems.filter((x: { level: string }) => x.level === "error")).toEqual([]);

    const d1 = await hubApi.diff(api, procId);
    expect(d1.diff).toMatchObject({ first: true });
    expect(publishVerdict(d1, { canPublish: true, authority: true, retired: false })).toMatchObject({ ok: true });
    const pub = await hubApi.publish(api, procId, "نخستین انتشار");
    expect(publishedText(pub).title).toBe("نسخهٔ ۱ منتشر شد؛ پرونده‌های تازه با آن آغاز می‌شوند");
    let row = (await hub()).rows.find((r) => r.id === procId)!;
    expect(row).toMatchObject({ status: "منتشرشده نسخهٔ ۱", active: true });
    expect(processActions(row, { canPublish: true, authority: true, writable: true })).toEqual(["publish", "retire"]);

    // nothing changed since: the dialog does not publish it twice
    const same = await hubApi.diff(api, procId);
    expect(publishVerdict(same, { canPublish: true, authority: true, retired: false })).toMatchObject({ ok: false, unchanged: true });

    const ret = await hubApi.retire(api, procId, null);
    expect(ret).toMatchObject({ status: "retired", open_cases: 0, message: "گردش‌کار بازنشسته شد" });
    row = (await hub()).rows.find((r) => r.id === procId)!;
    expect(processTarget(row).retired).toBe(true);
    expect(processActions(row, { canPublish: true, authority: true, writable: true })).toEqual(["publish"]);
    // a retired process may be published again unchanged
    const back = await hubApi.diff(api, procId);
    expect(publishVerdict(back, { canPublish: true, authority: true, retired: true }).ok).toBe(true);
    expect((await hubApi.publish(api, procId, null)).version.version_no).toBe(2);
    expect((await hub()).rows.find((r) => r.id === procId)).toMatchObject({ status: "منتشرشده نسخهٔ ۲", active: true });
  });

  it("a designer reads the hub but is not offered publishing; the server refuses with the dialog's words; a requester has no hub", async () => {
    const m = await e.member("member");
    await e.owner.put(`${P}/access/members/${m.userId}`, { roles: ["process_designer"] });
    const des = await probeOf(m.client, P);
    expect(hubAccess(des).read).toBe(true);
    const h: Hub = await hubApi.hub(orgApiOf(m.client, P));
    expect(h.can).toEqual({ create: true, publish: false });
    expect(h.rows.some((r) => r.kind === "process")).toBe(true);
    const r = h.rows.find((x) => x.id === procId)!;
    expect(processActions(r, { canPublish: h.can.publish, authority: true, writable: true })).toEqual([]);
    const d = await hubApi.diff(orgApiOf(m.client, P), procId);
    expect(publishVerdict(d, { canPublish: h.can.publish, authority: true, retired: false }).reason).toBe(PUBLISH_REFUSAL);
    expect((await m.client.post(`${P}/process/defs/${procId}/publish`, {}, 403)).error.message).toBe(PUBLISH_REFUSAL);

    const q = await e.member("member");
    await e.owner.put(`${P}/access/members/${q.userId}`, { roles: ["requester"], persona: "requester" });
    expect(hubAccess(await probeOf(q.client, P)).read).toBe(false);
    await q.client.get(`${P}/process/hub`, 403);
  });

  it("a lifecycle saved from the editor's draft reaches the table's definition and the hub, and goes back to the module's", async () => {
    const v = await lifecycleApi.get(api, "incident");
    const base = tableDef("incident")!;
    expect(v.labels_only).toBe(false);
    expect(v.states.map((s) => s.value)).toEqual(base.states!.states.map((s) => s.value));
    const d0 = draftOf(v);
    expect([overlayOf(v, d0), isDirty(v, d0)]).toEqual([null, false]);
    const roles = new Set((await lifecycleApi.roles(api)).map((r) => r.key));
    const def = await meta("incident");
    const first = v.states[0];
    const t = v.transitions.find((x) => !x.guard && x.from !== "*")!;
    const field = requirableFields(def).find((f) => f.name === "external_ref")!;
    expect(field.blocked).toBeNull();
    let d = setState(d0, first.value, { label: `${first.default_label} تازه`, color: "magenta" });
    d = setTransition(d, t.key, { label: "گام بعد", needs: [field.name], also: ["agent"], when: { f: "priority", op: "in", v: ["1", "2"] }, message: "فقط اولویت‌های بالا" });
    d = setPrimary(d, t.key);
    expect(draftProblems(v, d, { base, def, roles })).toEqual([]);
    const saved = await lifecycleApi.save(api, "incident", overlayOf(v, d));
    // what the server keeps is what was drafted: nothing left to save
    expect(isDirty(saved, d)).toBe(false);
    expect(draftOf(saved)).toEqual(d);
    // the table's definition (the record pages, the lists, the Windows app) carries it
    const after = await meta("incident");
    expect(after.states!.states.find((s) => s.value === first.value)).toMatchObject({ label: `${first.default_label} تازه`, color: "magenta" });
    expect(after.states!.transitions.find((x) => `${x.from === "*" ? "*" : [...x.from].sort().join(",")}>${x.to}` === t.key)).toMatchObject({ label: "گام بعد", primary: true, needs: [field.name], also: ["agent"] });
    // the hub says it was changed, by whom, and lists it in «همه»
    const row = (await hub()).rows.find((r) => r.kind === "lifecycle" && r.table === "incident")!;
    expect(row).toMatchObject({ status: "سفارشی‌شده", owner: e.ownerId });
    expect(listRows((await hub()).rows, { kind: null, q: "" }).some((r) => r.type === "row" && r.row.id === "incident")).toBe(true);
    // «بازگشت به پیش‌فرض»: the module's draft saves nothing
    expect(overlayOf(saved, defaultDraft(saved))).toBeNull();
    const reset = await lifecycleApi.save(api, "incident", overlayOf(saved, defaultDraft(saved)));
    expect(reset.overlay).toBeNull();
    expect(isDefault(reset, draftOf(reset))).toBe(true);
    expect((await hub()).rows.find((r) => r.kind === "lifecycle" && r.table === "incident")!.status).toBe(DEFAULT_LIFECYCLE);
  });

  it("the server refuses for the reasons the editor shows: a field hidden from the form, a role that does not exist", async () => {
    const v = await lifecycleApi.get(api, "todo");
    const base = tableDef("todo")!;
    const t = v.transitions.find((x) => x.from !== "*")!;
    const def = await meta("todo");
    const field = requirableFields(def).find((f) => f.name === "estimate")!;
    expect(field.blocked).toBeNull();
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { [field.name]: { form_hidden: true } } });
    const hidden = await meta("todo");
    expect(requirableFields(hidden).find((f) => f.name === field.name)?.blocked).toMatch(/در فرم پنهان است/);
    const d = setTransition(draftOf(v), t.key, { needs: [field.name] });
    const mine = draftProblems(v, d, { base, def: hidden, roles: null });
    expect(mine.length).toBe(1);
    const r = await e.owner.put(`${P}/lifecycles/todo`, overlayOf(v, d), 400);
    expect(r.error.message).toBe(mine[0]);
    const roles = new Set((await lifecycleApi.roles(api)).map((x) => x.key));
    const ghost = setTransition(draftOf(v), t.key, { also: ["no_such_role"] });
    const why = draftProblems(v, ghost, { base, def: hidden, roles });
    expect(why).toEqual([`نقش «no_such_role» برای «${t.label}» وجود ندارد`]);
    expect((await e.owner.put(`${P}/lifecycles/todo`, overlayOf(v, ghost), 400)).error.message).toBe(why[0]);
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { [field.name]: { form_hidden: false } } });
  });

  it("change requests: labels, colours and the primary transition only, with the change models' line and link", async () => {
    const v = await lifecycleApi.get(api, "change_request");
    expect(v.labels_only).toBe(true);
    expect(v.notes.map((n) => n.link)).toContain("changes/models");
    // each note's link opens a page of the menu (the editor names the link after it)
    const menuPage = (link: string) => NAV.some((g) => g.items.some((i) => link === i.path || link.startsWith(`${i.path}/`)));
    for (const n of v.notes) expect([routed(n.link), menuPage(n.link)]).toEqual([true, true]);
    const t = v.transitions[0];
    const d = setPrimary(setTransition(draftOf(v), t.key, { label: "بررسی", needs: ["short_description"] }), t.key);
    expect(overlayOf(v, d)).toEqual({ transitions: [{ key: t.key, label: "بررسی", primary: true }] });
    const saved = await lifecycleApi.save(api, "change_request", overlayOf(v, d));
    expect(isDirty(saved, d)).toBe(false);
    // the server holds the same line: anything more is refused
    const r = await e.owner.put(`${P}/lifecycles/change_request`, { transitions: [{ key: t.key, requires: ["short_description"] }] }, 400);
    expect(r.error.message).toMatch(/فقط برچسب، رنگ و انتقال اصلی/);
    await lifecycleApi.save(api, "change_request", null);
    // the other tables a module shapes elsewhere say where, with a link the UI registers
    for (const table of ["request_item", "journey", "sec_incident"]) {
      const x = await lifecycleApi.get(api, table);
      expect(x.labels_only).toBe(false);
      expect(x.notes.length).toBeGreaterThan(0);
      for (const n of x.notes) expect([routed(n.link), menuPage(n.link)]).toEqual([true, true]);
    }
  });

  it("people below `settings` full read a lifecycle but may not change it; the server says the editor's words", async () => {
    const m = await e.member("member");
    await e.owner.put(`${P}/access/members/${m.userId}`, { roles: ["agent"], persona: "agent" });
    const a = lifecycleAccess(await probeOf(m.client, P));
    expect(a).toEqual({ read: true, write: false });
    const v = await lifecycleApi.get(orgApiOf(m.client, P), "incident");
    const d = setState(draftOf(v), v.states[0].value, { label: "تغییر" });
    expect((await m.client.put(`${P}/lifecycles/incident`, overlayOf(v, d), 403)).error.message).toBe(LIFECYCLE_REFUSAL);
  });
});

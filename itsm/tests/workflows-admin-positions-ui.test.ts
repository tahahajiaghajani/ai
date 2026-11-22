// «نقش‌های سازمانی» (design F §3.4, §8, package F5; src/ui/modules/workflows/admin/positions): who is offered the page
// and its actions (the workflows row for the people of «طراحی فرم و گردش‌کار», the «سازمان و دسترسی» row for keepers
// of the structure), the list's search and chips, a holder's period, source and form, the spreadsheet rows the import
// sends and its result in words, the preview's starting rule — and the same calls on a real organisation: a position
// and a holder from the sheet's payloads, the overview, a file's holders imported after a dry run, and the preview
// finding the branch head for a requester of that branch — and release 1.1.5: the preview starts as «تکمیل فرم» in a
// preview's words (B7), a half-filled holder is never dropped by Escape or a close (B8), and making one of the demo
// pack's people a holder asks first (FINAL-1), except on a position of the pack's own, which the page and the sheet tag.
import { describe, it, expect, beforeAll } from "vitest";
import { composeEffective, gateAllows, roleCatalog, type AccessGate, type FullGrant } from "@shared/access";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import {
  IMPORT_HEADERS, PREVIEW_ACTION, RESOLVE_STATUS, addsDemoHolder, demoHolderQuestion, emptyHolder, endingSoon, filterPositions, fixedPlace, holderFormDirty, holderProblems, holderStart,
  holderState, holdersText, importSummary, keyInput, positionsAccess, previewStep, sheetClose, sheetRows, sortHolders, sourcesText, validKey,
} from "../src/ui/modules/workflows/admin/positions/model";
import { positionsApi, type HolderImportResult, type HolderRow, type PositionOverview, type ResolveResult } from "../src/ui/modules/workflows/admin/positions/api";
import type { OrgApi } from "../src/ui/lib/api";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { POSITIONS_ACCESS_ROW, positionsPart } from "../src/ui/modules/workflows/admin/positions/routes";
import { NAV, ROUTES } from "../src/ui/modules/registry";
import { engineOrg, type EngineOrg } from "./engine-helpers";

const catalog = roleCatalog([]);
const grantsOf = (...roles: string[]) => composeEffective({ role: "member", levels: { work: "edit" }, explicit: roles, catalog }).grants;
const DESIGNER: Record<string, FullGrant> = { [PROCESS_DESIGN_AREA]: { read: "all", create: true, write: "all", delete: "none", approve: false, admin: false }, org: { read: "all", create: false, write: "none", delete: "none", approve: false, admin: false } };
const probe = (grants: Record<string, FullGrant>, writable = true) => ({ allows: (g: AccessGate) => gateAllows(grants, g), writable });
const passes = (grants: Record<string, FullGrant>, gate: AccessGate | readonly AccessGate[] | undefined) => [gate ?? []].flat().every((g) => gateAllows(grants, g));

const pos = (p: Partial<PositionOverview> & { key: string; name: string }): PositionOverview => ({
  id: p.key, unit_kind: null, active: true, reports_to: null, holders: 0, units: 0, sources: { manual: 0, directory: 0, import: 0 }, vacancies: null, ending: 0, ...p,
});
const holder = (p: Partial<HolderRow> & { id: string }): HolderRow => ({ version: 1, position_id: "p", user_id: p.id, org_unit_id: null, kind: "primary", valid_from: null, valid_to: null, source: "manual", ...p });

describe("who is offered what", () => {
  it("keepers of the structure manage; designers preview; requesters and agents only read", () => {
    expect(positionsAccess(probe(grantsOf("tenant_admin")))).toEqual({ read: true, manage: true, remove: true, preview: true });
    // a service-desk manager deletes `org` rows in their groups only: a holder has no group, so removing one is not offered (F5-5)
    expect(positionsAccess(probe(grantsOf("service_desk_manager")))).toEqual({ read: true, manage: true, remove: false, preview: true });
    // a team lead writes `org` in their groups only: that reaches no holder
    expect(positionsAccess(probe(grantsOf("team_lead")))).toEqual({ read: true, manage: false, remove: false, preview: false });
    for (const r of ["agent", "requester"]) expect(positionsAccess(probe(grantsOf(r)))).toEqual({ read: true, manage: false, remove: false, preview: false });
    expect(positionsAccess(probe(DESIGNER))).toEqual({ read: true, manage: false, remove: false, preview: true });
    expect(positionsAccess(probe(grantsOf("tenant_admin"), false))).toMatchObject({ manage: false, remove: false });
  });

  it("two rows reach the page: the workflows group's for designers, «سازمان و دسترسی»'s for keepers of the structure", () => {
    const rows = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))).filter((i) => i.key === "workflows:positions" || i.key === "access:positions");
    expect(rows.map((r) => [r.key, r.group, r.path])).toEqual([
      ["access:positions", "سازمان و دسترسی", "access/positions"],
      ["workflows:positions", "فرم‌ها و گردش‌کارها", "settings/positions"],
    ].sort((a, b) => rows.findIndex((r) => r.key === a[0]) - rows.findIndex((r) => r.key === b[0])));
    const workflows = rows.find((r) => r.key === "workflows:positions")!;
    expect(passes(DESIGNER, workflows.access)).toBe(true);
    expect(passes(DESIGNER, POSITIONS_ACCESS_ROW.access)).toBe(false);
    expect(passes(grantsOf("service_desk_manager"), POSITIONS_ACCESS_ROW.access)).toBe(true);
    for (const r of ["agent", "requester", "team_lead"]) for (const row of rows) expect(passes(grantsOf(r), row.access)).toBe(false);
    // each row its own address, both the one page
    for (const path of ["settings/positions", "access/positions"]) expect(ROUTES.filter((r) => r.path === path)).toHaveLength(1);
    expect(positionsPart.routes.map((r) => r.path)).toEqual(["settings/positions", "access/positions"]);
    expect(new Set(positionsPart.routes.map((r) => (r.element as { type?: unknown }).type)).size).toBe(1);
  });
});

describe("the list", () => {
  const rows = [
    pos({ key: "branch_head", name: "رئیس شعبه", unit_kind: "branch", holders: 48, units: 48, vacancies: 2, sources: { manual: 3, directory: 45, import: 0 } }),
    pos({ key: "credit_officer", name: "کارشناس اعتبارات", holders: 5, units: 3, ending: 1, sources: { manual: 0, directory: 0, import: 5 } }),
    pos({ key: "teller", name: "تحويلدار", active: false }),
  ];
  it("search by name or key (Arabic letters read as Persian), chips are any of their conditions", () => {
    expect(filterPositions(rows, "تحویل", []).map((p) => p.key)).toEqual(["teller"]);
    expect(filterPositions(rows, "credit", []).map((p) => p.key)).toEqual(["credit_officer"]);
    expect(filterPositions(rows, "", ["vacant"]).map((p) => p.key)).toEqual(["branch_head", "teller"]);
    expect(filterPositions(rows, "", ["ending", "inactive"]).map((p) => p.key)).toEqual(["credit_officer", "teller"]);
  });
  it("holders and sources in words, the directory first", () => {
    expect(holdersText(rows[0])).toBe("۴۸ نفر در ۴۸ شعبه");
    expect(holdersText(rows[1])).toBe("۵ نفر در ۳ واحد");
    expect(holdersText(rows[2])).toBe("بی‌دارنده");
    expect(sourcesText(rows[0].sources)).toBe("AD ۴۵ · دستی ۳");
    expect(sourcesText(rows[2].sources)).toBe("");
  });
});

describe("holders", () => {
  const today = "2026-11-14";
  it("a period against today, days inclusive; ending within 30 days", () => {
    expect(holderState(holder({ id: "a" }), today)).toBe("current");
    expect(holderState(holder({ id: "a", valid_to: today }), today)).toBe("current");
    expect(holderState(holder({ id: "a", valid_to: "2026-11-13" }), today)).toBe("ended");
    expect(holderState(holder({ id: "a", valid_from: "2026-11-15" }), today)).toBe("future");
    expect(endingSoon(holder({ id: "a", valid_to: "2026-12-14" }), today)).toBe(true);
    expect(endingSoon(holder({ id: "a", valid_to: "2026-12-15" }), today)).toBe(false);
  });
  it("current ones first by name, then future; ended ones only when asked", () => {
    const names: Record<string, string> = { a: "بهرام", b: "آرش", c: "پری", d: "جمشید" };
    const list = [holder({ id: "a" }), holder({ id: "b" }), holder({ id: "c", valid_from: "2027-01-01" }), holder({ id: "d", valid_to: "2026-01-01" })];
    expect(sortHolders(list, today, false, (u) => names[u]).map((h) => h.id)).toEqual(["b", "a", "c"]);
    expect(sortHolders(list, today, true, (u) => names[u]).map((h) => h.id)).toEqual(["b", "a", "c", "d"]);
  });
  it("AD's and a file's holders keep their person and unit; the form asks for a person, the unit of the position's kind, dates in order", () => {
    expect(fixedPlace({ source: "directory" }) && fixedPlace({ source: "import" }) && !fixedPlace({ source: "manual" })).toBe(true);
    expect(holderProblems(emptyHolder(), { unit_kind: "branch" })).toEqual({ user_id: "دارنده را برگزینید", org_unit_id: "این نقش در شعبه‌ها است؛ واحد را برگزینید" });
    expect(holderProblems({ ...emptyHolder(), user_id: "u", valid_from: "2026-12-01", valid_to: "2026-11-01" }, { unit_kind: null })).toEqual({ valid_to: "«تا تاریخ» پیش از «از تاریخ» است" });
  });
  it("1.1.5: a half-filled holder is never dropped without a question: Escape leaves the sheet open while the form is, closing asks (B8)", () => {
    const fresh = emptyHolder();
    expect(holderFormDirty(fresh, null)).toBe(false);
    const half = { ...fresh, user_id: "u-negar", org_unit_id: "unit-alborz", valid_from: "2026-11-21" };
    expect(holderFormDirty(half, null)).toBe(true);
    const h = holder({ id: "h1", user_id: "u1", org_unit_id: "x", valid_to: "2026-12-01" });
    expect(holderFormDirty(holderStart(h), h)).toBe(false);
    expect(holderFormDirty({ ...holderStart(h), valid_to: null }, h)).toBe(true);
    // the person filled the form and pressed Escape (to close a date's popover): the sheet stays, and a close asks
    expect(sheetClose({ manage: true, positionDirty: false, holderOpen: true, holderDirty: true })).toEqual({ guard: true, keyboard: false });
    expect(sheetClose({ manage: true, positionDirty: false, holderOpen: true, holderDirty: false })).toEqual({ guard: false, keyboard: false });
    expect(sheetClose({ manage: true, positionDirty: false, holderOpen: false, holderDirty: false })).toEqual({ guard: false, keyboard: true });
    expect(sheetClose({ manage: true, positionDirty: true, holderOpen: false, holderDirty: false })).toEqual({ guard: true, keyboard: true });
    expect(sheetClose({ manage: false, positionDirty: true, holderOpen: false, holderDirty: true }).guard).toBe(false);
  });

  it("1.1.5: making one of the demo pack's people a holder asks first: the organisation's own cases never reach them (FINAL-1)", () => {
    const demo = new Set(["u-negar"]);
    expect(addsDemoHolder({ user_id: "U-NEGAR" }, null, demo)).toBe(true);
    expect(addsDemoHolder({ user_id: "u-ali" }, null, demo)).toBe(false);
    // the same holder saved again (its dates changed) asks nothing; another person on it does
    expect(addsDemoHolder({ user_id: "u-negar" }, { user_id: "u-negar" }, demo)).toBe(false);
    expect(addsDemoHolder({ user_id: "u-negar" }, { user_id: "u-ali" }, demo)).toBe(true);
    expect(addsDemoHolder({ user_id: null }, null, demo)).toBe(false);
    // 1.1.5: a position of the pack's own asks nothing — its holders are the pack's people by design
    expect(addsDemoHolder({ user_id: "u-negar" }, null, demo, true)).toBe(false);
    expect(addsDemoHolder({ user_id: "u-negar" }, { user_id: "u-ali" }, demo, true)).toBe(false);
    expect(addsDemoHolder({ user_id: "u-negar" }, null, demo, false)).toBe(true);
    const q = demoHolderQuestion("نگار کارشناس‌پور");
    expect(q.title).toBe("«نگار کارشناس‌پور» حساب نمایشی است؛ دارندهٔ این نقش شود؟");
    expect(q.content).toContain("مرحله‌های پرونده‌های واقعی سازمان به حساب‌های نمایشی نمی‌رسد");
    expect(demoHolderQuestion(null).title).toBe("این شخص حساب نمایشی است؛ دارندهٔ این نقش شود؟");
  });

  it("a position's key as typed", () => {
    expect(keyInput("Branch-Head 2")).toBe("branchhead2");
    expect(validKey("branch_head")).toBe(true);
    expect(validKey("2head")).toBe(false);
  });
});

describe("the import and the preview", () => {
  it("the first non-empty row names the columns; empty rows are left out", () => {
    expect(sheetRows([[], ["کلید نقش", "ایمیل", ""], ["branch_head", "a@x.ir"], ["", ""], ["teller", "b@x.ir", "x"]])).toEqual({
      headers: ["کلید نقش", "ایمیل", "ستون 3"],
      rows: [
        { "کلید نقش": "branch_head", ایمیل: "a@x.ir", "ستون 3": "" },
        { "کلید نقش": "teller", ایمیل: "b@x.ir", "ستون 3": "x" },
      ],
    });
    expect(sheetRows([])).toEqual({ headers: [], rows: [] });
  });
  it("the result in words", () => {
    const r: HolderImportResult = { dry_run: true, total: 9, created: 5, updated: 1, unchanged: 1, removed: 0, skipped: [{ row: 3, message: "x" }], errors: [{ row: 4, message: "y" }] };
    expect(importSummary(r)).toBe("۵ تازه، ۱ به‌روز، ۱ بی‌تغییر؛ ۱ ردیف دست نخورد؛ ۱ خطا");
    expect(importSummary({ ...r, removed: 2, skipped: [], errors: [] })).toBe("۵ تازه، ۱ به‌روز، ۱ بی‌تغییر، ۲ برداشته");
  });
  it("the preview starts from the position's holder up the requester's tree, or anywhere", () => {
    expect(previewStep(pos({ key: "branch_head", name: "", unit_kind: "branch" }))).toEqual({ assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }] });
    expect(previewStep(pos({ key: "auditor", name: "" }))).toEqual({ assignees: [{ kind: "position", position: "auditor", where: "anywhere" }] });
    // 1.1.5: before a position is picked, «همه‌جا» as the designer's new rule — never «واحد درخواست‌دهنده»
    expect(previewStep(null)).toEqual({ assignees: [{ kind: "position", position: "", where: "anywhere" }] });
  });

  it("1.1.5: the preview starts as «تکمیل فرم» (an approval keeps the sample requester out) and speaks a preview's words (B7)", () => {
    expect(PREVIEW_ACTION).toBe("fill");
    expect(RESOLVE_STATUS.nobody.label).toBe("کسی پیدا نمی‌شود");
    expect(RESOLVE_STATUS.ok.label).toBe("پیدا می‌شود");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The same calls on a real organisation

describe("the screens' calls on a real organisation", () => {
  let e: EngineOrg;
  let P: string;
  let R: string;
  const U: Record<string, string> = {};
  let head: { userId: string };
  let staff: { userId: string };
  let teller: { userId: string; email: string };
  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    R = `${P}/r`;
    U.vanak = (await e.owner.post(`${R}/org_unit`, { name: "شعبهٔ ونک", code: "1001", kind: "branch" })).row.id;
    U.tajrish = (await e.owner.post(`${R}/org_unit`, { name: "شعبهٔ تجریش", code: "1002", kind: "branch" })).row.id;
    const as = async (email: string) => {
      const m = await e.member("member", email);
      await e.owner.put(`${P}/access/members/${m.userId}`, { roles: ["requester"], persona: "requester", org_unit_id: U.vanak });
      return m;
    };
    head = await as("head@example.com");
    staff = await as("staff@example.com");
    teller = { ...(await as("teller@example.com")), email: "teller@example.com" };
  }, 600_000);

  it("a position and a holder from the sheet's payloads; the overview counts them and the vacant branch", async () => {
    const position = (await e.owner.post(`${R}/position`, { name: "رئیس شعبه", key: "branch_head", unit_kind: "branch", reports_to: null, active: true, description: null })).row;
    await e.owner.post(`${R}/position_holder`, { kind: "primary", valid_from: null, valid_to: null, user_id: head.userId, org_unit_id: U.vanak, position_id: position.id });
    const o: { positions: PositionOverview[]; today: string } = await e.owner.get(`${P}/positions/overview`);
    const row = o.positions.find((p) => p.key === "branch_head")!;
    expect(row).toMatchObject({ holders: 1, units: 1, vacancies: 1, sources: { manual: 1, directory: 0, import: 0 } });
    expect(holdersText(row)).toBe("۱ نفر در ۱ شعبه");
    // the key never changes once made
    expect((await e.owner.patch(`${R}/position/${position.id}`, { key: "boss", version: position.version }, 400)).error.message).toMatch(/کلید/);
  });

  it("a file's holders: a dry run writes nothing, the import keeps them as «ورود از فایل»", async () => {
    await e.owner.post(`${R}/position`, { name: "تحویلدار", key: "teller", unit_kind: "branch", active: true });
    const { rows } = sheetRows([IMPORT_HEADERS, ["teller", teller.email, "1002", "موقت", "1405/08/01", ""], ["teller", "nobody@example.com", "1002", "", "", ""]]);
    const dry: HolderImportResult = await e.owner.post(`${P}/positions/holders/import`, { rows, mode: "merge", dry_run: true });
    expect(dry).toMatchObject({ dry_run: true, created: 1, errors: [{ row: 2 }] });
    let o: { positions: PositionOverview[] } = await e.owner.get(`${P}/positions/overview`);
    expect(o.positions.find((p) => p.key === "teller")?.holders).toBe(0);
    const run: HolderImportResult = await e.owner.post(`${P}/positions/holders/import`, { rows: rows.slice(0, 1), mode: "merge", dry_run: false });
    expect(importSummary(run)).toBe("۱ تازه، ۰ به‌روز، ۰ بی‌تغییر");
    const h = (await e.owner.get(`${R}/position_holder?size=50`)).rows.find((x: { user_id: string }) => x.user_id === teller.userId);
    expect(h).toMatchObject({ source: "import", kind: "temporary", org_unit_id: U.tajrish });
    o = await e.owner.get(`${P}/positions/overview`);
    expect(sourcesText(o.positions.find((p) => p.key === "teller")!.sources)).toBe("فایل ۱");
  });

  it("the preview finds the branch head for a requester of that branch, in the designer's words", async () => {
    const r: ResolveResult = await e.owner.post(`${P}/positions/resolve`, { step: previewStep(pos({ key: "branch_head", name: "", unit_kind: "branch" })), action: "approve", requester: staff.userId, label: "پیش‌نمایش" });
    expect(r.status).toBe("ok");
    expect(r.people.map((p) => p.user)).toEqual([head.userId]);
    expect(r.lines[0]).toMatch(/رئیس شعبه \(شعبهٔ ونک\)$/);
  });

  it("a service-desk manager places, changes and ends a holder; removing it is refused as the sheet does not offer it (F5-5)", async () => {
    const m = await e.member("member");
    await e.owner.put(`${P}/access/members/${m.userId}`, { roles: ["service_desk_manager"], persona: "agent" });
    // what the page offers them, from the grants the shell reads (GET /o/:org)
    const info = await m.client.get(P);
    expect(positionsAccess({ allows: (g) => gateAllows(info.access.grants, g), writable: true })).toMatchObject({ manage: true, remove: false });
    const position = (await m.client.post(`${R}/position`, { name: "معاون شعبه", key: "deputy", unit_kind: "branch", active: true })).row;
    const h = (await m.client.post(`${R}/position_holder`, { kind: "acting", valid_from: null, valid_to: null, user_id: staff.userId, org_unit_id: U.tajrish, position_id: position.id })).row;
    const ended = (await m.client.patch(`${R}/position_holder/${h.id}`, { valid_to: "2026-11-14", version: h.version })).row;
    await m.client.del(`${R}/position_holder/${h.id}?version=${ended.version}`, 403);
    // the organisation's administrator may
    await e.owner.del(`${R}/position_holder/${h.id}?version=${ended.version}`);
  });

  it("1.1.5: the pack's own position is marked on the page's list and the sheet's record; the organisation's own is not", async () => {
    const sys = await systemCtx(e.cfg, e.org);
    const pack = String((await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "position", { key: "aftab_branch_head", name: "رئیس شعبه (نمونه)", active: true }, { trusted: true })))).id);
    const own = (await e.owner.post(`${R}/position`, { name: "کارشناس اعتبارات", key: "credit_officer", unit_kind: null, active: true })).row.id as string;
    const o: { positions: PositionOverview[] } = await e.owner.get(`${P}/positions/overview`);
    expect([o.positions.find((p) => p.id === pack)?.demo, o.positions.find((p) => p.id === own)?.demo]).toEqual([true, false]);
    const api = {
      get: (path: string) => e.owner.get(`${P}${path}`),
      post: (path: string, body?: unknown) => e.owner.post(`${P}${path}`, body),
    } as unknown as OrgApi;
    expect([(await positionsApi.position(api, pack)).demo, (await positionsApi.position(api, own)).demo]).toEqual([true, false]);
    expect((await positionsApi.position(api, own)).key).toBe("credit_officer");
  });

  it("a requester reads the overview but may not preview or import", async () => {
    const m = await e.member("member");
    await e.owner.put(`${P}/access/members/${m.userId}`, { roles: ["requester"], persona: "requester" });
    expect((await m.client.get(`${P}/positions/overview`)).positions.length).toBeGreaterThan(0);
    await m.client.post(`${P}/positions/resolve`, { step: previewStep(null), action: "approve", requester: staff.userId }, 403);
    await m.client.post(`${P}/positions/holders/import`, { rows: [], mode: "merge", dry_run: true }, 403);
  });
});

// Pure logic of IT asset management (src/shared/itam/logic.ts): substates and CI statuses, depreciation (three
// methods, Jalali months), stock status, software normalisation, the effective licence position per metric, true-up
// projection, labels and scans, TCO and repair-or-replace.
import { describe, expect, it } from "vitest";
import {
  assetTagFor, assetTco, ciStatusOf, contractShare, depreciation, depreciationSchedule, labelSheet, licensePosition, matchSoftware, orderQuantity, paginate, parseScan,
  positionTotals, qrPayload, stockStatus, substateFor, trueUpProjection, warrantyStatus, type PosEntitlement, type PosInstall,
} from "@shared/itam/logic";

describe("lifecycle", () => {
  it("keeps a substate that fits the state, else the state's default", () => {
    expect(substateFor("in_stock", "reserved")).toBe("reserved");
    expect(substateFor("in_use", "reserved")).toBe("assigned");
    expect(substateFor("missing", null)).toBe("lost");
    expect(substateFor("disposed", "available")).toBeNull();
  });
  it("maps asset states to CI statuses", () => {
    expect(ciStatusOf("in_use", "assigned")).toEqual({ install_status: "installed", operational_status: "operational", ci_state: "operational" });
    expect(ciStatusOf("missing", "stolen").install_status).toBe("stolen");
    expect(ciStatusOf("disposed", null).ci_state).toBe("disposed");
  });
  it("tells warranty status and builds tags", () => {
    expect(warrantyStatus(null, "2026-01-01")).toBe("none");
    expect(warrantyStatus("2025-12-31", "2026-01-01")).toBe("expired");
    expect(warrantyStatus("2026-02-15", "2026-01-01")).toBe("expiring");
    expect(warrantyStatus("2027-01-01", "2026-01-01")).toBe("active");
    expect(assetTagFor("IT-", "AST0000123")).toBe("IT-0000123");
  });
});

describe("depreciation", () => {
  const start = "2026-03-21"; // 1 Farvardin 1405
  it("straight line spreads cost minus salvage exactly over the life", () => {
    const s = depreciationSchedule({ cost: "36000000", salvage: "0", lifeMonths: 36, method: "straight_line", start });
    expect(s).toHaveLength(36);
    expect(s[0].charge).toBe("1000000");
    expect(s[0].period).toBe("1405-01");
    expect(s[35].book).toBe("0");
    const d = depreciation({ cost: "36000000", lifeMonths: 36, method: "straight_line", start, asOf: "2026-06-25" }); // Tir 1405
    expect(d.months).toBe(4);
    expect(d.bookValue).toBe("32000000");
  });
  it("never goes below salvage and ends exactly on it", () => {
    for (const method of ["straight_line", "declining_balance", "sum_of_years"] as const) {
      const s = depreciationSchedule({ cost: "10000000", salvage: "1000000", lifeMonths: 24, method, start });
      expect(s[s.length - 1].book).toBe("1000000");
      for (const m of s) expect(Number(m.book)).toBeGreaterThanOrEqual(1000000);
      const total = s.reduce((a, m) => a + Number(m.charge), 0);
      expect(total).toBe(9000000);
    }
  });
  it("front-loads declining balance and sum of years", () => {
    const sl = depreciationSchedule({ cost: "12000000", lifeMonths: 36, method: "straight_line", start });
    const db = depreciationSchedule({ cost: "12000000", lifeMonths: 36, method: "declining_balance", start });
    const syd = depreciationSchedule({ cost: "12000000", lifeMonths: 36, method: "sum_of_years", start });
    expect(Number(db[0].charge)).toBeGreaterThan(Number(sl[0].charge));
    expect(Number(syd[0].charge)).toBeGreaterThan(Number(sl[0].charge));
    expect(depreciationSchedule({ cost: "1", lifeMonths: 12, method: "none", start })).toHaveLength(0);
  });
  it("is the full cost before the start and fully depreciated after the life", () => {
    expect(depreciation({ cost: "500", lifeMonths: 12, method: "straight_line", start, asOf: "2026-01-01" }).bookValue).toBe("500");
    const end = depreciation({ cost: "1200", lifeMonths: 12, method: "straight_line", start, asOf: "2030-01-01" });
    expect(end.fullyDepreciated).toBe(true);
    expect(end.bookValue).toBe("0");
    expect(end.monthCharge).toBe("0");
  });
});

describe("stock", () => {
  it("is out, low or ok against the reorder point", () => {
    expect(stockStatus(0, { min_qty: 2 })).toBe("out");
    expect(stockStatus(2, { min_qty: 2 })).toBe("low");
    expect(stockStatus(3, { min_qty: 2 })).toBe("ok");
    expect(stockStatus(0, { min_qty: 0 })).toBe("ok");
  });
  it("orders the fixed quantity or up to the target", () => {
    expect(orderQuantity(1, { min_qty: 2, max_qty: 10 })).toBe(9);
    expect(orderQuantity(1, { min_qty: 2, max_qty: 10, reorder_qty: 5 })).toBe(5);
    expect(orderQuantity(0, { min_qty: 3 })).toBe(4);
  });
});

describe("software normalisation", () => {
  const models = [
    { id: "office", name: "Office 2021", match_patterns: ["Office 2021", "Office Professional Plus 2021"] },
    { id: "acrobat", name: "Acrobat Pro", match_patterns: ["Adobe Acrobat"], exclude_patterns: ["Reader"] },
    { id: "eset", name: "ESET", match_patterns: ["/^ESET (Endpoint|File) Security/"], publisher_patterns: ["ESET"] },
  ];
  it("matches by the longest pattern, regexes, publishers and exclusions", () => {
    expect(matchSoftware({ name: "Microsoft Office Professional Plus 2021 - fa-ir" }, models)?.id).toBe("office");
    expect(matchSoftware({ name: "Adobe Acrobat DC (64-bit)" }, models)?.id).toBe("acrobat");
    expect(matchSoftware({ name: "Adobe Acrobat Reader DC" }, models)).toBeNull();
    expect(matchSoftware({ name: "ESET Endpoint Security", publisher: "ESET, spol. s r.o." }, models)?.id).toBe("eset");
    expect(matchSoftware({ name: "ESET Endpoint Security", publisher: "Unknown" }, models)).toBeNull();
    expect(matchSoftware({ name: "Notepad++" }, models)).toBeNull();
  });
});

describe("licence position", () => {
  const today = "2026-06-01";
  const ent = (o: Partial<PosEntitlement>): PosEntitlement => ({ id: o.id ?? "e1", metric: "per_device", quantity: 10, state: "active", unit_cost: "1000", ...o });
  const inst = (n: number, o: Partial<PosInstall> = {}): PosInstall[] => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, ci_id: `d${i}`, user_id: `u${i % 5}`, cores: 4, active: true, ...o }));

  it("counts devices and reports a shortfall with its exposure", () => {
    const p = licensePosition({ metric: "per_device", entitlements: [ent({ quantity: 10 })], installs: inst(12), today, unusedDays: 90 });
    expect(p.consumed).toBe(12);
    expect(p.delta).toBe(-2);
    expect(p.status).toBe("under_licensed");
    expect(p.exposure).toBe("2000");
  });
  it("counts users (a device without a user counts as one) and per-core minimums", () => {
    const users = licensePosition({ metric: "per_user", entitlements: [ent({ metric: "per_user", quantity: 5 })], installs: [...inst(6), { id: "x", ci_id: "dx", user_id: null, active: true }], today, unusedDays: 90 });
    expect(users.consumed).toBe(6);
    const cores = licensePosition({ metric: "per_core", entitlements: [ent({ metric: "per_core", quantity: 40, min_cores: 16 })], installs: [{ id: "a", ci_id: "s1", cores: 8 }, { id: "b", ci_id: "s2", cores: 24 }], today, unusedDays: 90 });
    expect(cores.consumed).toBe(16 + 24);
    expect(cores.status).toBe("compliant");
  });
  it("ignores entitlements not in force, flags the unlicensed, and treats site and free licences apart", () => {
    const expired = licensePosition({ metric: "per_device", entitlements: [ent({ end_date: "2026-01-01" })], installs: inst(1), today, unusedDays: 90 });
    expect(expired.status).toBe("unlicensed");
    expect(licensePosition({ metric: "per_device", entitlements: [ent({ metric: "site", quantity: 1 })], installs: inst(50), today, unusedDays: 90 }).status).toBe("unlimited");
    expect(licensePosition({ metric: "free", entitlements: [], installs: inst(3), today, unusedDays: 90 }).status).toBe("free");
  });
  it("finds savings in surplus and unused installs", () => {
    const old = "2026-01-01T00:00:00.000Z";
    const p = licensePosition({ metric: "per_device", entitlements: [ent({ quantity: 20 })], installs: [...inst(8), ...inst(2, { last_used_at: old }).map((x, i) => ({ ...x, id: `o${i}`, ci_id: `od${i}` }))], today, unusedDays: 90 });
    expect(p.consumed).toBe(10);
    expect(p.unused_installs).toBe(2);
    expect(p.reclaimable).toBe(2);
    expect(p.savings).toBe(String((10 + 2) * 1000));
    expect(p.status).toBe("over_licensed");
  });
  it("uses named allocations when the entitlement requires them", () => {
    const p = licensePosition({ metric: "subscription", entitlements: [ent({ metric: "subscription", quantity: 3, allocation_required: true })], installs: inst(10), allocations: [{ entitlement_id: "e1", user_id: "u1" }, { entitlement_id: "e1", user_id: "u2" }], today, unusedDays: 90 });
    expect(p.consumed).toBe(2);
    expect(p.status).toBe("over_licensed");
  });
  it("sums totals and projects a true-up", () => {
    const t = positionTotals([{ status: "under_licensed", exposure: "100", savings: "0" }, { status: "compliant", exposure: "0", savings: "50" }]);
    expect(t).toMatchObject({ products: 2, compliant: 1, under_licensed: 1, exposure: "100", savings: "50" });
    const proj = trueUpProjection([{ at: "2026-01-01", consumed: 10 }, { at: "2026-02-01", consumed: 12 }, { at: "2026-03-01", consumed: 14 }], 12, "500", "2026-06-01");
    expect(proj.projected).toBeGreaterThan(18);
    expect(proj.shortfall).toBe(proj.projected - 12);
    expect(proj.cost).toBe(String(proj.shortfall * 500));
  });
});

describe("labels and scans", () => {
  it("points QR codes at the asset page or falls back to the tag", () => {
    expect(qrPayload("https://itsm.example/", "org1", { id: "a1", asset_tag: "IT-1" })).toBe("https://itsm.example/org1/assets/a1");
    expect(qrPayload("", "org1", { id: "a1", asset_tag: "IT-1" })).toBe("IT-1");
  });
  it("reads links, ids, numbers and codes", () => {
    const id = "0190f3a2-1b2c-7d3e-8f40-123456789abc";
    expect(parseScan(`https://x/org/assets/${id}`)).toEqual({ kind: "id", value: id });
    expect(parseScan(id.toUpperCase())).toEqual({ kind: "id", value: id });
    expect(parseScan("ast-0000012")).toEqual({ kind: "number", value: "AST0000012" });
    expect(parseScan(" IT-۱۲۳ ")).toEqual({ kind: "code", value: "IT-123" });
    expect(parseScan("  ")).toBeNull();
  });
  it("lays out A4 sheets right to left and paginates with skipped cells", () => {
    const s = labelSheet({ cols_count: 3, rows_count: 8, label_width_mm: "63.5", label_height_mm: "33.9", margin_top_mm: "13", margin_side_mm: "7", gap_x_mm: "2.5", gap_y_mm: "0" });
    expect(s.perPage).toBe(24);
    expect(s.fits).toBe(true);
    expect(s.cells[0].x).toBeCloseTo(210 - 7 - 63.5);
    expect(s.cells[1].x).toBeLessThan(s.cells[0].x);
    expect(labelSheet({ cols_count: 4, label_width_mm: "60" }).fits).toBe(false);
    const pages = paginate([1, 2, 3, 4, 5], 4, 2);
    expect(pages).toEqual([[null, null, 1, 2], [3, 4, 5]]);
  });
});

describe("TCO and repair or replace", () => {
  it("sums the costs and recommends replacement when repairs reach half the replacement", () => {
    const t = assetTco({ purchase: "1000", repairs: ["300", "250"], contracts: "120", other: ["30"], months: 24, replacement: "1000", usefulLifeMonths: 36 });
    expect(t.total).toBe("1700");
    expect(t.monthly).toBe("71");
    expect(t.recommendation).toBe("replace");
    expect(assetTco({ purchase: "1000", repairs: ["310"], replacement: "1000" }).recommendation).toBe("watch");
    expect(assetTco({ purchase: "1000" }).recommendation).toBe("keep");
    expect(contractShare("1200", 4)).toBe("300");
  });
});

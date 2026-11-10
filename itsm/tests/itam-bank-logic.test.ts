// Pure logic of bank ITAM (src/shared/itam/bank.ts): depreciation by Jalali fiscal year, the transfer receipt,
// audit reconciliation, availability and maintenance penalties, the failure-risk score, asset-tag patterns,
// attestation periods and device-class attributes.
import { describe, expect, it } from "vitest";
import {
  attestationPeriod, availabilityOf, cleanAttributes, failureRisk, fiscalYearDepreciation, nextJalaliMonthStart, openDiscrepancies, penaltyOf, receiptOutcome, RESOLUTIONS_FOR,
  tagFromPattern, transferProblem, BANK_DEVICE_CLASSES, deviceClass, eosBucket,
} from "@shared/itam/bank";
import { fromJalali } from "@shared/jalali";
import { MODEL_CATEGORIES } from "@shared/tables/itam";
import { D } from "@shared/money";

describe("depreciation by Jalali fiscal year", () => {
  const base = { cost: "84000000", salvage: "0", lifeMonths: 84, method: "straight_line" as const, start: fromJalali(1403, 7, 15) };

  it("charges from the month after going into service and splits the years at 1 Farvardin", () => {
    const y1 = fiscalYearDepreciation({ ...base, convention: "next_month" }, 1403);
    expect(y1).toMatchObject({ acquired_in_year: true, opening_cost: "0", additions: "84000000", opening_accumulated: "0", charge: "5000000", closing_accumulated: "5000000", closing_book: "79000000", months_charged: 5 });
    const y2 = fiscalYearDepreciation({ ...base, convention: "next_month" }, 1404);
    expect(y2).toMatchObject({ acquired_in_year: false, opening_cost: "84000000", additions: "0", opening_accumulated: "5000000", charge: "12000000", closing_accumulated: "17000000", closing_book: "67000000", months_charged: 12 });
    // the same month: one month more in the first year
    expect(fiscalYearDepreciation({ ...base, convention: "same_month" }, 1403).charge).toBe("6000000");
    expect(nextJalaliMonthStart(fromJalali(1403, 12, 20))).toBe(fromJalali(1404, 1, 1));
  });

  it("stops at disposal, removes the cost and ends at zero after the useful life", () => {
    const d = fiscalYearDepreciation({ ...base, convention: "next_month", end: fromJalali(1405, 3, 10) }, 1405);
    expect(d).toMatchObject({ disposed_in_year: true, opening_accumulated: "17000000", charge: "3000000", closing_accumulated: "0", closing_book: "0", disposals: "84000000" });
    expect(fiscalYearDepreciation({ ...base, convention: "next_month", end: fromJalali(1405, 3, 10) }, 1406)).toMatchObject({ opening_cost: "0", charge: "0" });
    const last = fiscalYearDepreciation({ ...base, convention: "next_month" }, 1410);
    expect(last.charge).toBe("7000000");
    expect(fiscalYearDepreciation({ ...base, convention: "next_month" }, 1411)).toMatchObject({ charge: "0", closing_accumulated: "84000000", closing_book: "0" });
    // before the asset existed: nothing
    expect(fiscalYearDepreciation({ ...base, convention: "next_month" }, 1402)).toMatchObject({ opening_cost: "0", additions: "0", charge: "0" });
  });

  it("writes a declining-balance asset down to its residual value over the years", () => {
    const input = { cost: "100000000", salvage: "10000000", lifeMonths: 60, method: "declining_balance" as const, start: fromJalali(1402, 1, 1) };
    let total = D(0);
    for (let fy = 1402; fy <= 1407; fy++) total = total.plus(fiscalYearDepreciation(input, fy).charge);
    expect(total.toFixed(0)).toBe("90000000");
    const first = fiscalYearDepreciation(input, 1402);
    expect(D(first.charge).gt(fiscalYearDepreciation(input, 1403).charge)).toBe(true);
    expect(fiscalYearDepreciation(input, 1406).closing_book).toBe("10000000");
  });
});

describe("transfers", () => {
  it("refuses a note without items or to the same branch", () => {
    expect(transferProblem({ from_branch_id: "a", to_branch_id: "a" }, [{ asset_id: "x" }])).toContain("یکی است");
    expect(transferProblem({ from_branch_id: "a", to_branch_id: "b" }, [])).toContain("قلمی ندارد");
    expect(transferProblem({ from_branch_id: "a", to_branch_id: "b" }, [{ asset_id: "x" }])).toBeNull();
  });

  it("closes a receipt as complete or with discrepancies", () => {
    expect(receiptOutcome(["received", "received"])).toMatchObject({ state: "received", received: 2, discrepancies: 0 });
    expect(receiptOutcome(["received", "damaged", "missing"])).toEqual({ state: "received_partial", received: 2, damaged: 1, missing: 1, discrepancies: 2 });
    expect(receiptOutcome(["pending"]).missing).toBe(1);
  });
});

describe("audit reconciliation", () => {
  it("counts the discrepancies still open and allows the settlements that fit each result", () => {
    expect(openDiscrepancies([{ result: "found" }, { result: "missing", resolution: "none" }, { result: "moved", resolution: "transferred" }, { result: "unexpected" }])).toBe(2);
    expect(RESOLUTIONS_FOR.missing).toContain("confirmed_missing");
    expect(RESOLUTIONS_FOR.unexpected).toEqual(["registered", "ignored"]);
    expect(RESOLUTIONS_FOR.found).toEqual([]);
  });
});

describe("availability and penalties", () => {
  const from = "2026-01-01T00:00:00.000Z";
  const to = "2026-01-02T00:00:00.000Z";
  const now = Date.parse("2026-02-01T00:00:00.000Z");
  const periods = [
    { status: "in_service", from_at: "2025-12-30T00:00:00.000Z", to_at: "2026-01-01T06:00:00.000Z" },
    { status: "out_of_service", from_at: "2026-01-01T06:00:00.000Z", to_at: "2026-01-01T09:00:00.000Z" },
    { status: "in_service", from_at: "2026-01-01T09:00:00.000Z", to_at: "2026-01-01T12:00:00.000Z" },
    { status: "out_of_cash", from_at: "2026-01-01T12:00:00.000Z", to_at: "2026-01-01T13:00:00.000Z" },
    { status: "maintenance", from_at: "2026-01-01T20:00:00.000Z", to_at: "2026-01-02T02:00:00.000Z" },
  ];

  it("measures the share of the window in service", () => {
    const a = availabilityOf(periods.slice(0, 4), from, to, now);
    expect(a.window_minutes).toBe(1440);
    expect(a.down).toEqual({ out_of_service: 180, out_of_cash: 60 });
    expect(a.availability).toBe("83.33");
    // a period crossing the window's end is clipped
    expect(availabilityOf(periods, from, to, now).down.maintenance).toBe(240);
    expect(availabilityOf([], from, to, now).availability).toBe("100.00");
  });

  it("charges late hours beyond the restore time, with the monthly cap, planned maintenance excluded", () => {
    expect(penaltyOf(periods, { restore_hours: 2, penalty_per_hour: "1000000" }, from, to, now)).toEqual({ breaches: 1, late_hours: 1, amount: "1000000" });
    expect(penaltyOf(periods, { restore_hours: 2, penalty_per_hour: "1000000", counts_maintenance: true }, from, to, now)).toEqual({ breaches: 2, late_hours: 5, amount: "5000000" });
    expect(penaltyOf(periods, { restore_hours: 2, penalty_per_hour: "1000000", penalty_cap: "500000", counts_maintenance: true }, from, to, now).amount).toBe("500000");
  });

  it("scores the failure risk with its reasons", () => {
    const high = failureRisk({ incidents_90d: 5, downtime_minutes_30d: 600, age_months: 90, life_months: 84, eos_days: -10, status: "out_of_service" });
    expect(high.level).toBe("high");
    expect(high.score).toBe(90);
    expect(high.reasons.join(" ")).toContain("سیستم‌عامل");
    expect(failureRisk({ incidents_90d: 0, downtime_minutes_30d: 0, age_months: 10, life_months: 84, eos_days: 900, status: "in_service" })).toEqual({ score: 0, level: "low", reasons: [] });
    expect(eosBucket("2026-11-10", "2026-10-01")).toBe("past");
    expect(eosBucket("2026-11-10", "2027-02-01")).toBe("soon");
    expect(eosBucket("2026-11-10", null)).toBe("unknown");
  });
});

describe("tags, attestation periods, device classes", () => {
  it("builds asset tags from the organisation's pattern", () => {
    expect(tagFromPattern("{prefix}{branch}-{class}-{seq}", { prefix: "BK-", branch: "1001", cls: "ATM", number: "AST0000123" })).toBe("BK-1001-ATM-0000123");
    expect(tagFromPattern("{branch}-{seq}", { branch: null, number: "AST0000007" })).toBe("0000007");
    expect(tagFromPattern("", { number: "AST1" })).toBeNull();
  });

  it("finds the attestation period of a date", () => {
    const p = attestationPeriod("2026-11-10", 6)!;
    expect(p.label).toBe("1405 — نیمهٔ دوم");
    expect(p.start).toBe(fromJalali(1405, 7, 1));
    expect(attestationPeriod("2026-11-10", 0)).toBeNull();
    expect(attestationPeriod("2026-04-01", 3)!.label).toBe("1405 — فصل 1");
  });

  it("keeps attribute values to the class's definitions", () => {
    expect(cleanAttributes("atm", { cassettes: "4", deposit: true, bogus: 1 })).toEqual({ values: { cassettes: 4, deposit: true }, problem: null });
    expect(cleanAttributes("atm", { cassettes: -1 }).problem).toContain("کاست");
    expect(cleanAttributes("hsm", { fips_level: "Level 9" }).problem).toContain("FIPS");
    // every bank class is a model category
    for (const c of BANK_DEVICE_CLASSES) expect(MODEL_CATEGORIES.some((o) => o.value === c.key)).toBe(true);
    expect(deviceClass("atm")?.fleet).toBe(true);
    expect(deviceClass("pos")?.fleet).toBe(false);
  });
});

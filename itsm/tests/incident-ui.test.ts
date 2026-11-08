// Pure logic of the incident screens (src/ui/modules/incident/model.ts): the queues (valid conditions on the incident
// table, the clock-dependent one), row tones, the major-incident menu, the update cadence, durations, the merge primary,
// canned responses and the timeline filter.
import { describe, it, expect } from "vitest";
import { validateCond } from "@shared/model/conditions";
import { TABLES } from "@shared/tables";
import { AT_RISK_HOURS, QUEUES, cadence, cannedFor, cannedText, durationText, localInput, majorMenu, mergePrimary, queueOf, rowTone, visibleTimeline } from "@ui/modules/incident/model";

const def = TABLES.get("incident")!;
const now = Date.parse("2026-11-07T10:00:00Z");

describe("queues", () => {
  it("are the agent workspace's seven queues with valid conditions, columns and sorts", () => {
    expect(QUEUES.map((q) => q.label)).toEqual(["رخدادهای من", "بی‌مسئول در گروه‌های من", "اولویت بالا", "نزدیک به نقض توافق", "منتظر درخواست‌دهنده", "حل‌شده امروز", "رخدادهای عمده"]);
    for (const q of QUEUES) {
      expect(validateCond(q.filter(now), def), q.key).toBeNull();
      for (const c of q.columns) expect(def.fields.some((f) => f.name === c), `${q.key}: ${c}`).toBe(true);
      for (const s of q.sort.split(",")) expect(def.fields.some((f) => f.name === s.replace(/^-/, "") && f.sort), `${q.key}: ${s}`).toBe(true);
      expect(q.path.startsWith("incidents/")).toBe(true);
    }
    const risk = queueOf("at-risk")!.filter(now) as { and: { f: string; v?: unknown }[] };
    expect(risk.and[1].v).toBe(new Date(now + AT_RISK_HOURS * 3600_000).toISOString());
    expect(queueOf("nope")).toBeUndefined();
  });

  it("tints rows that need attention", () => {
    expect(rowTone({ active: true, major_state: "accepted" }, now)).toBe("danger");
    expect(rowTone({ active: true, sla_due: "2026-11-07T09:00:00Z" }, now)).toBe("danger");
    expect(rowTone({ active: true, priority: "1" }, now)).toBe("warning");
    expect(rowTone({ active: true, sla_due: "2026-11-07T10:30:00Z" }, now)).toBe("warning");
    expect(rowTone({ active: true, priority: "3", sla_due: "2026-11-08T10:00:00Z" }, now)).toBeNull();
    expect(rowTone({ active: false, priority: "1" }, now)).toBeNull();
  });
});

describe("major incidents", () => {
  it("offers what the person may do now", () => {
    const keys = (s: string | null, open: boolean, may: { work: boolean; manage: boolean }) => majorMenu(s, open, may).map((m) => m.action);
    expect(keys(null, true, { work: true, manage: false })).toEqual(["propose"]);
    expect(keys(null, true, { work: true, manage: true })).toEqual(["declare"]);
    expect(keys("candidate", true, { work: true, manage: true })).toEqual(["declare", "reject"]);
    expect(keys("proposed", true, { work: true, manage: false })).toEqual([]);
    expect(keys("accepted", true, { work: true, manage: true })).toEqual(["downgrade"]);
    expect(keys(null, false, { work: true, manage: true })).toEqual([]);
    expect(keys("candidate", true, { work: false, manage: false })).toEqual([]);
    expect(majorMenu("proposed", true, { work: true, manage: true }).find((m) => m.action === "reject")!.reason).toBe(true);
  });

  it("says when the next update is due", () => {
    expect(cadence(null, now)).toEqual({ tone: null, text: "" });
    expect(cadence("2026-11-07T10:30:00Z", now)).toEqual({ tone: "neutral", text: "۳۰ دقیقه تا اطلاع‌رسانی بعدی" });
    expect(cadence("2026-11-07T10:05:00Z", now).tone).toBe("warning");
    expect(cadence("2026-11-07T09:00:00Z", now)).toEqual({ tone: "danger", text: "۱ ساعت از موعد اطلاع‌رسانی گذشته است" });
  });
});

describe("helpers", () => {
  it("writes durations in Persian", () => {
    expect(durationText(5400)).toBe("۱ ساعت و ۳۰ دقیقه");
    expect(durationText(20)).toBe("کمتر از یک دقیقه");
    expect(durationText(null)).toBe("");
  });

  it("picks the oldest incident as the merge primary", () => {
    const { primary, rest } = mergePrimary([
      { id: "b", opened_at: "2026-11-02T00:00:00Z", number: "INC2" },
      { id: "a", opened_at: "2026-11-01T00:00:00Z", number: "INC1" },
      { id: "c", opened_at: "2026-11-03T00:00:00Z", number: "INC3" },
    ]);
    expect([primary!.id, rest.map((r) => r.id)]).toEqual(["a", ["b", "c"]]);
    expect(mergePrimary([])).toEqual({ primary: null, rest: [] });
  });

  it("fills canned responses and offers those of the tab, the category first", () => {
    const row = { number: "INC0000007", short_description: "چاپگر", caller_id: "u1", assigned_to: "u2", assignment_group_id: "g1", category: "hardware" };
    const display = { u1: "سارا", u2: "علی", g1: "میز خدمت" };
    expect(cannedText("{{caller}} گرامی، {{number}} ({{title}}) را {{assignee}} از {{group}} پیگیری می‌کند — {{me}}", row, display, "مینا")).toBe("سارا گرامی، INC0000007 (چاپگر) را علی از میز خدمت پیگیری می‌کند — مینا");
    const rows = [
      { id: "1", name: "ب", kind: "comment", active: true, sort_order: 10 },
      { id: "2", name: "الف", kind: "work_note", active: true, sort_order: 5 },
      { id: "3", name: "ج", kind: "both", active: true, sort_order: 50, category: "hardware" },
      { id: "4", name: "د", kind: "comment", active: false },
    ];
    expect(cannedFor(rows, "comment", "hardware").map((r) => r.id)).toEqual(["3", "1"]);
    expect(cannedFor(rows, "work_note", null).map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("filters the timeline and writes local times", () => {
    expect(visibleTimeline([{ key: true }, { key: false }, {}], true)).toHaveLength(1);
    expect(visibleTimeline([{ key: true }, { key: false }], false)).toHaveLength(2);
    expect(localInput(Date.parse("2026-11-07T06:30:00Z"), "Asia/Tehran")).toBe("2026-11-07T10:00");
  });
});

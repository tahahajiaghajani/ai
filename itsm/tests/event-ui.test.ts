// The event screens' pure logic: labels and tones, the console's rows and key map, relative times and durations, and
// the on-call calendar's items (people in their colours, gaps in red, hours per person).
import { describe, expect, it } from "vitest";
import { ago, canAck, consoleRows, durationText, hoursPerPerson, keyAction, layerItems, onCallAtView, personColor, seenLine, severityTone, shiftItems } from "../src/ui/modules/event/model";
import type { ConsoleView, ShiftsView } from "@shared/event/api";

const alert = (id: string, extra: Record<string, unknown> = {}) => ({ id, number: id, short_description: id, severity: "minor", priority: "3", state: "open", node: null, resource: null, metric: null, ci_id: null, service_id: null, assignment_group_id: null, assigned_to: null, event_count: 1, first_seen_at: null, last_seen_at: null, group_id: null, incident_id: null, noise_label: null, escalation_state: null, escalation_level: null, symptom: false, source_id: null, acknowledged_at: null, snoozed_until: null, version: 1, can_respond: true, ...extra });

describe("console", () => {
  const view: ConsoleView = {
    groups: [
      { id: "g1", number: "SIT1", title: "a", severity: "minor", priority: "3", state: "open", reason: "ci", alert_count: 1, open_count: 1, assignment_group_id: null, assigned_to: null, incident_id: null, first_seen_at: null, last_seen_at: "2026-11-09T08:00:00Z", ci_id: null, alerts: [alert("a1", { group_id: "g1" })] },
      { id: "g2", number: "SIT2", title: "b", severity: "critical", priority: "1", state: "open", reason: "ci", alert_count: 2, open_count: 2, assignment_group_id: null, assigned_to: null, incident_id: null, first_seen_at: null, last_seen_at: "2026-11-09T07:00:00Z", ci_id: null, alerts: [alert("a2", { group_id: "g2" }), alert("a3", { group_id: "g2" })] },
    ],
    alerts: [alert("a4")],
    counts: { total: 4, open: 4, acknowledged: 0, critical: 1, unassigned: 4 },
    display: {},
    truncated: false,
  };

  it("orders groups worst first, with their alerts when expanded, then lone alerts", () => {
    expect(consoleRows(view, new Set(["g1", "g2"])).map((r) => r.id)).toEqual(["g2", "a2", "a3", "g1", "a1", "a4"]);
    expect(consoleRows(view, new Set()).map((r) => r.id)).toEqual(["g2", "g1", "a4"]);
    expect(consoleRows(undefined, new Set())).toEqual([]);
  });

  it("maps physical keys to actions, never while typing or with modifiers", () => {
    expect(keyAction({ code: "KeyA" })).toBe("ack");
    expect(keyAction({ code: "KeyJ" })).toBe("next");
    expect(keyAction({ code: "KeyA", ctrlKey: true })).toBeNull();
    expect(keyAction({ code: "KeyA", target: { tagName: "INPUT" } })).toBeNull();
    expect(keyAction({ code: "KeyQ" })).toBeNull();
    expect(canAck("open")).toBe(true);
    expect(canAck("acknowledged")).toBe(false);
    expect(severityTone("critical")).toBe("danger");
    expect(severityTone("info")).toBe("neutral");
  });

  it("says times and durations in Persian", () => {
    const now = Date.parse("2026-11-09T10:00:00Z");
    expect(ago("2026-11-09T09:55:00Z", now)).toBe("۵ دقیقه پیش");
    expect(ago("2026-11-09T07:00:00Z", now)).toBe("۳ ساعت پیش");
    expect(durationText(125 * 60_000)).toBe("۲ ساعت و ۵ دقیقه");
    expect(durationText(30_000)).toBe("۳۰ ثانیه");
    expect(seenLine({ event_count: 3, first_seen_at: "2026-11-09T09:00:00Z", last_seen_at: "2026-11-09T09:55:00Z" }, now)).toBe("۳ رویداد · نخست ۱ ساعت پیش · آخرین ۵ دقیقه پیش");
  });
});

describe("on-call calendar", () => {
  const view: ShiftsView = {
    schedule: { id: "s", name: "کشیک", group_id: null, timezone: "Asia/Tehran", calendar_id: null },
    from: "2026-11-07T00:00:00.000Z",
    to: "2026-11-08T00:00:00.000Z",
    final: [
      { start: "2026-11-07T00:00:00.000Z", end: "2026-11-07T08:00:00.000Z", user_id: "u1", layer: 1, rotation_id: "r", override_id: null },
      { start: "2026-11-07T08:00:00.000Z", end: "2026-11-07T10:00:00.000Z", user_id: null, layer: null, rotation_id: null, override_id: null },
      { start: "2026-11-07T10:00:00.000Z", end: "2026-11-08T00:00:00.000Z", user_id: "u2", layer: 1, rotation_id: "r", override_id: "o" },
    ],
    layers: [{ rotation_id: "r", name: "هفتگی", layer: 1, restriction: "none", shifts: [{ start: "2026-11-07T00:00:00.000Z", end: "2026-11-08T00:00:00.000Z", user_id: "u1", layer: 1, rotation_id: "r", override_id: null }] }],
    overrides: [],
    gaps: [{ start: "2026-11-07T08:00:00.000Z", end: "2026-11-07T10:00:00.000Z" }],
    now: "2026-11-07T09:00:00.000Z",
    can_take: true,
    display: { u1: "علی", u2: "سارا" },
  };

  it("draws people in stable colours and gaps in red", () => {
    const items = shiftItems(view);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ label: "علی", color: personColor("u1") });
    expect(items[1]).toMatchObject({ label: "خلأ پوشش", tone: "danger" });
    expect(items[2].label).toContain("جایگزین");
    expect(personColor("u1")).toBe(personColor("u1"));
    expect(personColor(null)).toBe("gray");
    expect(layerItems(view, "r")).toHaveLength(1);
    expect(onCallAtView(view, Date.parse("2026-11-07T11:00:00Z"))).toBe("u2");
    expect(onCallAtView(view, Date.parse("2026-11-07T09:00:00Z"))).toBeNull();
    expect(hoursPerPerson(view)).toEqual([{ user_id: "u2", hours: 14 }, { user_id: "u1", hours: 8 }]);
  });
});

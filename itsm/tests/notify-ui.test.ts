// Pure logic of the notification screens (src/ui/modules/notify/model.ts): the notification center's day groups,
// snooze times and badge, the preference matrix, quiet-time checks, the rule list's recipient sentence, the template
// editor's placeholders and caret insertion, and a rule condition split into the builder's part and the change trigger.
import { describe, it, expect } from "vitest";
import {
  badgeText, dayGroup, groupByDay, insertAt, joinChange, placeholdersFor, quietProblem, receives, recipientFields, recipientParts,
  setReceive, snoozeOptions, splitChange, ruleTableOk,
} from "@ui/modules/notify/model";
import { CHANNEL_POLICIES, EMAIL_POLICIES, channelDefaults } from "@ui/modules/notify/channels";
import { NOTIFY_TABLES } from "@shared/tables/notify";
import { DEFAULT_PREFS, type NotifyPrefs } from "@shared/notify";
import { validateCond, type Cond } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";

const TZ = "Asia/Tehran"; // UTC+03:30, no daylight saving

describe("notification center", () => {
  it("groups items by the local day", () => {
    const now = new Date("2026-11-07T08:00:00Z"); // 11:30 Tehran, Saturday
    expect(dayGroup("2026-11-07T07:00:00Z", now, TZ)).toBe("today");
    expect(dayGroup("2026-11-06T20:30:00Z", now, TZ)).toBe("today"); // 00:00 Tehran
    expect(dayGroup("2026-11-06T20:29:00Z", now, TZ)).toBe("yesterday"); // 23:59 Tehran
    expect(dayGroup("2026-11-06T20:00:00Z", now, "UTC")).toBe("yesterday");
    expect(dayGroup("2026-11-06T10:00:00Z", now, TZ)).toBe("yesterday");
    expect(dayGroup("2026-11-03T10:00:00Z", now, TZ)).toBe("week");
    expect(dayGroup("2026-10-20T10:00:00Z", now, TZ)).toBe("older");
    const g = groupByDay(
      [{ shown_at: "2026-11-07T07:00:00Z" }, { shown_at: "2026-11-07T06:00:00Z" }, { shown_at: "2026-11-05T06:00:00Z" }, { shown_at: "2026-09-01T06:00:00Z" }],
      now,
      TZ,
    );
    expect(g.map((x) => [x.key, x.label, x.items.length])).toEqual([
      ["today", "امروز", 2],
      ["week", "هفتهٔ گذشته", 1],
      ["older", "پیش‌تر", 1],
    ]);
  });

  it("offers snooze times in the organisation's zone (tomorrow and Saturday at 8)", () => {
    const sat = new Date("2026-11-07T08:00:00Z"); // Saturday 11:30 Tehran
    const o = Object.fromEntries(snoozeOptions(sat, TZ).map((x) => [x.key, x.minutes]));
    expect(o["1h"]).toBe(60);
    expect(o["3h"]).toBe(180);
    const at = (m: number) => new Date(sat.getTime() + m * 60_000).toISOString();
    expect(at(o.tomorrow)).toBe("2026-11-08T04:30:00.000Z"); // Sunday 08:00 Tehran
    expect(at(o.week)).toBe("2026-11-14T04:30:00.000Z"); // next Saturday 08:00
    const fri = new Date("2026-11-13T19:00:00Z"); // Friday 22:30 Tehran
    const f = Object.fromEntries(snoozeOptions(fri, TZ).map((x) => [x.key, x.minutes]));
    expect(new Date(fri.getTime() + f.tomorrow * 60_000).toISOString()).toBe("2026-11-14T04:30:00.000Z");
    expect(f.week).toBe(f.tomorrow); // tomorrow is Saturday
    const early = new Date("2026-11-08T00:00:00Z"); // Sunday 03:30: «tomorrow» is Monday, not today
    const e = Object.fromEntries(snoozeOptions(early, TZ).map((x) => [x.key, x.minutes]));
    expect(new Date(early.getTime() + e.tomorrow * 60_000).toISOString()).toBe("2026-11-09T04:30:00.000Z");
  });

  it("writes the badge in Persian digits, capped at 99", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(7)).toBe("۷");
    expect(badgeText(42)).toBe("۴۲");
    expect(badgeText(250)).toBe("۹۹+");
  });
});

describe("preferences", () => {
  const p = (optouts: string[]): NotifyPrefs => ({ ...DEFAULT_PREFS, optouts });

  it("reads and switches cells of the matrix", () => {
    expect(receives(p([]), "assigned", "email")).toBe(true);
    expect(receives(p(["assigned:email"]), "assigned", "email")).toBe(false);
    expect(receives(p(["assigned:email"]), "assigned", "in_app")).toBe(true);
    expect(receives(p(["*:sms"]), "commented", "sms")).toBe(false);
    expect(receives(p(["*:sms"]), "*", "sms")).toBe(false);
    let x = setReceive(p([]), "commented", "email", false);
    expect(x.optouts).toEqual(["commented:email"]);
    x = setReceive(x, "*", "email", false);
    expect(x.optouts).toEqual(["*:email", "commented:email"]);
    // the whole channel back on keeps the choice underneath
    x = setReceive(x, "*", "email", true);
    expect(x.optouts).toEqual(["commented:email"]);
    expect(receives(x, "commented", "email")).toBe(false);
    expect(setReceive(x, "commented", "email", true).optouts).toEqual([]);
  });

  it("checks quiet hours", () => {
    expect(quietProblem(null, null)).toBeNull();
    expect(quietProblem("22:00", "07:00")).toBeNull();
    expect(quietProblem("22:00", null)).toMatch(/هر دو/);
    expect(quietProblem("25:00", "07:00")).toMatch(/۲۲:۰۰/);
    expect(quietProblem("08:00", "08:00")).toMatch(/یکی/);
  });
});

describe("rules", () => {
  const def = {
    key: "nt",
    module: "test",
    fields: [
      { name: "assigned_to", label: "کارشناس", type: "user" },
      { name: "approvers", label: "تأییدکنندگان", type: "users" },
      { name: "assignment_group", label: "گروه", type: "group" },
      { name: "secret_owner", label: "پنهان", type: "user", hidden: true },
      { name: "short_description", label: "عنوان", type: "string" },
      { name: "state", label: "وضعیت", type: "choice" },
      { name: "ci", label: "پیکربندی", type: "ref", ref: "ci" },
      { name: "token", label: "کلید", type: "secret" },
    ],
  } as unknown as TableDef;

  it("offers user and group fields as recipients and describes recipients in Persian", () => {
    expect(recipientFields(def).map((f) => f.name)).toEqual(["assigned_to", "approvers", "assignment_group"]);
    expect(recipientParts({ assignee: true, watchers: true })).toEqual(["کارشناس رکورد", "پیگیری‌کنندگان"]);
    const users = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
    expect(recipientParts({ fields: ["approvers"], users, roles: ["agent"] }, { field: (n) => def.fields.find((f) => f.name === n)?.label, role: () => "کارشناس پشتیبانی" })).toEqual([
      "فیلد «تأییدکنندگان»",
      "۳ عضو",
      "نقش «کارشناس پشتیبانی»",
    ]);
    expect(recipientParts({ users: users.slice(0, 2) }, { user: (id) => (id.endsWith("1") ? "مینا" : "رضا") })).toEqual(["مینا", "رضا"]);
    expect(recipientParts({ groups: users.slice(0, 1) })).toEqual(["۱ گروه"]);
  });

  it("keeps the service's own tables and virtual tables out of the table list", () => {
    expect(ruleTableOk({ key: "todo", module: "records", virtual: false } as never)).toBe(true);
    expect(ruleTableOk({ key: "notification", module: "notify" } as never)).toBe(false);
    expect(ruleTableOk({ key: "user", module: "core", virtual: true } as never)).toBe(false);
  });

  it("splits a condition into the builder's part and the change trigger, and joins them back", () => {
    const base: Cond = { f: "priority", op: "eq", v: "1" };
    const change: Cond = { f: "state", op: "changes_to", v: "done" };
    expect(splitChange(null)).toEqual({ base: null, change: null, complex: false });
    expect(splitChange({} as Cond)).toEqual({ base: null, change: null, complex: false });
    expect(splitChange(base)).toEqual({ base, change: null, complex: false });
    expect(splitChange(change)).toEqual({ base: null, change, complex: false });
    expect(splitChange({ and: [base, change] })).toEqual({ base, change, complex: false });
    const two: Cond = { and: [base, { f: "x", op: "eq", v: 1 }, change] };
    expect(splitChange(two)).toEqual({ base: { and: [base, { f: "x", op: "eq", v: 1 }] }, change, complex: false });
    expect(splitChange({ or: [base, change] }).complex).toBe(true);
    expect(splitChange({ and: [change, { f: "y", op: "changed" }] }).complex).toBe(true);
    expect(joinChange(null, null)).toBeNull();
    expect(joinChange(base, null)).toEqual(base);
    expect(joinChange(null, change as never)).toEqual(change);
    expect(joinChange(base, change as never)).toEqual({ and: [base, change] });
    expect(joinChange({ and: [base] }, change as never)).toEqual({ and: [base, change] });
    // round trip
    const s = splitChange(two);
    expect(joinChange(s.base, s.change)).toEqual({ and: [base, { f: "x", op: "eq", v: 1 }, change] });
  });
});

describe("template editor", () => {
  it("lists the common placeholders, then the table's fields (names of references, no secrets)", () => {
    const def = {
      fields: [
        { name: "short_description", label: "عنوان", type: "string" },
        { name: "assigned_to", label: "کارشناس", type: "user" },
        { name: "state", label: "وضعیت", type: "choice" },
        { name: "token", label: "کلید", type: "secret" },
        { name: "extra", label: "داده", type: "json" },
        { name: "internal", label: "درونی", type: "string", hidden: true },
      ],
    } as unknown as TableDef;
    const all = placeholdersFor(def);
    expect(all.slice(0, 3).map((p) => p.path)).toEqual(["record.display", "record.number", "record.title"]);
    expect(all.some((p) => p.path === "link")).toBe(true);
    expect(all.filter((p) => p.group === "field").map((p) => p.path)).toEqual(["short_description", "assigned_to", "assigned_to.display", "state"]);
    expect(placeholdersFor(undefined).every((p) => p.group === "common")).toBe(true);
  });

  it("inserts at the caret (or at the end)", () => {
    expect(insertAt("سلام دنیا", "{{x}}", 5)).toEqual({ value: "سلام {{x}}دنیا", caret: 10 });
    expect(insertAt("abc", "{{x}}", null)).toEqual({ value: "abc{{x}}", caret: 8 });
    expect(insertAt("abc", "{{x}}", 99)).toEqual({ value: "abc{{x}}", caret: 8 });
  });
});

describe("channel forms", () => {
  it("show only the fields a kind uses: policies name real fields with valid conditions", () => {
    for (const [table, policies] of [["notification_channel", CHANNEL_POLICIES], ["email_channel", EMAIL_POLICIES]] as const) {
      const def = NOTIFY_TABLES.find((t) => t.key === table)!;
      for (const p of policies) {
        expect(validateCond(p.when, def), p.key).toBeNull();
        for (const a of p.actions) expect(def.fields.some((f) => f.name === a.field), `${p.key}: ${a.field}`).toBe(true);
        // a stored secret is not sent back to the form: never required there
        for (const a of p.actions) if (a.mandatory) expect(def.fields.find((f) => f.name === a.field)!.type).not.toBe("secret");
      }
    }
  });

  it("start a new channel from the address (kind, SMS preset)", () => {
    expect(channelDefaults(new URLSearchParams("preset=kavenegar"))).toMatchObject({ kind: "sms", name: "کاوه‌نگار", sms_method: "POST", sms_content_type: "form" });
    expect(channelDefaults(new URLSearchParams("kind=telegram"))).toEqual({ kind: "telegram" });
    expect(channelDefaults(new URLSearchParams("kind=Bad!&preset=nope"))).toEqual({});
  });
});

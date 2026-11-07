// The rest of the record UI's pure model: form layout (definition and the organisation's arrangement), the activity
// stream, mentions, values and change sets, SLA timers and viewers, calendar/timeline geometry, the kanban board's
// drops, the list page's URL state and saved views.
import { describe, expect, it } from "vitest";
import { tableDef } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { cleanArrangement, FORM_ROW } from "@shared/model/arrangement";
import { arrangementOf, formLayout, layoutFieldNames, spanOf, SYSTEM_SECTION } from "../src/ui/records/model/layout";
import { activityCounts, filterActivity, groupChanges, mergeActivity } from "../src/ui/records/model/activity";
import { formatMention, insertMention, isMentionHref, mentionAt, mentionedIds } from "../src/ui/records/model/mentions";
import { changedValues, formatDuration, sameValue, splitDuration, valueText } from "../src/ui/records/model/values";
import { otherViewers, slaText, slaTimers, viewersText } from "../src/ui/records/model/sla";
import { dayOf, eventsOn, monthGrid, moveEvent, shiftMonth, shiftValue, timelineBars, toEvents, weekOf, weekTitle, windowFilter } from "../src/ui/records/model/calendar";
import { aggregateColumns, boardField, choiceColumns, planDrop, wipState } from "../src/ui/records/model/kanban";
import { defaultView, emptyListState, groupViews, readListState, stateOfView, viewBody, viewDirty, writeListState } from "../src/ui/records/model/views";
import { offeredOptions, optionLabel, recordLabel } from "../src/ui/records/model/schema";
import type { HistoryEntry, JournalEntry, RecordRow, ViewRow } from "../src/ui/records/model/types";
import { validateCond } from "@shared/model/conditions";

const todo = tableDef("todo")!;
const lookup = (k: string) => tableDef(k);
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("form layout", () => {
  it("lays a task table out from its definition: no state, number or watch list in the body; engine fields last", () => {
    const tabs = formLayout(todo, { mode: "update" });
    expect(tabs.map((t) => t.label)).toEqual(["جزئیات"]);
    const names = layoutFieldNames(tabs);
    expect(names[0]).toBe("short_description");
    expect(names).not.toContain("state");
    expect(names).not.toContain("number");
    expect(names).not.toContain("watch_list");
    expect(names).not.toContain("workspace_id");
    const last = tabs[0].sections[tabs[0].sections.length - 1];
    expect(last).toMatchObject({ label: SYSTEM_SECTION, system: true });
    expect(last.fields.map((f) => f.name)).toContain("created_at");
    expect(layoutFieldNames(formLayout(todo, { mode: "create" }))).not.toContain("opened_at");
  });

  it("follows declared sections and tabs", () => {
    const def: TableDef = {
      ...todo,
      form: { sections: ["اصلی", "حل"], tabs: ["تحلیل"] },
      fields: todo.fields.map((f) => (f.name === "close_notes" || f.name === "close_code" ? { ...f, section: "حل" } : f.name === "estimate" ? { ...f, tab: "تحلیل" } : f)),
    };
    const tabs = formLayout(def, { mode: "create" });
    expect(tabs.map((t) => t.label)).toEqual(["جزئیات", "تحلیل"]);
    expect(tabs[0].sections.map((s) => s.label)).toEqual(["اصلی", "حل"]);
    expect(tabs[0].sections[1].fields.map((f) => f.name)).toEqual(["close_code", "close_notes"]);
    expect(tabs[1].sections[0].fields.map((f) => f.name)).toEqual(["estimate"]);
  });

  it("uses the organisation's arrangement and keeps unplaced fields in their default place", () => {
    const def: TableDef = {
      ...todo,
      form: { arrangement: { tabs: [{ label: "اصلی", sections: [{ label: "خلاصه", fields: ["priority", "short_description", "ghost"] }] }, { label: "بستن", sections: [{ label: null, fields: ["close_notes"] }] }] } },
    };
    const tabs = formLayout(def, { mode: "create" });
    expect(tabs.map((t) => t.label)).toEqual(["اصلی", "بستن"]);
    const first = tabs[0].sections[0].fields.map((f) => f.name);
    expect(first.slice(0, 2)).toEqual(["priority", "short_description"]);
    expect(first).toContain("description"); // not named: joins the first section
    expect(tabs[1].sections[0].fields.map((f) => f.name)).toEqual(["close_notes"]);
    expect(formLayout(def, { mode: "create", ignoreArrangement: true })[0].label).toBe("جزئیات");
    // the designer starts from the current layout
    expect(arrangementOf(def).tabs[0].sections[0].fields.slice(0, 2)).toEqual(["priority", "short_description"]);
  });

  it("gives wide types a whole row", () => {
    const f = (n: string) => todo.fields.find((x) => x.name === n)!;
    expect(spanOf(f("description"))).toBe(24);
    expect(spanOf(f("priority"))).toBe(8);
  });
});

describe("the arrangement row", () => {
  it("is cleaned: labels trimmed, names checked, every field once, text accepted", () => {
    expect(FORM_ROW).toBe("_form");
    const a = cleanArrangement({ tabs: [{ label: "  اصلی  ", sections: [{ label: "", fields: ["state", "state", "Bad Name", "u_cost", 7] }] }, "x", { sections: "no" }] });
    expect(a).toEqual({ tabs: [{ label: "اصلی", sections: [{ label: null, fields: ["state", "u_cost"] }] }, { label: "جزئیات", sections: [] }] });
    expect(cleanArrangement(JSON.stringify({ tabs: [{ label: "x", sections: [] }] }))).toEqual({ tabs: [{ label: "x", sections: [] }] });
    expect(cleanArrangement("nope")).toBeNull();
    expect(cleanArrangement({ tabs: [] })).toBeNull();
    expect(cleanArrangement(null)).toBeNull();
  });
});

describe("activity stream", () => {
  const j = (id: string, at: string, kind: JournalEntry["kind"], visibility: JournalEntry["visibility"]): JournalEntry => ({ id, kind, visibility, body: id, author: U1, created_at: at, data: null, attachments: [] });
  const h = (id: string, at: string, field: string, old: unknown, nw: unknown, actor = U1): HistoryEntry => ({ id, field, label: field, type: "string", old, new: nw, actor, at });

  it("groups one save's field changes, marks the creation and merges with the journal newest first", () => {
    const history = [
      h("h1", "2026-11-01T10:00:00.000Z", "short_description", null, "چاپگر"),
      h("h2", "2026-11-01T10:00:00.400Z", "priority", null, "3"),
      h("h3", "2026-11-02T08:00:00.000Z", "priority", "3", "2", U2),
      h("h4", "2026-11-02T08:00:01.000Z", "assigned_to", null, U1, U2),
      h("h5", "2026-11-02T08:00:01.500Z", "priority", "2", "1", U2),
    ];
    expect(groupChanges(history).map((g) => g.map((x) => x.id))).toEqual([["h1", "h2"], ["h3", "h4"], ["h5"]]);
    const items = mergeActivity([j("c1", "2026-11-03T09:00:00.000Z", "comment", "public"), j("w1", "2026-11-02T08:00:00.000Z", "work_note", "internal")], history, "2026-11-01T10:00:00.000Z");
    expect(items.map((i) => i.key)).toEqual(["j:c1", "h:h5", "j:w1", "h:h3", "h:h1"]);
    expect(items[items.length - 1].created).toBe(true);
    expect(items.find((i) => i.key === "h:h3")!.created).toBeUndefined();
  });

  it("filters by the chips and counts them", () => {
    const items = mergeActivity(
      [j("c1", "2026-11-03T09:00:00Z", "comment", "public"), j("w1", "2026-11-03T08:00:00Z", "work_note", "internal"), j("s1", "2026-11-03T07:00:00Z", "system", "public")],
      [h("h1", "2026-11-03T06:00:00Z", "priority", "3", "2")],
    );
    expect(filterActivity(items, "public").map((i) => i.key)).toEqual(["j:c1"]);
    expect(filterActivity(items, "internal").map((i) => i.key)).toEqual(["j:w1"]);
    expect(filterActivity(items, "system").map((i) => i.key)).toEqual(["j:s1", "h:h1"]);
    expect(activityCounts(items)).toEqual({ all: 4, public: 1, internal: 1, system: 2 });
  });
});

describe("mentions", () => {
  it("writes, finds and inserts mentions", () => {
    const m = formatMention(U1.toUpperCase(), "سارا [محمدی]");
    expect(m).toBe(`@[سارا محمدی](mention:${U1})`);
    expect(isMentionHref(`mention:${U1}`)).toBe(true);
    expect(isMentionHref("https://x")).toBe(false);
    expect(mentionedIds(`سلام ${m} و @[علی](mention:${U2}) و دوباره ${m}`)).toEqual([U1, U2]);
    expect(mentionAt("سلام @سا", 8)).toEqual({ start: 5, query: "سا" });
    expect(mentionAt("email@host", 10)).toBeNull();
    expect(mentionAt("@a\nb", 4)).toBeNull();
    const r = insertMention("سلام @سا تمام", 5, 8, U1, "سارا");
    expect(r.text).toBe(`سلام @[سارا](mention:${U1})  تمام`);
    expect(r.caret).toBe(5 + `@[سارا](mention:${U1}) `.length);
  });
});

describe("values", () => {
  const f = (n: string) => todo.fields.find((x) => x.name === n)!;

  it("writes durations, numbers, choices, members and dates in Persian", () => {
    expect(formatDuration(9000)).toBe("۲ ساعت و ۳۰ دقیقه");
    expect(formatDuration(45)).toBe("۴۵ ثانیه");
    expect(formatDuration(90061)).toBe("۱ روز و ۱ ساعت");
    expect(formatDuration(null)).toBe("");
    expect(splitDuration(5400)).toEqual({ h: 1, m: 30 });
    const ctx = { choices: {}, display: { [U1]: "سارا محمدی" }, tz: "Asia/Tehran" };
    expect(valueText(f("priority"), "1", ctx)).toBe("۱ — بحرانی");
    expect(valueText(f("assigned_to"), U1, ctx)).toBe("سارا محمدی");
    expect(valueText(f("assigned_to"), U2, ctx)).toBe("(محدود)");
    expect(valueText(f("estimate"), "1250.5", ctx)).toBe("۱٬۲۵۰٫۵");
    expect(valueText(f("knowledge"), false, ctx)).toBe("خیر");
    expect(valueText(f("due_at"), "2026-03-21T06:30:00.000Z", ctx)).toBe("۱۴۰۵/۰۱/۰۱ ۱۰:۰۰");
    expect(valueText(f("tags"), ["الف", "ب"], ctx)).toBe("الف، ب");
  });

  it("compares stored values and sends only what changed", () => {
    expect(sameValue(null, "")).toBe(true);
    expect(sameValue([], null)).toBe(true);
    expect(sameValue("1.5", 1.5)).toBe(true);
    expect(sameValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameValue({ and: [{ f: "x" }] }, { and: [{ f: "x" }] })).toBe(true);
    expect(sameValue("x", null)).toBe(false);
    const base = { short_description: "الف", priority: "3", tags: ["x"], secret_f: { secret: true, hint: "…ab" } };
    const fields = [f("short_description"), f("priority"), f("tags"), { name: "secret_f", label: "رمز", type: "secret" as const }];
    expect(changedValues(base, { short_description: "الف", priority: "2", tags: ["x"], secret_f: { secret: true } }, fields)).toEqual({ priority: "2" });
    expect(changedValues(base, { secret_f: "new" }, fields)).toEqual({ secret_f: "new" });
  });

  it("labels options and records, and offers only active options of the parent's children", () => {
    const sub = { name: "sub", label: "زیردسته", type: "choice" as const, dependsOn: "cat", choices: [{ value: "a", label: "الف", parent: "x" }, { value: "b", label: "ب", parent: "y" }, { value: "c", label: "ج", parent: "x", active: false }] };
    expect(offeredOptions(sub, {}, { cat: "x" }).map((o) => o.value)).toEqual(["a"]);
    expect(offeredOptions(sub, {}, { cat: "x", sub: "c" }).map((o) => o.value)).toEqual(["a", "c"]);
    expect(offeredOptions(sub, {}, { cat: null }).map((o) => o.value)).toEqual([]);
    expect(optionLabel(sub, {}, "zz")).toBe("zz");
    expect(recordLabel(todo, { number: "TODO0000012", short_description: "چاپگر" })).toBe("TODO0000012 — چاپگر");
  });
});

describe("SLA timers and viewers", () => {
  const now = Date.parse("2026-11-07T10:00:00Z");
  it("reads timers leniently and words them", () => {
    const [a, b, c] = slaTimers(
      [
        { name: "پاسخ", start_at: "2026-11-07T09:00:00Z", due_at: "2026-11-07T11:00:00Z" },
        { label: "حل", due_at: "2026-11-07T09:30:00Z" },
        { title: "x", state: "met", percent: 40 },
      ],
      now,
    );
    expect(a).toMatchObject({ label: "پاسخ", breached: false, paused: false, used: 0.5, remainingMs: 3600_000 });
    expect(slaText(a)).toBe("۱ ساعت مانده");
    expect(b.breached).toBe(true);
    expect(slaText(b)).toBe("۳۰ دقیقه از موعد گذشته");
    expect(c).toMatchObject({ met: true, used: 0.4, remainingMs: null });
    expect(slaText(c)).toBe("در موعد انجام شد");
    expect(slaTimers({ timers: [{ due_at: "2026-11-09T10:00:00Z", paused: true }] }, now)[0]).toMatchObject({ paused: true, breached: false });
    expect(slaTimers(null)).toEqual([]);
  });

  it("lists the other people who have the record open", () => {
    const vs = otherViewers([U1, { id: U2, name: "علی" }, { user_id: U2 }], U1);
    expect(vs).toEqual([{ id: U2, name: "علی" }]);
    expect(viewersText(vs)).toBe("علی هم این رکورد را باز کرده است");
    expect(viewersText([...vs, { id: "x", name: "رضا" }])).toBe("علی و ۱ نفر دیگر هم این رکورد را باز کرده‌اند");
    expect(viewersText([{ id: U2, name: "علی", typing: true }])).toBe("علی در حال نوشتن روی این رکورد است");
    expect(otherViewers("x", U1)).toEqual([]);
  });
});

describe("calendar and timeline", () => {
  it("lays a Jalali month out in Saturday-first weeks", () => {
    const weeks = monthGrid(1405, 1, "2026-03-25");
    expect(weeks.every((w) => w.length === 7 && w[0].weekday === 0)).toBe(true);
    const days = weeks.flat().filter((d) => d.inMonth);
    expect(days).toHaveLength(31);
    expect(days[0].iso).toBe("2026-03-21");
    expect(weeks.flat().find((d) => d.today)?.iso).toBe("2026-03-25");
    expect(weekOf("2026-03-25", "2026-03-25").map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekTitle(weekOf("2026-03-25", "x"))).toBe("۱ تا ۷ فروردین ۱۴۰۵");
    expect(shiftMonth(1405, 12, 1)).toEqual({ jy: 1406, jm: 1 });
    expect(shiftMonth(1405, 1, -1)).toEqual({ jy: 1404, jm: 12 });
  });

  it("finds the local day of dates and date-times and loads a window with a valid condition", () => {
    expect(dayOf("datetime", "2026-03-20T21:00:00Z", "Asia/Tehran")).toBe("2026-03-21");
    expect(dayOf("date", "2026-03-20", "Asia/Tehran")).toBe("2026-03-20");
    expect(dayOf("date", "x", "Asia/Tehran")).toBeNull();
    const due = todo.fields.find((f) => f.name === "due_at")!;
    const opened = todo.fields.find((f) => f.name === "opened_at")!;
    expect(validateCond(windowFilter(due, null, "2026-03-21", "2026-04-20"), todo)).toBeNull();
    expect(validateCond(windowFilter(opened, due, "2026-03-21", "2026-04-20"), todo)).toBeNull();
  });

  it("moves events by days keeping their local time, and places events on days and timeline lanes", () => {
    expect(shiftValue("datetime", "2026-03-21T06:30:00.000Z", 2, "Asia/Tehran")).toBe("2026-03-23T06:30:00.000Z");
    expect(shiftValue("date", "2026-03-21", -1, "Asia/Tehran")).toBe("2026-03-20");
    const start = todo.fields.find((f) => f.name === "opened_at")!;
    const end = todo.fields.find((f) => f.name === "due_at")!;
    const rows: RecordRow[] = [
      { id: "a", version: 1, opened_at: "2026-03-21T06:00:00Z", due_at: "2026-03-24T06:00:00Z" },
      { id: "b", version: 1, opened_at: "2026-03-22T06:00:00Z", due_at: null },
      { id: "c", version: 1, opened_at: "2026-03-25T06:00:00Z", due_at: "2026-03-26T06:00:00Z" },
      { id: "d", version: 1, opened_at: null },
    ];
    const ev = toEvents(rows, start, end, "Asia/Tehran");
    expect(ev.map((e) => [e.id, e.start, e.end])).toEqual([["a", "2026-03-21", "2026-03-24"], ["b", "2026-03-22", "2026-03-22"], ["c", "2026-03-25", "2026-03-26"]]);
    expect(eventsOn(ev, "2026-03-22").map((e) => e.id)).toEqual(["a", "b"]);
    expect(moveEvent(ev[0], "2026-03-23", start, end, "Asia/Tehran")).toEqual({ opened_at: "2026-03-23T06:00:00.000Z", due_at: "2026-03-26T06:00:00.000Z" });
    const t = timelineBars(ev, "2026-03-22", "2026-03-31");
    expect(t.lanes).toBe(2);
    expect(t.bars.find((b) => b.event.id === "a")).toMatchObject({ offset: 0, span: 3, clippedStart: true, lane: 0 });
    expect(t.bars.find((b) => b.event.id === "b")).toMatchObject({ lane: 1 });
    expect(t.bars.find((b) => b.event.id === "c")).toMatchObject({ offset: 3, lane: 0 });
  });
});

describe("kanban", () => {
  it("groups by the state field by default and plans drops by the state model", () => {
    const f = boardField(todo)!;
    expect(f.name).toBe("state");
    const cols = choiceColumns(todo, f, {}, { in_progress: 3 });
    expect(cols.map((c) => c.value)).toEqual(["new", "in_progress", "on_hold", "resolved", "closed", "canceled"]);
    expect(cols[1].wip).toBe(3);
    expect(planDrop(todo, f, { state: "new" }, "in_progress")).toMatchObject({ kind: "transition", to: "in_progress" });
    expect(planDrop(todo, f, { state: "new" }, "resolved")).toMatchObject({ kind: "transition", requires: ["close_code", "close_notes"] });
    expect(planDrop(todo, f, { state: "new" }, "closed")).toMatchObject({ kind: "blocked" });
    expect(planDrop(todo, f, { state: "new" }, "new")).toEqual({ kind: "none" });
  });

  it("updates other fields, refuses closed records and limits WIP", () => {
    const pr = boardField(todo, "priority")!;
    expect(planDrop(todo, pr, { state: "new", priority: "4" }, "2")).toEqual({ kind: "update", data: { priority: "2" } });
    expect(planDrop(todo, pr, { state: "closed", priority: "4" }, "2")).toMatchObject({ kind: "blocked" });
    expect(choiceColumns(todo, pr, {}).some((c) => c.value === null)).toBe(true);
    expect(boardField(todo, "tags")).toBeUndefined();
    expect(wipState(3, 3)).toBe("full");
    expect(wipState(4, 3)).toBe("over");
    expect(wipState(4)).toBe("ok");
    const ag = aggregateColumns([{ keys: [U1], labels: ["سارا"], values: { count: 3 } }, { keys: [null], labels: ["(خالی)"], values: { count: 1 } }], {});
    expect(ag.map((c) => c.label)).toEqual(["سارا", "بدون مقدار"]);
  });
});

describe("list state and saved views", () => {
  it("round-trips the page state through the URL, writing only what differs", () => {
    const s = emptyListState({ filter: { f: "state", op: "eq", v: "new" }, quick: ["mine"], q: "چاپگر", sort: "-priority", groupBy: "state", size: 100, page: 3, mode: "board", view: "v1" });
    const p = writeListState(s);
    expect(readListState(p)).toEqual(s);
    expect(writeListState(emptyListState()).toString()).toBe("");
    const bad = readListState(new URLSearchParams("size=99999&page=-2&mode=hack&filter=%7Bx"));
    expect(bad).toMatchObject({ size: 50, page: 1, mode: "list", filter: null });
  });

  it("loads a view into the page, detects changes and builds the view's body", () => {
    const v: ViewRow = { id: "v1", version: 1, table_key: "todo", name: "باز من", owner_id: U1, shared: false, is_default: true, kind: "kanban", filter: { f: "assigned_to", op: "is_me" }, q: null, columns: ["number", "state"], sort: "-priority", group_by: null, page_size: 20 };
    const { state, columns } = stateOfView(v);
    expect(state).toMatchObject({ view: "v1", mode: "board", size: 20, sort: "-priority" });
    expect(columns).toEqual(["number", "state"]);
    const page = emptyListState(state);
    expect(viewDirty(v, page, ["number", "state"])).toBe(false);
    expect(viewDirty(v, { ...page, q: "x" }, ["number", "state"])).toBe(true);
    expect(viewDirty(v, page, ["number"])).toBe(true);
    expect(viewBody(page, ["number"], { f: "active", op: "eq", v: true })).toMatchObject({ filter: { and: [{ f: "assigned_to", op: "is_me" }, { f: "active", op: "eq", v: true }] }, kind: "kanban", columns: ["number"], page_size: 20 });
  });

  it("opens the person's default view, else a shared one, and groups views", () => {
    const mk = (id: string, owner: string, shared: boolean, def: boolean, name = id): ViewRow => ({ id, version: 1, table_key: "todo", name, owner_id: owner, shared, is_default: def, kind: "list", filter: null, q: null, columns: null, sort: null, group_by: null, page_size: null });
    const views = [mk("a", U2, true, true), mk("b", U1, false, false), mk("c", U1, false, true)];
    expect(defaultView(views, U1)?.id).toBe("c");
    expect(defaultView(views.slice(0, 2), U1)?.id).toBe("a");
    expect(defaultView([mk("x", U2, false, true)], U1)).toBeNull();
    const g = groupViews(views, U1);
    expect(g.mine.map((v) => v.id)).toEqual(["b", "c"]);
    expect(g.shared.map((v) => v.id)).toEqual(["a"]);
  });
});

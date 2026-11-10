// The request screens' pure logic (src/ui/modules/request/model.ts): queues and row tones, the order form's sections
// and visible questions, server errors mapped onto questions, money, recurring charges and durations in Persian, the
// stage bar, the builder's helpers (names from labels, new questions, reordering, policies as sentences, type groups)
// and the cart's state.
import { describe, it, expect } from "vitest";
import { evaluate } from "@shared/model/conditions";
import type { FormSchema, VarDef } from "@shared/request/form";
import {
  QUEUES, answerErrors, cartState, durationText, lineErrors, money, nameFromLabel, newQuestion, nextOrder, policySentence, queueOf, recurringText, reorder, rowTone, sectionsOf, stageSteps,
  typeGroups, visibleQuestions,
} from "@ui/modules/request/model";

const v = (name: string, extra: Partial<VarDef> = {}): VarDef => ({ name, label: name, type: "string", order: 10, ...extra });
const schema: FormSchema = {
  v: 1,
  item: { id: "i", number: null, name: "قلم", code: "c", type: "standard", catalog_id: "k", category_id: null },
  sections: [{ key: "addr", label: "نشانی" }],
  variables: [v("b", { order: 20 }), v("a", { order: 10 }), v("city", { section: "addr" }), v("secret_note", { hidden: true, order: 30 })],
  grids: [],
  policies: [{ name: "p", when: { f: "a", op: "eq", v: "x" }, actions: [{ variable: "secret_note", visible: true }], applies_to: "both", order: 1 }],
  tasks: [],
};

describe("request screens", () => {
  it("defines queues with valid conditions, and finds them by key", () => {
    const now = Date.parse("2026-11-08T08:00:00Z");
    for (const q of QUEUES) {
      const c = q.filter(now);
      expect(() => evaluate(c, { active: true, state: "awaiting_approval", due_at: "2026-11-01T00:00:00Z", assigned_to: null }, { userId: "u", groups: ["g"], now })).not.toThrow();
      expect(q.columns.length).toBeGreaterThan(3);
    }
    expect(queueOf("overdue")?.table).toBe("request_item");
    expect(queueOf("my-tasks")?.table).toBe("request_task");
    expect(new Set(QUEUES.map((q) => q.path)).size).toBe(QUEUES.length);
  });

  it("tones rows past their promise, close to it, or blocked", () => {
    const now = Date.parse("2026-11-08T08:00:00Z");
    expect(rowTone({ due_at: "2026-11-07T08:00:00Z" }, now)).toBe("danger");
    expect(rowTone({ due_at: "2026-11-08T12:00:00Z" }, now)).toBe("warning");
    expect(rowTone({ due_at: "2026-11-20T12:00:00Z" }, now)).toBeNull();
    expect(rowTone({ blocked: true }, now)).toBe("warning");
    expect(rowTone({ active: false, due_at: "2026-01-01T00:00:00Z" }, now)).toBeNull();
  });

  it("groups questions by section in order and hides what policies hide", () => {
    expect(sectionsOf(schema).map((s) => [s.label, s.variables.map((x) => x.name)])).toEqual([
      [null, ["a", "b", "secret_note"]],
      ["نشانی", ["city"]],
    ]);
    expect(visibleQuestions(schema, {}, "order").sections[0].variables.map((x) => x.name)).toEqual(["a", "b"]);
    expect(visibleQuestions(schema, { a: "x" }, "order").sections[0].variables.map((x) => x.name)).toEqual(["a", "b", "secret_note"]);
  });

  it("maps the server's errors of an order line onto questions", () => {
    const fields = { "lines.0.answers.a": "الف", "lines.1.answers.b": "ب", "lines.0.requested_for": "شخص", "answers.c": "ج" };
    expect(answerErrors(fields)).toEqual({ a: "الف", c: "ج" });
    expect(answerErrors(fields, 1)).toEqual({ b: "ب", c: "ج" });
    expect(lineErrors(fields)).toEqual(["شخص"]);
  });

  it("writes money, recurring charges and durations in Persian", () => {
    expect(money("650000000")).toBe(`${(650000000).toLocaleString("fa-IR")} ریال`);
    expect(money("12.50")).toBe(`${(12).toLocaleString("fa-IR")} ریال`);
    expect(money(null)).toBe("");
    expect(recurringText("1500000", "monthly")).toContain("ماهانه");
    expect(recurringText("0", "monthly")).toBe("");
    expect(durationText(2 * 86400 + 4 * 3600)).toBe("۲ روز و ۴ ساعت");
    expect(durationText(5400)).toBe("۱ ساعت و ۳۰ دقیقه");
    expect(durationText(30)).toBe("۱ دقیقه");
    expect(durationText(null)).toBe("");
  });

  it("draws the stage bar: done, current, ahead; a rejected item ends the bar", () => {
    expect(stageSteps("in_fulfilment", "fulfilment").map((s) => s.status)).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(stageSteps("closed_complete", "completed").every((s) => s.status === "done")).toBe(true);
    const rejected = stageSteps("rejected", "rejected");
    expect(rejected[rejected.length - 1]).toMatchObject({ key: "rejected", status: "current" });
    expect(stageSteps("pending", null, ["submitted", "fulfilment", "completed"])[0].status).toBe("current");
  });

  it("names questions from Latin labels or q1, q2…, never one taken or reserved", () => {
    expect(nameFromLabel("Start Date", [])).toBe("start_date");
    expect(nameFromLabel("Start Date", ["start_date"])).toBe("start_date_1");
    expect(nameFromLabel("تاریخ شروع", [])).toBe("q1");
    expect(nameFromLabel("تاریخ شروع", ["q1", "q2"])).toBe("q3");
    expect(nameFromLabel("item", [])).toBe("item_1"); // reserved as it is
  });

  it("starts new questions with options for choice types and numbers rows by tens", () => {
    expect(newQuestion("select", 30, ["q1"])).toMatchObject({ type: "select", sort_order: 30, name: "q2" });
    expect((newQuestion("radio", 10, []).choices as unknown[]).length).toBe(2);
    expect(newQuestion("secret", 10, []).field_class).toBe("secret");
    expect(nextOrder([{ sort_order: 10 }, { sort_order: 40 }])).toBe(50);
    expect(nextOrder([])).toBe(10);
    const rows = [{ id: "a", sort_order: 10 }, { id: "b", sort_order: 20 }, { id: "c", sort_order: 30 }];
    expect(reorder(rows, 2, 0)).toEqual([{ id: "c", sort_order: 10 }, { id: "a", sort_order: 20 }, { id: "b", sort_order: 30 }]);
    expect(reorder(rows, 0, 0)).toEqual([]);
  });

  it("says a policy as a sentence and groups the question types", () => {
    expect(policySentence({ actions: [{ variable: "a", visible: true, mandatory: true }, { variable: "b", readonly: true }] }, "«الف» برابر بله", { a: "الف", b: "ب" })).toBe("اگر «الف» برابر بله ← نمایش و الزامی «الف»، فقط‌خواندنی «ب»");
    expect(policySentence({ actions: [{ variable: "z", visible: false }] }, "", {})).toBe("همیشه ← پنهان «z»");
    const groups = typeGroups();
    expect(groups.map((g) => g.group)).toEqual(["متن", "عدد و تاریخ", "گزینه", "ارجاع", "ویژه"]);
    expect(groups.flatMap((g) => g.types).length).toBe(28);
  });

  it("tells which cart lines are ready, saved or blocked", () => {
    expect(cartState([{ saved: false }, { saved: true }, { saved: false, problem: "تغییر کرده" }, { saved: true, problem: "x" }])).toEqual({ ready: 1, saved: 2, blocked: 1 });
  });
});

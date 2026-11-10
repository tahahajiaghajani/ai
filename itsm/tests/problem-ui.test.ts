// Pure logic of the problem screens (src/ui/modules/problem/model.ts): the queues and the RCA canvas operations.
import { describe, it, expect } from "vitest";
import { validateCond } from "@shared/model/conditions";
import { TABLES } from "@shared/tables";
import { emptyRca } from "@shared/problem/logic";
import { PROBLEM_QUEUES, addCause, addEvent, addHypothesis, addWhy, rcaDirty, rcaOf, removeAt, removeCause, setHypothesis, setIsIsNot, setWhy } from "@ui/modules/problem/model";

describe("queues", () => {
  it("have valid conditions, columns and sorts", () => {
    for (const q of PROBLEM_QUEUES) {
      const def = TABLES.get(q.table)!;
      expect(validateCond(q.filter, def), q.key).toBeNull();
      for (const c of q.columns) expect(def.fields.some((f) => f.name === c), `${q.key}: ${c}`).toBe(true);
      for (const s of q.sort.split(",")) expect(def.fields.some((f) => f.name === s.replace(/^-/, "") && f.sort), `${q.key}: ${s}`).toBe(true);
    }
  });
});

describe("the RCA canvas", () => {
  it("chains whys from the last answer and edits them", () => {
    let c = addWhy(emptyRca());
    expect(c.whys).toEqual([{ question: "چرا؟", answer: "" }]);
    c = setWhy(c, 0, { answer: "دیسک پر شد" });
    c = addWhy(c);
    expect(c.whys[1].question).toBe("چرا دیسک پر شد؟");
    c = removeAt(c, "whys", 0);
    expect(c.whys).toHaveLength(1);
  });

  it("adds and removes fishbone causes without duplicates", () => {
    let c = addCause(emptyRca(), "process", " نبود پایش ");
    c = addCause(c, "process", "نبود پایش");
    c = addCause(c, "process", "  ");
    expect(c.fishbone).toEqual({ process: ["نبود پایش"] });
    expect(removeCause(c, "process", 0).fishbone).toEqual({});
  });

  it("keeps the timeline in order and tracks hypotheses and «is / is not»", () => {
    let c = addEvent(emptyRca(), "2026-11-07T10:00:00Z", "دوم");
    c = addEvent(c, "2026-11-07T09:00:00Z", "اول");
    c = addEvent(c, "2026-11-07T11:00:00Z", " ");
    expect(c.timeline.map((t) => t.text)).toEqual(["اول", "دوم"]);
    c = addHypothesis(c, "پشتیبان‌گیری");
    const id = c.hypotheses[0].id;
    c = setHypothesis(c, id, { status: "confirmed", evidence: "لاگ" });
    expect(c.hypotheses[0]).toMatchObject({ text: "پشتیبان‌گیری", status: "confirmed", evidence: "لاگ", confidence: "medium" });
    c = setIsIsNot(c, "where", "is", "سرور ایمیل");
    expect(c.is_isnot.where).toEqual({ is: "سرور ایمیل", isnot: "" });
  });

  it("knows when the canvas differs from what is stored", () => {
    const stored = { whys: [{ question: "چرا؟", answer: "x" }], junk: 1 };
    const c = rcaOf(stored);
    expect(rcaDirty(c, stored)).toBe(false);
    expect(rcaDirty(setWhy(c, 0, { answer: "y" }), stored)).toBe(true);
  });
});

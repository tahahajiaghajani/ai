// «پرسش تحلیلی» (docs/spec/AI.md §15): a model reads a question into a report definition, the definition is checked
// against the metadata and the asker's access (unknown or unreadable tables and fields refused in Persian), and the
// numbers are computed by the analytics engine with the asker's own access — never by the model. Without a model the
// rule-based reader answers, or a guided start is offered.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TABLES } from "@shared/tables";
import { memberCtx } from "@server/access/service";
import { access } from "@server/access/provider";
import { createIn } from "@server/engine";
import { askRefusal } from "@server/modules/ai/nlreport";
import { world, type World } from "./incident-helpers";

const before = process.env.ITSM_AI_FAKE;
let w: World;

const directive = (spec: Record<string, unknown>) => `تعداد رخدادها را بگو [json:${JSON.stringify({ spec })}]`;
const ask = (client: World["o"], question: string, status = 200) => client.post(`${w.P}/ai/ask-report`, { question }, status);

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  w = await world({ preset: "need_to_know" });
  await w.sys.write(async (tx) => {
    for (let i = 0; i < 7; i++) await createIn(tx, w.sys, "incident", { short_description: `کندی شبکه ${i}`, priority: i % 2 ? "2" : "3", assignment_group_id: w.g.desk }, { trusted: true });
    for (let i = 0; i < 5; i++) await createIn(tx, w.sys, "incident", { short_description: `قطعی سوییچ ${i}`, priority: "1", assignment_group_id: w.g.network }, { trusted: true });
  });
  await w.drain();
}, 120_000);

afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

describe("without a model", () => {
  it("reads what the rules understand, else offers a guided start", async () => {
    const r = await ask(w.p.agent.client, "تعداد رخدادها به تفکیک اولویت");
    expect(["rules", "guided"]).toContain(r.mode);
    if (r.mode === "rules") expect(r.result.total_n).toBeGreaterThan(0);
    const g = await ask(w.p.agent.client, "چیزی نامفهوم بنویس");
    expect(g.mode).toBe("guided");
    expect(g.spec).toBeNull();
    expect(g.suggestions.length).toBeGreaterThan(0);
    expect(g.designer_path).toMatch(/^analytics\/reports\/new\?spec=/);
  });
});

describe("with a model", () => {
  beforeAll(async () => {
    await w.o.post(`${w.P}/ai/connections`, { preset: "fake" });
  });

  it("runs the model's definition with the asker's own access: the numbers come from the engine", async () => {
    const spec = { table: "incident", measures: [{ fn: "count" }], dims: [{ field: "priority" }], viz: "table" };
    const desk = await ask(w.p.agent.client, directive(spec));
    expect(desk.mode).toBe("ai");
    expect(desk.refusal).toBeNull();
    const net = await ask(w.p.other.client, directive(spec));
    const all = await ask(w.o, directive(spec));
    // the desk agent counts only the desk's incidents, the network agent only the network's; the owner every one
    expect(desk.result.total_n).toBe(7);
    expect(net.result.total_n).toBe(5);
    expect(all.result.total_n).toBeGreaterThanOrEqual(12);
    expect(desk.chips.map((c: any) => c.kind)).toEqual(expect.arrayContaining(["table", "measure", "dim"]));
    expect(desk.designer_path).toMatch(/^analytics\/reports\/new\?spec=/);
    expect(desk.narrative.text.length).toBeGreaterThan(0);
  });

  it("refuses an unknown table or field in Persian instead of guessing", async () => {
    const t = await ask(w.p.agent.client, directive({ table: "no_such_table", measures: [{ fn: "count" }], dims: [], viz: "score" }));
    expect(t.spec).toBeNull();
    expect(t.result).toBeNull();
    expect(t.refusal).toMatch(/جدولی به نام/);
    const f = await ask(w.p.agent.client, directive({ table: "incident", measures: [{ fn: "count" }], dims: [{ field: "no_such_field" }], viz: "table" }));
    expect(f.refusal).toMatch(/فیلدی به نام «no_such_field»/);
  });

  it("refuses a table or a field the asker may not read", async () => {
    const ctx = await memberCtx(w.e.cfg, w.e.org, w.p.agent.userId);
    const closed = [...TABLES.values()].find((d) => !d.virtual && d.module !== "analytics" && !access().canReadTable(ctx, d) && !d.rowAccess?.read);
    if (closed) {
      const r = await ask(w.p.agent.client, directive({ table: closed.key, measures: [{ fn: "count" }], dims: [], viz: "score" }));
      expect(r.result).toBeNull();
      expect(r.refusal).toMatch(/دسترسی ندارید/);
    }
    // a field of a group the agent does not hold
    let hidden: { table: string; field: string } | null = null;
    for (const d of TABLES.values()) {
      if (d.virtual || d.module === "analytics" || !access().canReadTable(ctx, d)) continue;
      const v = access().visibleFields(ctx, d);
      const f = v ? d.fields.find((x) => !v.has(x.name) && ["choice", "money", "int", "decimal"].includes(x.type)) : undefined;
      if (f) {
        hidden = { table: d.key, field: f.name };
        break;
      }
    }
    expect(hidden).not.toBeNull();
    const spec = { v: 1, table: hidden!.table, measures: [{ fn: "count" }], dims: [{ field: hidden!.field }], viz: "table" } as never;
    expect(await askRefusal(ctx, spec)).toMatch(/خواندنی نیست/);
    const r = await ask(w.p.agent.client, directive({ table: hidden!.table, measures: [{ fn: "count" }], dims: [{ field: hidden!.field }], viz: "table" }));
    expect(r.result).toBeNull();
    expect(r.refusal).toMatch(/خواندنی نیست/);
  });

  it("saves the answer as the asker's own report", async () => {
    const spec = { v: 1, table: "incident", measures: [{ fn: "count" }], dims: [{ field: "priority" }], viz: "column" };
    const saved = await w.o.post(`${w.P}/ai/ask-report/save`, { spec, name: "رخدادها به تفکیک اولویت", question: "تعداد رخدادها به تفکیک اولویت" });
    expect(saved.path).toBe(`analytics/reports/${saved.id}`);
    const row = await w.o.get(`${w.P}/r/analytics_report/${saved.id}`);
    expect(row.row.table_key).toBe("incident");
    await w.o.post(`${w.P}/ai/ask-report/save`, { spec: { ...spec, table: "no_such_table" }, name: "x" }, 400);
  });
});

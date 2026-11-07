// The designer's pure logic (src/ui/modules/flows/model.ts): adding steps after the selected one, which connections
// may be drawn (ports, the trigger, cycles), removing steps, auto-layout top-to-bottom and right-to-left with dagre,
// the data pills a step may use, node summaries and the palette.
import { describe, it, expect } from "vitest";
import { addNode, autoLayout, availablePills, connect, connectProblem, freePort, nodeSummary, paletteGroups, removeNodes, writableFields, NODE_W } from "../src/ui/modules/flows/model";
import { emptyGraph, validateGraph, type FlowGraph } from "@shared/flows";
import { E, N, graph } from "./flows-helpers";

const fields = [
  { name: "short_description", label: "عنوان", type: "string" },
  { name: "priority", label: "اولویت", type: "choice" },
  { name: "assigned_to", label: "کارشناس", type: "user" },
  { name: "reopen_count", label: "بازگشایی", type: "int", readonly: true },
  { name: "secret_key", label: "کلید", type: "secret" },
];
const fieldsOf = (t: string) => (t === "todo" ? fields : undefined);

describe("flows designer model", () => {
  it("adds steps after the selected one through its first free port, with unique ids", () => {
    let g: FlowGraph = emptyGraph();
    const a = addNode(g, "branch", { after: "trigger" });
    g = a.graph;
    expect(a.id).toBe("branch1");
    expect(g.edges).toEqual([{ id: "trigger-out-branch1", source: "trigger", target: "branch1" }]);
    const yes = addNode(g, "set_vars", { after: a.id });
    const no = addNode(yes.graph, "set_vars", { after: a.id });
    expect(no.graph.edges.filter((e) => e.source === "branch1").map((e) => e.port)).toEqual(["yes", "no"]);
    expect(no.id).toBe("setVars2");
    // a full node adds without an edge
    const third = addNode(no.graph, "end", { after: a.id });
    expect(third.graph.edges.filter((e) => e.target === third.id)).toEqual([]);
    expect(freePort(third.graph, third.graph.nodes.find((n) => n.id === "branch1")!)).toBeNull();
    expect(validateGraph(no.graph).filter((p) => p.level === "error" && /دور|خروجی/.test(p.message))).toEqual([]);
  });

  it("refuses connections to the trigger, from used ports, to itself and that close a cycle", () => {
    const g = graph([N("a", "set_vars"), N("b", "set_vars"), N("p", "parallel")], [E("trigger", "a"), E("a", "b")]);
    expect(connectProblem(g, "a", "out", "trigger")).toMatch(/شروع/);
    expect(connectProblem(g, "a", "out", "p")).toMatch(/فقط یک/);
    expect(connectProblem(g, "b", "out", "b")).toMatch(/خودش/);
    expect(connectProblem(g, "b", "out", "a")).toMatch(/دور/);
    expect(connectProblem(g, "b", "out", "p")).toBeNull();
    const par = connect(connect(g, "b", "out", "p"), "p", "out", "a");
    expect(connectProblem(par, "p", "out", "a")).toMatch(/هست/);
  });

  it("removes steps with their edges but never the trigger", () => {
    const g = graph([N("a", "set_vars"), N("b", "set_vars")], [E("trigger", "a"), E("a", "b")]);
    const r = removeNodes(g, ["a", "trigger"]);
    expect(r.nodes.map((n) => n.id)).toEqual(["trigger", "b"]);
    expect(r.edges).toEqual([]);
  });

  it("lays out top to bottom and right to left", () => {
    const g = graph([N("a", "set_vars"), N("b", "set_vars")], [E("trigger", "a"), E("a", "b")]);
    const tb = autoLayout(g, "TB");
    const y = (id: string) => tb.nodes.find((n) => n.id === id)!.position!.y;
    expect(y("trigger")).toBeLessThan(y("a"));
    expect(y("a")).toBeLessThan(y("b"));
    const rl = autoLayout(g, "RL");
    const x = (id: string) => rl.nodes.find((n) => n.id === id)!.position!.x;
    expect(x("trigger")).toBeGreaterThan(x("a") + NODE_W - 1);
    expect(x("a")).toBeGreaterThan(x("b"));
    expect(rl.layout?.direction).toBe("RL");
  });

  it("offers the pills a step may use: trigger record fields, earlier steps, variables, the loop's item, the clock", () => {
    const g = graph(
      [
        N("v", "set_vars", { vars: [{ name: "total", value: 1 }] }),
        N("h", "call_http", { connection: "x", map: [{ name: "ticket", path: "id" }] }),
        N("l", "for_each", { table: "todo" }),
        N("u", "update_record", { values: {} }),
        N("later", "add_comment", { body: "" }),
      ],
      [E("trigger", "v"), E("v", "h"), E("h", "l"), E("l", "u", "each"), E("l", "later", "done")],
    );
    const trigger = { kind: "record" as const, table: "todo", run_as: "trigger_user" as const };
    const paths = availablePills(g, "u", { trigger, fieldsOf }).map((p) => p.path);
    expect(paths).toContain("trigger.record.priority");
    expect(paths).toContain("trigger.record.$labels.priority");
    expect(paths).not.toContain("trigger.record.$labels.short_description");
    expect(paths).not.toContain("trigger.record.secret_key");
    expect(paths).toContain("steps.h.output.ticket");
    expect(paths).toContain("steps.h.error");
    expect(paths).toContain("vars.total");
    expect(paths).toContain("item.priority");
    expect(paths).toContain("item_index");
    expect(paths).toContain("jalali.month_name");
    expect(paths).not.toContain("steps.later.output.entry_id");
    const after = availablePills(g, "later", { trigger, fieldsOf }).map((p) => p.path);
    expect(after).not.toContain("item_index");
    expect(after).toContain("steps.l.output.count");
  });

  it("summarises nodes in Persian and offers writable fields and the palette", () => {
    const label = (k: string) => (k === "todo" ? "کارها" : k);
    expect(nodeSummary(N("u", "update_record", { values: { a: 1, b: 2 } }), label, { table: "todo" })).toBe("کارها · ۲ فیلد");
    expect(nodeSummary(N("w", "wait_duration", { duration: { amount: 3, unit: "day" }, business: true }), label)).toBe("۳ روز کاری");
    expect(nodeSummary(N("h", "call_http", { method: "POST", path: "/x" }), label)).toBe("POST /x");
    expect(writableFields(fields).map((f) => f.name)).toEqual(["short_description", "priority", "assigned_to"]);
    const groups = paletteGroups();
    expect(groups.flatMap((g) => g.types)).not.toContain("trigger");
    expect(groups.map((g) => g.group)).toEqual(["records", "communication", "control"]);
  });
});

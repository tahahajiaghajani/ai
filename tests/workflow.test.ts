import { describe, expect, it } from "vitest";
import { findCycle, flowSummary, layers, nextBatch, schedule, summaryLayers, validateWorkflow, type AgentDef, type NodeOutcome, type WorkflowDef } from "@/lib/workflow/types";
import { DEFAULT_AGENTS, DEFAULT_WORKFLOWS } from "@/lib/workflow/registry";

const agents: Record<string, AgentDef> = Object.fromEntries(DEFAULT_AGENTS.map((a) => [a.id, a]));

const node = (id: string, agentId = "analyze") => ({ id, agentId, x: 0, y: 0 });

describe("workflow scheduling", () => {
  const prework = DEFAULT_WORKFLOWS.find((w) => w.id === "prework-standard")!;

  it("runs steps in order and the two branches after the brief in parallel", () => {
    expect(schedule(prework, {}).ready).toEqual(["analyze"]);
    expect(schedule(prework, { analyze: { status: "done" } }).ready).toEqual(["brief"]);
    const after = schedule(prework, { analyze: { status: "done" }, brief: { status: "done" } });
    expect(after.ready.sort()).toEqual(["helpers", "summary"]);
    expect(after.finished).toBe(false);
    const all: Record<string, NodeOutcome> = { analyze: { status: "done" }, brief: { status: "done" }, helpers: { status: "done" }, summary: { status: "done" } };
    expect(schedule(prework, all).finished).toBe(true);
  });

  it("follows only the branch a condition chose and skips the other one (and what depends only on it)", () => {
    const wf: WorkflowDef = {
      id: "w",
      name: "w",
      stage: "main",
      nodes: [node("build", "claude"), node("check", "reviewer"), node("fix", "claude"), node("polish", "summary"), node("done", "summary")],
      edges: [
        { id: "1", source: "build", target: "check" },
        { id: "2", source: "check", target: "fix", when: "no" },
        { id: "3", source: "fix", target: "polish" },
        { id: "4", source: "check", target: "done", when: "yes" },
      ],
    };
    const yes = schedule(wf, { build: { status: "done" }, check: { status: "done", decision: "yes" } });
    expect(yes.ready).toEqual(["done"]);
    expect(yes.skip.sort()).toEqual(["fix", "polish"]);
    const no = schedule(wf, { build: { status: "done" }, check: { status: "done", decision: "no" } });
    expect(no.ready).toEqual(["fix"]);
    expect(no.skip).toEqual(["done"]);
  });

  it("joins: a step with two inputs waits for both", () => {
    const wf: WorkflowDef = {
      id: "j",
      name: "j",
      stage: "prework",
      nodes: [node("a"), node("b"), node("c")],
      edges: [
        { id: "1", source: "a", target: "c" },
        { id: "2", source: "b", target: "c" },
      ],
    };
    expect(schedule(wf, {}).ready.sort()).toEqual(["a", "b"]);
    expect(schedule(wf, { a: { status: "done" } }).ready).toEqual(["b"]);
    expect(schedule(wf, { a: { status: "done" }, b: { status: "done" } }).ready).toEqual(["c"]);
  });
});

describe("engine batches", () => {
  const prework = DEFAULT_WORKFLOWS.find((w) => w.id === "prework-standard")!;
  const never = () => false;

  it("resumes a step interrupted by the time limit instead of waiting forever", () => {
    const b = nextBatch(prework, { analyze: { status: "done" }, brief: { status: "running" } }, never);
    expect(b.gemini).toEqual(["brief"]);
    expect(b.finished).toBe(false);
  });

  it("runs parallel Gemini steps together and Claude steps one at a time after them", () => {
    const wf: WorkflowDef = {
      id: "m",
      name: "m",
      stage: "main",
      nodes: [node("g1"), node("g2"), node("c", "claude")],
      edges: [],
    };
    const isClaude = (id: string) => id === "c";
    expect(nextBatch(wf, {}, isClaude)).toMatchObject({ gemini: ["g1", "g2"], claude: null });
    expect(nextBatch(wf, { g1: { status: "done" }, g2: { status: "done" } }, isClaude)).toMatchObject({ gemini: [], claude: "c" });
  });
});

describe("workflow validation", () => {
  it("accepts the built-in workflows", () => {
    for (const wf of DEFAULT_WORKFLOWS) expect(validateWorkflow(wf, agents)).toEqual([]);
  });

  it("rejects cycles, Claude in pre-work, unlabeled condition branches and bad file names", () => {
    const wf: WorkflowDef = {
      id: "bad",
      name: "bad",
      stage: "prework",
      nodes: [node("a"), { ...node("b", "reviewer") }, { ...node("c", "claude") }, { ...node("d"), saveAs: "../x" }],
      edges: [
        { id: "1", source: "a", target: "b" },
        { id: "2", source: "b", target: "a" },
        { id: "3", source: "b", target: "d" },
      ],
    };
    const errors = validateWorkflow(wf, agents).join("\n");
    expect(errors).toContain("حلقه");
    expect(errors).toContain("Claude فقط در ورکفلوی کار اصلی");
    expect(errors).toContain("«بله» یا «خیر»");
    expect(errors).toContain("نام فایل خروجی");
    expect(findCycle(wf)).not.toBeNull();
  });
});

describe("live view summary", () => {
  it("wraps the workflow between prepare and publish and groups parallel steps in one layer", () => {
    const wf = DEFAULT_WORKFLOWS.find((w) => w.id === "prework-standard")!;
    const flow = flowSummary(wf, agents);
    const ids = summaryLayers(flow).map((layer) => layer.map((n) => n.id).sort());
    expect(ids).toEqual([["prepare"], ["analyze"], ["brief"], ["helpers", "summary"], ["publish"]]);
    expect(layers(wf).length).toBe(3);
  });
});

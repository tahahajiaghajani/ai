import { describe, expect, it } from "vitest";
import fixture from "./fixtures/graphify-graph.json";
import { buildOverview, mergeGraphs, parseGraphify, projectSubgraph, relationLabel, taskNodeId, type GraphData } from "@/lib/graph/model";

function assertConsistent(g: GraphData) {
  const ids = new Set(g.nodes.map((n) => n.id));
  expect(ids.size).toBe(g.nodes.length);
  for (const l of g.links) {
    expect(ids.has(l.source), `missing source ${l.source}`).toBe(true);
    expect(ids.has(l.target), `missing target ${l.target}`).toBe(true);
  }
  const keys = g.links.map((l) => `${l.source}|${l.target}|${l.relation}`);
  expect(new Set(keys).size).toBe(keys.length);
}

describe("parseGraphify (real graphify graph.json)", () => {
  const root = taskNodeId("t1");
  const g = parseGraphify(fixture, { prefix: "g:t1", rootId: root, taskId: "t1", taskCode: "T-0001", fileUrl: (p) => `https://github.com/o/r/tree/main/tasks/x/${p}` });

  it("keeps every graphify node, scoped and linked", () => {
    expect(g.nodes.length).toBe((fixture as { nodes: unknown[] }).nodes.length);
    expect(g.nodes.every((n) => n.id.startsWith("g:t1:") && n.graphify && n.taskId === "t1")).toBe(true);
    // root is external (the project node lives in the overview), so check links after merging
    assertConsistent(mergeGraphs({ nodes: [{ id: root, label: "p", kind: "project" }], links: [] }, g));
  });

  it("recognises file nodes and hangs them off the project", () => {
    const files = g.nodes.filter((n) => n.kind === "file");
    expect(files.map((f) => f.label).sort()).toEqual(["jalali.ts", "model.ts", "utils.ts"]);
    expect(files.every((f) => f.url?.endsWith(f.path!))).toBe(true);
    const rootLinks = g.links.filter((l) => l.source === root);
    expect(rootLinks).toHaveLength(3);
    expect(rootLinks.every((l) => l.relation === "has_file")).toBe(true);
  });

  it("keeps graphify relations", () => {
    const rel = new Set(g.links.map((l) => l.relation));
    expect(rel.has("calls")).toBe(true);
    expect(rel.has("imports_from")).toBe(true);
    expect(rel.has("contains")).toBe(true);
  });

  it("caps very large graphs by degree", () => {
    const small = parseGraphify(fixture, { prefix: "g", rootId: "r", maxNodes: 10 });
    expect(small.nodes.filter((n) => !n.id.startsWith("g:file:")).length).toBeLessThanOrEqual(10);
    assertConsistent(mergeGraphs({ nodes: [{ id: "r", label: "r", kind: "project" }], links: [] }, small));
  });

  it("accepts the `edges` key, object endpoints and synthesises missing file nodes", () => {
    const g2 = parseGraphify(
      {
        nodes: [
          { id: "a", label: "Alpha", file_type: "concept", source_file: "docs/a.md", community: 2 },
          { id: "b", label: "Beta", file_type: "document", source_file: "docs/b.md" },
        ],
        edges: [{ source: { id: "a" }, target: { id: "b" }, relation: "semantically_similar_to" }],
      },
      { prefix: "p", rootId: "root" },
    );
    expect(g2.nodes.find((n) => n.id === "p:a")?.kind).toBe("concept");
    expect(g2.nodes.find((n) => n.id === "p:a")?.group).toBe("خوشه 2");
    expect(g2.nodes.filter((n) => n.kind === "file").map((n) => n.label).sort()).toEqual(["a.md", "b.md"]);
    expect(g2.links.some((l) => l.source === "p:a" && l.target === "p:b" && l.relation === "semantically_similar_to")).toBe(true);
    expect(g2.links.filter((l) => l.relation === "contains")).toHaveLength(2);
  });

  it("tolerates garbage", () => {
    expect(parseGraphify(null, { prefix: "x", rootId: "r" })).toEqual({ nodes: [], links: [] });
    expect(parseGraphify({ nodes: "no" }, { prefix: "x", rootId: "r" })).toEqual({ nodes: [], links: [] });
  });
});

describe("buildOverview / projectSubgraph", () => {
  const tasks = [
    { id: "p1", code: "T-0001", title: "پروژه یک", status: "closed", root_id: null, parent_id: null, relation_type: null, requester_id: "u1", github_path: "tasks/T-0001" },
    { id: "c1", code: "T-0001.2", title: "ادامه", status: "main_done", root_id: "p1", parent_id: "p1", relation_type: "continuation", requester_id: "u1", github_path: "tasks/T-0001" },
    { id: "p2", code: "T-0002", title: "پروژه دو", status: "approved", root_id: null, parent_id: null, relation_type: null, requester_id: "u2", github_path: null },
  ];
  const g = buildOverview({
    tasks,
    profiles: [
      { id: "u1", full_name: "علی", email: null },
      { id: "u2", full_name: null, email: "b@x.ir" },
    ],
    files: [{ id: "f1", task_id: "c1", name: "brief.pdf", context: "request", github_path: "tasks/T-0001/inputs/brief.pdf" }],
    knowledge: [
      { id: "k1", metadata: { title: "روش", task_id: "p1", tags: ["BPM", "بانک"] } },
      { id: "k2", metadata: { title: "روش دو", task_id: "p2", tags: ["bpm"] } },
    ],
    fileUrl: (p) => `https://gh/${p}`,
  });

  it("builds projects, related tasks, requesters, files and knowledge", () => {
    assertConsistent(g);
    expect(g.nodes.find((n) => n.id === "task:p1")?.kind).toBe("project");
    expect(g.nodes.find((n) => n.id === "task:c1")?.kind).toBe("task");
    expect(g.links).toContainEqual({ source: "task:p1", target: "task:c1", relation: "continuation" });
    // same requester as the parent: no duplicate requester link for the child
    expect(g.links.filter((l) => l.source === "user:u1")).toHaveLength(1);
    expect(g.nodes.find((n) => n.id === "tf:f1")?.url).toBe("https://gh/tasks/T-0001/inputs/brief.pdf");
    // tags are shared case-insensitively and connect the two projects' knowledge
    expect(g.links.filter((l) => l.target === "tag:bpm")).toHaveLength(2);
  });

  it("project view does not leak into other projects through shared tags", () => {
    const sub = projectSubgraph(g, "task:p1");
    const ids = new Set(sub.nodes.map((n) => n.id));
    expect(ids.has("task:c1")).toBe(true);
    expect(ids.has("tf:f1")).toBe(true);
    expect(ids.has("tag:bpm")).toBe(true);
    expect(ids.has("kn:k2")).toBe(false);
    expect(ids.has("task:p2")).toBe(false);
  });

  it("translates relations to Persian", () => {
    expect(relationLabel("calls")).toBe("فراخوانی");
    expect(relationLabel("some_new_relation")).toBe("some new relation");
  });
});

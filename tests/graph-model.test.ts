import { describe, expect, it } from "vitest";
import fixture from "./fixtures/graphify-graph.json";
import { buildProjectsOverview, mergeGraphs, parseGraphify, projectNodeId, projectSubgraph, relationLabel, type GraphData } from "@/lib/graph/model";
import { resolveImport } from "@/lib/projects/symbols";

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
  const root = projectNodeId("p1");
  const g = parseGraphify(fixture, { prefix: "g:p1", rootId: root, projectId: "p1", fileUrl: (p) => `https://github.com/o/r/blob/main/projects/x/${p}` });

  it("keeps every graphify node, scoped and linked", () => {
    expect(g.nodes.length).toBe((fixture as { nodes: unknown[] }).nodes.length);
    expect(g.nodes.every((n) => n.id.startsWith("g:p1:") && n.graphify && n.projectId === "p1")).toBe(true);
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

describe("buildProjectsOverview / projectSubgraph", () => {
  const projects = [
    { id: "p1", name: "Renew", slug: "renew", root_path: "projects/renew" },
    { id: "p2", name: "CRM", slug: "crm", root_path: "projects/crm" },
  ];
  const files = [
    { project_id: "p1", path: "src/app.ts", kind: "code", summary: "نقطه‌ی شروع", symbols: ["main"], imports: ["./audit", "react"] },
    { project_id: "p1", path: "src/audit.ts", kind: "code", summary: null, symbols: ["Audit", "save"], imports: [] },
    { project_id: "p1", path: "docs/guide.md", kind: "doc", summary: "راهنما", symbols: [], imports: [] },
    { project_id: "p2", path: "index.ts", kind: "code", summary: null, symbols: [], imports: [] },
  ];
  const tasks = [
    { id: "t1", code: "T-0001", title: "باگ audit", status: "main_done", project_id: "p1" },
    { id: "t2", code: "T-0002", title: "بی‌پروژه", status: "approved", project_id: null },
  ];
  const g = buildProjectsOverview({ projects, files, tasks, resolve: resolveImport, fileUrl: (p, path) => `https://gh/${p.root_path}/${path}` });

  it("builds projects, their files, import links and the tasks that worked on them", () => {
    assertConsistent(g);
    expect(g.nodes.find((n) => n.id === projectNodeId("p1"))?.kind).toBe("project");
    expect(g.links.filter((l) => l.source === projectNodeId("p1") && l.relation === "has_file")).toHaveLength(3);
    expect(g.links).toContainEqual({ source: "pf:p1:src/app.ts", target: "pf:p1:src/audit.ts", relation: "imports" });
    // package imports do not create links
    expect(g.links.filter((l) => l.relation === "imports")).toHaveLength(1);
    expect(g.nodes.find((n) => n.id === "pf:p1:src/audit.ts")?.detail).toBe("Audit، save");
    expect(g.nodes.find((n) => n.id === "pf:p1:docs/guide.md")?.kind).toBe("document");
    expect(g.nodes.find((n) => n.id === "pf:p1:src/app.ts")?.url).toBe("https://gh/projects/renew/src/app.ts");
    expect(g.links).toContainEqual({ source: "task:t1", target: projectNodeId("p1"), relation: "worked_on" });
    expect(g.nodes.some((n) => n.id === "task:t2")).toBe(false);
  });

  it("project view does not leak into other projects", () => {
    const sub = projectSubgraph(g, projectNodeId("p1"));
    const ids = new Set(sub.nodes.map((n) => n.id));
    expect(ids.has("pf:p1:src/audit.ts")).toBe(true);
    expect(ids.has("task:t1")).toBe(true);
    expect(ids.has(projectNodeId("p2"))).toBe(false);
    expect(ids.has("pf:p2:index.ts")).toBe(false);
  });

  it("translates relations to Persian", () => {
    expect(relationLabel("calls")).toBe("فراخوانی");
    expect(relationLabel("some_new_relation")).toBe("some new relation");
  });
});

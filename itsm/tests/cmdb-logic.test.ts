// Configuration management's pure logic (src/shared/cmdb) and the screens' model (src/ui/modules/cmdb/model.ts): the
// class tree and inheritance, impact propagation with weights, redundancy and cycles, data health, snapshot
// differences, identifiers, CSV and JSON reading, the map's layered layout, the import wizard's guesses and the class
// attribute form's coercion.
import { describe, expect, it } from "vitest";
import {
  BUILTIN_CLASSES, BUILTIN_REL_TYPES, ClassTree, ciHealth, diffSnapshots, flatten, isStale, jsonArrayAt, normalizeIdent, parseCsv, propagate, severityLabel, type GEdge,
} from "@shared/cmdb/logic";
import { CLASS_LIBRARY, REL_TYPES } from "@shared/cmdb/classes";
import { attrsToSave, batches, coerceAttr, guessMapping, layoutMap, listWith, mappingProblems, missingAttrs, orientEdge, severityStyle } from "../src/ui/modules/cmdb/model";
import type { MapNode } from "@shared/cmdb/api";

const tree = new ClassTree(BUILTIN_CLASSES);
const types = new Map(BUILTIN_REL_TYPES.map((t) => [t.key, t]));

describe("the class pack", () => {
  it("has every seeded class of the brief with Persian labels", () => {
    for (const k of ["server", "virtual_machine", "computer", "network_device", "storage", "database", "application", "business_application", "business_service", "technical_service", "offering", "cloud_resource"]) {
      const c = CLASS_LIBRARY.find((x) => x.key === k);
      expect(c, k).toBeTruthy();
      expect(c!.label).toMatch(/[؀-ۿ]/);
    }
    // parents exist and there are no loops
    for (const c of CLASS_LIBRARY) if (c.parent) expect(CLASS_LIBRARY.some((x) => x.key === c.parent), `${c.key} → ${c.parent}`).toBe(true);
    for (const c of CLASS_LIBRARY) expect(tree.resolve(c.key)!.ancestry.at(-1)).toBe(c.key);
  });

  it("inherits attributes down the tree and lists descendants", () => {
    const server = tree.resolve("server")!;
    expect(server.ancestry[0]).not.toBe("server");
    expect(server.allAttrs.length).toBeGreaterThan((tree.get("server")!.attrs ?? []).length);
    expect(tree.descendants("computer")).toEqual(expect.arrayContaining(["computer", "server"]));
    expect(tree.label("server")).toBe("سرور");
  });

  it("has relationship types with an impact direction and inverse labels", () => {
    for (const t of REL_TYPES) {
      expect(t.label).toMatch(/[؀-ۿ]/);
      expect(t.inverse).toMatch(/[؀-ۿ]/);
    }
    expect(types.get("runs_on")).toMatchObject({ propagates: true, impact: "child_to_parent" });
  });
});

describe("impact propagation", () => {
  const e = (id: string, parent: string, type: string, child: string, weight?: number): GEdge => ({ id, parent, type, child, weight });

  it("reaches dependents through runs_on and depends_on, nearest first", () => {
    const edges = [e("1", "app", "runs_on", "vm"), e("2", "vm", "runs_on", "host"), e("3", "svc", "depends_on", "app")];
    const hits = propagate(new Map([["host", 1]]), edges, types);
    expect(hits.get("vm")).toMatchObject({ severity: 1, depth: 1, from: "host" });
    expect(hits.get("svc")).toMatchObject({ severity: 1, depth: 3 });
  });

  it("weights partial dependencies and stops at the depth limit", () => {
    const edges = [e("1", "db", "depends_on", "san", 50), e("2", "app", "depends_on", "db")];
    const hits = propagate(new Map([["san", 1]]), edges, types);
    expect(hits.get("db")!.severity).toBeCloseTo(0.5);
    expect(hits.get("app")!.severity).toBeCloseTo(0.5);
    const shallow = propagate(new Map([["san", 1]]), edges, types, { maxDepth: 1 });
    expect(shallow.has("app")).toBe(false);
  });

  it("lets a redundancy group absorb one member and terminates on cycles", () => {
    const edges = [e("1", "web1", "member_of", "cl"), e("2", "web2", "member_of", "cl"), e("3", "svc", "depends_on", "cl"), e("4", "a", "depends_on", "b"), e("5", "b", "depends_on", "a")];
    const one = propagate(new Map([["web1", 1]]), edges, types, { redundancy: [{ cluster: "cl", minUp: 1 }] });
    expect(one.get("cl")?.absorbed).toBe(true);
    expect(one.get("cl")!.severity).toBeLessThan(1);
    const both = propagate(new Map([["web1", 1], ["web2", 1]]), edges, types, { redundancy: [{ cluster: "cl", minUp: 1 }] });
    expect(both.get("cl")!.severity).toBe(1);
    expect(both.get("svc")!.severity).toBe(1);
    const loop = propagate(new Map([["a", 1]]), edges, types);
    expect(loop.get("b")!.severity).toBe(1);
  });

  it("labels severities", () => {
    expect(severityLabel(1).key).toBe("down");
    expect(severityLabel(0.6).key).toBe("major");
    expect(severityLabel(0.2).key).toBe("degraded");
    expect(severityStyle(1).tone).toBe("danger");
    expect(severityStyle(0.3, true).tone).toBe("in");
  });
});

describe("data health", () => {
  it("scores completeness, correctness and compliance and lists the issues", () => {
    const cls = tree.resolve("server")!;
    const good = ciHealth({ ci: { name: "s1", class: "server", owned_by: "u", support_group_id: "g", serial_number: "1", manufacturer: "HPE", state: "operational", updated_at: new Date().toISOString(), attrs: {} }, cls, now: Date.now(), rels: [], tree, duplicate: false, audit: { applicable: 1, passed: 1 } });
    const bad = ciHealth({ ci: { name: "s2", class: "server", state: "operational", updated_at: "2020-01-01T00:00:00Z", attrs: {} }, cls, now: Date.now(), rels: [], tree, duplicate: true, audit: { applicable: 1, passed: 0 } });
    expect(good.score).toBeGreaterThan(bad.score);
    expect(bad.issues.length).toBeGreaterThan(0);
    expect(bad.correctness).toBeLessThan(good.correctness);
    expect(bad.compliance).toBe(0);
  });

  it("calls a CI stale after its class's days without being seen", () => {
    const now = Date.parse("2026-06-01T00:00:00Z");
    expect(isStale({ last_discovered_at: "2026-01-01T00:00:00Z" }, 30, now)).toBe(true);
    expect(isStale({ last_discovered_at: "2026-05-25T00:00:00Z" }, 30, now)).toBe(false);
    expect(isStale({ last_discovered_at: "2026-01-01T00:00:00Z" }, null, now)).toBe(false);
  });
});

describe("baselines", () => {
  it("finds modified fields, relationships and removed CIs", () => {
    const before = [
      { id: "1", name: "a", class: "server", values: { os: "Ubuntu 22.04", ram_mb: 8192 }, rels: [{ type: "runs_on", dir: "out" as const, other: "h1" }] },
      { id: "2", name: "b", class: "server", values: {}, rels: [] },
    ];
    const after = [{ id: "1", name: "a", class: "server", values: { os: "Ubuntu 24.04", ram_mb: 8192 }, rels: [{ type: "runs_on", dir: "out" as const, other: "h2" }] }];
    const d = diffSnapshots(before, after);
    expect(d.removed.map((x) => x.id)).toEqual(["2"]);
    expect(d.modified[0].fields).toEqual([{ field: "os", before: "Ubuntu 22.04", after: "Ubuntu 24.04" }]);
    expect(d.modified[0].relsAdded[0].other).toBe("h2");
    expect(d.modified[0].relsRemoved[0].other).toBe("h1");
  });
});

describe("identifiers and files", () => {
  it("normalises identifiers the reconciliation engine matches on", () => {
    expect(normalizeIdent("mac_address", "aa-bb-cc-dd-ee-ff")).toBe(normalizeIdent("mac_address", "AA:BB:CC:DD:EE:FF"));
    expect(normalizeIdent("serial_number", " sn-۱۲۳ ")).toBe(normalizeIdent("serial_number", "SN-123"));
    expect(normalizeIdent("hostname", "")).toBeNull();
  });

  it("reads CSV with quotes and JSON arrays at a path", () => {
    expect(parseCsv('name,ip\n"web, 1",10.0.0.1\nweb2,10.0.0.2')).toEqual([["name", "ip"], ["web, 1", "10.0.0.1"], ["web2", "10.0.0.2"]]);
    const rows = jsonArrayAt({ data: { items: [{ name: "a", hw: { serial: "1" } }] } }, "data.items");
    expect(flatten(rows[0])).toEqual({ name: "a", "hw.serial": "1" });
  });
});

describe("the screens' model", () => {
  const node = (id: string, family: MapNode["family"], extra: Partial<MapNode> = {}): MapNode => ({ id, name: id, family, depth: 0, ...extra });

  it("lays dependents above what they depend on", () => {
    const map = {
      nodes: [node("svc", "service"), node("app", "software"), node("host", "hardware"), node("x", "logical", { restricted: true })],
      edges: [
        { id: "1", source: "svc", target: "app", type: "depends_on", label: "", propagates: true, dependent: "source" as const },
        { id: "2", source: "app", target: "host", type: "runs_on", label: "", propagates: true, dependent: "source" as const },
        { id: "3", source: "host", target: "x", type: "connects", label: "", propagates: false, dependent: null },
      ],
    };
    const pos = layoutMap(map, "TB");
    expect(pos.get("svc")!.y).toBeLessThan(pos.get("app")!.y);
    expect(pos.get("app")!.y).toBeLessThan(pos.get("host")!.y);
    expect(pos.get("x")!.w).toBeLessThan(pos.get("host")!.w);
    // with no side, the higher layer (service above hardware) is the dependent
    const by = new Map(map.nodes.map((n) => [n.id, n]));
    expect(orientEdge({ ...map.edges[2], source: "host", target: "svc" }, by)).toEqual({ from: "svc", to: "host" });
    const rl = layoutMap(map, "RL");
    expect(rl.get("svc")!.x).toBeGreaterThan(rl.get("host")!.x);
  });

  it("guesses import columns by name, label and synonyms, once each", () => {
    const targets = [{ value: "name", label: "نام", group: "field" as const }, { value: "serial_number", label: "شمارهٔ سریال", group: "field" as const }, { value: "ip_address", label: "نشانی IP", group: "field" as const }, { value: "attrs.rack_u", label: "واحد رک", group: "attr" as const }];
    const m = guessMapping(["Name", "Serial Number", "IP", "rack_u", "Name "], targets);
    expect(m).toEqual({ Name: "name", "Serial Number": "serial_number", IP: "ip_address", rack_u: "attrs.rack_u", "Name ": "" });
    expect(mappingProblems({ a: "ip_address" }, null)).toHaveLength(2);
    expect(mappingProblems({ a: "serial_number" }, "server")).toHaveLength(0);
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("coerces class attributes for saving and finds the required ones still empty", () => {
    expect(coerceAttr({ name: "n", label: "n", type: "int" }, "12.7")).toBe(12);
    expect(coerceAttr({ name: "b", label: "b", type: "bool" }, "true")).toBe(true);
    expect(coerceAttr({ name: "t", label: "t", type: "tags" }, "a، b,c")).toEqual(["a", "b", "c"]);
    expect(coerceAttr({ name: "s", label: "s", type: "string" }, "  ")).toBeNull();
    const attrs = [{ name: "rack_u", label: "واحد رک", type: "int" as const, required: true }, { name: "role", label: "نقش", type: "string" as const }];
    expect(attrsToSave(attrs, { old: "kept", role: "web" }, { rack_u: "4", role: "" })).toEqual({ old: "kept", rack_u: 4 });
    expect(missingAttrs(attrs, {})).toEqual(["واحد رک"]);
    expect(decodeURIComponent(listWith("cis", { f: "class", op: "eq", v: "server" }))).toBe('cis?filter={"f":"class","op":"eq","v":"server"}');
  });
});

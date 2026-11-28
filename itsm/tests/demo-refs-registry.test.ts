// The purge's reference catalogue never rots (docs/DEMO_FA.md «حذف کامل», release 1.1.5; like tests/sync-registry.test.ts).
// «حذف داده‌های نمایشی» keeps what was built on top of the pack and cleans it (src/server/modules/demo/refs.ts): every json
// or conditions field of every table has a decision, every reference a role, every text field that looks like an id a
// decision, every jsonb column of a platform table a decision — and every name the catalogue lists exists. A module that
// adds a table or a field without a decision fails here; the purge would otherwise leave it naming removed rows (the
// post-purge verifier finds those only when a test happens to build one) or, worse, widen what it selects.
// The second half pins the meaning of the pruning: a condition pruned of removed ids selects exactly the rows it selected
// before among the rows that are left (none of them names a removed row), a list that empties never means «everyone».
import { describe, it, expect, beforeAll } from "vitest";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import type { Db } from "@server/db";
import { physicalTables } from "@shared/tables";
import { FIELD_TYPES, type TableDef } from "@shared/model/types";
import { evaluate, type Cond } from "@shared/model/conditions";
import { archivable, archiveTableOf } from "@server/engine/ddl";
import { COMPUTED_TABLES } from "@server/modules/demo/purge";
import {
  ABOUT_COLUMNS, FOREIGN_TEXT, ID_TEXT, JSON_FIELDS, PARENTS, PLATFORM_JSON_DERIVES, PLATFORM_JSON_DERIVE_WHEN, PLATFORM_JSON_NONE,
  PLATFORM_JSON_PRUNES, PLATFORM_KEPT, PRODUCER_REFS, RESTRICTION_SCALARS, RESTRICTION_SETS, RESTRICTION_WORDS, SNAPSHOT_TABLES, TRAIL_TABLE_NAMES,
  actionsHandler, approvalLevelsHandler, fieldRefs, jsonHandler, processDraftHandler, pruneCond, pruneIds, pruneRules, recipientsHandler,
  type Gone,
} from "@server/modules/demo/refs";

const defs = new Map(physicalTables().map((d) => [d.key, d]));
const family = (t: string, n: string) => {
  const f = defs.get(t)?.fields.find((x) => x.name === n);
  return f ? FIELD_TYPES[f.type].family : null;
};

describe("every place a row can name another has a decision", () => {
  it("every json or conditions field of every table (refs.ts JSON_FIELDS)", () => {
    const missing: string[] = [];
    for (const d of defs.values())
      for (const f of d.fields) if (!f.base && FIELD_TYPES[f.type].family === "json" && !JSON_FIELDS[d.key]?.[f.name]) missing.push(`${d.key}.${f.name}`);
    expect(missing).toEqual([]);
  });

  it("every reference field has a role, and a snapshot table's are never rewritten", () => {
    for (const d of defs.values()) {
      const refs = fieldRefs(d);
      const names = d.fields.filter((f) => !f.base && FIELD_TYPES[f.type].family === "ref").map((f) => f.name);
      expect(refs.map((r) => r.name).sort()).toEqual([...names].sort());
      if (SNAPSHOT_TABLES.has(d.key)) expect(refs.every((r) => r.role === "snapshot")).toBe(true);
    }
  });

  it("every text field that looks like an id is a row's id (ID_TEXT), another system's (FOREIGN_TEXT), or read by name", () => {
    const missing: string[] = [];
    for (const d of defs.values())
      for (const f of d.fields) {
        if (f.base || FIELD_TYPES[f.type].family !== "text" || !/(_id|_ids|_ref|_refs|_uuid|^ref)$/.test(f.name)) continue;
        if (ID_TEXT[d.key]?.[f.name] || FOREIGN_TEXT.has(`${d.key}.${f.name}`) || (ABOUT_COLUMNS as readonly string[]).includes(f.name)) continue;
        missing.push(`${d.key}.${f.name}`);
      }
    expect(missing).toEqual([]);
  });

  describe("platform tables (no engine definition)", () => {
    let db: Db;
    let cols: { t: string; c: string; udt: string }[];
    beforeAll(async () => {
      db = await createPgliteDb({});
      await migrate(db, () => {});
      cols = await db.query(
        `select c.table_name as t, c.column_name as c, c.udt_name as udt from information_schema.columns c
           join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
          where c.table_schema = current_schema() and c.table_name like 'sm\\_%' order by 1, 2`,
      );
    }, 120_000);

    const engineTables = () => {
      const out = new Set<string>();
      for (const d of physicalTables()) {
        out.add(d.table);
        if (archivable(d)) out.add(archiveTableOf(d));
      }
      return out;
    };

    it("every jsonb column of an organisation's platform table: derived, pruned, a trail or holding no row", () => {
      const engine = engineTables();
      const withOrg = new Set(cols.filter((c) => c.c === "org_id").map((c) => c.t));
      const has = (m: Record<string, readonly string[]>, t: string, c: string) => (m[t] ?? []).includes(c);
      const missing = cols
        .filter((c) => c.udt === "jsonb" && !engine.has(c.t) && (withOrg.has(c.t) || c.t === "sm_orgs") && !TRAIL_TABLE_NAMES.has(c.t))
        .filter((c) => !has(PLATFORM_JSON_DERIVES, c.t, c.c) && !has(PLATFORM_JSON_PRUNES, c.t, c.c) && !has(PLATFORM_JSON_NONE, c.t, c.c))
        .map((c) => `${c.t}.${c.c}`);
      expect(missing).toEqual([]);
    });

    it("computed tables are put back from their copy, never derived or pruned row by row", () => {
      const both = COMPUTED_TABLES.filter((t) => PLATFORM_JSON_DERIVES[t] || PLATFORM_JSON_PRUNES[t]);
      expect(both).toEqual([]);
    });

    it("the platform lists name jsonb columns that exist", () => {
      const json = new Set(cols.filter((c) => c.udt === "jsonb").map((c) => `${c.t}.${c.c}`));
      const all = new Set(cols.map((c) => `${c.t}.${c.c}`));
      const stale: string[] = [];
      for (const m of [PLATFORM_JSON_DERIVES, PLATFORM_JSON_PRUNES, PLATFORM_JSON_NONE, PLATFORM_KEPT])
        for (const [t, cs] of Object.entries(m)) for (const c of cs) if (!json.has(`${t}.${c}`)) stale.push(`${t}.${c}`);
      for (const t of Object.keys(PLATFORM_JSON_DERIVE_WHEN)) if (!PLATFORM_JSON_DERIVES[t]) stale.push(`when ${t}`);
      // the derive conditions name columns of their table
      for (const [t, sql] of Object.entries(PLATFORM_JSON_DERIVE_WHEN)) for (const m of sql.matchAll(/x\.([a-z_]+)/g)) if (!all.has(`${t}.${m[1]}`)) stale.push(`${t}.${m[1]}`);
      expect(stale).toEqual([]);
    });
  });
});

describe("the catalogue names only what exists (lists never rot)", () => {
  it("JSON_FIELDS: tables and json / conditions fields", () => {
    const stale: string[] = [];
    for (const [t, fs] of Object.entries(JSON_FIELDS)) {
      if (!defs.has(t)) stale.push(t);
      else for (const n of Object.keys(fs)) if (family(t, n) !== "json") stale.push(`${t}.${n}`);
    }
    expect(stale).toEqual([]);
  });

  it("parents, restrictions, producers: reference fields; ID_TEXT and FOREIGN_TEXT: text fields; snapshots: tables", () => {
    const stale: string[] = [];
    const refs = (label: string, m: Record<string, readonly string[]>) => {
      for (const [t, ns] of Object.entries(m)) for (const n of ns) if (family(t, n) !== "ref") stale.push(`${label} ${t}.${n}`);
    };
    refs("PARENTS", PARENTS);
    refs("RESTRICTION_SCALARS", RESTRICTION_SCALARS);
    refs("PRODUCER_REFS", PRODUCER_REFS);
    refs("RESTRICTION_SETS", Object.fromEntries(Object.entries(RESTRICTION_SETS).map(([t, s]) => [t, s.flat()])));
    // a list's own review words name a list the purge cleans
    for (const t of Object.keys(RESTRICTION_WORDS)) if (!RESTRICTION_SETS[t]) stale.push(`RESTRICTION_WORDS ${t}`);
    for (const [t, m] of Object.entries(ID_TEXT)) for (const n of Object.keys(m)) if (family(t, n) !== "text") stale.push(`ID_TEXT ${t}.${n}`);
    for (const k of FOREIGN_TEXT) {
      const [t, n] = k.split(".");
      if (family(t, n) !== "text") stale.push(`FOREIGN_TEXT ${k}`);
    }
    for (const t of SNAPSHOT_TABLES) if (!defs.has(t)) stale.push(`SNAPSHOT ${t}`);
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// what the decisions mean

const A = "0190a000-0000-7000-8000-00000000000a"; // removed
const A2 = "0190a000-0000-7000-8000-0000000000a2"; // removed
const B = "0190b000-0000-7000-8000-00000000000b"; // kept
const C = "0190c000-0000-7000-8000-00000000000c"; // kept
const gone = (extra: Partial<Gone> = {}): Gone => ({
  id: (x) => x === A || x === A2,
  position: (k) => k === "pack_head",
  libraryField: (n) => n === "u_pack_field",
  tableField: (t, n) => t === "incident" && n === "u_pack_field",
  ...extra,
});

describe("conditions are pruned by meaning, never widened", () => {
  const incident = defs.get("incident") as TableDef;
  it("a clause on a removed row can no longer hold; its negation always holds", () => {
    expect(pruneCond({ f: "assignment_group_id", op: "eq", v: A }, gone(), "incident")).toMatchObject({ value: { or: [] }, changed: true, never: true });
    expect(pruneCond({ f: "assignment_group_id", op: "ne", v: A }, gone(), "incident")).toMatchObject({ value: { and: [] }, changed: true, never: false });
    expect(pruneCond({ f: "assignment_group_id", op: "in", v: [A, B] }, gone(), "incident").value).toEqual({ f: "assignment_group_id", op: "in", v: [B] });
    expect(pruneCond({ f: "assignment_group_id", op: "nin", v: [A, A2] }, gone(), "incident").value).toEqual({ and: [] });
    // «و»: one clause that can no longer hold ends it; «یا»: the clause just leaves
    const and = { and: [{ f: "assignment_group_id", op: "eq", v: A }, { f: "priority", op: "eq", v: "1" }] };
    expect(pruneCond(and, gone(), "incident")).toMatchObject({ value: { or: [] }, never: true });
    const or = { or: [{ f: "assignment_group_id", op: "eq", v: A }, { f: "priority", op: "eq", v: "1" }] };
    expect(pruneCond(or, gone(), "incident")).toMatchObject({ value: { or: [{ f: "priority", op: "eq", v: "1" }] }, never: false });
    // a field that left the table is empty everywhere
    expect(pruneCond({ f: "u_pack_field", op: "nempty" }, gone(), "incident").value).toEqual({ or: [] });
    expect(pruneCond({ f: "u_pack_field", op: "empty" }, gone(), "incident").value).toEqual({ and: [] });
    // nothing to prune: unchanged
    expect(pruneCond({ f: "assignment_group_id", op: "eq", v: B }, gone(), "incident")).toMatchObject({ changed: false });
  });

  it("among the rows that are left, a pruned condition selects exactly what it selected before (random conditions)", () => {
    let seed = 1405;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const fields = ["assignment_group_id", "assigned_to", "priority", "u_pack_field"];
    const ids = [A, A2, B, C];
    const leaf = (): Cond => {
      const f = fields[rnd(fields.length)];
      const op = ["eq", "ne", "in", "nin", "empty", "nempty"][rnd(6)];
      if (op === "empty" || op === "nempty") return { f, op } as Cond;
      const one = () => (f === "priority" ? String(1 + rnd(4)) : ids[rnd(ids.length)]);
      return { f, op, v: op === "in" || op === "nin" ? [one(), one()] : one() } as Cond;
    };
    const tree = (depth: number): Cond => {
      if (depth === 0 || rnd(3) === 0) return leaf();
      const k = rnd(3);
      if (k === 2) return { not: tree(depth - 1) } as Cond;
      const xs = Array.from({ length: 1 + rnd(3) }, () => tree(depth - 1));
      return (k === 0 ? { and: xs } : { or: xs }) as Cond;
    };
    // the rows that are left name no removed row and have no removed field
    const rows: Record<string, unknown>[] = [];
    for (const g of [B, C, null]) for (const u of [B, C, null]) for (const p of ["1", "2", "3", null]) rows.push({ assignment_group_id: g, assigned_to: u, priority: p });
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const c = tree(3);
      const p = pruneCond(c, gone(), "incident");
      for (const r of rows) {
        const before = evaluate(c, r, {}, incident);
        const after = evaluate(p.value as Cond, r, {}, incident);
        if (before !== after) throw new Error(`${JSON.stringify(c)} → ${JSON.stringify(p.value)} on ${JSON.stringify(r)}: ${before} → ${after}`);
        checked++;
      }
      // «never» is reported only when the condition really selects nothing now
      if (p.never) expect(rows.some((r) => evaluate(c, r, {}, incident))).toBe(false);
    }
    expect(checked).toBe(400 * rows.length);
  });
});

describe("lists that empty never mean «everyone»", () => {
  it("pruneIds: removed ids leave lists, objects and keys; strings naming one go; an entry about one goes whole", () => {
    const v = { list: [A, B], obj: { g: A, h: B }, [A]: 1, link: `/r/incident/${A}`, keep: `/r/incident/${B}` };
    const p = pruneIds(v, gone());
    expect(p.changed).toBe(true);
    expect(p.value).toEqual({ list: [B], obj: { h: B }, keep: `/r/incident/${B}` });
    expect(pruneIds({ list: [B] }, gone()).changed).toBe(false);
    // a dashboard shared with a removed group keeps its other shares, never an entry without its target
    const shares = [{ kind: "group", id: A, right: "edit" }, { kind: "user", id: B, right: "view" }, { kind: "everyone", id: null }];
    expect(pruneIds(shares, gone()).value).toEqual([{ kind: "user", id: B, right: "view" }, { kind: "everyone", id: null }]);
  });

  it("a condition whose absence would mean «always» stays «never»; a flow whose trigger can no longer hold stops", () => {
    const h = (t: string, n: string) => jsonHandler(t, defs.get(t)!.fields.find((x) => x.name === n)!)!;
    const never = { f: "assignment_group_id", op: "eq", v: A };
    expect(h("order_guide_rule", "condition")(never, { gone: gone(), row: {}, table: "order_guide_rule" })).toMatchObject({ value: { or: [] }, dead: false });
    expect(h("catalog_variable", "ref_filter")(never, { gone: gone(), row: {}, table: "catalog_variable" })).toMatchObject({ value: { or: [] } });
    expect(h("flow", "trigger_condition")(never, { gone: gone(), row: { trigger_table: "incident" }, table: "flow" })).toMatchObject({ dead: true });
    // an auto-approval that can no longer hold is dropped: its absence means «never»
    expect(h("approval_rule", "auto_approve")(never, { gone: gone(), row: { table_key: "incident" }, table: "approval_rule" }).value).toBeNull();
  });

  it("an assignee rule whose «فقط این افراد» empties, whose position, group or field went, goes whole", () => {
    const r = pruneRules(
      [
        { kind: "position", position: "pack_head" },
        { kind: "position", position: "branch_head", members: [A] },
        { kind: "position", position: "branch_head", members: [A, B] },
        { kind: "group", group: A },
        { kind: "users", users: [A, C] },
        { kind: "users", users: [A2] },
        { kind: "field", field: "u_pack_field" },
        { kind: "requester_manager" },
      ],
      gone(),
    );
    expect(r.changed).toBe(true);
    expect(r.rules).toEqual([{ kind: "position", position: "branch_head", members: [B] }, { kind: "users", users: [C] }, { kind: "requester_manager" }]);
  });

  it("an approval level left without approvers ends its rule; a notification rule left with nobody ends", () => {
    const levels = [{ sources: [{ kind: "users", users: [A] }, { kind: "groups", groups: [A2] }] }, { sources: [{ kind: "users", users: [B] }] }];
    const a = approvalLevelsHandler(levels, { gone: gone(), row: {}, table: "approval_rule" });
    expect(a.dead).toBe(true);
    const b = approvalLevelsHandler([{ sources: [{ kind: "users", users: [A, B] }] }], { gone: gone(), row: {}, table: "approval_rule" });
    expect(b).toMatchObject({ changed: true, dead: false, value: [{ sources: [{ kind: "users", users: [B] }] }] });
    const n = recipientsHandler({ users: [A], groups: [] }, { gone: gone(), row: {}, table: "notification_rule" });
    expect(n.dead).toBe(true);
    expect(recipientsHandler({ users: [A, B] }, { gone: gone(), row: {}, table: "notification_rule" }).dead).toBe(false);
  });

  it("an action that would write a removed row goes; a definition left with no action ends", () => {
    const one = actionsHandler([{ type: "set", field: "assignment_group_id", value: A }], { gone: gone(), row: {}, table: "business_rule" });
    expect(one).toMatchObject({ value: [], changed: true, dead: true });
    const two = actionsHandler([{ type: "set", field: "assignment_group_id", value: A }, { type: "set", field: "priority", value: "2" }], { gone: gone(), row: {}, table: "business_rule" });
    expect(two).toMatchObject({ value: [{ type: "set", field: "priority", value: "2" }], dead: false });
  });

  it("a workflow draft loses only what went: steps' rules, starters, managers, form fields", () => {
    const draft = {
      graph: { nodes: [{ id: "s1", type: "form_step", config: { assignees: [{ kind: "group", group: A }, { kind: "users", users: [B] }], fallback: [{ kind: "users", users: [A] }], rights: { fields: { u_pack_field: "edit", u_real: "edit" } } } }] },
      starters: [{ kind: "users", users: [A] }, { kind: "position", position: "branch_head" }],
      managers: [A, B],
      requester_view: ["u_pack_field", "u_real"],
    };
    const r = processDraftHandler(draft, { gone: gone(), row: {}, table: "process" });
    expect(r.changed).toBe(true);
    const d = r.value as typeof draft;
    expect(d.graph.nodes[0].config.assignees).toEqual([{ kind: "users", users: [B] }]);
    expect(d.graph.nodes[0].config.fallback).toEqual([]);
    expect(d.graph.nodes[0].config.rights.fields).toEqual({ u_real: "edit" });
    expect(d.starters).toEqual([{ kind: "position", position: "branch_head" }]);
    // starters left with nobody would let everyone start: a rule naming nobody keeps it closed until reviewed
    const only = processDraftHandler({ graph: { nodes: [] }, starters: [{ kind: "group", group: A }] }, { gone: gone(), row: {}, table: "process" });
    expect((only.value as { starters: unknown[] }).starters).toEqual([{ kind: "users", users: [] }]);
    expect(d.managers).toEqual([B]);
    expect(d.requester_view).toEqual(["u_real"]);
  });

  it("roles: audiences and scopes are restrictions, requesters and required references parents, assignees pointers", () => {
    const role = (t: string, n: string) => fieldRefs(defs.get(t)!).find((r) => r.name === n)?.role;
    expect(role("portal_link", "aud_users")).toBe("restriction");
    expect(role("catalog_item", "available_for")).toBe("restriction");
    expect(role("sla_definition", "service_id")).toBe("restriction");
    expect(role("incident", "caller_id")).toBe("parent");
    expect(role("incident_task", "incident_id")).toBe("parent");
    expect(role("incident", "assigned_to")).toBe("pointer");
    expect(role("incident", "assignment_group_id")).toBe("pointer");
    expect(role("approval", "approver_id")).toBe("approval");
    expect(role("assignment_rule", "group_id")).toBe("producer");
    expect(role("process_case", "process_id")).toBe("parent");
    // the ledgers' self-references: a reversal exists for the entry it reverses (it goes with it); a cost type's parent
    // is a tree (the child stays, top level); an allocation rule's cost types are its source, all of them when empty
    expect(role("cost_entry", "reversal_of")).toBe("parent");
    expect(role("stock_movement", "reversal_of")).toBe("parent");
    expect(role("cost_type", "parent_id")).toBe("pointer");
    expect(role("allocation_rule", "cost_types")).toBe("restriction");
    expect(role("allocation_rule", "source_cost_center_id")).toBe("parent");
    expect(role("allocation_result", "run_id")).toBe("parent");
    // a published version is a snapshot: never rewritten
    expect(fieldRefs(defs.get("process_version")!).every((r) => r.role === "snapshot")).toBe(true);
    // conditions without a declared decision are still pruned by meaning; snapshots are kept
    const cond = defs.get("business_rule")!.fields.find((f) => f.name === "condition")!;
    expect(jsonHandler("business_rule", cond)).toBeTypeOf("function");
    const graph = defs.get("process_version")!.fields.find((f) => FIELD_TYPES[f.type].family === "json")!;
    expect(jsonHandler("process_version", graph)).toBeNull();
  });
});

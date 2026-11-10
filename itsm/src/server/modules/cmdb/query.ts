// CMDB queries (catalogue CMDB-019/020): a start class with a condition, then relationship steps — follow a type out
// of or into the current CIs, optionally to a class with its own condition — e.g. «پایگاه‌های دادهٔ تولیدی ← اجرا روی ←
// سرورهای مرکز دادهٔ تهران». Every set is computed through the caller's read rule (the relationships themselves are
// walked with system rights, but only readable CIs ever enter a set), capped at 10 000 ids per step with a clear note
// when a cap was reached. The same query tree is what saved queries store and what natural-language search produces.
import type { Cond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import { bad } from "../../http/errors";
import { checkFilter, condEnv, list, orgSchema, readable, toSql } from "../../engine";
import { access } from "../../access/provider";
import { classTree, isUuid, relTypes, sysOf } from "./common";

export interface QueryStep {
  type: string;
  direction: "out" | "in";
  class?: string | null;
  condition?: Cond | null;
}

export interface CmdbQuery {
  class?: string | null;
  condition?: Cond | null;
  steps?: QueryStep[];
  page?: number;
  size?: number;
  fields?: string[];
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  display: Record<string, string>;
  total: number;
  truncated: boolean;
  steps: { label: string; count: number }[];
}

const CAP = 10_000;

/** Readable CI ids among `ids` (or all) matching class and condition, at most CAP + 1. */
async function filterSet(ctx: Ctx, cls: string | null | undefined, cond: Cond | null | undefined, ids: string[] | null): Promise<string[]> {
  const q = ctx.db;
  const schema = await orgSchema(ctx, q);
  const def = schema.def("ci") ?? tableDef("ci")!;
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const parts = [readable(ctx, def, "t", params, env)];
  if (cls) {
    const tree = await classTree(q, ctx);
    params.push(pgArray(tree.descendants(cls)));
    parts.push(`t.class = any($${params.length}::text[])`);
  }
  if (cond) parts.push(toSql(cond, def, "t", params, env, { ctx, lookup: schema.lookup, filter: true }));
  if (ids) {
    if (!ids.length) return [];
    params.push(pgArray(ids));
    parts.push(`t.id = any($${params.length}::uuid[])`);
  }
  const rows = await q.query<{ id: string }>(`select t.id from ${def.table} t where ${parts.join(" and ")} order by t.id limit ${CAP + 1}`, params);
  return rows.map((r) => r.id);
}

/** Run a query for the caller. */
export async function runQuery(ctx: Ctx, query: CmdbQuery): Promise<QueryResult> {
  const schema = await orgSchema(ctx);
  const def = schema.def("ci") ?? tableDef("ci")!;
  if (!access().canReadTable(ctx, def)) throw bad("به پایگاه پیکربندی دسترسی ندارید");
  const steps = (query.steps ?? []).slice(0, 5);
  if (!query.class && !query.condition && !steps.length) throw bad("پرس‌وجو بدون کلاس یا شرط همهٔ پایگاه را می‌گردد؛ دست‌کم یکی را مشخص کنید");
  if (query.condition) checkFilter(ctx, def, schema, query.condition);
  for (const s of steps) if (s.condition) checkFilter(ctx, def, schema, s.condition);
  const tree = await classTree(ctx.db, ctx);
  const types = await relTypes(ctx.db, ctx);
  for (const s of steps) {
    if (s.type !== "*" && !types.has(s.type)) throw bad(`نوع رابطهٔ «${s.type}» پیدا نشد`);
    if (s.class && !tree.get(s.class)) throw bad(`کلاس «${s.class}» پیدا نشد`);
  }
  if (query.class && !tree.get(query.class)) throw bad(`کلاس «${query.class}» پیدا نشد`);
  let truncated = false;
  let current = await filterSet(ctx, query.class, query.condition, null);
  if (current.length > CAP) {
    truncated = true;
    current = current.slice(0, CAP);
  }
  const summary = [{ label: query.class ? tree.label(query.class) : "پیکربندی‌ها", count: current.length }];
  const sys = sysOf(ctx);
  for (const s of steps) {
    if (!current.length) break;
    const relDef = (await orgSchema(sys)).def("ci_rel") ?? tableDef("ci_rel")!;
    const env = await condEnv(sys);
    const params: unknown[] = [];
    const parts = [readable(sys, relDef, "r", params, env), `(r.valid_to is null or r.valid_to > now())`];
    params.push(pgArray(current));
    parts.push(s.direction === "out" ? `r.parent_id = any($${params.length}::uuid[])` : `r.child_id = any($${params.length}::uuid[])`);
    if (s.type !== "*") {
      params.push(s.type);
      parts.push(`r.type = $${params.length}`);
    }
    const col = s.direction === "out" ? "child_id" : "parent_id";
    const rows = await ctx.db.query<{ id: string }>(`select distinct r.${col} as id from ${relDef.table} r where ${parts.join(" and ")} limit ${CAP * 5}`, params);
    let next = await filterSet(ctx, s.class, s.condition, rows.map((r) => r.id).filter(isUuid));
    if (next.length > CAP) {
      truncated = true;
      next = next.slice(0, CAP);
    }
    current = next;
    summary.push({ label: `${s.direction === "out" ? types.get(s.type)?.label ?? "هر رابطه" : types.get(s.type)?.inverse ?? "هر رابطه"} ← ${s.class ? tree.label(s.class) : "پیکربندی"}`, count: current.length });
  }
  const size = Math.max(1, Math.min(200, query.size ?? 50));
  const page = Math.max(1, query.page ?? 1);
  const slice = current.slice((page - 1) * size, page * size);
  const listed = slice.length ? await list(ctx, "ci", { ids: slice, size, fields: query.fields?.length ? query.fields : undefined, sort: "name", total: false }) : { rows: [], display: {} };
  return { rows: listed.rows, display: listed.display ?? {}, total: current.length, truncated, steps: summary };
}

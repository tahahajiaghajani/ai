// What the models read (docs/spec/AI.md §13.2). Training and scoring jobs read as the system through `readable` (the
// engine's one read path), live rows only. A model never LEARNS from a confidential record or a record of a secure
// workspace — those are read only by the people their rules name, so their words and outcomes stay out of every
// organisation-wide model — but such a record is still SCORED (its prediction is shown only to its readers).
import type { Cond } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import type { Ctx } from "../../../context";
import { condEnv, fromDb, orgSchema, readable, toSql } from "../../../engine";

export type Row = Record<string, unknown> & { id: string; created_at: string };

const IDENT = /^[a-z][a-z0-9_]*$/;

/** The SQL that keeps confidential rows and rows of secure workspaces out of a training set. */
export function trainableSql(def: TableDef, alias = "t"): string {
  const parts: string[] = [];
  if (def.fields.some((f) => f.name === "confidential")) parts.push(`not coalesce(${alias}.confidential, false)`);
  parts.push(`not exists (select 1 from sm_workspaces w where w.id = ${alias}.workspace_id and w.secure)`);
  return parts.join(" and ");
}

export interface ReadOptions {
  where?: Cond | null;
  /** extra SQL on alias `t` (no user input) */
  sql?: string;
  params?: unknown[];
  order?: string;
  limit?: number;
  /** a training read: leaves out what a model must not learn from */
  training?: boolean;
  ids?: string[];
}

/** Rows of `def` with the named columns (non-custom fields and base columns), as the system. */
export async function readRows(sys: Ctx, def: TableDef, cols: readonly string[], opts: ReadOptions = {}): Promise<Row[]> {
  const schema = await orgSchema(sys);
  const env = await condEnv(sys);
  const params: unknown[] = [];
  const parts = [readable(sys, def, "t", params, env)];
  if (opts.where) parts.push(toSql(opts.where, def, "t", params, env, { ctx: sys, lookup: schema.lookup }));
  if (opts.training) parts.push(trainableSql(def));
  if (opts.ids) {
    params.push(`{${opts.ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).join(",")}}`);
    parts.push(`t.id = any($${params.length}::uuid[])`);
  }
  if (opts.sql) {
    // the extra SQL numbers its own parameters from $1: shift them after ours
    const base = params.length;
    parts.push(opts.sql.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + base}`));
    params.push(...(opts.params ?? []));
  }
  const names = [...new Set(["id", "created_at", ...cols])].filter((c) => IDENT.test(c) && (["id", "created_at", "updated_at", "workspace_id"].includes(c) || def.fields.some((f) => f.name === c && !f.custom)));
  const limit = Math.max(1, Math.min(50_000, Math.floor(opts.limit ?? 20_000)));
  const rows = await sys.db.query<Row>(`select ${names.map((c) => `t.${c}`).join(", ")} from ${def.table} t where ${parts.join(" and ")} order by ${opts.order ?? "t.created_at desc, t.id"} limit ${limit}`, params);
  return rows.map((r) => fromDb(def, r) as Row);
}

/** The text of a row for a model: its text fields joined (Markdown marks are dropped by the tokeniser). */
export function rowText(row: Record<string, unknown>, fields: readonly string[]): string {
  return fields
    .map((f) => row[f])
    .filter((v) => typeof v === "string" && v.trim())
    .join("\n")
    .slice(0, 6000);
}

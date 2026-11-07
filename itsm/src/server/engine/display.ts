// Display values of references: every response that carries ids of other records or members also carries
// `display: { [id]: "label" }` — one query per referenced table for the whole page (never one per row), through the
// access provider: a record the caller may not read gets no label (the UI shows it as restricted). Numbered records
// read "TODO0000012 — title", members their name.
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import type { CondEnv } from "@shared/model/conditions";
import { USER_DEF } from "@shared/tables";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { pgArray } from "../db";
import { access } from "../access/provider";
import type { OrgSchema } from "./schema";
import { optionsOf } from "./schema";
import { fieldExpr, readable } from "./sql";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids to label, by target table key ("user" for members). */
export class RefSet {
  readonly byTarget = new Map<string, Set<string>>();
  add(target: string | null | undefined, id: unknown): void {
    if (!target || typeof id !== "string" || !UUID.test(id)) return;
    let s = this.byTarget.get(target);
    if (!s) this.byTarget.set(target, (s = new Set()));
    s.add(id.toLowerCase());
  }
  /** every reference value of `fields` in `row` */
  addRow(def: TableDef, row: Record<string, unknown>, fields: Iterable<FieldDef> = def.fields): void {
    for (const f of fields) {
      if (FIELD_TYPES[f.type].family !== "ref") continue;
      const target = refTarget(f, def.key);
      const v = row[f.name];
      if (Array.isArray(v)) for (const x of v) this.add(target, x);
      else this.add(target, v);
    }
  }
  get size() {
    let n = 0;
    for (const s of this.byTarget.values()) n += s.size;
    return n;
  }
}

/** Labels of the referenced ids the caller may read. */
export async function resolveDisplay(q: Queryable, ctx: Ctx, env: CondEnv, schema: OrgSchema, refs: RefSet): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [target, set] of refs.byTarget) {
    const ids = [...set].slice(0, 5000);
    if (!ids.length) continue;
    if (target === "user") {
      const params: unknown[] = [pgArray(ids)];
      const where = readable(ctx, USER_DEF, "m", params, env, { deleted: "any" });
      const rows = await q.query<{ id: string; d: string }>(
        `select m.user_id as id, coalesce(nullif(u.full_name, ''), u.email) as d
         from sm_org_members m join sm_users u on u.id = m.user_id
         where m.user_id = any($1::uuid[]) and ${where}`,
        params,
      );
      for (const r of rows) out[r.id] = r.d;
      continue;
    }
    const def = schema.def(target);
    if (!def || def.virtual) continue;
    const visible = access().visibleFields(ctx, def);
    const df = def.fields.find((f) => f.name === def.display);
    const showField = df && (!visible || visible.has(df.name)) && df.type !== "secret" ? df : null;
    const params: unknown[] = [pgArray(ids)];
    const where = readable(ctx, def, "t", params, env, { deleted: "any" });
    const cols = [`t.id`, `t.deleted_at`];
    if (def.numbered) cols.push(`t.number`);
    if (showField) cols.push(`${fieldExpr(def, showField, "t")} as d`);
    const rows = await q.query<{ id: string; deleted_at: string | null; number?: string | null; d?: unknown }>(
      `select ${cols.join(", ")} from ${def.table} t where t.id = any($1::uuid[]) and ${where}`,
      params,
    );
    for (const r of rows) {
      let label = showField ? labelOf(showField, r.d, schema) : "";
      if (def.numbered && r.number && showField?.name !== "number") label = label ? `${r.number} — ${label}` : r.number;
      if (!label) label = r.number ?? "—";
      if (r.deleted_at) label += " (حذف‌شده)";
      out[r.id] = label;
    }
  }
  return out;
}

/** A value as text for labels and exports (choice labels, «بله/خیر», arrays joined). */
export function labelOf(f: FieldDef, v: unknown, schema: Pick<OrgSchema, "choices">): string {
  if (v === null || v === undefined || v === "") return "";
  if (f.type === "choice" || f.type === "multichoice") {
    const options = optionsOf(f, schema);
    const one = (x: unknown) => options.find((o) => o.value === x)?.label ?? String(x);
    return Array.isArray(v) ? v.map(one).join("، ") : one(v);
  }
  if (f.type === "bool") return v ? "بله" : "خیر";
  if (Array.isArray(v)) return v.map(String).join("، ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

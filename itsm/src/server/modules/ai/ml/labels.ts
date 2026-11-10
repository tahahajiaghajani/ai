// Labels of classifiers that refer to rows (a group, a CI…): which still name a live row. Shared by training (dead
// labels are not learnt), scoring and the suggestions people see, and the assignment rules' predictor.
import type { TableDef } from "@shared/model/types";
import { refTarget } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import { pgArray, type Queryable } from "../../../db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Of the labels a classifier learnt for a reference field (a group, a CI…), those that still name a live row — not
 * deleted, active where the target has `active`, and an assignment group when `assignment` is asked; null for a field
 * that refers to nothing (a choice), whose labels all stand. A deleted or retired group stays in old records, so in
 * the training labels too: it is never suggested, applied or learnt again.
 */
export async function liveRefLabels(q: Queryable, orgId: string, def: TableDef, field: string, labels: readonly string[], opts: { assignment?: boolean } = {}): Promise<Set<string> | null> {
  const f = def.fields.find((x) => x.name === field);
  const target = f && (f.type === "group" || f.type === "ref") ? refTarget(f, def.key) : null;
  const t = target ? tableDef(target) : undefined;
  if (!t || t.virtual) return null;
  const ids = [...new Set(labels.filter((l) => UUID_RE.test(l)))];
  if (!ids.length) return new Set();
  const extra = [
    t.fields.some((x) => x.name === "active") ? " and coalesce(t.active, true)" : "",
    opts.assignment && target === "group" ? ` and coalesce(t.types, '["assignment"]'::jsonb) @> '["assignment"]'::jsonb` : "",
  ].join("");
  const rows = await q.query<{ id: string }>(`select t.id from ${t.table} t where t.org_id = $1 and t.id = any($2::uuid[]) and t.deleted_at is null${extra}`, [orgId, pgArray(ids)]);
  return new Set(rows.map((r) => String(r.id)));
}


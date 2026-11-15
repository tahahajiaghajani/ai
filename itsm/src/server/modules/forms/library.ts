// The field library as forms see it (design F §3.1–§3.2, package F2): the organisation's library fields by name, each
// built as the online forms build it — `libraryFieldDef` of its row and its type, the same definition a table that
// attaches it gets — with its status. Read by the form hooks, the snapshot of a publish, the preview and the designer.
import type { FieldDef } from "@shared/model/types";
import { LIBRARY_NAME, libraryFieldDef, resolveFieldType, type LibraryFieldRow } from "@shared/forms/fieldtypes";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { SETTINGS_ENV, orgFieldTypes } from "../fields";

export interface LibraryField {
  id: string;
  name: string;
  label: string;
  /** its type's key and label */
  type: string;
  type_label: string;
  /** null when it cannot be built now (a reference without a target table, a type that is gone) */
  def: FieldDef | null;
  retired: boolean;
}

/** Library fields of the organisation by name (only `names` when given). */
export async function libraryFields(q: Queryable, orgId: string, names?: readonly string[]): Promise<Map<string, LibraryField>> {
  const wanted = names ? [...new Set(names.filter((n) => LIBRARY_NAME.test(n)))] : null;
  if (wanted && !wanted.length) return new Map();
  const [rows, types] = await Promise.all([
    q.query<LibraryFieldRow & { id: string }>(
      `select id, name, label, type, help, placeholder, default_value, options, choices, depends_on, validation, field_group, list, search, filter, status
       from sm_field_defs where org_id = $1 and deleted_at is null${wanted ? " and name = any($2::text[])" : ""}`,
      wanted ? [orgId, pgArray(wanted)] : [orgId],
    ),
    orgFieldTypes(q, orgId),
  ]);
  const out = new Map<string, LibraryField>();
  for (const r of rows) {
    const type = resolveFieldType(r.type, types, SETTINGS_ENV);
    out.set(r.name, {
      id: String(r.id),
      name: r.name,
      label: r.label || r.name,
      type: r.type,
      type_label: type?.label ?? r.type,
      def: type ? libraryFieldDef(r, type, SETTINGS_ENV) : null,
      retired: r.status === "retired",
    });
  }
  return out;
}

/** Library field names a stored or sent layout names (whatever its shape): what a check of it needs to load. */
export function namedFields(raw: unknown, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 8 || out.size > 2000) return out;
  if (typeof raw === "string") {
    if (depth === 0) {
      try {
        return namedFields(JSON.parse(raw), out, 1);
      } catch {
        return out;
      }
    }
    return out;
  }
  if (Array.isArray(raw)) for (const x of raw) namedFields(x, out, depth + 1);
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.field === "string" && LIBRARY_NAME.test(o.field)) out.add(o.field);
    for (const k of ["tabs", "sections", "items"]) if (o[k] !== undefined) namedFields(o[k], out, depth + 1);
  }
  return out;
}

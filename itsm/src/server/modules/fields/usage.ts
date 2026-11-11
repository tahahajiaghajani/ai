// Where a library field or a field type is used (design F §3.1): the tables a library field is attached to (live
// `custom_field` rows naming it, active or not — a deactivated one still holds values in `custom`), and the forms and
// published versions that use it, which their packages report through `registerFieldUsage`. A field in use is never
// renamed, deleted or moved to another storage type: it is retired instead, and keeps working where it is used.
import type { Queryable } from "../../db";

export interface FieldUsage {
  /** keys of the tables the field is attached to */
  tables: string[];
  /** names of the forms that use it */
  forms: string[];
  /** processes whose published versions use it */
  versions: string[];
}

export type FieldUsageSource = (q: Queryable, orgId: string, field: { id: string; name: string }) => Promise<Partial<FieldUsage>>;

const sources: FieldUsageSource[] = [];

/** Another place that uses library fields (F2's forms, F4's process versions). */
export function registerFieldUsage(source: FieldUsageSource): void {
  sources.push(source);
}

export async function fieldUsage(q: Queryable, orgId: string, field: { id: string; name: string }): Promise<FieldUsage> {
  const rows = await q.query<{ table_key: string }>(
    `select distinct table_key from sm_custom_fields where org_id = $1 and library_id = $2 and deleted_at is null order by table_key`,
    [orgId, field.id],
  );
  const out: FieldUsage = { tables: rows.map((r) => r.table_key), forms: [], versions: [] };
  for (const source of sources) {
    const u = await source(q, orgId, field);
    out.tables.push(...(u.tables ?? []));
    out.forms.push(...(u.forms ?? []));
    out.versions.push(...(u.versions ?? []));
  }
  return out;
}

export const inUse = (u: FieldUsage): boolean => u.tables.length + u.forms.length + u.versions.length > 0;

/** Where each of many library fields is used (the library's list): one query for the tables, then the sources. */
export async function libraryUsage(q: Queryable, orgId: string, fields: { id: string; name: string }[]): Promise<Map<string, FieldUsage>> {
  const out = new Map<string, FieldUsage>(fields.map((f) => [f.id, { tables: [], forms: [], versions: [] }]));
  if (!fields.length) return out;
  const rows = await q.query<{ library_id: string; table_key: string }>(
    `select distinct library_id, table_key from sm_custom_fields where org_id = $1 and library_id is not null and deleted_at is null order by table_key`,
    [orgId],
  );
  for (const r of rows) out.get(String(r.library_id))?.tables.push(r.table_key);
  for (const source of sources) {
    for (const f of fields) {
      const u = await source(q, orgId, f);
      const mine = out.get(f.id)!;
      mine.tables.push(...(u.tables ?? []));
      mine.forms.push(...(u.forms ?? []));
      mine.versions.push(...(u.versions ?? []));
    }
  }
  return out;
}

/** Live library fields of a type. */
export async function fieldsOfType(q: Queryable, orgId: string, typeKey: string): Promise<{ id: string; name: string; label: string }[]> {
  return q.query(`select id, name, label from sm_field_defs where org_id = $1 and type = $2 and deleted_at is null order by label limit 50`, [orgId, typeKey]);
}

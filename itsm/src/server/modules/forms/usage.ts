// Where process forms are used (design F §3.2, §8.2 «به کار رفته در», package F2):
//   · the processes whose drafts or published versions use a form — F4 reports them through `registerFormUsage`; a
//     form a process uses is never deleted (its published versions keep their snapshot, but a draft would lose it);
//   · and, for the field library (F1's `registerFieldUsage`), the forms that use a library field: a used field is
//     never renamed, deleted or moved to another storage type, and the library's list shows the forms beside the
//     tables and versions. A form's `fields` column (kept by the form's hook) answers it in one query.
import type { Queryable } from "../../db";
import type { FieldUsageSource } from "../fields";

export interface FormUsage {
  /** names of the processes (drafts or published versions) that use the form */
  processes: string[];
}

/** For each of `forms`, the names of the processes that use it (form id → names). */
export type FormUsageSource = (q: Queryable, orgId: string, forms: readonly { id: string; name: string }[]) => Promise<Record<string, string[]>>;

const sources: FormUsageSource[] = [];

/** Another place that uses forms (F4: process drafts and published versions). Returns an unregister function (tests). */
export function registerFormUsage(source: FormUsageSource): () => void {
  sources.push(source);
  return () => {
    const at = sources.indexOf(source);
    if (at >= 0) sources.splice(at, 1);
  };
}

/** Where each of `forms` is used (form id → usage). */
export async function formsUsage(q: Queryable, orgId: string, forms: readonly { id: string; name: string }[]): Promise<Map<string, FormUsage>> {
  const out = new Map<string, FormUsage>(forms.map((f) => [f.id, { processes: [] }]));
  if (!forms.length) return out;
  for (const source of sources) {
    const found = await source(q, orgId, forms);
    for (const [id, names] of Object.entries(found ?? {})) out.get(id)?.processes.push(...names);
  }
  for (const u of out.values()) u.processes = [...new Set(u.processes)].sort((a, b) => a.localeCompare(b, "fa"));
  return out;
}

export async function formUsage(q: Queryable, orgId: string, form: { id: string; name: string }): Promise<FormUsage> {
  return (await formsUsage(q, orgId, [form])).get(form.id)!;
}

/** F1's usage source: the forms that use a library field (their names); for the library's list, one query for all. */
export const formsUsingField: FieldUsageSource = Object.assign(
  async (q: Queryable, orgId: string, field: { id: string; name: string }) => {
    const rows = await q.query<{ name: string }>(
      `select name from sm_forms where org_id = $1 and deleted_at is null and fields @> jsonb_build_array($2::text) order by name`,
      [orgId, field.name],
    );
    return { forms: rows.map((r) => String(r.name)) };
  },
  {
    many: async (q: Queryable, orgId: string, fields: readonly { id: string; name: string }[]) => {
      const rows = await q.query<{ name: string; fields: unknown }>(`select name, fields from sm_forms where org_id = $1 and deleted_at is null order by name`, [orgId]);
      const forms = new Map<string, string[]>();
      for (const r of rows) {
        for (const name of new Set(Array.isArray(r.fields) ? r.fields.filter((n): n is string => typeof n === "string") : [])) {
          const list = forms.get(name);
          if (list) list.push(String(r.name));
          else forms.set(name, [String(r.name)]);
        }
      }
      return new Map(fields.map((f) => [f.id, { forms: forms.get(f.name) ?? [] }]));
    },
  },
);

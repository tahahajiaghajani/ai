// Spreadsheet export and import of engine tables. Export asks the server for the list as it is filtered and sorted
// (POST /r/:table/export: labels of choices, references and members resolved, numbers as numbers, ≤ 10 000 rows),
// then writes an RTL .xlsx with Persian headers and Jalali dates. Import is the platform's import sheet over
// POST /r/:table/import (headers mapped to fields, a dry run first, rows checked one by one; «شماره» updates
// existing records).
import { useMemo } from "react";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import type { Cond } from "@shared/model/conditions";
import type { OrgApi } from "../../lib/api";
import { exportExcel } from "../../lib/excel";
import { ImportSheet, type ImportTarget } from "../../components/import";
import { useOrg } from "../../lib/org";
import { recordsApi } from "../data/api";
import { keys } from "../data/hooks";
import { fieldOf, isListable } from "../model/schema";
import type { TableMeta } from "../model/types";

export const EXPORT_LIMIT = 10_000;

/** Cells of the export: Jalali dates and date-times (in the organisation's zone), numbers kept as numbers. */
export function exportCell(type: string, v: string | number | boolean | null, tz: string): string | number | null {
  if (v === null || v === undefined || v === "") return null;
  if (type === "date") return formatJalali(String(v)) || String(v);
  if (type === "datetime") return formatJalaliDateTime(String(v), tz) || String(v);
  if (typeof v === "boolean") return v ? "بله" : "خیر";
  return v;
}

/** Downloads the list as .xlsx; returns the number of rows and whether the server cut it at the limit. */
export async function exportList(api: OrgApi, def: TableMeta, o: { filter: Cond | null; q?: string; sort?: string; columns: string[]; tz: string }): Promise<{ rows: number; truncated: boolean }> {
  const fields = o.columns.filter((c) => {
    const f = fieldOf(def, c);
    return c.includes(".") || (f ? isListable(f) : false);
  });
  const res = await recordsApi.exportRows(api, def.key, { filter: o.filter, q: o.q, sort: o.sort, fields, limit: EXPORT_LIMIT });
  const numeric = new Set(["int", "decimal", "money", "percent", "rating", "duration"]);
  const cols = res.columns.map((c, i) => ({
    title: c.label,
    type: numeric.has(c.type) ? ("number" as const) : ("text" as const),
    width: Math.min(48, Math.max(12, c.label.length + 6)),
    value: (r: (string | number | boolean | null)[]) => exportCell(c.type, r[i], o.tz),
  }));
  const stamp = formatJalali(new Date().toISOString().slice(0, 10), { latin: true }).replace(/\//g, "-");
  await exportExcel(`${def.plural} ${stamp}`, cols, res.rows, def.plural);
  return { rows: res.rows.length, truncated: res.truncated };
}

/** «ورود از اکسل» of an engine table. */
export function ImportRecords({ def, open, onClose }: { def: TableMeta; open: boolean; onClose: () => void }) {
  const { api, orgId } = useOrg();
  const target = useMemo<ImportTarget>(() => {
    const fields = def.fields
      .filter((f) => !f.system && !f.readonly && !f.hidden && f.type !== "secret" && f.type !== "json" && f.type !== "conditions")
      .map((f) => ({ name: f.name, label: f.label, required: !!f.required && f.default === undefined }));
    if (def.numbered) fields.unshift({ name: "number", label: "شماره", required: false });
    return {
      plural: def.plural,
      fields,
      updateLabel: def.numbered ? "اگر «شماره» از قبل وجود داشت، همان رکورد به‌روزرسانی شود" : null,
      run: async (rows, o) => {
        const r = await recordsApi.importRows(api, def.key, { rows, ...(o.update && def.numbered ? { key: "number" } : {}), dry_run: o.dry });
        const bad = new Map<number, string[]>();
        for (const e of r.errors) bad.set(e.row, [...(bad.get(e.row) ?? []), e.field ? `${fieldOf(def, e.field)?.label ?? e.field}: ${e.message}` : e.message]);
        const results = rows.map((_, i) => (bad.has(i) ? { row: o.offset + i, ok: false, error: bad.get(i)!.join("؛ ") } : { row: o.offset + i, ok: true }));
        return { results, created: r.created, updated: r.updated, failed: bad.size };
      },
      invalidate: [keys.lists(orgId, def.key), keys.aggs(orgId, def.key)],
    };
  }, [def, api, orgId]);
  return <ImportSheet target={target} open={open} onClose={onClose} />;
}

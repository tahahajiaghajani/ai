// Excel files of reports (catalogue ANA-016/017): a right-to-left workbook with the result the RECIPIENT may see —
// one sheet per report (a dashboard's report widgets, its scorecard), the groups and their measures as numbers
// (durations in hours, percentages 0–100, dates as Jalali text), list reports with labels instead of ids, and a last
// sheet saying what the file is: the definition, the time window, when it was made and for whom. Built on the server
// with write-excel-file (the UI's downloads use the same library in the browser).
import writeXlsxFile from "write-excel-file/node";
import type { Cell, SheetData } from "write-excel-file/node";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { STATUS_LABELS, formatValue } from "@shared/analytics/kpi";
import type { ReportResult, ScorecardItem } from "@shared/analytics/types";
import { FIELD_TYPES } from "@shared/model/types";
import { labelOf, type OrgSchema } from "../../engine";

export interface XlsxSheet {
  name: string;
  data: SheetData;
  widths: number[];
}

const HEADER = { fontWeight: "bold" as const, backgroundColor: "#F1EEE9" };
const text = (v: unknown): Cell => ({ type: String, value: v === null || v === undefined ? "" : String(v) });
const number = (v: number | null | undefined, format = "#,##0.##"): Cell => (v === null || v === undefined || !Number.isFinite(v) ? text("") : { type: Number, value: v, format });

const safeSheet = (name: string, used: Set<string>) => {
  let base = name.replace(/[\\/:*?[\]]/g, "-").trim().slice(0, 28) || "گزارش";
  let n = 2;
  let out = base;
  while (used.has(out)) out = `${base.slice(0, 26)} ${n++}`;
  used.add(out);
  return out;
};

/** The value of a measure cell (durations in hours, dates as Jalali text). */
function measureCell(v: number | null, unit: string): Cell {
  if (v === null || v === undefined) return text("");
  if (unit === "duration") return number(Math.round((v / 3600) * 100) / 100);
  if (unit === "date") return text(formatJalaliDateTime(new Date(v).toISOString()));
  if (unit === "percent") return number(Math.round(v * 100) / 100, "0.00");
  return number(v);
}

const unitSuffix = (unit: string) => (unit === "duration" ? " (ساعت)" : unit === "percent" ? " (٪)" : "");

/** One sheet of a report result as its recipient may see it. */
export function resultSheet(title: string, r: ReportResult, schema: OrgSchema): XlsxSheet {
  if (r.kind === "list" && r.list) {
    const def = schema.def(r.table);
    const cols = r.list.columns;
    const header = cols.map((c) => ({ ...text(c.label), ...HEADER }));
    const rows = r.list.rows.map((row) =>
      cols.map((c) => {
        const v = row[c.name];
        const f = def?.fields.find((x) => x.name === c.name);
        if (v === null || v === undefined || v === "") return text("");
        if (f && FIELD_TYPES[f.type]?.family === "ref") return text(Array.isArray(v) ? v.map((x) => r.list!.display[String(x)] ?? "(محدود)").join("، ") : (r.list!.display[String(v)] ?? "(محدود)"));
        if (f && (f.type === "user" || f.type === "users")) return text(Array.isArray(v) ? v.map((x) => r.list!.display[String(x)] ?? "").join("، ") : (r.list!.display[String(v)] ?? ""));
        if (f && (f.type === "choice" || f.type === "multichoice")) return text(Array.isArray(v) ? v.map((x) => labelOf({ ...f, type: "choice" }, x, schema)).join("، ") : labelOf(f, v, schema));
        if (f && f.type === "date") return text(formatJalali(String(v)));
        if (f && f.type === "datetime") return text(formatJalaliDateTime(String(v)));
        if (f && f.type === "bool") return text(v ? "بله" : "خیر");
        if (f && FIELD_TYPES[f.type]?.numeric && Number.isFinite(Number(v))) return number(Number(v));
        return text(typeof v === "object" ? JSON.stringify(v) : v);
      }),
    );
    return { name: title, data: [header, ...rows], widths: cols.map((c) => (c.type === "text" || c.type === "string" ? 36 : 18)) };
  }
  const header = [...r.dims.map((d) => ({ ...text(d.label), ...HEADER })), ...r.measures.map((m) => ({ ...text(`${m.label}${unitSuffix(m.unit)}`), ...HEADER })), { ...text("رکوردها"), ...HEADER }];
  const rows: Cell[][] = r.rows.map((row) => [
    ...row.labels.map((l) => text(l)),
    ...r.measures.map((m) => (row.suppressed ? text("کمتر از حد نمایش") : measureCell(row.values[m.key] ?? null, m.unit))),
    row.suppressed ? text("") : number(row.n, "#,##0"),
  ]);
  const totals: Cell[] = [...r.dims.map((_, i) => ({ ...text(i === 0 ? "جمع کل" : ""), fontWeight: "bold" as const })), ...r.measures.map((m) => measureCell(r.totals[m.key] ?? null, m.unit)), number(r.total_n, "#,##0")];
  const data: SheetData = [header, ...rows];
  if (r.dims.length) data.push(totals);
  else data.splice(1, rows.length, totals.slice(r.dims.length));
  return { name: title, data, widths: [...r.dims.map(() => 28), ...r.measures.map(() => 18), 12] };
}

/** A scorecard as a sheet (the recipient's live values; stored scores are not included). */
export function scorecardSheet(title: string, items: ScorecardItem[]): XlsxSheet {
  const head = ["شاخص", "فرایند", "دوره", "مقدار", "دورهٔ پیش", "تغییر (٪)", "هدف", "وضعیت"].map((h) => ({ ...text(h), ...HEADER }));
  const rows = items.map((i) => [
    text(i.name),
    text(i.practice),
    text(i.current.label),
    text(i.restricted ? "در دسترس نیست" : formatValue(i.current.value, i.unit, i.decimals)),
    text(formatValue(i.previous.value, i.unit, i.decimals)),
    number(i.delta === null ? null : Math.round(i.delta * 10) / 10, "0.0"),
    text(i.target === null ? "" : formatValue(i.target, i.unit, i.decimals)),
    text(STATUS_LABELS[i.status]),
  ]);
  return { name: title, data: [head, ...rows], widths: [34, 12, 16, 16, 16, 12, 14, 14] };
}

/** The «about» sheet: what the file holds and for whom it was computed. */
export function aboutSheet(lines: [string, string][]): XlsxSheet {
  return { name: "دربارهٔ این پرونده", data: lines.map(([k, v]) => [{ ...text(k), fontWeight: "bold" as const }, text(v)]), widths: [28, 70] };
}

/** The workbook as bytes. */
export async function workbook(sheets: XlsxSheet[]): Promise<Uint8Array> {
  const used = new Set<string>();
  const out = await writeXlsxFile(
    sheets.map((s) => ({ data: s.data, sheet: safeSheet(s.name, used), rightToLeft: true, stickyRowsCount: 1, columns: s.widths.map((width) => ({ width })) })),
  ).toBuffer();
  return new Uint8Array(out);
}

/** «گزارش-رخدادها-۱۴۰۵-۰۸-۱۸.xlsx» */
export function fileName(title: string, at = new Date()): string {
  const day = formatJalali(at.toISOString().slice(0, 10)).replace(/\//g, "-");
  return `${title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)}-${day}.xlsx`;
}

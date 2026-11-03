// Export any table to an Excel file (right-to-left sheet, numbers as numbers).
import writeXlsxFile from "write-excel-file/browser";
import type { SheetData } from "write-excel-file/browser";

export interface XlsColumn<T> {
  title: string;
  value: (row: T) => string | number | null | undefined;
  type?: "number" | "text";
  width?: number;
}

export function sheetData<T>(columns: XlsColumn<T>[], rows: T[]): SheetData {
  const header = columns.map((c) => ({ value: c.title, type: String, fontWeight: "bold" as const, backgroundColor: "#E6F4F7" }));
  const data = rows.map((r) =>
    columns.map((c) => {
      const v = c.value(r);
      if (c.type === "number" && v !== null && v !== undefined && v !== "") {
        const n = Number(v);
        return Number.isFinite(n) ? { type: Number, value: n, format: "#,##0.########" } : { type: String, value: String(v) };
      }
      return { type: String, value: v === null || v === undefined ? "" : String(v) };
    }),
  );
  return [header, ...data] as SheetData;
}

export async function exportExcel<T>(fileName: string, columns: XlsColumn<T>[], rows: T[], sheet = "گزارش") {
  const name = (fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`).replace(/[\\/:*?"<>|]/g, "-");
  await writeXlsxFile(sheetData(columns, rows), {
    sheet: sheet.replace(/[\\/:*?[\]]/g, "-").slice(0, 31),
    rightToLeft: true,
    stickyRowsCount: 1,
    columns: columns.map((c) => ({ width: c.width ?? 18 })),
  }).toFile(name);
}

// Export any table to an Excel file (right-to-left sheet, numbers as numbers).
import writeXlsxFile from "write-excel-file/browser";

export interface XlsColumn<T> {
  title: string;
  value: (row: T) => string | number | null | undefined;
  type?: "number" | "text";
  width?: number;
}

export async function exportExcel<T>(fileName: string, columns: XlsColumn<T>[], rows: T[], sheet = "گزارش") {
  const header = columns.map((c) => ({ value: c.title, fontWeight: "bold" as const, backgroundColor: "#E6F4F7" }));
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
  await writeXlsxFile([header, ...data] as never, {
    fileName: fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`,
    sheet,
    rightToLeft: true,
    columns: columns.map((c) => ({ width: c.width ?? 18 })),
  } as never);
}

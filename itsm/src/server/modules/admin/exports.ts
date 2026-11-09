// Data exports (catalogue ADM-023, INT-034): the tables a person names, exported with THEIR access — only the rows they
// may list, only the fields they see, references and choices as labels — into files attached to the «خروجی داده» row
// (JSON with every table, a CSV per table, or one Excel workbook with a sheet per table). Scheduled exports of the
// integration hub use the same code with their integration user (export_schedule). A job builds the files; the row
// is readable only by who asked for it (and, for a schedule, its owner); a ready export expires after seven days.
import type { Ctx, ServerConfig } from "../../context";
import { tableDef } from "@shared/tables";
import { bad, notFound } from "../../http/errors";
import { addAttachmentIn, createIn, emitEvent, exportRows, listAttachments, listJournal, removeAttachment, systemCtx, updateIn, type ExportResult } from "../../engine";
import { enqueue, registerJobHandler } from "../../jobs";
import { memberCtx } from "../../access";
import { audit } from "../data/crud";
import { workbook } from "../analytics/xlsx";
import { liveRow, type Row } from "./common";

export const EXPORT_DAYS = 7;
const MAX_TABLES = 40;

export type ExportFormat = "json" | "csv" | "xlsx";

export interface ExportRequest {
  title?: string | null;
  tables: string[];
  format: ExportFormat;
  include_journal?: boolean;
}

/** A new export (built by a job with the requester's access). */
export async function requestExport(ctx: Ctx, input: ExportRequest, opts: { requestedFor?: string | null; scheduleId?: string | null } = {}): Promise<Row> {
  const tables = [...new Set(input.tables)].filter((t) => tableDef(t) && !tableDef(t)!.virtual).slice(0, MAX_TABLES);
  if (!tables.length) throw bad("دست‌کم یک جدول انتخاب کنید");
  return ctx.write(async (tx) => {
    const row = await createIn(
      tx,
      ctx,
      "data_export",
      {
        title: (input.title?.trim() || `خروجی ${tables.length.toLocaleString("fa-IR")} جدول`).slice(0, 160),
        tables,
        format: input.format,
        include_journal: !!input.include_journal,
        status: "queued",
        requested_for: opts.requestedFor ?? null,
        schedule_id: opts.scheduleId ?? null,
      },
      { trusted: true },
    );
    await enqueue(tx, { kind: "admin.export.run", orgId: ctx.org.id, payload: { id: row.id }, maxAttempts: 3 });
    await audit(tx, ctx, "data_export", "data_export", String(row.id), `درخواست خروجی ${tables.join("، ")} (${input.format})`);
    return row;
  });
}

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "boolean" ? (v ? "بله" : "خیر") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(r: ExportResult): string {
  const lines = [r.columns.map((c) => csvCell(c.label)).join(","), ...r.rows.map((row) => row.map(csvCell).join(","))];
  // a BOM so Excel reads the Persian text as UTF-8
  return `﻿${lines.join("\r\n")}\r\n`;
}

export interface BuiltExport {
  files: { name: string; type: string; data: Uint8Array }[];
  stats: Record<string, { rows: number; truncated: boolean }>;
}

/** Build the files of an export with `ctx`'s access. */
export async function buildExport(ctx: Ctx, tables: string[], format: ExportFormat, opts: { journal?: boolean; base: string }): Promise<BuiltExport> {
  const results: Record<string, ExportResult & { label: string }> = {};
  const stats: BuiltExport["stats"] = {};
  const journals: Record<string, Record<string, unknown[]>> = {};
  for (const t of tables) {
    const def = tableDef(t);
    if (!def) continue;
    try {
      const r = await exportRows(ctx, t, { limit: 10_000 });
      results[t] = { ...r, label: def.plural };
      stats[t] = { rows: r.rows.length, truncated: r.truncated };
      if (opts.journal && format === "json" && def.features?.journal) {
        const ids = await ctx.db.query<{ id: string }>(`select id from ${def.table} where org_id = $1 and deleted_at is null order by updated_at desc limit 200`, [ctx.org.id]);
        journals[t] = {};
        for (const { id } of ids) {
          const j = await listJournal(ctx, t, id, { limit: 100 }).catch(() => null);
          if (j?.entries.length) journals[t][id] = j.entries.map((e) => ({ kind: e.kind, visibility: e.visibility, body: e.body, author: j.display[e.author ?? ""] ?? null, at: e.created_at }));
        }
      }
    } catch (e) {
      // a table the person may not read is left out (said in the stats), never an error of the whole export
      stats[t] = { rows: 0, truncated: false };
      results[t] = { columns: [], rows: [], truncated: false, label: `${def.plural} (${String((e as Error).message ?? e).slice(0, 120)})` };
    }
  }
  const enc = new TextEncoder();
  const files: BuiltExport["files"] = [];
  if (format === "json") {
    const body = {
      format: "itsm-export",
      version: 1,
      exported_at: new Date().toISOString(),
      organisation: ctx.org.name,
      tables: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { label: r.label, columns: r.columns, rows: r.rows, truncated: r.truncated, ...(journals[k] ? { journal: journals[k] } : {}) }])),
    };
    files.push({ name: `${opts.base}.json`, type: "application/json", data: enc.encode(JSON.stringify(body)) });
  } else if (format === "csv") {
    for (const [k, r] of Object.entries(results)) if (r.columns.length) files.push({ name: `${opts.base}-${k}.csv`, type: "text/csv", data: enc.encode(toCsv(r)) });
  } else {
    const sheets = Object.values(results)
      .filter((r) => r.columns.length)
      .map((r) => ({
        name: r.label,
        widths: r.columns.map(() => 22),
        data: [r.columns.map((c) => ({ type: String, value: c.label, fontWeight: "bold" as const })), ...r.rows.map((row) => row.map((v) => (typeof v === "number" ? { type: Number, value: v } : { type: String, value: v === null ? "" : typeof v === "boolean" ? (v ? "بله" : "خیر") : String(v) })))],
      }));
    if (sheets.length) files.push({ name: `${opts.base}.xlsx`, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: await workbook(sheets as Parameters<typeof workbook>[0]) });
  }
  return { files, stats };
}

/** The job: build the files as the person who asked, attach them, mark the row ready and tell them. */
async function runExport(cfg: ServerConfig, orgId: string, id: string): Promise<void> {
  const sys = await systemCtx(cfg, orgId);
  const row = await liveRow(cfg.db, sys, "data_export", id);
  if (!row || row.status === "ready") return;
  const ctx = await memberCtx(cfg, orgId, String(row.created_by)).catch(() => null);
  const fail = (message: string) => sys.write((tx) => updateIn(tx, sys, "data_export", id, { status: "failed", error: message.slice(0, 2000) }, { trusted: true }));
  if (!ctx) return void (await fail("درخواست‌کنندهٔ این خروجی دیگر عضو فعال نیست"));
  await sys.write((tx) => updateIn(tx, sys, "data_export", id, { status: "running" }, { trusted: true }));
  try {
    const built = await buildExport(ctx, (row.tables as string[]) ?? [], (row.format as ExportFormat) ?? "json", { journal: !!row.include_journal, base: String(row.number ?? "export") });
    if (!built.files.length) throw new Error("هیچ‌یک از جدول‌ها برای درخواست‌کننده خواندنی نبود");
    const def = tableDef("data_export")!;
    await ctx.write(async (tx) => {
      for (const f of built.files) await addAttachmentIn(tx, ctx, def, id, { name: f.name, type: f.type, data: f.data });
      await updateIn(tx, sys, "data_export", id, { status: "ready", stats: built.stats, error: null, expires_at: new Date(Date.now() + EXPORT_DAYS * 86400_000).toISOString() }, { trusted: true });
      const users = [row.requested_for, row.created_by].filter((u): u is string => typeof u === "string");
      await emitEvent(tx, sys, { kind: "record.export_ready", table: "data_export", id, data: { users } });
    });
  } catch (e) {
    await fail(String((e as Error).message ?? e));
    throw e;
  }
}

/** Expired exports lose their files (the row stays as evidence). */
export async function expireExports(cfg: ServerConfig, orgId: string): Promise<number> {
  const sys = await systemCtx(cfg, orgId);
  const rows = await cfg.db.query<{ id: string }>(`select id from sm_data_exports where org_id = $1 and deleted_at is null and status = 'ready' and expires_at < now()`, [orgId]);
  for (const r of rows) {
    const { attachments } = await listAttachments(sys, "data_export", r.id);
    for (const a of attachments) await removeAttachment(sys, "data_export", r.id, a.id);
    await sys.write((tx) => updateIn(tx, sys, "data_export", r.id, { status: "expired" }, { trusted: true }));
  }
  return rows.length;
}

export async function exportRow(ctx: Ctx, id: string): Promise<Row> {
  const row = await liveRow(ctx.db, ctx, "data_export", id);
  if (!row) throw notFound("خروجی پیدا نشد");
  return row;
}

let installed = false;
export function installExportJobs(): void {
  if (installed) return;
  installed = true;
  registerJobHandler("admin.export.run", async (job, jctx) => {
    if (!job.org_id) return;
    await runExport(jctx.cfg as ServerConfig, job.org_id, String(job.payload.id));
  });
}

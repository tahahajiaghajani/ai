// Scheduled data exports (catalogue INT-034, ADM-023): the named tables, read with the schedule's integration user's
// access (never the system's), every N hours — to files on a «خروجی داده» row its owner downloads, or POSTed as signed
// JSON to a URL (a warehouse loader, an iPaaS). A schedule runs as a self-rescheduling job; its result is on the row.
import { createHmac } from "node:crypto";
import type { Ctx, ServerConfig } from "../../context";
import { tableDef } from "@shared/tables";
import { bad, notFound } from "../../http/errors";
import { readSecret, systemCtx, updateIn } from "../../engine";
import { enqueue, registerJobHandler } from "../../jobs";
import { hasFeature } from "../admin/common";
import { needPrincipalWithin } from "./users";
import { buildExport, requestExport, type ExportFormat } from "../admin/exports";
import { callOut, failText } from "./net";
import { intLog, liveRow, needIntegrations, principalCtx, redactUrl, type Row } from "./common";

const HOUR = 3600_000;

/** Run a schedule now (with its integration user's access). */
export async function runSchedule(cfg: ServerConfig, orgId: string, id: string): Promise<{ ok: boolean; message: string }> {
  const sys = await systemCtx(cfg, orgId);
  const s = await liveRow(cfg.db, sys, "export_schedule", id);
  if (!s) throw notFound("خروجی زمان‌بندی‌شده پیدا نشد");
  const mark = (patch: Record<string, unknown>) => sys.write((tx) => updateIn(tx, sys, "export_schedule", id, patch, { trusted: true, keepVersion: true }));
  const next = new Date(Date.now() + Number(s.every_hours ?? 24) * HOUR).toISOString();
  try {
    if (!(await hasFeature(cfg.db, orgId, "scheduled_exports", cfg.mode))) throw bad("خروجی‌های زمان‌بندی‌شده برای این سازمان روشن نیست");
    const { ctx } = await principalCtx(cfg, orgId, String(s.principal_id));
    const tables = (Array.isArray(s.tables) ? (s.tables as string[]) : []).filter((t) => tableDef(t));
    if (!tables.length) throw bad("جدولی برای خروجی انتخاب نشده است");
    let message: string;
    if (s.destination === "webhook") {
      if (!s.url) throw bad("نشانی مقصد تنظیم نشده است");
      const built = await buildExport(ctx, tables, "json", { base: `export-${id.slice(0, 8)}` });
      const body = new TextDecoder().decode(built.files[0]?.data ?? new Uint8Array());
      const secret = await readSecret(cfg.db, sys, tableDef("export_schedule")!, id, "secret");
      const r = await callOut(cfg, String(s.url), { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "X-Signature": `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}` } : {}), "X-Event": "export" }, body }, `نشانی خروجی «${s.name}»`, 30_000);
      await intLog(cfg.db, { org_id: orgId, kind: "export", ref_id: id, method: "POST", target: redactUrl(String(s.url)), status: r.status || null, ok: r.ok, latency_ms: r.ms, summary: `${tables.length} جدول`, error: r.ok ? null : failText("نشانی", r) });
      if (!r.ok) throw bad(failText("نشانی مقصد", r));
      message = `${Object.values(built.stats).reduce((a, x) => a + x.rows, 0).toLocaleString("fa-IR")} ردیف فرستاده شد`;
    } else {
      const row = await requestExport(ctx, { title: `${s.name} — ${new Date().toISOString().slice(0, 10)}`, tables, format: (s.format as ExportFormat) ?? "csv" }, { requestedFor: String(s.created_by ?? ""), scheduleId: id });
      message = `خروجی ${row.number ?? ""} ساخته شد`;
      await intLog(cfg.db, { org_id: orgId, kind: "export", ref_id: id, ok: true, summary: message });
    }
    await mark({ health: "ok", last_run_at: new Date().toISOString(), next_run_at: next, last_status: message });
    return { ok: true, message };
  } catch (e) {
    const message = String((e as Error).message ?? e).slice(0, 300);
    await mark({ health: "failing", last_run_at: new Date().toISOString(), next_run_at: next, last_status: message });
    return { ok: false, message };
  }
}

/** Queue the next run of a schedule (saved, switched on). */
export async function scheduleExport(ctx: Ctx, s: Row): Promise<void> {
  if (s.active === false) return;
  await ctx.write((tx) => enqueue(tx, { kind: "integration.export.run", orgId: ctx.org.id, payload: { id: s.id }, delayMs: Number(s.every_hours ?? 24) * HOUR, dedupeKey: `export:${s.id}`, maxAttempts: 2 }));
}

export async function runScheduleNow(ctx: Ctx, id: string) {
  needIntegrations(ctx, "edit");
  const s = await liveRow(ctx.db, ctx, "export_schedule", id);
  if (!s) throw notFound("خروجی زمان‌بندی‌شده پیدا نشد");
  await needPrincipalWithin(ctx, s.principal_id);
  return runSchedule(ctx.cfg, ctx.org.id, id);
}

let installed = false;
export function installExportSchedules(): void {
  if (installed) return;
  installed = true;
  registerJobHandler("integration.export.run", async (job, jctx) => {
    if (!job.org_id) return;
    const cfg = jctx.cfg as ServerConfig;
    const sys = await systemCtx(cfg, job.org_id);
    const s = await liveRow(cfg.db, sys, "export_schedule", job.payload.id);
    if (!s || s.active === false) return;
    await runSchedule(cfg, job.org_id, String(s.id));
    return { again: Number(s.every_hours ?? 24) * HOUR };
  });
}

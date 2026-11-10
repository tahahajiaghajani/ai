// Import sets with transform maps (catalogue ADM-003, PLT-065, INT-011): a CSV or XLSX file — attached to the import set
// or read from a URL on every run — is read, its rows go through the transform map (column → field, value maps,
// constants, joins) and into the target table through the engine's import (types, choices, references by number or
// name, Jalali dates, the key field updating existing records), with the access of the member who runs it: the
// administrator by hand, the import set's creator on a schedule — never the system.
import type { Ctx, ServerConfig } from "../../context";
import type { Queryable } from "../../db";
import { readSpreadsheet } from "@shared/sheet";
import { applySpec, specProblem, suggestMapping, type MapRule, type Suggestion, type TransformSpec } from "@shared/admin/mapping";
import { bad, notFound } from "../../http/errors";
import { importRows, listAttachments, readAttachment, systemCtx, updateIn } from "../../engine";
import { enqueue, registerJobHandler } from "../../jobs";
import { memberCtx } from "../../access";
import { audit } from "../data/crud";
import { liveRow, needFeature, sysOf, type Row } from "./common";
import { importFields } from "./ai";
import { outsideFetch } from "../integration/net";
import { isAiUnavailable, runSkill } from "../ai/skills/runtime";
import { dataUsePlan } from "../ai/datause";

export const MAX_IMPORT_ROWS = 20_000;
/** The largest file an import reads from a URL (the shared server's memory is every organisation's). */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const BATCH = 500;
const HOUR = 3600_000;

interface Sheet {
  headers: string[];
  rows: Record<string, string>[];
  name: string;
}

function toObjects(rows: string[][]): { headers: string[]; rows: Record<string, string>[] } {
  const [head = [], ...rest] = rows;
  const headers = head.map((h, i) => String(h ?? "").trim() || `ستون ${i + 1}`);
  const out = rest
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .slice(0, MAX_IMPORT_ROWS)
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "")])));
  return { headers, rows: out };
}

/** A response body of at most `max` bytes (its announced length first, then counted while it streams). */
async function boundedBody(res: Response, max: number, ac: AbortController): Promise<Uint8Array> {
  const tooBig = () => bad(`فایل ورود از ${Math.round(max / 1024 / 1024)} مگابایت بزرگ‌تر است`);
  if (Number(res.headers.get("content-length") ?? 0) > max) {
    ac.abort();
    throw tooBig();
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      ac.abort();
      throw tooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The import set's file: its newest attachment, or the URL. */
async function readSource(ctx: Ctx, set: Row): Promise<Sheet> {
  if (set.source === "url") {
    const url = String(set.source_url ?? "");
    if (!/^https?:\/\//i.test(url)) throw bad("نشانی فایل ورود تنظیم نشده است");
    const name = url.split("?")[0].split("/").pop() || "data.csv";
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    let data: Uint8Array;
    try {
      const res = await outsideFetch(ctx.cfg)(url, { method: "GET", signal: ac.signal, redirect: "manual" });
      if (!res.ok) throw bad(`سرور فایل ورود پاسخ ${res.status} داد`);
      data = await boundedBody(res, MAX_IMPORT_BYTES, ac);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw bad("سرور فایل ورود پاسخ نداد (زمان تمام شد)");
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const sheet = await readSpreadsheet(name.toLowerCase().endsWith(".xlsx") ? name : name.toLowerCase().endsWith(".csv") ? name : `${name}.csv`, data, { maxRows: MAX_IMPORT_ROWS + 1 });
    return { ...toObjects(sheet.rows), name };
  }
  const { attachments } = await listAttachments(ctx, "import_set", String(set.id));
  const file = [...attachments].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!file) throw bad("نخست فایل CSV یا اکسل را به این مجموعه پیوست کنید");
  const { data } = await readAttachment(ctx, file.id);
  const sheet = await readSpreadsheet(file.name, data, { maxRows: MAX_IMPORT_ROWS + 1 });
  return { ...toObjects(sheet.rows), name: file.name };
}

async function setRow(ctx: Ctx, id: string): Promise<Row> {
  const row = await liveRow(ctx.db, ctx, "import_set", id);
  if (!row) throw notFound("مجموعهٔ ورود پیدا نشد");
  return row;
}

/** Read the file: its columns, a sample and the suggested mapping to the target table's fields. */
export async function analyzeImport(ctx: Ctx, id: string): Promise<{ headers: string[]; sample: Record<string, string>[]; total: number; suggestions: Suggestion[]; file: string }> {
  ctx.need("settings", "edit");
  await needFeature(ctx, "data_import");
  const set = await setRow(ctx, id);
  const sheet = await readSource(ctx, set);
  const sample = sheet.rows.slice(0, 5);
  const fields = await importFields(ctx, String(set.target_table));
  if (!fields.length) throw bad(`جدول «${set.target_table}» برای ورود در دسترس شما نیست`);
  await ctx.write((tx) => updateIn(tx, ctx, "import_set", id, { headers: sheet.headers, sample, rows_total: sheet.rows.length, status: "analyzed", last_error: null }, { trusted: true }));
  return { headers: sheet.headers, sample, total: sheet.rows.length, suggestions: suggestMapping(sheet.headers, fields), file: sheet.name };
}

/** Mapping suggestions for columns (the AI skill «admin.import_mapping», rule-based without a model). */
export async function suggestImport(ctx: Ctx, table: string, headers: string[], sample: Record<string, string>[]): Promise<{ mapping: Suggestion[]; ai: boolean }> {
  ctx.need("settings", "edit");
  const fields = await importFields(ctx, table);
  if (!fields.length) throw bad(`جدول «${table}» برای ورود در دسترس شما نیست`);
  // the sample rows are the target table's data: its data-use policy decides (never: no model at all; local: only a
  // model on the organisation's own computers — the skill's runtime enforces it through `dataTables`)
  if ((await dataUsePlan(ctx, [table])).use === "never") return { mapping: suggestMapping(headers, fields), ai: false };
  try {
    const r = await runSkill(ctx, "admin.import_mapping", { params: { table, headers: JSON.stringify(headers.slice(0, 200)), sample: JSON.stringify(sample.slice(0, 3)) } }, { ephemeral: true, dataTables: [table] });
    const mapping = ((r.json ?? {}) as { mapping?: Suggestion[] }).mapping;
    if (Array.isArray(mapping) && mapping.length) {
      return { mapping: headers.map((h) => mapping.find((m) => m.header === h) ?? { header: h, field: null, confidence: 0, reason: "" }), ai: !r.fallback };
    }
  } catch (e) {
    if (!isAiUnavailable(e)) throw e;
  }
  return { mapping: suggestMapping(headers, fields), ai: false };
}

export interface ImportRunResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  errors: { row: number; field?: string; message: string }[];
}

async function specOf(ctx: Ctx, set: Row): Promise<TransformSpec> {
  if (!set.transform_map_id) throw bad("نقشهٔ تبدیل این مجموعه انتخاب نشده است");
  const map = await liveRow(ctx.db, sysOf(ctx), "transform_map", set.transform_map_id);
  if (!map) throw notFound("نقشهٔ تبدیل پیدا نشد");
  if (map.target_table !== set.target_table) throw bad("جدول مقصد نقشهٔ تبدیل با جدول مقصد مجموعه یکی نیست");
  if (map.active === false) throw bad("نقشهٔ تبدیل غیرفعال است");
  return { rules: (Array.isArray(map.rules) ? map.rules : []) as MapRule[], key_field: map.key_field ?? null };
}

/** Run an import set (dry run: everything checked and rolled back). */
export async function runImport(ctx: Ctx, id: string, opts: { dryRun: boolean }): Promise<ImportRunResult> {
  ctx.need("settings", "edit");
  await needFeature(ctx, "data_import");
  const set = await setRow(ctx, id);
  const spec = await specOf(ctx, set);
  const table = String(set.target_table);
  const fields = new Set((await importFields(ctx, table)).map((f) => f.name));
  const sheet = await readSource(ctx, set);
  const problem = specProblem(spec, fields, sheet.headers);
  if (problem) throw bad(problem);
  const out: ImportRunResult = { dryRun: opts.dryRun, total: sheet.rows.length, created: 0, updated: 0, errors: [] };
  if (!opts.dryRun) await ctx.write((tx) => updateIn(tx, ctx, "import_set", id, { status: "running" }, { trusted: true }));
  try {
    for (let i = 0; i < sheet.rows.length; i += BATCH) {
      const batch = sheet.rows.slice(i, i + BATCH).map((r) => applySpec(r, spec));
      const mapping = Object.fromEntries([...new Set(batch.flatMap((r) => Object.keys(r)))].map((k) => [k, k]));
      const r = await importRows(ctx, table, { rows: batch, mapping, key: spec.key_field ?? undefined, dryRun: opts.dryRun });
      out.created += r.created;
      out.updated += r.updated;
      out.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i })));
      if (out.errors.length > 500) break;
    }
  } catch (e) {
    if (!opts.dryRun) await ctx.write((tx) => updateIn(tx, ctx, "import_set", id, { status: "failed", last_error: String((e as Error).message ?? e).slice(0, 2000), last_run_at: new Date().toISOString() }, { trusted: true }));
    throw e;
  }
  if (!opts.dryRun) {
    const scheduled = Number(set.schedule_hours ?? 0) > 0 && set.source === "url";
    const next = scheduled ? new Date(Date.now() + Number(set.schedule_hours) * HOUR).toISOString() : null;
    await ctx.write(async (tx) => {
      await updateIn(
        tx,
        ctx,
        "import_set",
        id,
        { status: out.errors.length && !out.created && !out.updated ? "failed" : "done", stats: { created: out.created, updated: out.updated, errors: out.errors.length, total: out.total, sample_errors: out.errors.slice(0, 20) }, last_run_at: new Date().toISOString(), next_run_at: next, last_error: out.errors[0]?.message ?? null },
        { trusted: true },
      );
      if (next) await enqueue(tx, { kind: "admin.import.run", orgId: ctx.org.id, payload: { id }, runAt: next, dedupeKey: `import:${id}`, maxAttempts: 3 });
      await audit(tx, ctx, "data_import", "import_set", id, `ورود «${set.name}» به ${table}: ${out.created} تازه، ${out.updated} به‌روز، ${out.errors.length} خطا`);
    });
  }
  return out;
}

/**
 * Queue the next run of an import set that reads a URL on a schedule (the import set's hook calls it inside the write
 * that saves it; a queued run with the same key is kept).
 */
export async function scheduleImportIn(q: Queryable, orgId: string, set: Row): Promise<boolean> {
  if (Number(set.schedule_hours ?? 0) <= 0 || set.source !== "url") return false;
  await enqueue(q, { kind: "admin.import.run", orgId, payload: { id: set.id }, delayMs: Number(set.schedule_hours) * HOUR, dedupeKey: `import:${set.id}`, maxAttempts: 3 });
  return true;
}

let installed = false;
export function installImportJobs(): void {
  if (installed) return;
  installed = true;
  // a scheduled import runs as the member who created the import set (their access, never the system's)
  registerJobHandler("admin.import.run", async (job, jctx) => {
    if (!job.org_id) return;
    const cfg = jctx.cfg as ServerConfig;
    const sys = await systemCtx(cfg, job.org_id);
    const set = await liveRow(cfg.db, sys, "import_set", job.payload.id);
    if (!set || Number(set.schedule_hours ?? 0) <= 0 || set.source !== "url") return;
    const ctx = await memberCtx(cfg, job.org_id, String(set.created_by)).catch(() => null);
    if (!ctx) {
      await sys.write((tx) => updateIn(tx, sys, "import_set", String(set.id), { status: "failed", last_error: "سازندهٔ این مجموعه دیگر عضو فعال نیست؛ ورود زمان‌بندی‌شده انجام نشد" }, { trusted: true }));
      return;
    }
    // a failed run (the source down, a timeout) does not end the schedule: the next run is queued all the same
    const ok = await runImport(ctx, String(set.id), { dryRun: false }).then(() => true).catch(async (e) => {
      const next = new Date(Date.now() + Number(set.schedule_hours) * HOUR).toISOString();
      await sys.write((tx) => updateIn(tx, sys, "import_set", String(set.id), { status: "failed", last_error: String((e as Error).message ?? e).slice(0, 2000), next_run_at: next }, { trusted: true }));
      return false;
    });
    if (!ok) await scheduleImportIn(cfg.db, job.org_id, set);
  });
}

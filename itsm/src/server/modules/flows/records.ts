// Records as flow steps see them: read through the run's identity (the access provider decides), with `$labels`
// — the display text of references, choices, yes/no and Jalali dates — so pills such as
// {{trigger.record.$labels.assigned_to}} read like the screens do.
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import type { Cond } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import { refTarget } from "@shared/model/types";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { zonedMidnight } from "@shared/model/jalali-buckets";
import { FLOW_LIMITS, nodeTable } from "@shared/flows";
import { RefSet, condEnv, defFor, get, labelOf, list, orgTz, parseDate, parseDateTime, requireReadable, resolveDisplay, toOutput, type OrgSchema } from "../../engine";
import { access } from "../../access/provider";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Display text of the fields whose stored value is not what people read. */
export function labelsFor(def: TableDef, row: Record<string, unknown>, display: Record<string, string>, schema: Pick<OrgSchema, "choices">, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of def.fields) {
    const v = row[f.name];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (refTarget(f, def.key)) {
      const one = (x: unknown) => display[String(x).toLowerCase()] ?? String(x);
      out[f.name] = Array.isArray(v) ? v.map(one).join("، ") : one(v);
    } else if (f.type === "date") out[f.name] = formatJalali(String(v));
    else if (f.type === "datetime") out[f.name] = formatJalaliDateTime(String(v), tz);
    else if (f.type === "choice" || f.type === "multichoice" || f.type === "bool") out[f.name] = labelOf(f, v, schema);
  }
  return out;
}

/** A record (visible fields + `$labels`) read as `ctx`; 404 when it may not read it. */
export async function readRecord(ctx: Ctx, table: string, id: string): Promise<Record<string, unknown>> {
  const r = await get(ctx, table, id);
  const { def, schema } = await defFor(ctx, table);
  return { ...r.row, $labels: labelsFor(def, r.row, r.display, schema, orgTz(ctx)) };
}

/** `readRecord` inside a transaction (a transactional step must not read around its own `s.tx`). */
export async function readRecordIn(q: Queryable, ctx: Ctx, table: string, id: string): Promise<Record<string, unknown>> {
  const { def } = await defFor(ctx, table, q);
  const row = await requireReadable(ctx, def, id, await condEnv(ctx), q);
  return storedOutput(q, ctx, table, row);
}

/** A row a write just stored, as `ctx` may see it (inside the write's transaction). */
export async function storedOutput(q: Queryable, ctx: Ctx, table: string, stored: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { def, schema } = await defFor(ctx, table, q);
  const row = toOutput(def, stored, access().visibleFields(ctx, def));
  const refs = new RefSet();
  refs.addRow(def, row);
  const display = await resolveDisplay(q, ctx, await condEnv(ctx), schema, refs);
  return { ...row, $labels: labelsFor(def, row, display, schema, orgTz(ctx)) };
}

/** Does record `id` of `table` satisfy `cond` — as `ctx` reads it (no access: false)? */
export async function matchesRecord(ctx: Ctx, table: string, id: string, cond: unknown): Promise<boolean> {
  if (!UUID.test(id)) throw new Error("شناسهٔ رکورد معتبر نیست");
  const { def } = await defFor(ctx, table);
  const r = await list(ctx, table, { filter: (cond ?? null) as Cond | null, ids: [id], size: 1, total: false, fields: [def.display] });
  return r.rows.length > 0;
}

/** The items of «برای هر مورد»: records of a table (as `ctx`, with `$labels`) or a list from the data. */
export async function forEachItems(ctx: Ctx, config: Record<string, unknown>, render: (v: unknown) => unknown, trigger: Record<string, unknown>): Promise<unknown[]> {
  const limit = Math.min(Math.max(Math.trunc(Number(config.limit ?? 100)) || 100, 1), FLOW_LIMITS.items);
  if (config.source === "list") {
    const v = render(config.list);
    if (v === null || v === undefined || v === "") return [];
    if (!Array.isArray(v)) throw new Error("«فهرست» آرایه نیست");
    return v.slice(0, limit);
  }
  const table = nodeTable(config, { table: typeof trigger.table === "string" ? trigger.table : null });
  if (!table) throw new Error("جدول را انتخاب کنید");
  const filter = config.condition ? (render(config.condition) as Cond) : null;
  const sort = typeof config.sort === "string" && config.sort.trim() ? config.sort.trim() : undefined;
  const r = await list(ctx, table, { filter, sort, size: limit, total: false });
  const { def, schema } = await defFor(ctx, table);
  const tz = orgTz(ctx);
  return r.rows.map((row) => ({ ...row, $labels: labelsFor(def, row, r.display, schema, tz) }));
}

/** An instant from a pill's value: ISO, epoch ms, a Jalali/ISO date (its local midnight) or a wall clock. */
export function parseInstant(v: unknown, tz: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const dt = parseDateTime(v, tz);
  if (dt) return Date.parse(dt);
  const d = parseDate(v, tz);
  return d ? zonedMidnight(d, tz) : null;
}

/** The record id a step works on (its «رکورد» setting, default the trigger record). */
export function recordIdOf(render: (v: unknown) => unknown, config: Record<string, unknown>): string {
  const raw = render(config.record === undefined || config.record === "" ? "{{trigger.record.id}}" : config.record);
  const id = typeof raw === "object" && raw && "id" in raw ? String((raw as { id: unknown }).id) : String(raw ?? "").trim();
  if (!UUID.test(id)) throw new Error(id ? `«${id.slice(0, 60)}» شناسهٔ رکورد نیست` : "رکوردی برای این گام مشخص نیست");
  return id.toLowerCase();
}

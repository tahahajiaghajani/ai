// Field history (sm_history): one row per changed audited field — written by the engine inside the write
// transaction for creates (the initial non-empty values), updates and transitions; read through the access
// provider (the record must be readable, and only fields the caller may see are listed). Secrets are recorded as
// changed without their values; very long texts are cut. History rows are a synchronised root of their own
// ("history"), so the Windows app shows the same activity stream.
import type { FieldDef, TableDef } from "@shared/model/types";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { forbidden } from "../http/errors";
import { access } from "../access/provider";
import { actorId, condEnv } from "./env";
import { defFor } from "./schema";
import { RefSet, resolveDisplay } from "./display";
import { requireReadable } from "./read";

const MAX_TEXT = 10_000;

/** Does a change of `f` go into the history of `def`? */
export function audited(def: TableDef, f: FieldDef | undefined): boolean {
  if (!f || def.features?.history === false) return false;
  if (f.audit === false) return false;
  if (f.base) return false;
  return true;
}

function stored(f: FieldDef, v: unknown): unknown {
  if (f.type === "secret") return null;
  if (v === undefined) return null;
  if (typeof v === "string" && v.length > MAX_TEXT) return `${v.slice(0, MAX_TEXT)}…`;
  return v;
}

/** Write history rows for `fields` of a record (prev null = a create: only non-empty initial values). */
export async function writeHistory(q: Queryable, ctx: Ctx, def: TableDef, recordId: string, prev: Record<string, unknown> | null, next: Record<string, unknown>, fields: Iterable<string>): Promise<number> {
  const rows: unknown[][] = [];
  const actor = actorId(ctx);
  for (const name of fields) {
    const f = def.fields.find((x) => x.name === name);
    if (!audited(def, f)) continue;
    const before = prev ? prev[name] ?? null : null;
    const after = next[name] ?? null;
    // a create records what the caller set (and the initial state), not the engine's own stamps and counters
    if (!prev && (f!.system || after === null || after === false || (Array.isArray(after) && !after.length))) continue;
    rows.push([uuidv7(), ctx.org.id, def.key, recordId, name, JSON.stringify(stored(f!, before)), JSON.stringify(stored(f!, after)), actor]);
  }
  if (!rows.length) return 0;
  const params: unknown[] = [];
  const values = rows.map((r) => `(${r.map((v, i) => {
    params.push(v);
    return i === 5 || i === 6 ? `$${params.length}::jsonb` : `$${params.length}`;
  }).join(", ")})`);
  await q.query(`insert into sm_history (id, org_id, table_key, record_id, field, old, new, actor) values ${values.join(", ")}`, params);
  return rows.length;
}

export interface HistoryEntry {
  id: string;
  field: string;
  label: string;
  type: string;
  old: unknown;
  new: unknown;
  actor: string | null;
  at: string;
}

/** History of one record, oldest first (fields the caller may not see are left out). */
export async function listHistory(ctx: Ctx, table: string, id: string, opts: { limit?: number; before?: string } = {}): Promise<{ entries: HistoryEntry[]; display: Record<string, string> }> {
  const { def, schema } = await defFor(ctx, table);
  if (def.features?.history === false) throw forbidden("این جدول تاریخچه ندارد");
  const env = await condEnv(ctx);
  await requireReadable(ctx, def, id, env, ctx.db, { archived: true });
  const visible = access().visibleFields(ctx, def);
  const params: unknown[] = [ctx.org.id, def.key, id];
  let cond = "";
  if (opts.before) {
    params.push(opts.before);
    cond = ` and at < $${params.length}::timestamptz`;
  }
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const rows = await ctx.db.query<{ id: string; field: string; old: unknown; new: unknown; actor: string | null; at: string }>(
    `select id, field, old, new, actor, at from sm_history where org_id = $1 and table_key = $2 and record_id = $3 and deleted_at is null${cond}
     order by at desc, id desc limit ${limit}`,
    params,
  );
  const refs = new RefSet();
  const entries: HistoryEntry[] = [];
  for (const r of rows.reverse()) {
    const f = def.fields.find((x) => x.name === r.field);
    if (!f || (visible && !visible.has(f.name))) continue;
    entries.push({ id: r.id, field: r.field, label: f.label, type: f.type, old: r.old, new: r.new, actor: r.actor, at: r.at });
    refs.add("user", r.actor);
    refs.addRow(def, { [f.name]: r.old }, [f]);
    refs.addRow(def, { [f.name]: r.new }, [f]);
  }
  const display = await resolveDisplay(ctx.db, ctx, env, schema, refs);
  return { entries, display };
}

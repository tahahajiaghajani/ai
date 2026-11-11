// Spreadsheet export and import of any table, through the same access paths as everything else.
// - export: rows the caller may read (filter, search, sort, columns), as cells ready for a spreadsheet: numbers as
//   numbers, choices and references as their labels, booleans «بله/خیر», dates as ISO (the UI writes them Jalali).
//   The UI builds the .xlsx with write-excel-file.
// - import: spreadsheet rows mapped to fields (by a mapping, the field name or its Persian label); cells are read
//   leniently (choice labels, members by e-mail or name, references by number or display value, Jalali or Excel
//   dates) and then go through the write pipeline like any create/update. A key field (e.g. number) updates the
//   matching record instead of creating one. `dryRun` validates everything — hooks and unique checks included —
//   and rolls back.
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import type { Cond } from "@shared/model/conditions";
import { normalizeSearch } from "@shared/model/conditions";
import { normalizeDigits } from "@shared/money";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { pgArray } from "../db";
import { AppError, bad, forbidden } from "../http/errors";
import { access } from "../access/provider";
import { condEnv } from "./env";
import { defFor, optionsOf, type OrgSchema } from "./schema";
import { fieldExpr, readable } from "./sql";
import { list } from "./records";
import { labelOf } from "./display";
import { createIn, savepoint, updateIn } from "./write";

export interface ExportParams {
  filter?: Cond | null;
  q?: string;
  sort?: string;
  fields?: string[];
  view?: string;
  /** at most this many rows (default and maximum 10,000) */
  limit?: number;
  /** leave out the demo pack's rows (an export that leaves the system: docs/DEMO_FA.md) */
  withoutDemo?: boolean;
}

export type Cell = string | number | boolean | null;

export interface ExportResult {
  columns: { name: string; label: string; type: string }[];
  rows: Cell[][];
  /** more rows matched than were exported */
  truncated: boolean;
}

function cell(f: FieldDef, v: unknown, display: Record<string, string>, schema: OrgSchema): Cell {
  if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return null;
  const info = FIELD_TYPES[f.type];
  if (info.numeric) {
    const n = Number(v);
    return Number.isFinite(n) ? n : String(v);
  }
  if (info.family === "ref") {
    const one = (x: unknown) => display[String(x)] ?? String(x);
    return Array.isArray(v) ? v.map(one).join("، ") : one(v);
  }
  if (f.type === "date" || f.type === "datetime") return String(v);
  return labelOf(f, v, schema);
}

/** Rows for a spreadsheet. */
export async function exportRows(ctx: Ctx, table: string, p: ExportParams): Promise<ExportResult> {
  const { def, schema } = await defFor(ctx, table);
  if (!access().canReadTable(ctx, def)) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  const visible = access().visibleFields(ctx, def);
  const names = (p.fields?.length ? p.fields : def.list?.columns ?? def.fields.filter((f) => f.list).map((f) => f.name)).filter((n) => !n.includes("."));
  const fields = names
    .map((n) => def.fields.find((f) => f.name === n))
    .filter((f): f is FieldDef => !!f && f.type !== "secret" && (!visible || visible.has(f.name)));
  const columns = [...(def.numbered && !fields.some((f) => f.name === "number") ? [{ name: "number", label: "شماره", type: "string" }] : []), ...fields.map((f) => ({ name: f.name, label: f.label, type: f.type }))];
  const limit = Math.min(Math.max(p.limit ?? 10_000, 1), 10_000);
  const rows: Cell[][] = [];
  let truncated = false;
  const demo = p.withoutDemo
    ? new Set((await ctx.db.query<{ id: string }>(`select row_id::text as id from sm_demo_rows where org_id = $1 and tbl = $2`, [ctx.org.id, def.table])).map((x) => x.id.toLowerCase()))
    : null;
  for (let page = 1; rows.length < limit; page++) {
    const r = await list(ctx, table, { filter: p.filter, q: p.q, sort: p.sort, view: p.view, fields: fields.map((f) => f.name), page, size: 500, total: false });
    for (const row of r.rows) {
      if (rows.length >= limit) {
        truncated = true;
        break;
      }
      if (demo?.has(String(row.id ?? "").toLowerCase())) continue;
      rows.push(columns.map((c) => (c.name === "number" ? (row.number ?? null) : cell(fields.find((f) => f.name === c.name)!, row[c.name], r.display, schema))));
    }
    if (r.rows.length < 500) break;
    if (rows.length >= limit) {
      truncated = true;
      break;
    }
  }
  return { columns, rows, truncated };
}

export interface ImportParams {
  /** spreadsheet rows: column header → cell */
  rows: Record<string, unknown>[];
  /** column header → field name (unmapped headers match a field name or its label) */
  mapping?: Record<string, string>;
  /** match existing records by this field (number, or a unique field) and update them */
  key?: string;
  dryRun?: boolean;
}

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; field?: string; message: string }[];
  dryRun: boolean;
  /** the columns that were used, as header → field */
  mapped: Record<string, string>;
}

class DryRun extends Error {}

const norm = (s: unknown) => normalizeSearch(String(s ?? "")).replace(/\s+/g, " ").trim().toLowerCase();

/** Excel serial day → ISO date (1900 date system). */
function excelDate(n: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}

/** Look-ups of member and reference cells, one query per target. */
async function resolver(q: Queryable, ctx: Ctx, def: TableDef, schema: OrgSchema, fields: FieldDef[], rows: Record<string, unknown>[]) {
  const env = await condEnv(ctx);
  const maps = new Map<string, Map<string, string>>();
  const targets = new Map<string, Set<string>>();
  for (const f of fields) {
    if (FIELD_TYPES[f.type].family !== "ref") continue;
    const t = refTarget(f, def.key);
    if (!t) continue;
    const set = targets.get(t) ?? new Set<string>();
    for (const r of rows) for (const x of splitCell(r[f.name])) set.add(String(x).trim());
    targets.set(t, set);
  }
  for (const [t, values] of targets) {
    const m = new Map<string, string>();
    const vals = [...values].filter(Boolean).slice(0, 5000);
    if (!vals.length) continue;
    if (t === "user") {
      const rows2 = await q.query<{ id: string; email: string; name: string }>(
        `select m.user_id as id, u.email, u.full_name as name from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.deleted_at is null`,
        [ctx.org.id],
      );
      for (const r of rows2) {
        m.set(r.id, r.id);
        m.set(norm(r.email), r.id);
        if (r.name) m.set(norm(r.name), r.id);
      }
    } else {
      const td = schema.def(t);
      if (!td || td.virtual) continue;
      const df = td.fields.find((f) => f.name === td.display);
      const params: unknown[] = [pgArray(vals.filter((v) => /^[0-9a-f-]{36}$/i.test(v)).concat(["00000000-0000-0000-0000-000000000000"]))];
      const where = readable(ctx, td, "t", params, env);
      params.push(pgArray(vals.map(norm)));
      const dexpr = df && !df.custom && FIELD_TYPES[df.type].sql === "text" ? fieldExpr(td, df, "t") : null;
      const conds = [`t.id = any($1::uuid[])`];
      if (td.numbered) conds.push(`lower(t.number) = any($${params.length}::text[])`);
      if (dexpr) conds.push(`lower(${dexpr}) = any($${params.length}::text[])`);
      const found = await q.query<{ id: string; number?: string; d?: string }>(
        `select t.id${td.numbered ? ", t.number" : ""}${dexpr ? `, ${dexpr} as d` : ""} from ${td.table} t where ${where} and (${conds.join(" or ")}) limit 20000`,
        params,
      );
      for (const r of found) {
        m.set(r.id, r.id);
        if (r.number) m.set(norm(r.number), r.id);
        if (r.d) m.set(norm(r.d), r.id);
      }
    }
    maps.set(t, m);
  }
  return (f: FieldDef, raw: unknown): unknown => {
    const t = refTarget(f, def.key);
    const m = t ? maps.get(t) : undefined;
    const one = (x: unknown) => {
      const s = String(x).trim();
      return m?.get(s) ?? m?.get(norm(s)) ?? s;
    };
    if (FIELD_TYPES[f.type].array) return splitCell(raw).map(one);
    return raw === null || raw === undefined || raw === "" ? null : one(raw);
  };
}

function splitCell(v: unknown): unknown[] {
  if (v === null || v === undefined || v === "") return [];
  if (Array.isArray(v)) return v;
  return String(v).split(/[،,;\n]/).map((s) => s.trim()).filter(Boolean);
}

/** A spreadsheet cell as an input value of `f`. */
function fromCell(f: FieldDef, raw: unknown, schema: OrgSchema, ref: (f: FieldDef, raw: unknown) => unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  const t = f.type;
  if (t === "choice" || t === "multichoice") {
    const options = optionsOf(f, schema);
    const one = (x: unknown) => {
      const s = norm(x);
      return options.find((o) => norm(o.value) === s || norm(o.label) === s)?.value ?? String(x).trim();
    };
    return t === "multichoice" ? splitCell(raw).map(one) : one(raw);
  }
  if (FIELD_TYPES[t].family === "ref") return ref(f, raw);
  if (t === "tags") return splitCell(raw);
  if (t === "date" && typeof raw === "number") return excelDate(raw);
  if (t === "datetime" && typeof raw === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(raw * 86400000)).toISOString();
  if (t === "bool" && typeof raw === "string") return ["✓", "✔", "x", "*", "دارد", "فعال", "هست"].includes(normalizeDigits(raw).trim().toLowerCase()) ? true : raw;
  return raw;
}

/** Import spreadsheet rows (each row succeeds or fails on its own; `dryRun` rolls everything back). */
export async function importRows(ctx: Ctx, table: string, p: ImportParams): Promise<ImportResult> {
  const { def, schema } = await defFor(ctx, table);
  if (def.virtual) throw bad("در این جدول نمی‌توان ورود گروهی انجام داد");
  if (!access().canReadTable(ctx, def)) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  if (p.rows.length > 1000) throw bad("در هر بار حداکثر ۱۰۰۰ ردیف");
  // header → field
  const byLabel = new Map(def.fields.map((f) => [norm(f.label), f.name]));
  const mapped: Record<string, string> = {};
  const headers = new Set(p.rows.flatMap((r) => Object.keys(r)));
  for (const h of headers) {
    const target = p.mapping?.[h] ?? (def.fields.some((f) => f.name === h) ? h : byLabel.get(norm(h)));
    if (target && (def.fields.some((f) => f.name === target) || target === "number")) mapped[h] = target;
  }
  const keyField = p.key ? (p.key === "number" && def.numbered ? null : def.fields.find((f) => f.name === p.key)) : undefined;
  if (p.key && keyField === undefined) throw bad(`فیلد کلید «${p.key}» وجود ندارد`);
  const rows = p.rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [h, v] of Object.entries(r)) if (mapped[h]) o[mapped[h]] = v;
    return o;
  });
  const fields = def.fields.filter((f) => Object.values(mapped).includes(f.name));
  const result: ImportResult = { created: 0, updated: 0, errors: [], dryRun: !!p.dryRun, mapped };
  const run = async () => {
    await ctx.write(async (tx) => {
      const ref = await resolver(tx, ctx, def, schema, fields, rows);
      for (let i = 0; i < rows.length; i++) {
        const src = rows[i];
        const data: Record<string, unknown> = {};
        for (const f of fields) if (f.name in src) data[f.name] = fromCell(f, src[f.name], schema, ref);
        try {
          await savepoint(tx, async () => {
            let existing: string | null = null;
            if (p.key) {
              const kv = p.key === "number" ? src.number : data[p.key];
              if (kv !== null && kv !== undefined && kv !== "") {
                const col = p.key === "number" ? "lower(number)" : keyField!.custom ? `lower(custom ->> '${keyField!.name}')` : `lower(${keyField!.name}::text)`;
                const hit = await tx.one<{ id: string }>(`select id from ${def.table} where org_id = $1 and deleted_at is null and ${col} = lower($2::text) limit 1`, [ctx.org.id, String(kv)]);
                existing = hit?.id ?? null;
              }
            }
            delete data.number;
            if (existing) {
              await updateIn(tx, ctx, def.key, existing, data, { via: "import" });
              result.updated++;
            } else {
              await createIn(tx, ctx, def.key, data, { via: "import" });
              result.created++;
            }
          });
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          const fieldsErr = (e.details as { fields?: Record<string, string> } | null)?.fields;
          if (fieldsErr && Object.keys(fieldsErr).length) for (const [field, message] of Object.entries(fieldsErr)) result.errors.push({ row: i, field, message });
          else result.errors.push({ row: i, message: e.message });
        }
      }
      if (p.dryRun) throw new DryRun();
    });
  };
  try {
    await run();
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return result;
}

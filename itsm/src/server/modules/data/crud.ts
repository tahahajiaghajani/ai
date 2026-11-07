// Generic CRUD for master data described in @shared/entities. Values are coerced and validated
// per field type; entity hooks keep derived data in shape (detail accounts, gold net weight…).
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { likeContains } from "../../db";
import { ident, insertRow, nextCode, updateRow } from "../../db/sql";
import { ENTITIES, fieldsFor, importFields, type EntityDef, type FieldDef } from "@shared/entities";
import { AppError, bad, conflict, dbErrorMessage, forbidden, notFound } from "../../http/errors";
import { parseJalaliInput } from "@shared/jalali";
import { D, isNumeric, normalizeDigits } from "@shared/money";
import { checkFormat, normalizeIban, normalizeMobile } from "@shared/validate";
import { uuidv7, isUuid } from "@shared/id";
import { ensureDetail, archiveDetail } from "../accounting/details";

export function def(key: string): EntityDef {
  const d = ENTITIES[key];
  if (!d) throw notFound("نوع داده پیدا نشد");
  return d;
}

function coerce(f: FieldDef, raw: unknown): unknown {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") {
    if (f.type === "bool") return false;
    if (f.type === "multiselect") return [];
    return null;
  }
  switch (f.type) {
    case "text":
    case "textarea":
    case "code": {
      let s = String(raw).trim();
      if (f.format === "mobile") s = normalizeMobile(s);
      if (f.format === "iban") s = normalizeIban(s);
      if (["nationalId", "postal", "economic", "card", "sayad", "taxGoodsId"].includes(f.format ?? "")) s = normalizeDigits(s).replace(/[\s-]/g, "");
      if (f.type === "code") s = normalizeDigits(s);
      const max = f.maxLength ?? (f.type === "textarea" ? 4000 : 300);
      if (s.length > max) throw bad(`«${f.label}» حداکثر ${max} نویسه است`);
      if (f.format) {
        const problem = checkFormat(f.format, s);
        if (problem) throw bad(`${f.label}: ${problem}`);
      }
      return s || null;
    }
    case "int": {
      const s = normalizeDigits(String(raw));
      if (!/^-?\d+$/.test(s)) throw bad(`«${f.label}» باید عدد صحیح باشد`);
      return Number(s);
    }
    case "decimal":
    case "money":
    case "pct":
    case "weight": {
      if (!isNumeric(raw)) throw bad(`«${f.label}» باید عدد باشد`);
      const d = D(raw as string);
      if (f.type === "pct" && (d.lt(0) || d.gt(1000))) throw bad(`«${f.label}» معتبر نیست`);
      if (f.type === "weight" && d.lt(0)) throw bad(`«${f.label}» نمی‌تواند منفی باشد`);
      return d.toString();
    }
    case "bool":
      return raw === true || raw === "true" || raw === 1 || raw === "1";
    case "date": {
      const s = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad(`«${f.label}» تاریخ معتبر نیست`);
      return s;
    }
    case "select": {
      const s = String(raw);
      if (f.options && f.options.length && !f.options.some((o) => o.value === s)) throw bad(`«${f.label}» معتبر نیست`);
      return s;
    }
    case "multiselect": {
      const arr = Array.isArray(raw) ? raw.map(String) : String(raw).split(",").map((s) => s.trim()).filter(Boolean);
      if (f.options && f.options.length) {
        const allowed = new Set(f.options.map((o) => o.value));
        for (const v of arr) if (!allowed.has(v)) throw bad(`«${f.label}»: مقدار «${v}» معتبر نیست`);
      }
      return Array.from(new Set(arr)).slice(0, 50);
    }
    case "ref": {
      const s = String(raw);
      if (!isUuid(s)) throw bad(`«${f.label}» معتبر نیست`);
      return s;
    }
    case "json": {
      if (typeof raw === "string") {
        try {
          return JSON.parse(raw);
        } catch {
          throw bad(`«${f.label}» باید JSON معتبر باشد`);
        }
      }
      return raw;
    }
    case "image": {
      const s = String(raw);
      if (!/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(s)) throw bad(`«${f.label}» باید تصویر باشد`);
      if (s.length > 600_000) throw bad("حجم تصویر زیاد است (حداکثر حدود ۴۰۰ کیلوبایت)");
      return s;
    }
    default:
      return raw;
  }
}

function pickValues(d: EntityDef, fields: FieldDef[], data: Record<string, unknown>, creating: boolean) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.readonly) continue;
    let v = coerce(f, data[f.name]);
    if (v === undefined && creating && f.default !== undefined) v = f.default;
    if (creating && f.required && (v === null || v === undefined || v === "") && f.type !== "code") throw bad(`«${f.label}» را وارد کنید`);
    if (!creating && f.required && v === null) throw bad(`«${f.label}» را وارد کنید`);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

/** References must point at rows of the same business (ids are global, there are no FKs per org). */
async function checkRefs(tx: Tx, ctx: Ctx, fields: FieldDef[], row: Record<string, unknown>) {
  for (const f of fields) {
    if (f.type !== "ref" || !f.ref) continue;
    const v = row[f.name];
    if (v === null || v === undefined) continue;
    const table = f.ref === "account" ? "tz_accounts" : ENTITIES[f.ref]?.table;
    if (!table) continue;
    const found = await tx.one(`select 1 from ${ident(table)} where id = $1 and org_id = $2`, [v, ctx.org.id]);
    if (!found) throw bad(`«${f.label}» پیدا نشد`);
  }
}

// ---------- entity hooks ----------
type Hook = (tx: Tx, ctx: Ctx, row: Record<string, unknown>, prev: Record<string, unknown> | null) => Promise<void>;

const before: Record<string, Hook> = {
  party: async (_tx, _ctx, row, prev) => {
    const kind = row.kind ?? prev?.kind;
    if (!row.name && (row.first_name || row.last_name)) row.name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
    if (kind === "company" && !row.company_name && row.name) row.company_name = row.name;
    if (Array.isArray(row.roles) && row.roles.length === 0) row.roles = ["customer"];
  },
  gold_item: async (_tx, _ctx, row, prev) => {
    const gross = D((row.gross_weight ?? prev?.gross_weight ?? 0) as string);
    const stone = D((row.stone_weight ?? prev?.stone_weight ?? 0) as string);
    if (stone.gt(gross)) throw bad("وزن سنگ از وزن کل بیشتر است");
    row.net_weight = gross.minus(stone).toDecimalPlaces(3).toString();
    const fin = D((row.fineness ?? prev?.fineness ?? 750) as string);
    if (fin.lte(0) || fin.gt(1000)) throw bad("عیار باید بین ۱ تا ۱۰۰۰ (در هزار) باشد");
  },
  wallet: async (_tx, _ctx, row, prev) => {
    const chain = String(row.chain ?? prev?.chain ?? "");
    const addr = String(row.address ?? prev?.address ?? "").trim();
    row.address = addr;
    const { isCryptoAddress } = await import("@shared/validate");
    if (addr && !isCryptoAddress(chain as never, addr)) throw bad("نشانی کیف‌پول با شبکه‌ی انتخاب‌شده جور نیست");
  },
  currency: async (_tx, _ctx, row) => {
    if (row.code) row.code = String(row.code).toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  },
  item: async (_tx, _ctx, row, prev) => {
    const u2 = row.unit2_id ?? prev?.unit2_id;
    const f2 = row.unit2_factor ?? prev?.unit2_factor;
    if (u2 && (!f2 || D(f2 as string).lte(0))) throw bad("ضریب واحد فرعی را وارد کنید");
  },
};

const after: Record<string, Hook> = {};
for (const key of Object.keys(ENTITIES)) {
  const d = ENTITIES[key];
  if (!d.detail) continue;
  after[key] = async (tx, ctx, row) => {
    const name = String(row[d.display] ?? "");
    const detailId = await ensureDetail(tx, ctx.org.id, d.detail!, String(row.id), name, row.detail_id as string | null);
    if (detailId !== row.detail_id) {
      await tx.query(`update ${ident(d.table)} set detail_id = $1 where id = $2`, [detailId, row.id]);
      row.detail_id = detailId;
    }
  };
}

// ---------- queries ----------
export interface ListParams {
  q?: string;
  page?: number;
  size?: number;
  sort?: string;
  dir?: "asc" | "desc";
  filters?: Record<string, string>;
  includeInactive?: boolean;
}

function searchCols(d: EntityDef) {
  return d.fields.filter((f) => f.search).map((f) => f.name);
}

export async function list(ctx: Ctx, key: string, p: ListParams) {
  const d = def(key);
  ctx.need(d.area, "view");
  const params: unknown[] = [ctx.org.id];
  const where: string[] = ["org_id = $1", "deleted_at is null"];
  const q = (p.q ?? "").trim();
  if (q) {
    params.push(likeContains(normalizeDigits(q)));
    const cols = searchCols(d);
    where.push(`(${(cols.length ? cols : [d.display]).map((c) => `${ident(c)}::text ilike $${params.length}`).join(" or ")})`);
  }
  for (const [name, value] of Object.entries(p.filters ?? {})) {
    const f = d.fields.find((x) => x.name === name);
    if (!f || value === "" || value === undefined) continue;
    if (f.type === "multiselect") {
      params.push(JSON.stringify([value]));
      where.push(`${ident(f.name)} @> $${params.length}::jsonb`);
    } else if (f.type === "bool") {
      params.push(value === "true");
      where.push(`${ident(f.name)} = $${params.length}`);
    } else {
      params.push(value);
      where.push(`${ident(f.name)}::text = $${params.length}`);
    }
  }
  if (!p.includeInactive && d.fields.some((f) => f.name === "is_active") && !(p.filters && "is_active" in p.filters)) {
    // inactive rows stay visible in lists (greyed); selects hide them (see options)
  }
  // query-string numbers may be NaN or huge: they would end up as `limit NaN` / `offset 1e+302`
  const int = (v: number | undefined, dflt: number) => (Number.isFinite(v) ? Math.trunc(v!) : dflt);
  const size = Math.min(Math.max(int(p.size, 50), 1), 500);
  const page = Math.min(Math.max(int(p.page, 1), 1), 1_000_000);
  const sortField = p.sort && d.fields.some((f) => f.name === p.sort) ? p.sort : null;
  const order = sortField ? `${ident(sortField)} ${p.dir === "desc" ? "desc" : "asc"}` : orderClause(d);
  const totalRow = await ctx.db.one<{ n: number }>(`select count(*)::int as n from ${ident(d.table)} where ${where.join(" and ")}`, params);
  const rows = await ctx.db.query(
    `select * from ${ident(d.table)} where ${where.join(" and ")} order by ${order} nulls last, id limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  return { rows, total: totalRow?.n ?? 0, page, size };
}

function orderClause(d: EntityDef) {
  const f = d.order;
  if (f === "code" || f === "tag_no") return `length(${ident(f)}), ${ident(f)}`;
  return ident(f);
}

export async function get(ctx: Ctx, key: string, id: string) {
  const d = def(key);
  ctx.need(d.area, "view");
  const row = await ctx.db.one(`select * from ${ident(d.table)} where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
  if (!row) throw notFound(`${d.title} پیدا نشد`);
  return row;
}

/** Compact options for searchable selects. */
export async function options(ctx: Ctx, key: string, q: string, filters: Record<string, string> = {}, ids: string[] = []) {
  const d = def(key);
  // selecting a party/item in an invoice only needs to see it
  const params: unknown[] = [ctx.org.id];
  const where = ["org_id = $1", "deleted_at is null"];
  if (d.fields.some((f) => f.name === "is_active")) where.push("is_active");
  if (ids.length) {
    params.push(`{${ids.filter(isUuid).join(",")}}`);
    where.push(`id = any($${params.length}::uuid[])`);
  } else if (q.trim()) {
    params.push(likeContains(normalizeDigits(q.trim())));
    const cols = searchCols(d);
    where.push(`(${(cols.length ? cols : [d.display]).map((c) => `${ident(c)}::text ilike $${params.length}`).join(" or ")})`);
  }
  for (const [name, value] of Object.entries(filters)) {
    if (name === "role" && key === "party") {
      params.push(JSON.stringify([value]));
      where.push(`roles @> $${params.length}::jsonb`);
      continue;
    }
    const f = d.fields.find((x) => x.name === name);
    if (!f) continue;
    if (value.includes(",")) {
      params.push(`{${value.split(",").map((v) => `"${v.replace(/"/g, "")}"`).join(",")}}`);
      where.push(`${ident(f.name)}::text = any($${params.length}::text[])`);
      continue;
    }
    params.push(value);
    where.push(`${ident(f.name)}::text = $${params.length}`);
  }
  const sub = d.sub ? `, ${ident(d.sub)} as sub` : "";
  // pickers are used everywhere (an invoice needs a customer); full rows only for members who
  // may view this area, others get just what a picker shows
  const full = ctx.can(d.area, "view");
  const extra = full ? ", *" : d.fields.some((f) => f.name === "code") ? ", code" : "";
  return ctx.db.query(
    `select id, ${ident(d.display)} as label${sub}${extra} from ${ident(d.table)} where ${where.join(" and ")} order by ${orderClause(d)} limit 40`,
    params,
  );
}

export async function create(ctx: Ctx, key: string, data: Record<string, unknown>) {
  const d = def(key);
  ctx.need(d.area, "edit");
  if (d.modules && !d.modules.some((m) => ctx.hasModule(m))) throw forbidden("این ماژول برای کسب‌وکار شما فعال نیست");
  return ctx.write((tx) => createIn(tx, ctx, key, data));
}

/** Insert inside an open write transaction (permission already checked). */
async function createIn(tx: Tx, ctx: Ctx, key: string, data: Record<string, unknown>) {
  const d = def(key);
  const fields = fieldsFor(d, ctx.org.modules);
  const row = pickValues(d, fields, data, true);
  await checkRefs(tx, ctx, fields, row);
  if (d.code && !row[d.code.field]) row[d.code.field] = await nextCode(tx, d.table, ctx.org.id, d.code.start, d.code.field);
  await before[key]?.(tx, ctx, row, null);
  row.id = isUuid(data.id) ? data.id : uuidv7();
  row.org_id = ctx.org.id;
  row.origin = ctx.cfg.origin;
  const saved = await insertRow<Record<string, unknown>>(tx, d.table, row);
  await after[key]?.(tx, ctx, saved, null);
  await audit(tx, ctx, "create", key, String(saved.id), String(saved[d.display] ?? ""));
  return saved;
}

export async function update(ctx: Ctx, key: string, id: string, data: Record<string, unknown>) {
  const d = def(key);
  ctx.need(d.area, "edit");
  return ctx.write((tx) => updateIn(tx, ctx, key, id, data));
}

async function updateIn(tx: Tx, ctx: Ctx, key: string, id: string, data: Record<string, unknown>) {
  const d = def(key);
  const fields = fieldsFor(d, ctx.org.modules).filter((f) => f.name in data);
  const prev = await tx.one<Record<string, unknown>>(`select * from ${ident(d.table)} where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
  if (!prev) throw notFound(`${d.title} پیدا نشد`);
  const patch = pickValues(d, fields, data, false);
  await checkRefs(tx, ctx, fields, patch);
  if (d.code && patch[d.code.field] === null) delete patch[d.code.field];
  await before[key]?.(tx, ctx, patch, prev);
  patch.origin = ctx.cfg.origin;
  const saved = await updateRow<Record<string, unknown>>(tx, d.table, { id, org_id: ctx.org.id }, patch);
  await after[key]?.(tx, ctx, saved!, prev);
  await audit(tx, ctx, "update", key, id, String(saved?.[d.display] ?? ""));
  return saved;
}

// ---------- import from a spreadsheet ----------

/** Lower-case, Persian letters and digits, single spaces — for matching labels typed in Excel. */
export function normText(s: unknown): string {
  return normalizeDigits(String(s ?? ""))
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200f\u200e\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const YES = new Set(["1", "true", "yes", "y", "بله", "بلی", "آری", "اری", "دارد", "فعال", "هست", "✓", "✔", "x", "*"]);

/** Spreadsheet date cell → ISO: Jalali 1403/05/12, Gregorian 2024-08-02, or an Excel serial day. */
export function importDate(v: unknown): string | null {
  if (typeof v === "number" || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const n = Math.floor(Number(v));
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  const s = normalizeDigits(String(v)).trim().replace(/\s.*$/, "");
  const g = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (g && Number(g[1]) >= 1700) {
    const iso = `${g[1]}-${g[2].padStart(2, "0")}-${g[3].padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  return parseJalaliInput(s);
}

/** Entities a missing reference may be created for on the fly (only a name is needed). */
const AUTO_CREATE = new Set(["unit", "item_category", "party_group", "gold_category"]);

interface RefCache {
  map: Map<string, string | null>;
  createdInRow: string[];
}

async function resolveRef(tx: Tx, ctx: Ctx, f: FieldDef, value: unknown, cache: RefCache): Promise<string> {
  const raw = String(value).trim();
  if (isUuid(raw)) return raw;
  const key = `${f.ref}|${normText(raw)}`;
  if (cache.map.has(key)) {
    const id = cache.map.get(key);
    if (id) return id;
    throw bad(`«${f.label}»: «${raw}» پیدا نشد`);
  }
  let id: string | null = null;
  const text = normalizeDigits(raw).replace(/[يى]/g, "ی").replace(/ك/g, "ک").trim();
  if (f.ref === "account") {
    const r = await tx.one<{ id: string }>(
      `select id from tz_accounts where org_id = $1 and deleted_at is null and (code = $2 or lower(name) = lower($2)) order by is_postable desc limit 1`,
      [ctx.org.id, text],
    );
    id = r?.id ?? null;
  } else {
    const rd = ENTITIES[f.ref!];
    if (!rd) throw bad(`«${f.label}» قابل ورود از فایل نیست`);
    const hasCode = rd.fields.some((x) => x.name === "code");
    const r = await tx.one<{ id: string }>(
      `select id from ${ident(rd.table)} where org_id = $1 and deleted_at is null and (lower(${ident(rd.display)}) = lower($2)${hasCode ? " or code = $2" : ""}) limit 1`,
      [ctx.org.id, text],
    );
    id = r?.id ?? null;
    if (!id && AUTO_CREATE.has(rd.key) && ctx.can(rd.area, "edit") && (!rd.modules || rd.modules.some((m) => ctx.hasModule(m)))) {
      const saved = await createIn(tx, ctx, rd.key, { [rd.display]: text });
      id = String(saved.id);
      cache.createdInRow.push(key);
    }
  }
  cache.map.set(key, id);
  if (!id) throw bad(`«${f.label}»: «${raw}» پیدا نشد`);
  return id;
}

function matchOption(f: FieldDef, v: unknown): string {
  const n = normText(v);
  const o = (f.options ?? []).find((x) => normText(x.value) === n || normText(x.label) === n);
  if (!o) throw bad(`«${f.label}»: «${String(v)}» معتبر نیست؛ یکی از ${(f.options ?? []).map((x) => `«${x.label}»`).join("، ")}`);
  return o.value;
}

/** One spreadsheet row (field name → cell) → values `pickValues` accepts. Empty cells are skipped. */
async function importValues(tx: Tx, ctx: Ctx, fields: FieldDef[], raw: Record<string, unknown>, cache: RefCache) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = raw[f.name];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) continue;
    switch (f.type) {
      case "money":
      case "decimal":
      case "int":
      case "pct":
      case "weight": {
        const s = normalizeDigits(String(v)).replace(/[,،٬\s]/g, "").replace(/٫/g, ".").replace(/[٪%]$/, "");
        out[f.name] = s;
        break;
      }
      case "bool":
        out[f.name] = v === true || YES.has(normText(v));
        break;
      case "date": {
        const iso = importDate(v);
        if (!iso) throw bad(`«${f.label}»: تاریخ «${String(v)}» معتبر نیست`);
        out[f.name] = iso;
        break;
      }
      case "select":
        out[f.name] = f.options?.length ? matchOption(f, v) : String(v).trim();
        break;
      case "multiselect":
        out[f.name] = String(v)
          .split(/[,،;|\n]/)
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => (f.options?.length ? matchOption(f, x) : x));
        break;
      case "ref":
        out[f.name] = await resolveRef(tx, ctx, f, v, cache);
        break;
      default: {
        let s = typeof v === "number" ? String(v) : String(v).trim();
        // Excel drops leading zeros of numeric-looking cells
        if (f.format === "nationalId" && /^\d{8,9}$/.test(normalizeDigits(s))) s = normalizeDigits(s).padStart(10, "0");
        if (f.format === "mobile" && /^9\d{9}$/.test(normalizeDigits(s))) s = `0${normalizeDigits(s)}`;
        out[f.name] = s;
      }
    }
  }
  return out;
}

export interface ImportResult {
  row: number;
  ok: boolean;
  action?: "create" | "update";
  id?: string;
  label?: string;
  error?: string;
}

const DRY_RUN = Symbol("dry-run");

/**
 * Create (or, with `updateExisting`, update by code) many rows at once. Every row runs in its own
 * savepoint so one bad row does not stop the rest; `dryRun` validates everything and rolls back.
 */
export async function importRows(ctx: Ctx, key: string, rows: Record<string, unknown>[], opts: { updateExisting?: boolean; dryRun?: boolean; offset?: number } = {}) {
  const d = def(key);
  ctx.need(d.area, "edit");
  if (d.modules && !d.modules.some((m) => ctx.hasModule(m))) throw forbidden("این ماژول برای کسب‌وکار شما فعال نیست");
  const fields = importFields(d, ctx.org.modules);
  const results: ImportResult[] = [];
  const cache: RefCache = { map: new Map(), createdInRow: [] };
  const codeField = d.code?.field ?? (d.fields.some((f) => f.name === "code") ? "code" : null);
  const offset = opts.offset ?? 0;
  const run = async (tx: Tx) => {
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] ?? {};
      if (!Object.values(raw).some((v) => v !== null && v !== undefined && String(v).trim() !== "")) continue;
      cache.createdInRow = [];
      await tx.query("savepoint tz_import_row");
      try {
        const data = await importValues(tx, ctx, fields, raw, cache);
        let existing: { id: string } | null = null;
        if (codeField && data[codeField]) {
          const codeValue = normalizeDigits(String(data[codeField]));
          data[codeField] = codeValue;
          if (seen.has(codeValue)) throw bad(`کد «${codeValue}» در همین فایل تکراری است`);
          seen.add(codeValue);
          existing = await tx.one<{ id: string }>(`select id from ${ident(d.table)} where org_id = $1 and ${ident(codeField)} = $2 and deleted_at is null`, [ctx.org.id, codeValue]);
          if (existing && !opts.updateExisting) throw conflict(`کد «${codeValue}» از قبل وجود دارد`);
        }
        const saved = existing ? await updateIn(tx, ctx, key, existing.id, data) : await createIn(tx, ctx, key, data);
        await tx.query("release savepoint tz_import_row");
        results.push({ row: offset + i, ok: true, action: existing ? "update" : "create", id: String(saved?.id), label: String(saved?.[d.display] ?? "") });
      } catch (e) {
        await tx.query("rollback to savepoint tz_import_row");
        for (const k of cache.createdInRow) cache.map.delete(k);
        const err = e instanceof AppError ? e : dbErrorMessage(e);
        results.push({ row: offset + i, ok: false, error: err?.message ?? String((e as Error)?.message ?? e) });
      }
    }
    if (opts.dryRun) throw DRY_RUN;
  };
  try {
    await ctx.write(run);
  } catch (e) {
    if (e !== DRY_RUN) throw e;
  }
  return {
    results,
    created: results.filter((r) => r.ok && r.action === "create").length,
    updated: results.filter((r) => r.ok && r.action === "update").length,
    failed: results.filter((r) => !r.ok).length,
    dry_run: !!opts.dryRun,
  };
}

/** Where a master row is referenced; used to refuse deleting rows in use. */
const USAGE: Record<string, [string, string][]> = {
  party: [["tz_invoices", "party_id"], ["tz_treasury_docs", "party_id"], ["tz_cheques", "party_id"], ["tz_gold_docs", "party_id"], ["tz_fx_deals", "party_id"], ["tz_remittances", "party_id"]],
  item: [["tz_invoice_lines", "item_id"], ["tz_stock_lines", "item_id"], ["tz_stock_moves", "item_id"]],
  warehouse: [["tz_stock_moves", "warehouse_id"]],
  cash_box: [["tz_treasury_lines", "cash_box_id"]],
  bank_account: [["tz_treasury_lines", "bank_account_id"], ["tz_cheques", "bank_account_id"]],
  currency: [["tz_voucher_lines", "currency_id"], ["tz_fx_deals", "in_currency_id"], ["tz_fx_deals", "out_currency_id"]],
  unit: [["tz_items", "unit_id"]],
  gold_item: [["tz_gold_lines", "gold_item_id"]],
  gold_category: [["tz_gold_items", "category_id"]],
  wallet: [["tz_treasury_lines", "wallet_id"]],
};

export async function remove(ctx: Ctx, key: string, id: string) {
  const d = def(key);
  ctx.need(d.area, "full");
  return ctx.write(async (tx) => {
    const prev = await tx.one<Record<string, unknown>>(`select * from ${ident(d.table)} where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!prev) throw notFound(`${d.title} پیدا نشد`);
    if (key === "currency" && prev.is_base) throw conflict("ارز پایه قابل حذف نیست");
    for (const [table, col] of USAGE[key] ?? []) {
      const used = await tx.one(`select 1 from ${ident(table)} where org_id = $1 and ${ident(col)} = $2 limit 1`, [ctx.org.id, id]);
      if (used) throw conflict(`این ${d.title} در اسناد استفاده شده و قابل حذف نیست؛ می‌توانید آن را غیرفعال کنید`);
    }
    if (prev.detail_id) {
      const usedDetail = await tx.one(`select 1 from tz_voucher_lines where org_id = $1 and (detail_id = $2 or detail2_id = $2) limit 1`, [ctx.org.id, prev.detail_id]);
      if (usedDetail) throw conflict(`این ${d.title} گردش حسابداری دارد و قابل حذف نیست؛ می‌توانید آن را غیرفعال کنید`);
      await archiveDetail(tx, ctx.org.id, prev.detail_id as string);
      await tx.query(`update tz_details set deleted_at = now() where id = $1`, [prev.detail_id]);
    }
    await tx.query(`update ${ident(d.table)} set deleted_at = now() where id = $1`, [id]);
    await audit(tx, ctx, "delete", key, id, String(prev[d.display] ?? ""));
    return { ok: true };
  });
}

export async function audit(q: Queryable, ctx: Ctx, action: string, entity: string, entityId: string | null, summary: string, data?: unknown) {
  await q.query(
    `insert into tz_audit (id, org_id, user_id, action, entity, entity_id, summary, data, origin) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [uuidv7(), ctx.org.id, ctx.user.id, action, entity, entityId, summary.slice(0, 300), data ?? null, ctx.cfg.origin],
  );
}

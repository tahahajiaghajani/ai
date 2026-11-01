// Generic CRUD for master data described in @shared/entities. Values are coerced and validated
// per field type; entity hooks keep derived data in shape (detail accounts, gold net weight…).
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { likeContains } from "../../db";
import { ident, insertRow, nextCode, updateRow } from "../../db/sql";
import { ENTITIES, fieldsFor, type EntityDef, type FieldDef } from "@shared/entities";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
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
  const size = Math.min(Math.max(p.size ?? 50, 1), 500);
  const page = Math.max(p.page ?? 1, 1);
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
  return ctx.db.query(
    `select id, ${ident(d.display)} as label${sub}, * from ${ident(d.table)} where ${where.join(" and ")} order by ${orderClause(d)} limit 40`,
    params,
  );
}

export async function create(ctx: Ctx, key: string, data: Record<string, unknown>) {
  const d = def(key);
  ctx.need(d.area, "edit");
  if (d.modules && !d.modules.some((m) => ctx.hasModule(m))) throw forbidden("این ماژول برای کسب‌وکار شما فعال نیست");
  const fields = fieldsFor(d, ctx.org.modules);
  return ctx.write(async (tx) => {
    const row = pickValues(d, fields, data, true);
    if (d.code && !row[d.code.field]) row[d.code.field] = await nextCode(tx, d.table, ctx.org.id, d.code.start, d.code.field);
    await before[key]?.(tx, ctx, row, null);
    row.id = isUuid(data.id) ? data.id : uuidv7();
    row.org_id = ctx.org.id;
    row.origin = ctx.cfg.origin;
    const saved = await insertRow<Record<string, unknown>>(tx, d.table, row);
    await after[key]?.(tx, ctx, saved, null);
    await audit(tx, ctx, "create", key, String(saved.id), String(saved[d.display] ?? ""));
    return saved;
  });
}

export async function update(ctx: Ctx, key: string, id: string, data: Record<string, unknown>) {
  const d = def(key);
  ctx.need(d.area, "edit");
  const fields = fieldsFor(d, ctx.org.modules).filter((f) => f.name in data);
  return ctx.write(async (tx) => {
    const prev = await tx.one<Record<string, unknown>>(`select * from ${ident(d.table)} where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!prev) throw notFound(`${d.title} پیدا نشد`);
    const patch = pickValues(d, fields, data, false);
    if (d.code && patch[d.code.field] === null) delete patch[d.code.field];
    await before[key]?.(tx, ctx, patch, prev);
    patch.origin = ctx.cfg.origin;
    const saved = await updateRow<Record<string, unknown>>(tx, d.table, { id, org_id: ctx.org.id }, patch);
    await after[key]?.(tx, ctx, saved!, prev);
    await audit(tx, ctx, "update", key, id, String(saved?.[d.display] ?? ""));
    return saved;
  });
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

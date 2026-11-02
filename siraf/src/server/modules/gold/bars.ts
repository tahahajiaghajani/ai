// The bar register (tz_gold_bars, a synced root with code column bar_no): every bar the shop has
// held with its maker's serial, certificate and assay, seal state, weights, owner, status and
// specific cost. Bars are created and consumed by gold documents (./posting); here are the
// register list, the lookup at the counter (bar number, serial or QR), numbering, reservation and
// the editing of a bar's descriptive fields.
import { z } from "zod";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { likeContains } from "../../db";
import { updateRow } from "../../db/sql";
import { bad, conflict, notFound } from "../../http/errors";
import { D, isNumeric, normalizeDigits } from "@shared/money";
import { isUuid } from "@shared/id";
import { BAR_NO_START, BAR_STATUS_TITLES } from "@shared/gold-catalogue";
import { barLineDefaults, type Product } from "@shared/gold-quote";
import { priceLine } from "./pricing";
import { audit } from "../data/crud";
import { latestRate } from "./rates";
import { goldSettings, priceEnv } from "./settings";
import { barInStockAt, products } from "./catalogue";

export interface BarRow {
  id: string;
  org_id: string;
  bar_no: string;
  item_id: string | null;
  brand: string | null;
  serial_no: string | null;
  qr: string | null;
  nominal_weight: string | null;
  weight: string;
  fineness: string;
  fine_weight: string;
  weight750: string;
  certificate_no: string | null;
  certificate_issuer: string | null;
  assay_lab: string | null;
  assay_no: string | null;
  assay_date: string | null;
  seal_status: string;
  source: string;
  source_ref: string | null;
  ownership: "own" | "consignment" | "customer";
  party_id: string | null;
  status: string;
  warehouse_id: string | null;
  cost: string | null;
  in_doc_id: string | null;
  out_doc_id: string | null;
  notes: string | null;
  deleted_at?: string | null;
}

export const barStatusTitle = (s: string) => (BAR_STATUS_TITLES as Record<string, string>)[s] ?? s;

/** Serial numbers and brands are compared without spaces, dashes and case. */
export function normalizeSerial(s: string | null | undefined): string {
  return normalizeDigits(String(s ?? "")).trim().toUpperCase().replace(/[\s\-_/]+/g, "");
}
export function normalizeBrand(s: string | null | undefined): string {
  return normalizeDigits(String(s ?? "")).trim().replace(/\s+/g, " ");
}
export function normalizeBarNo(s: string | null | undefined): string {
  return normalizeDigits(String(s ?? "")).trim().replace(/\s+/g, "");
}

/** Next free bar number (soft-deleted ones count, so a number is never reused). */
export async function nextBarNo(q: Queryable, orgId: string): Promise<number> {
  const r = await q.one<{ n: string | null }>(`select max(bar_no::numeric) as n from tz_gold_bars where org_id = $1 and bar_no ~ '^[0-9]{1,15}$'`, [orgId]);
  return Math.max(r?.n ? Number(r.n) + 1 : BAR_NO_START, BAR_NO_START);
}

export async function barNoTaken(q: Queryable, orgId: string, barNo: string, exceptId?: string | null): Promise<boolean> {
  return !!(await q.one(
    `select 1 from tz_gold_bars where org_id = $1 and bar_no = $2 and deleted_at is null ${exceptId ? "and id <> $3" : ""} limit 1`,
    exceptId ? [orgId, barNo, exceptId] : [orgId, barNo],
  ));
}

/** A live bar with this brand and serial (brand-less serials match any brand). */
export async function barBySerial(q: Queryable, orgId: string, brand: string | null | undefined, serial: string | null | undefined): Promise<BarRow | null> {
  const sn = normalizeSerial(serial);
  if (!sn) return null;
  const rows = await q.query<BarRow>(
    `select * from tz_gold_bars where org_id = $1 and deleted_at is null and upper(regexp_replace(coalesce(serial_no, ''), '[\\s\\-_/]+', '', 'g')) = $2 order by updated_at desc`,
    [orgId, sn],
  );
  const b = normalizeBrand(brand);
  return rows.find((r) => !b || !r.brand || normalizeBrand(r.brand) === b) ?? null;
}

export interface BarListParams {
  q?: string;
  status?: string;
  item_id?: string;
  ownership?: string;
  brand?: string;
  min_fineness?: string;
  to?: string;
  page?: number;
  size?: number;
}

/** The register with filters and sums (count, grams, fine grams, 750-equivalent, cost). */
export async function listBars(ctx: Ctx, p: BarListParams) {
  ctx.need("gold", "view");
  const params: unknown[] = [ctx.org.id];
  const cond = ["b.org_id = $1", "b.deleted_at is null"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (p.to && /^\d{4}-\d{2}-\d{2}$/.test(p.to)) {
    params.push(p.to);
    cond.push(barInStockAt(p.to, `$${params.length}`));
  } else if (p.status) {
    const list = p.status.split(",").filter((x) => /^[a-z_]+$/.test(x));
    if (list.length) add("b.status = any(?::text[])", `{${list.join(",")}}`);
  }
  if (p.q?.trim()) {
    const s = normalizeDigits(p.q.trim());
    add("(b.bar_no ilike ? or coalesce(b.serial_no, '') ilike ? or coalesce(b.brand, '') ilike ? or coalesce(b.certificate_no, '') ilike ? or coalesce(b.qr, '') ilike ?)", likeContains(s));
  }
  if (p.item_id && isUuid(p.item_id)) add("b.item_id = ?", p.item_id);
  if (p.ownership && ["own", "consignment", "customer"].includes(p.ownership)) add("b.ownership = ?", p.ownership);
  if (p.brand?.trim()) add("b.brand = ?", normalizeBrand(p.brand));
  if (p.min_fineness && isNumeric(p.min_fineness)) add("b.fineness >= ?", D(p.min_fineness).toString());
  const where = cond.join(" and ");
  const size = Math.min(Math.max(p.size ?? 50, 1), 1000);
  const page = Math.max(p.page ?? 1, 1);
  const sums = await ctx.db.one<{ n: number; weight: string; fine: string; w750: string; cost: string }>(
    `select count(*)::int as n, coalesce(sum(b.weight), 0) as weight, coalesce(sum(b.fine_weight), 0) as fine,
            coalesce(sum(b.weight750), 0) as w750, coalesce(sum(b.cost), 0) as cost
     from tz_gold_bars b where ${where}`,
    params,
  );
  const rows = await ctx.db.query(
    `select b.*, i.name as model_name, i.code as model_code, pa.name as party_name,
            di.kind as in_kind, di.no as in_no, di.date as in_date, do2.kind as out_kind, do2.no as out_no, do2.date as out_date
     from tz_gold_bars b
     left join tz_items i on i.id = b.item_id
     left join tz_parties pa on pa.id = b.party_id
     left join tz_gold_docs di on di.id = b.in_doc_id
     left join tz_gold_docs do2 on do2.id = b.out_doc_id
     where ${where} order by length(b.bar_no) desc, b.bar_no desc limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  const brands = await ctx.db.query<{ brand: string }>(`select distinct brand from tz_gold_bars where org_id = $1 and deleted_at is null and brand is not null order by brand`, [ctx.org.id]);
  return { rows, total: sums?.n ?? 0, page, size, sums, brands: brands.map((b) => b.brand) };
}

async function withPrice(ctx: Ctx, bar: BarRow) {
  const [model, rate] = await Promise.all([
    bar.item_id ? products(ctx.db, ctx.org.id, ["bar"], [bar.item_id]).then((r) => r[0] ?? null) : Promise.resolve(null),
    latestRate(ctx.db, ctx.org.id),
  ]);
  const s = goldSettings(ctx.org);
  const d = barLineDefaults(model as Product | null, bar, rate, s.bars, "sell");
  const line = {
    kind: "bar" as const, direction: "out" as const, weight: bar.weight, fineness: bar.fineness, gram_price: d.gram_price, unit_price: d.unit_price,
    basis: d.basis, wage_type: d.premium_type === "per_bar" ? "fixed" : d.premium_type === "per_gram" ? "per_gram" : "percent", wage_value: d.premium_value, vat_mode: d.vat_mode,
  };
  const price = d.gram_price || d.unit_price ? priceLine("sale", line, priceEnv(ctx.org, { gram18: d.gram_price ?? 0 })) : null;
  return { bar: { ...bar, model_name: model?.name ?? null }, model, available: bar.status === "in_stock" || bar.status === "reserved", status_title: barStatusTitle(bar.status), line, price };
}

/** A scanned code at the counter: our bar number, the maker's serial or the QR text. */
export async function barLookup(ctx: Ctx, raw: string) {
  ctx.need("gold", "view");
  const code = normalizeBarNo(raw);
  if (!code) throw bad("شماره‌ی شمش یا سریال را وارد کنید");
  let bar = await ctx.db.one<BarRow>(`select * from tz_gold_bars where org_id = $1 and bar_no = $2 and deleted_at is null`, [ctx.org.id, code]);
  if (!bar && /^\d+$/.test(code)) {
    bar = await ctx.db.one<BarRow>(
      `select * from tz_gold_bars where org_id = $1 and deleted_at is null and bar_no ~ '^[0-9]{1,15}$' and bar_no::numeric = $2::numeric limit 1`,
      [ctx.org.id, code],
    );
  }
  if (!bar) bar = await ctx.db.one<BarRow>(`select * from tz_gold_bars where org_id = $1 and deleted_at is null and qr = $2 limit 1`, [ctx.org.id, String(raw).trim()]);
  if (!bar) bar = await barBySerial(ctx.db, ctx.org.id, null, code);
  if (!bar) throw notFound(`شمشی با شماره یا سریال «${code}» پیدا نشد`);
  return withPrice(ctx, bar);
}

export async function readBar(ctx: Ctx, id: string) {
  ctx.need("gold", "view");
  const bar = await ctx.db.one<BarRow>(`select * from tz_gold_bars where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
  if (!bar) throw notFound("شمش پیدا نشد");
  const history = await ctx.db.query(
    `select d.id, d.kind, d.no, d.date, d.status, l.direction, l.total, l.cost, coalesce(pa.name, d.buyer->>'name') as party_name
     from tz_gold_lines l join tz_gold_docs d on d.id = l.doc_id left join tz_parties pa on pa.id = d.party_id
     where l.org_id = $1 and l.gold_bar_id = $2 and d.deleted_at is null order by d.date, d.created_at`,
    [ctx.org.id, id],
  );
  return { ...(await withPrice(ctx, bar)), history };
}

const text = (max: number) => z.string().max(max).nullish();
export const barEditSchema = z.object({
  brand: text(80), serial_no: text(80), qr: text(500), certificate_no: text(80), certificate_issuer: text(120), assay_lab: text(120), assay_no: text(60),
  assay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), seal_status: z.enum(["sealed", "opened", "damaged", "no_card"]).nullish(), notes: text(500),
  item_id: z.string().uuid().nullish(),
});

/** Descriptive fields of a bar (weights, cost and status change only through documents). */
export async function updateBar(ctx: Ctx, id: string, input: z.infer<typeof barEditSchema>) {
  ctx.need("gold", "edit");
  return ctx.write(async (tx) => {
    const bar = await tx.one<BarRow>(`select * from tz_gold_bars where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!bar) throw notFound("شمش پیدا نشد");
    const brand = input.brand !== undefined ? normalizeBrand(input.brand) || null : bar.brand;
    const serial = input.serial_no !== undefined ? input.serial_no?.trim() || null : bar.serial_no;
    if (serial) {
      const other = await barBySerial(tx, ctx.org.id, brand, serial);
      if (other && other.id !== id) throw conflict(`شمش دیگری با سریال «${serial}»${brand ? ` و برند «${brand}»` : ""} ثبت شده است (شماره‌ی ${other.bar_no})`);
    }
    if (input.item_id) {
      const m = await tx.one(`select 1 from tz_items where id = $1 and org_id = $2 and kind = 'bar' and deleted_at is null`, [input.item_id, ctx.org.id]);
      if (!m) throw bad("مدل شمش پیدا نشد");
    }
    const patch: Record<string, unknown> = { brand, serial_no: serial, origin: ctx.cfg.origin };
    for (const k of ["qr", "certificate_no", "certificate_issuer", "assay_lab", "assay_no", "assay_date", "seal_status", "notes", "item_id"] as const) {
      if (input[k] !== undefined) patch[k] = typeof input[k] === "string" ? (input[k] as string).trim() || null : input[k];
    }
    if (patch.seal_status === null) delete patch.seal_status;
    const row = await updateRow(tx, "tz_gold_bars", { id, org_id: ctx.org.id }, patch);
    await audit(tx, ctx, "update", "gold_bar", id, `شمش ${bar.bar_no}`);
    return row;
  });
}

export async function setBarReserved(ctx: Ctx, id: string, reserved: boolean) {
  ctx.need("gold", "edit");
  return ctx.write(async (tx) => {
    const bar = await tx.one<BarRow>(`select * from tz_gold_bars where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!bar) throw notFound("شمش پیدا نشد");
    if (reserved && bar.status !== "in_stock") throw conflict(`این شمش «${barStatusTitle(bar.status)}» است و رزرو نمی‌شود`);
    if (!reserved && bar.status !== "reserved") throw conflict("این شمش رزرو نیست");
    return updateRow(tx, "tz_gold_bars", { id, org_id: ctx.org.id }, { status: reserved ? "reserved" : "in_stock", origin: ctx.cfg.origin });
  });
}

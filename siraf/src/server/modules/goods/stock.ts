// Stock ledger (tz_stock_moves) and moving weighted average costing.
//
// Moves are written with their source document (invoice or stock document) inside the same
// transaction. After every change the pipeline in `afterStockChange` runs for the affected
// goods items from the earliest affected date:
//   1. stock counts dated later are re-derived (their correction = counted − system quantity),
//   2. negative stock is refused (per item and warehouse) unless allowed,
//   3. costs are recomputed in the canonical order (date, seq, document…) — outgoing moves and
//      incoming moves without an own cost take the running average of the item across all
//      warehouses; only rows whose values really change are written,
//   4. every other posted document whose moves changed gets its voucher (cost of goods sold,
//      inventory) refreshed and its root touched for sync.
// Coins and gold belong to the gold module: only items of kind "goods" are valued here and only
// moves of invoices and stock documents are ever updated.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { pgArray } from "../../db";
import { insertMany } from "../../db/sql";
import { bad } from "../../http/errors";
import { D, Decimal } from "@shared/money";
import { uuidv7 } from "@shared/id";
import { formatQty } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { MOVE_ORDER, OWN_SOURCES, SEQ, moneyDp, orgAllowsNegative } from "./common";
import { refreshSource } from "./posting";

type Dec = InstanceType<typeof Decimal>;

export interface MoveInput {
  item_id: string;
  warehouse_id: string;
  date: string;
  seq: number;
  /** signed quantity in the item's main unit (+ in, − out) */
  qty: string;
  unit_cost: string;
  /** signed value (qty × cost) */
  value: string;
  /** true: the document gives the cost (purchases, receipts); false: the costing run sets it */
  fixed_cost: boolean;
  source_line_id: string | null;
  batch_no?: string | null;
  serial_no?: string | null;
  /** the source document's created_at (keeps the order stable when it is re-posted) */
  created_at: string;
}

export interface Touch {
  item_id: string;
  date: string;
}

/** Replace the moves of a source document; returns the items/dates touched (old and new). */
export async function replaceMoves(tx: Tx, orgId: string, sourceType: string, sourceId: string, moves: MoveInput[]): Promise<Touch[]> {
  const old = await tx.query<Touch>(`delete from tz_stock_moves where org_id = $1 and source_id = $2 returning item_id, date`, [orgId, sourceId]);
  await insertMany(
    tx,
    "tz_stock_moves",
    moves.map((m) => ({
      id: uuidv7(),
      org_id: orgId,
      item_id: m.item_id,
      warehouse_id: m.warehouse_id,
      date: m.date,
      seq: m.seq,
      qty: m.qty,
      unit_cost: m.unit_cost,
      value: m.value,
      fixed_cost: m.fixed_cost,
      source_type: sourceType,
      source_id: sourceId,
      source_line_id: m.source_line_id,
      batch_no: m.batch_no ?? null,
      serial_no: m.serial_no ?? null,
      created_at: m.created_at,
    })),
  );
  return [...old, ...moves.map((m) => ({ item_id: m.item_id, date: m.date }))];
}

interface CostItem {
  id: string;
  name: string;
  kind: string;
  allow_negative: boolean | null;
  purchase_price: string | null;
}

export interface PipelineResult {
  /** "invoice:<id>" / "stock_doc:<id>" of documents whose stock values or counts changed */
  changed: Set<string>;
}

/**
 * Run after the moves of a document changed. `origin` is the document being saved: its own
 * voucher is posted by the caller afterwards, so it is not refreshed here.
 */
export async function afterStockChange(
  tx: Tx,
  ctx: Ctx,
  touches: Touch[],
  origin?: { type: string; id: string },
  opts: { checkNegative?: boolean } = {},
): Promise<PipelineResult> {
  const from = new Map<string, string>();
  for (const t of touches) {
    const cur = from.get(t.item_id);
    if (!cur || t.date < cur) from.set(t.item_id, t.date);
  }
  const changed = new Set<string>();
  if (!from.size) return { changed };
  const items = (await tx.query<CostItem>(
    `select id, name, kind, allow_negative, purchase_price from tz_items where org_id = $1 and id = any($2::uuid[])`,
    [ctx.org.id, pgArray(Array.from(from.keys()))],
  )).filter((i) => i.kind === "goods");
  if (!items.length) return { changed };
  const goodsFrom = new Map(items.map((i) => [i.id, from.get(i.id)!]));

  for (const id of await rederiveCounts(tx, ctx, goodsFrom, origin)) changed.add(`stock_doc:${id}`);
  if (opts.checkNegative !== false) await checkNegative(tx, ctx, items, goodsFrom);
  for (const key of await recomputeCosts(tx, ctx, items, goodsFrom)) changed.add(key);

  for (const key of changed) {
    const [type, id] = key.split(":");
    if (origin && origin.type === type && origin.id === id) continue;
    await refreshSource(tx, ctx, type, id);
  }
  return { changed };
}

// ---------------------------------------------------------------- negative stock

async function checkNegative(tx: Tx, ctx: Ctx, items: CostItem[], from: Map<string, string>) {
  if (orgAllowsNegative(ctx)) return;
  for (const item of items) {
    if (item.allow_negative) continue;
    const f = from.get(item.id)!;
    const opening = await tx.query<{ warehouse_id: string | null; q: string }>(
      `select warehouse_id, coalesce(sum(qty), 0) as q from tz_stock_moves where org_id = $1 and item_id = $2 and date < $3 group by warehouse_id`,
      [ctx.org.id, item.id, f],
    );
    const bal = new Map<string, Dec>(opening.map((o) => [o.warehouse_id ?? "", D(o.q)]));
    const rows = await tx.query<{ warehouse_id: string | null; date: string; qty: string }>(
      `select m.warehouse_id, m.date, m.qty from tz_stock_moves m where m.org_id = $1 and m.item_id = $2 and m.date >= $3 order by ${MOVE_ORDER}`,
      [ctx.org.id, item.id, f],
    );
    for (const r of rows) {
      const w = r.warehouse_id ?? "";
      const b = (bal.get(w) ?? D(0)).plus(D(r.qty));
      bal.set(w, b);
      if (b.isNeg() && D(r.qty).isNeg()) {
        const wh = r.warehouse_id ? await tx.one<{ name: string }>(`select name from tz_warehouses where id = $1`, [r.warehouse_id]) : null;
        throw bad(
          `موجودی «${item.name}»${wh ? ` در «${wh.name}»` : ""} کافی نیست: در تاریخ ${formatJalali(r.date)} به ${formatQty(b)} می‌رسد. ` +
            "اگر فروش بیش از موجودی مجاز است، آن را در تعریف کالا یا تنظیمات کسب‌وکار فعال کنید.",
          { item_id: item.id, warehouse_id: r.warehouse_id, date: r.date, balance: b.toString() },
        );
      }
    }
  }
}

// ---------------------------------------------------------------- costing

/** Recompute moving-average costs of `items` from their dates; returns changed sources. */
export async function recomputeCosts(tx: Tx, ctx: Ctx, items: CostItem[], from: Map<string, string>): Promise<Set<string>> {
  const dp = moneyDp(ctx);
  const changed = new Set<string>();
  const own = new Set<string>(OWN_SOURCES);
  for (const item of items) {
    const f = from.get(item.id)!;
    const open = await tx.one<{ q: string; v: string }>(
      `select coalesce(sum(qty), 0) as q, coalesce(sum(value), 0) as v from tz_stock_moves where org_id = $1 and item_id = $2 and date < $3`,
      [ctx.org.id, item.id, f],
    );
    let Q = D(open?.q ?? 0);
    let V = D(open?.v ?? 0);
    let lastAvg: Dec;
    if (Q.gt(0)) lastAvg = V.div(Q);
    else {
      const last = await tx.one<{ unit_cost: string }>(
        `select m.unit_cost from tz_stock_moves m where m.org_id = $1 and m.item_id = $2 and m.date < $3 and m.unit_cost > 0
         order by m.date desc, m.seq desc, m.created_at desc, m.source_id desc, m.id desc limit 1`,
        [ctx.org.id, item.id, f],
      );
      lastAvg = D(last?.unit_cost ?? item.purchase_price ?? 0);
    }
    const moves = await tx.query<{
      id: string; qty: string; unit_cost: string; value: string; fixed_cost: boolean; source_type: string; source_id: string;
      source_line_id: string | null; inv_kind: string | null; ref_invoice_id: string | null;
    }>(
      `select m.id, m.qty, m.unit_cost, m.value, m.fixed_cost, m.source_type, m.source_id, m.source_line_id,
              i.kind as inv_kind, i.ref_invoice_id
       from tz_stock_moves m
       left join tz_invoices i on m.source_type = 'invoice' and i.id = m.source_id
       where m.org_id = $1 and m.item_id = $2 and m.date >= $3
       order by ${MOVE_ORDER}`,
      [ctx.org.id, item.id, f],
    );
    if (!moves.length) continue;

    // per-source running totals (a sale return takes the cost of its original sale)
    const bySource = new Map<string, { q: Dec; v: Dec }>();
    const refs = Array.from(new Set(moves.filter((m) => m.inv_kind === "sale_return" && m.ref_invoice_id).map((m) => m.ref_invoice_id!)));
    if (refs.length) {
      const pre = await tx.query<{ source_id: string; q: string; v: string }>(
        `select source_id, sum(qty) as q, sum(value) as v from tz_stock_moves
         where org_id = $1 and item_id = $2 and date < $3 and source_id = any($4::uuid[]) group by source_id`,
        [ctx.org.id, item.id, f, pgArray(refs)],
      );
      for (const p of pre) bySource.set(p.source_id, { q: D(p.q), v: D(p.v) });
    }
    const outByLine = new Map<string, Dec>();
    const updates: { id: string; unit_cost: string; value: string }[] = [];

    for (const m of moves) {
      const q = D(m.qty);
      const avgNow = Q.gt(0) ? V.div(Q) : lastAvg;
      let value: Dec;
      const updatable = own.has(m.source_type) && !m.fixed_cost && !q.isZero();
      if (!updatable) {
        value = D(m.value);
      } else if (q.gt(0)) {
        const partner = outByLine.get(`${m.source_id}|${m.source_line_id ?? ""}`);
        const ref = m.inv_kind === "sale_return" && m.ref_invoice_id ? bySource.get(m.ref_invoice_id) : undefined;
        if (partner) value = partner.neg(); // transfer: the incoming side carries the outgoing value
        else if (ref && !ref.q.isZero()) value = q.times(ref.v.div(ref.q).abs()).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
        else value = q.times(avgNow).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
      } else {
        // the last units take the remaining value, so no residue stays on an empty item
        if (Q.gt(0) && Q.plus(q).isZero()) value = V.neg();
        else value = q.times(avgNow).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
        if (m.source_type === "stock_doc") outByLine.set(`${m.source_id}|${m.source_line_id ?? ""}`, value);
      }
      if (updatable) {
        const unit = value.div(q).abs().toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
        if (!value.eq(D(m.value)) || !unit.eq(D(m.unit_cost))) {
          updates.push({ id: m.id, unit_cost: unit.toString(), value: value.toString() });
          changed.add(`${m.source_type}:${m.source_id}`);
        }
      }
      Q = Q.plus(q);
      V = V.plus(value);
      if (Q.gt(0)) lastAvg = V.div(Q);
      const s = bySource.get(m.source_id) ?? { q: D(0), v: D(0) };
      bySource.set(m.source_id, { q: s.q.plus(q), v: s.v.plus(value) });
    }

    for (let i = 0; i < updates.length; i += 1000) {
      const chunk = updates.slice(i, i + 1000);
      await tx.query(
        `update tz_stock_moves m set unit_cost = x.unit_cost, value = x.value
         from (select unnest($1::uuid[]) as id, unnest($2::numeric[]) as unit_cost, unnest($3::numeric[]) as value) x
         where m.id = x.id`,
        [pgArray(chunk.map((u) => u.id)), pgArray(chunk.map((u) => u.unit_cost)), pgArray(chunk.map((u) => u.value))],
      );
    }
  }
  return changed;
}

// ---------------------------------------------------------------- stock counts

interface CountDoc {
  id: string;
  date: string;
  created_at: string;
  warehouse_id: string | null;
}

/**
 * Write the correction moves of a stock count: for each counted line, correction = counted −
 * system quantity, where the system quantity is the balance of the warehouse just before the
 * count (canonical order). Updates line figures and moves only where they changed; with
 * `writeMoves: false` (draft counts) only the line figures.
 */
export async function deriveCount(
  tx: Tx,
  ctx: Ctx,
  doc: CountDoc,
  onlyItems?: Set<string>,
  opts: { writeMoves?: boolean } = {},
): Promise<{ changed: boolean; touches: Touch[] }> {
  const writeMoves = opts.writeMoves !== false;
  if (!doc.warehouse_id) throw bad("انبار برگه‌ی انبارگردانی مشخص نیست");
  const lines = await tx.query<{ id: string; item_id: string; counted_qty: string | null; system_qty: string | null; qty: string }>(
    `select l.id, l.item_id, l.counted_qty, l.system_qty, l.qty from tz_stock_lines l join tz_items i on i.id = l.item_id
     where l.doc_id = $1 and i.kind = 'goods' order by l.line_no`,
    [doc.id],
  );
  const moves = await tx.query<{ id: string; source_line_id: string; qty: string }>(
    `select id, source_line_id, qty from tz_stock_moves where org_id = $1 and source_id = $2`,
    [ctx.org.id, doc.id],
  );
  const moveOf = new Map(moves.map((m) => [m.source_line_id, m]));
  let changed = false;
  const touches: Touch[] = [];
  for (const l of lines) {
    if (onlyItems && !onlyItems.has(l.item_id)) continue;
    const sys = await tx.one<{ q: string }>(
      `select coalesce(sum(m.qty), 0) as q from tz_stock_moves m
       where m.org_id = $1 and m.item_id = $2 and m.warehouse_id = $3 and m.source_id <> $4
         and (m.date, m.seq, m.created_at, m.source_id) < ($5::date, ${SEQ.count}, $6::timestamptz, $4::uuid)`,
      [ctx.org.id, l.item_id, doc.warehouse_id, doc.id, doc.date, doc.created_at],
    );
    const system = D(sys?.q ?? 0);
    const diff = D(l.counted_qty ?? 0).minus(system);
    if (l.system_qty === null || !D(l.system_qty).eq(system) || !D(l.qty).eq(diff)) {
      await tx.query(`update tz_stock_lines set system_qty = $2, qty = $3, base_qty = $3 where id = $1`, [l.id, system.toString(), diff.toString()]);
      changed = true;
    }
    if (!writeMoves) continue; // draft count: figures only
    const mv = moveOf.get(l.id);
    if (diff.isZero()) {
      if (mv) {
        await tx.query(`delete from tz_stock_moves where id = $1`, [mv.id]);
        changed = true;
        touches.push({ item_id: l.item_id, date: doc.date });
      }
    } else if (mv) {
      if (!D(mv.qty).eq(diff)) {
        await tx.query(`update tz_stock_moves set qty = $2 where id = $1`, [mv.id, diff.toString()]);
        changed = true;
        touches.push({ item_id: l.item_id, date: doc.date });
      }
    } else {
      await insertMany(tx, "tz_stock_moves", [{
        id: uuidv7(), org_id: ctx.org.id, item_id: l.item_id, warehouse_id: doc.warehouse_id, date: doc.date, seq: SEQ.count,
        qty: diff.toString(), unit_cost: "0", value: "0", fixed_cost: false, source_type: "stock_doc", source_id: doc.id,
        source_line_id: l.id, created_at: doc.created_at,
      }]);
      changed = true;
      touches.push({ item_id: l.item_id, date: doc.date });
    }
  }
  return { changed, touches };
}

/** Re-derive posted stock counts dated on/after the change that contain affected items. */
async function rederiveCounts(tx: Tx, ctx: Ctx, from: Map<string, string>, origin?: { type: string; id: string }): Promise<string[]> {
  const minDate = Array.from(from.values()).sort()[0];
  const docs = await tx.query<CountDoc>(
    `select distinct d.id, d.date, d.created_at, d.warehouse_id from tz_stock_docs d join tz_stock_lines l on l.doc_id = d.id
     where d.org_id = $1 and d.kind = 'count' and d.status = 'posted' and d.deleted_at is null and d.date >= $2
       and l.item_id = any($3::uuid[])
     order by d.date, d.created_at, d.id`,
    [ctx.org.id, minDate, pgArray(Array.from(from.keys()))],
  );
  const out: string[] = [];
  for (const d of docs) {
    if (origin && origin.type === "stock_doc" && origin.id === d.id) continue;
    const only = new Set(Array.from(from.entries()).filter(([, date]) => date <= d.date).map(([id]) => id));
    if (!only.size) continue;
    // changed counts are re-posted and touched by the caller (refreshSource)
    if ((await deriveCount(tx, ctx, d, only)).changed) out.push(d.id);
  }
  return out;
}

/** Full recompute (maintenance): every goods item, or one, from its first move. */
export async function recomputeAll(tx: Tx, ctx: Ctx, itemId?: string | null): Promise<{ items: number; documents: number }> {
  const rows = await tx.query<{ item_id: string; date: string }>(
    `select m.item_id, min(m.date) as date from tz_stock_moves m join tz_items i on i.id = m.item_id
     where m.org_id = $1 and i.kind = 'goods' ${itemId ? "and m.item_id = $2" : ""} group by m.item_id`,
    itemId ? [ctx.org.id, itemId] : [ctx.org.id],
  );
  const r = await afterStockChange(tx, ctx, rows.map((x) => ({ item_id: x.item_id, date: x.date })), undefined, { checkNegative: false });
  return { items: rows.length, documents: r.changed.size };
}

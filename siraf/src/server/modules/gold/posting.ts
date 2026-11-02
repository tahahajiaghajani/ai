// Posting of gold documents: piece bookkeeping (tags created, sold, returned, melted), coin
// stock moves and the automatic voucher. Weights are 750-equivalent grams in w_debit/w_credit;
// rial costs come from the piece's own cost or from the average rial-per-gram of the account
// in the ledger (falling back to the document's gram18 price).
//
// applyDoc() runs when a document becomes posted (or is re-posted after an edit) and
// unapplyDoc() undoes it (cancel, delete, edit). Both run inside the caller's transaction.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { insertMany, insertRow, updateRow } from "../../db/sql";
import { bad, conflict } from "../../http/errors";
import { D, type Num } from "@shared/money";
import { faDigits, formatWeight } from "@shared/format";
import { uuidv7 } from "@shared/id";
import { accountByKey, cr, dr, postAuto, removeAuto, signed, type VoucherLineInput } from "../accounting/vouchers";
import { KINDS, bulkAccountKey, roundTo, type DocKind, type Direction, type LineKind } from "./pricing";
import { assertCoinStock, coinStock, defaultWarehouse, nextTagNo, tagTaken, ITEM_STATUS_TITLES, type GoldItemRow } from "./items";
import { barBySerial, barNoTaken, barStatusTitle, nextBarNo, normalizeBrand, type BarRow } from "./bars";
import { pureWeight } from "@shared/gold";
import { goldSettings, moneyStep } from "./settings";
import { latestRate } from "./rates";

type Decimal = ReturnType<typeof D>;

export interface SettleMoney {
  cash_box_id?: string | null;
  pos_id?: string | null;
  bank_account_id?: string | null;
  amount: string;
  ref_no?: string | null;
}

export interface Settle {
  mode?: "rial" | "weight";
  cash?: SettleMoney | null;
  pos?: SettleMoney | null;
  bank?: SettleMoney | null;
  /** computed: rial amount to settle, paid now, left on the party's account */
  due?: string;
  paid?: string;
  remaining?: string;
  /** workshop_in: 750-weight taken off the workshop's account (default: what came back) */
  consumed_weight750?: string | null;
  /** workshop_in: take the workshop's whole weight balance (the rest is loss) */
  close_workshop?: boolean;
}

export interface DocRow {
  id: string;
  org_id: string;
  fiscal_year_id: string;
  kind: DocKind;
  no: number;
  date: string;
  party_id: string | null;
  gram18: string | null;
  mazaneh: string | null;
  status: "draft" | "posted" | "cancelled";
  gold_value: string;
  wage: string;
  profit: string;
  tax: string;
  stone: string;
  discount: string;
  old_value: string;
  total: string;
  weight_out: string;
  weight_in: string;
  settle: Settle;
  buyer: Record<string, unknown>;
  moadian: Record<string, unknown>;
  extra?: Record<string, unknown>;
  description: string | null;
  voucher_id: string | null;
  created_by: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface LineRow {
  id: string;
  doc_id: string;
  org_id: string;
  line_no: number;
  kind: LineKind;
  direction: Direction;
  gold_item_id: string | null;
  gold_bar_id?: string | null;
  item_id: string | null;
  category_id: string | null;
  title: string | null;
  form: string | null;
  qty: string;
  fineness: string | null;
  weight: string;
  weight750: string;
  stone_weight: string | null;
  gram_price: string | null;
  gold_value: string;
  wage_type: string | null;
  wage_value: string | null;
  wage: string;
  profit_pct: string | null;
  profit: string;
  tax: string;
  stone: string;
  deduction_pct: string | null;
  discount: string;
  total: string;
  assay_no: string | null;
  description: string | null;
  cost: string | null;
  tag_no: string | null;
  extra: Record<string, unknown>;
}

/** Rial amount settled with cash/card/bank or the party's account (see posting rules). */
export function settleDue(kind: DocKind, mode: string | undefined, lines: Pick<LineRow, "kind" | "direction" | "total" | "gold_value">[]): Decimal {
  const sum = (f: (l: (typeof lines)[number]) => boolean, pick: (l: (typeof lines)[number]) => Num) =>
    lines.filter(f).reduce((a, l) => a.plus(D(pick(l))), D(0));
  switch (kind) {
    case "sale":
      return sum((l) => l.direction === "out", (l) => l.total).minus(sum((l) => l.direction === "in", (l) => l.total));
    case "purchase": {
      const total = sum(() => true, (l) => l.total);
      return mode === "weight" ? total.minus(sum((l) => l.kind !== "coin", (l) => l.gold_value)) : total;
    }
    case "buyback":
    case "workshop_in":
      return sum(() => true, (l) => l.total);
    case "bullion_sale":
      return mode === "weight" ? D(0) : sum(() => true, (l) => l.total);
    default:
      return D(0);
  }
}

interface PartyInfo {
  id: string;
  name: string;
  detail_id: string;
}

interface ConsignTerms {
  mode: "rial" | "weight";
  wage_type: string | null;
  wage_value: string | null;
  supplier_id: string;
}

const statusTitle = (s: string) => ITEM_STATUS_TITLES[s] ?? s;

class Posting {
  private v: VoucherLineInput[] = [];
  private dp: number;
  private step: string;
  private avgCache = new Map<string, Decimal | null>();
  private outItems = new Map<string, GoldItemRow>();
  private outBars = new Map<string, BarRow>();
  private partyRow: PartyInfo | null | undefined;
  private fallbackG18: Decimal | null | undefined;

  constructor(
    private tx: Tx,
    private ctx: Ctx,
    private doc: DocRow,
    private lines: LineRow[],
  ) {
    this.dp = ctx.org.money_decimals ?? 0;
    this.step = moneyStep(goldSettings(ctx.org), this.dp);
  }

  private get orgId() {
    return this.ctx.org.id;
  }
  private acc(key: string) {
    return accountByKey(this.tx, this.orgId, key);
  }
  private m(x: Num): string {
    return D(x).toDecimalPlaces(this.dp).toString();
  }
  private get label() {
    return `${KINDS[this.doc.kind].title} ش ${faDigits(this.doc.no)}`;
  }

  private async push(key: string, side: "dr" | "cr" | "signed", amount: Num, extra: Omit<VoucherLineInput, "account_id" | "debit" | "credit"> = {}) {
    const id = await this.acc(key);
    const e = { description: this.label, ...extra };
    this.v.push(side === "dr" ? dr(id, this.m(amount), e) : side === "cr" ? cr(id, this.m(amount), e) : signed(id, this.m(amount), e));
  }

  private async party(required = false): Promise<PartyInfo | null> {
    if (this.partyRow === undefined) {
      this.partyRow = this.doc.party_id
        ? await this.tx.one<PartyInfo>(`select id, name, detail_id from tz_parties where id = $1 and org_id = $2`, [this.doc.party_id, this.orgId])
        : null;
    }
    if (required && !this.partyRow) throw bad(`${KINDS[this.doc.kind].partyLabel || "طرف حساب"} را انتخاب کنید`);
    if (this.partyRow && !this.partyRow.detail_id) throw bad(`حساب تفصیلی «${this.partyRow.name}» ساخته نشده است`);
    return this.partyRow;
  }

  private async partyById(id: string): Promise<PartyInfo> {
    const p = await this.tx.one<PartyInfo>(`select id, name, detail_id from tz_parties where id = $1 and org_id = $2`, [id, this.orgId]);
    if (!p || !p.detail_id) throw bad("تأمین‌کننده‌ی جنس امانی پیدا نشد");
    return p;
  }

  /** gram18 for valuations when the ledger has no average: the document's, else the latest rate. */
  private async g18(): Promise<Decimal> {
    if (this.doc.gram18 && D(this.doc.gram18).gt(0)) return D(this.doc.gram18);
    if (this.fallbackG18 === undefined) {
      const r = await latestRate(this.tx, this.orgId);
      this.fallbackG18 = r?.gram18 && D(r.gram18).gt(0) ? D(r.gram18) : null;
    }
    if (!this.fallbackG18) throw bad("برای ارزش‌گذاری طلا، قیمت گرم ۱۸ عیار را در سند وارد کنید (یا در تابلوی قیمت ثبت کنید)");
    return this.fallbackG18;
  }

  /** Average rial per 750-gram of an account (optionally one detail) before this document. */
  private async ledgerBalance(key: string, detailId?: string | null) {
    const accountId = await this.acc(key);
    const r = await this.tx.one<{ r: string; w: string }>(
      `select coalesce(sum(l.debit - l.credit), 0) as r, coalesce(sum(l.w_debit - l.w_credit), 0) as w
       from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id
       where l.org_id = $1 and l.account_id = $2 and v.deleted_at is null and v.status in ('posted','final')
         and v.fiscal_year_id = $3 and v.date <= $4 and v.kind not in ('closing','temp_closing')
         and not (coalesce(v.source_type, '') = 'gold_doc' and v.source_id = $5)
         ${detailId ? "and l.detail_id = $6" : ""}`,
      detailId ? [this.orgId, accountId, this.doc.fiscal_year_id, this.doc.date, this.doc.id, detailId] : [this.orgId, accountId, this.doc.fiscal_year_id, this.doc.date, this.doc.id],
    );
    return { rial: D(r?.r ?? 0), w: D(r?.w ?? 0) };
  }

  private async avg(key: string, detailId?: string | null): Promise<Decimal | null> {
    const k = `${key}:${detailId ?? ""}`;
    if (!this.avgCache.has(k)) {
      const b = await this.ledgerBalance(key, detailId);
      this.avgCache.set(k, b.w.gt(0) && b.rial.gt(0) ? b.rial.div(b.w) : null);
    }
    return this.avgCache.get(k)!;
  }

  /** Cost of 750-weight taken out of an account: weight × ledger average (else × gram18). */
  private async costOf(key: string, w750: Num, detailId?: string | null): Promise<string> {
    const a = (await this.avg(key, detailId)) ?? (key === "gold_at_workshop" ? await this.avg("gold_old") : null) ?? (await this.g18());
    return this.m(D(w750).times(a));
  }

  // ------------------------------------------------------------ pieces

  /** Pieces that leave the shop: checked and marked sold / returned / melted. */
  private async consumePieces() {
    const outs = this.lines.filter((l) => l.kind === "piece" && l.direction === "out");
    if (!outs.length) return;
    const ids = outs.map((l) => l.gold_item_id).filter(Boolean) as string[];
    const rows = await this.tx.query<GoldItemRow>(
      `select * from tz_gold_items where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`,
      [this.orgId, `{${ids.join(",")}}`],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const next = this.doc.kind === "sale" ? "sold" : this.doc.kind === "consign_return" ? "returned" : "melted";
    for (const l of outs) {
      const it = l.gold_item_id ? byId.get(l.gold_item_id) : undefined;
      if (!it) throw bad(`ردیف ${faDigits(l.line_no)}: جنس با اتیکت «${l.tag_no ?? ""}» پیدا نشد`);
      const okStatus = it.status === "in_stock" || (this.doc.kind === "sale" && it.status === "reserved");
      if (!okStatus) throw conflict(`اتیکت ${faDigits(it.tag_no)} «${statusTitle(it.status)}» است و در این سند قابل استفاده نیست`);
      if (this.doc.kind === "consign_return") {
        if (it.ownership !== "consignment") throw bad(`اتیکت ${faDigits(it.tag_no)} امانی نیست`);
        if (it.supplier_id && it.supplier_id !== this.doc.party_id) throw bad(`اتیکت ${faDigits(it.tag_no)} امانیِ همکار دیگری است`);
      }
      if (this.doc.kind === "melt" && it.ownership !== "own") throw bad(`اتیکت ${faDigits(it.tag_no)} امانی است و ذوب نمی‌شود`);
      this.outItems.set(it.id, it);
      await this.tx.query(`update tz_gold_items set status = $3, out_doc_id = $4, origin = $5 where id = $1 and org_id = $2`, [
        it.id, this.orgId, next, this.doc.id, this.ctx.cfg.origin,
      ]);
    }
  }

  /** Pieces that come in (purchase, consignment, workshop, opening): their tags are created. */
  private async createPieces() {
    const ins = this.lines.filter((l) => l.kind === "piece" && l.direction === "in");
    if (!ins.length) return;
    const party = this.doc.kind === "opening" ? null : await this.party(true);
    const wh = await defaultWarehouse(this.tx, this.orgId);
    const cats = new Map(
      (await this.tx.query<{ id: string; wage_type: string; wage_value: string; profit_pct: string | null }>(
        `select id, wage_type, wage_value, profit_pct from tz_gold_categories where org_id = $1`,
        [this.orgId],
      )).map((c) => [c.id, c]),
    );
    for (const l of ins) {
      const x = (l.extra ?? {}) as Record<string, string | null | undefined>;
      const cat = l.category_id ? cats.get(l.category_id) : undefined;
      const fields = {
        category_id: l.category_id,
        title: l.title,
        fineness: l.fineness ?? "750",
        gross_weight: D(l.weight).plus(D(l.stone_weight ?? 0)).toDecimalPlaces(3).toString(),
        stone_weight: D(l.stone_weight ?? 0).toDecimalPlaces(3).toString(),
        net_weight: D(l.weight).toDecimalPlaces(3).toString(),
        wage_type: x.sale_wage_type || cat?.wage_type || "percent",
        wage_value: D(x.sale_wage_value ?? cat?.wage_value ?? 0).toString(),
        profit_pct: x.sale_profit_pct !== undefined && x.sale_profit_pct !== null && x.sale_profit_pct !== "" ? D(x.sale_profit_pct).toString() : cat?.profit_pct ?? null,
        stone_desc: x.stone_desc || null,
        stone_price: D(x.sale_stone_price ?? l.stone ?? 0).toString(),
        supplier_id: party?.id ?? null,
        ownership: this.doc.kind === "consign_in" ? "consignment" : "own",
        status: "in_stock",
        warehouse_id: wh,
        cost: this.doc.kind === "consign_in" ? null : l.cost,
        in_doc_id: this.doc.id,
        out_doc_id: null,
        notes: l.description,
        origin: this.ctx.cfg.origin,
      };
      const existing = l.gold_item_id
        ? await this.tx.one<GoldItemRow & { deleted_at: string | null }>(`select * from tz_gold_items where id = $1 and org_id = $2`, [l.gold_item_id, this.orgId])
        : null;
      if (existing && existing.in_doc_id === this.doc.id) {
        // re-posting: the piece keeps its tag unless someone took it meanwhile
        let tag = l.tag_no && l.tag_no !== existing.tag_no ? l.tag_no : existing.tag_no;
        if (await tagTaken(this.tx, this.orgId, tag, existing.id)) {
          if (l.tag_no && l.tag_no !== existing.tag_no) throw conflict(`اتیکت «${faDigits(tag)}» قبلاً ثبت شده است`);
          tag = String(await nextTagNo(this.tx, this.orgId));
        }
        await updateRow(this.tx, "tz_gold_items", { id: existing.id, org_id: this.orgId }, { ...fields, tag_no: tag, deleted_at: null });
        l.tag_no = tag;
        continue;
      }
      let tag = l.tag_no;
      if (tag) {
        if (await tagTaken(this.tx, this.orgId, tag)) throw conflict(`ردیف ${faDigits(l.line_no)}: اتیکت «${faDigits(tag)}» قبلاً ثبت شده است`);
      } else tag = String(await nextTagNo(this.tx, this.orgId));
      const id = uuidv7();
      await insertRow(this.tx, "tz_gold_items", { id, org_id: this.orgId, tag_no: tag, ...fields }, "id");
      l.gold_item_id = id;
      l.tag_no = tag;
    }
  }

  // ------------------------------------------------------------ bars

  /** Bars that leave the shop: checked and marked sold / returned / melted. */
  private async consumeBars() {
    const outs = this.lines.filter((l) => l.kind === "bar" && l.direction === "out");
    if (!outs.length) return;
    const ids = outs.map((l) => l.gold_bar_id).filter(Boolean) as string[];
    const rows = await this.tx.query<BarRow>(`select * from tz_gold_bars where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [this.orgId, `{${ids.join(",")}}`]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const kind = this.doc.kind;
    const next = kind === "sale" || kind === "bullion_sale" ? "sold" : kind === "consign_return" ? "returned" : "melted";
    for (const l of outs) {
      const b = l.gold_bar_id ? byId.get(l.gold_bar_id) : undefined;
      if (!b) throw bad(`ردیف ${faDigits(l.line_no)}: شمش «${l.tag_no ?? ""}» پیدا نشد`);
      const okStatus = b.status === "in_stock" || (kind === "sale" && b.status === "reserved");
      if (!okStatus) throw conflict(`شمش ${faDigits(b.bar_no)} «${barStatusTitle(b.status)}» است و در این سند قابل استفاده نیست`);
      if (kind === "consign_return") {
        if (b.ownership !== "consignment") throw bad(`شمش ${faDigits(b.bar_no)} امانی نیست`);
        if (b.party_id && b.party_id !== this.doc.party_id) throw bad(`شمش ${faDigits(b.bar_no)} امانیِ همکار دیگری است`);
      } else if (b.ownership === "customer" || (b.ownership === "consignment" && kind !== "sale")) {
        throw bad(`شمش ${faDigits(b.bar_no)} متعلق به ما نیست و در «${KINDS[kind].title}» به کار نمی‌رود`);
      }
      this.outBars.set(b.id, b);
      await this.tx.query(`update tz_gold_bars set status = $3, out_doc_id = $4, origin = $5 where id = $1 and org_id = $2`, [b.id, this.orgId, next, this.doc.id, this.ctx.cfg.origin]);
    }
  }

  /** Cost of a bar leaving the shop: its own cost, else the average of the bars account. */
  private async barCost(l: LineRow): Promise<string> {
    const b = this.outBars.get(l.gold_bar_id!)!;
    return b.cost !== null && b.cost !== undefined && D(b.cost).gt(0) ? this.m(b.cost) : this.costOf("gold_bars", l.weight750);
  }

  /** Bars leaving the bars account at their cost; `debitKey` takes the cost (cost of sales). */
  private async barsOut(lines: LineRow[], debitKey: "bar_cogs" | null) {
    let total = D(0);
    for (const l of lines) {
      l.cost = await this.barCost(l);
      total = total.plus(D(l.cost));
      await this.push("gold_bars", "cr", l.cost, {
        w_credit: l.weight750, fineness: l.fineness, raw_weight: l.weight,
        description: `شمش ${faDigits(l.tag_no ?? "")} — ${formatWeight(l.weight)} گرم عیار ${faDigits(D(l.fineness ?? 995).toString())} — ${this.label}`,
      });
    }
    if (debitKey && lines.length) await this.push(debitKey, "dr", total, { description: `بهای تمام‌شده‌ی شمش — ${this.label}` });
    return total;
  }

  /** Bars coming in at a cost (purchase, buy-back, trade-in, melt, opening). */
  private async barsIn(lines: LineRow[], cost: (l: LineRow) => string, what: string) {
    for (const l of lines) {
      l.cost = cost(l);
      await this.push("gold_bars", "dr", l.cost, {
        w_debit: l.weight750, fineness: l.fineness, raw_weight: l.weight, description: `${what} شمش ${formatWeight(l.weight)} گرم عیار ${faDigits(D(l.fineness ?? 995).toString())} — ${this.label}`,
      });
    }
  }

  /**
   * Bars that come in get a row in the register (or, bought back, their old row again — found
   * by the line or by brand + serial; its previous state is kept on the line for undo).
   */
  private async createBars() {
    const ins = this.lines.filter((l) => l.kind === "bar" && l.direction === "in");
    if (!ins.length) return;
    const kind = this.doc.kind;
    const party = kind === "opening" || kind === "melt" ? null : await this.party(kind === "purchase" || kind === "consign_in");
    const wh = await defaultWarehouse(this.tx, this.orgId);
    const docExtra = (this.doc.extra ?? {}) as Record<string, string>;
    const source = kind === "purchase" ? (docExtra.source === "ice" ? "ice" : docExtra.source === "public" ? "buyback" : "purchase") : kind === "consign_in" ? "consignment" : kind === "melt" ? "melt" : kind === "opening" ? "opening" : "buyback";
    for (const l of ins) {
      const x = ((l.extra ?? {}) as Record<string, unknown>);
      const a = ((x.bar ?? {}) as Record<string, string | undefined>);
      const fields = {
        item_id: l.item_id, brand: a.brand ? normalizeBrand(a.brand) : null, serial_no: a.serial_no ?? null, qr: a.qr ?? null,
        nominal_weight: a.nominal_weight ?? null, weight: D(l.weight).toString(), fineness: D(l.fineness ?? 995).toString(),
        fine_weight: pureWeight(l.weight, l.fineness ?? 995), weight750: D(l.weight750).toString(),
        certificate_no: a.certificate_no ?? null, certificate_issuer: a.certificate_issuer ?? null, assay_lab: a.assay_lab ?? null, assay_no: a.assay_no ?? l.assay_no ?? null,
        assay_date: a.assay_date ?? null, seal_status: a.seal_status ?? "sealed", source, source_ref: kind === "purchase" ? docExtra.auction_ref ?? null : null,
        ownership: kind === "consign_in" ? "consignment" : "own", party_id: party?.id ?? null, status: "in_stock", warehouse_id: wh,
        cost: kind === "consign_in" ? null : l.cost, in_doc_id: this.doc.id, out_doc_id: null, notes: l.description, origin: this.ctx.cfg.origin,
      };
      let existing: BarRow | null = l.gold_bar_id ? await this.tx.one<BarRow>(`select * from tz_gold_bars where id = $1 and org_id = $2 and deleted_at is null`, [l.gold_bar_id, this.orgId]) : null;
      if (!existing && a.serial_no) existing = await barBySerial(this.tx, this.orgId, a.brand, a.serial_no);
      if (existing && existing.in_doc_id !== this.doc.id) {
        if (existing.status === "in_stock" || existing.status === "reserved") {
          throw conflict(`ردیف ${faDigits(l.line_no)}: شمش با سریال «${a.serial_no ?? existing.serial_no ?? ""}» هم‌اکنون در موجودی است (شماره‌ی ${faDigits(existing.bar_no)})`);
        }
        // a bar we sold (or melted records of) comes back: its row is reused, the old state kept for undo
        x.prev_bar = { status: existing.status, in_doc_id: existing.in_doc_id, out_doc_id: existing.out_doc_id, cost: existing.cost, source: existing.source, ownership: existing.ownership, party_id: existing.party_id, seal_status: existing.seal_status, weight: existing.weight, fineness: existing.fineness, fine_weight: existing.fine_weight, weight750: existing.weight750 };
        await updateRow(this.tx, "tz_gold_bars", { id: existing.id, org_id: this.orgId }, { ...fields, brand: fields.brand ?? existing.brand, serial_no: fields.serial_no ?? existing.serial_no, item_id: fields.item_id ?? existing.item_id });
        l.gold_bar_id = existing.id;
        l.tag_no = existing.bar_no;
        l.extra = x;
        continue;
      }
      if (existing && existing.in_doc_id === this.doc.id) {
        // re-posting: the bar keeps its number unless someone took it meanwhile
        let no = a.bar_no && a.bar_no !== existing.bar_no ? a.bar_no : existing.bar_no;
        if (await barNoTaken(this.tx, this.orgId, no, existing.id)) {
          if (a.bar_no && a.bar_no !== existing.bar_no) throw conflict(`شماره‌ی شمش «${faDigits(no)}» قبلاً ثبت شده است`);
          no = String(await nextBarNo(this.tx, this.orgId));
        }
        await updateRow(this.tx, "tz_gold_bars", { id: existing.id, org_id: this.orgId }, { ...fields, bar_no: no, deleted_at: null });
        l.tag_no = no;
        continue;
      }
      let no = a.bar_no;
      if (no) {
        if (await barNoTaken(this.tx, this.orgId, no)) throw conflict(`ردیف ${faDigits(l.line_no)}: شماره‌ی شمش «${faDigits(no)}» قبلاً ثبت شده است`);
      } else no = String(await nextBarNo(this.tx, this.orgId));
      const id = uuidv7();
      await insertRow(this.tx, "tz_gold_bars", { id, org_id: this.orgId, bar_no: no, ...fields }, "id");
      l.gold_bar_id = id;
      l.tag_no = no;
    }
  }

  /** Selling a consigned bar: the memo comes off and its owner is owed (by weight or in rial). */
  private async consignedBarSale(l: LineRow, b: BarRow) {
    const r = await this.tx.one<{ mode: string | null; party_id: string | null }>(
      `select d.settle->>'mode' as mode, d.party_id from tz_gold_lines gl join tz_gold_docs d on d.id = gl.doc_id
       where gl.org_id = $1 and gl.gold_bar_id = $2 and d.kind = 'consign_in' and d.status = 'posted' and d.deleted_at is null
       order by d.date desc, d.created_at desc limit 1`,
      [this.orgId, b.id],
    );
    const supplier = r?.party_id ?? b.party_id;
    if (!supplier) throw bad(`امانت‌گذارِ شمش ${faDigits(b.bar_no)} مشخص نیست`);
    const sup = await this.partyById(supplier);
    const gold = D(l.gold_value);
    l.cost = this.m(gold);
    const tag = `شمش ${faDigits(b.bar_no)}`;
    await this.push("gold_consign_contra", "dr", 0, { w_debit: l.weight750, detail_id: sup.detail_id, description: `فروش امانی ${tag} — ${this.label}` });
    await this.push("gold_consign_memo", "cr", 0, { w_credit: l.weight750, detail_id: sup.detail_id, description: `فروش امانی ${tag} — ${this.label}` });
    await this.push("bar_cogs", "dr", l.cost, { description: `بهای امانی ${tag} — ${sup.name}` });
    if (r?.mode === "rial") await this.push("ap", "cr", l.cost, { detail_id: sup.detail_id, description: `بهای امانی ${tag}` });
    else await this.push("gold_parties", "cr", gold, { w_credit: l.weight750, detail_id: sup.detail_id, fineness: l.fineness, raw_weight: l.weight, description: `بدهی وزنی بابت امانی ${tag}` });
  }

  // ------------------------------------------------------------ coins

  /** Average cost of sold coins (with a stock check) and the coin stock moves of the document. */
  private async coinCosts() {
    const coins = this.lines.filter((l) => l.kind === "coin");
    if (!coins.length) return;
    const taken = new Map<string, Decimal>();
    for (const l of coins) {
      if (l.direction === "in") {
        l.cost = this.m(l.total);
        continue;
      }
      const s = await coinStock(this.tx, this.orgId, l.item_id!, this.doc.date, this.doc.id);
      const before = taken.get(l.item_id!) ?? D(0);
      const left = s.qty.minus(before);
      if (left.lt(D(l.qty))) {
        const name = (await this.tx.one<{ name: string }>(`select name from tz_items where id = $1`, [l.item_id]))?.name ?? "";
        throw bad(`موجودی «${name}» کافی نیست (موجود: ${faDigits(left.toString())} عدد)؛ خرید یا موجودی اول دوره‌ی سکه را ثبت کنید`);
      }
      taken.set(l.item_id!, before.plus(D(l.qty)));
      l.cost = this.m(D(l.qty).times(s.avg ?? 0));
    }
  }

  private async writeCoinMoves() {
    await this.tx.query(`delete from tz_stock_moves where org_id = $1 and source_id = $2`, [this.orgId, this.doc.id]);
    const coins = this.lines.filter((l) => l.kind === "coin");
    if (!coins.length) return;
    const wh = await defaultWarehouse(this.tx, this.orgId);
    await insertMany(
      this.tx,
      "tz_stock_moves",
      coins.map((l) => {
        const sign = l.direction === "in" ? 1 : -1;
        const qty = D(l.qty);
        const value = D(l.cost ?? 0);
        return {
          id: uuidv7(),
          org_id: this.orgId,
          item_id: l.item_id,
          warehouse_id: wh,
          date: this.doc.date,
          seq: l.line_no,
          qty: qty.times(sign).toString(),
          unit_cost: qty.isZero() ? "0" : value.div(qty).toDecimalPlaces(6).toString(),
          value: value.times(sign).toString(),
          fixed_cost: true,
          source_type: "gold_doc",
          source_id: this.doc.id,
          source_line_id: l.id,
        };
      }),
    );
  }

  /** Coins out (cost of sales, or `null`: cost carried on, e.g. melted) and coins in, with their count. */
  private async coinLines(outDebit: "coin_cogs" | null) {
    const coins = this.lines.filter((l) => l.kind === "coin");
    if (!coins.length) return;
    const outs = coins.filter((l) => l.direction === "out");
    if (outs.length && outDebit) await this.push(outDebit, "dr", outs.reduce((a, l) => a.plus(D(l.cost ?? 0)), D(0)), { description: `بهای تمام‌شده‌ی سکه — ${this.label}` });
    for (const l of coins) {
      const e = { qty: l.qty, item_id: l.item_id, description: `${l.title ?? "سکه"} × ${faDigits(D(l.qty).toString())}${l.direction === "in" && this.doc.kind === "sale" ? " — دریافتی از مشتری" : ""}` };
      if (l.direction === "out") await this.push("coin_inventory", "cr", l.cost ?? 0, e);
      else await this.push("coin_inventory", "dr", l.cost ?? l.total, e);
    }
  }

  // ------------------------------------------------------------ settlement

  /**
   * Cash / card / bank and the rest on the party's account. `dir` receive: the party pays us;
   * pay: we pay the party. A negative due flips the direction (e.g. trade-in worth more than
   * the purchase).
   */
  private async settlement(due: Decimal, dir: "receive" | "pay", partyKey: "ar" | "ap") {
    const s = this.doc.settle ?? {};
    const sign = (dir === "receive" ? 1 : -1) * (due.isNeg() ? -1 : 1);
    let paid = D(0);
    if (s.cash && D(s.cash.amount).gt(0)) {
      const box = await this.tx.one<{ name: string; detail_id: string | null }>(`select name, detail_id from tz_cash_boxes where id = $1 and org_id = $2`, [s.cash.cash_box_id, this.orgId]);
      if (!box?.detail_id) throw bad("صندوق پیدا نشد");
      await this.push("cash", "signed", D(s.cash.amount).times(sign), { detail_id: box.detail_id, description: `${this.label} — نقد` });
      paid = paid.plus(D(s.cash.amount));
    }
    if (s.pos && D(s.pos.amount).gt(0)) {
      const pos = await this.tx.one<{ name: string; detail_id: string | null }>(
        `select p.name, b.detail_id from tz_pos_terminals p join tz_bank_accounts b on b.id = p.bank_account_id where p.id = $1 and p.org_id = $2`,
        [s.pos.pos_id, this.orgId],
      );
      if (!pos?.detail_id) throw bad("کارتخوان یا حساب بانکی متصل به آن پیدا نشد");
      await this.push("bank", "signed", D(s.pos.amount).times(sign), { detail_id: pos.detail_id, description: `${this.label} — کارتخوان ${pos.name}` });
      paid = paid.plus(D(s.pos.amount));
    }
    if (s.bank && D(s.bank.amount).gt(0)) {
      const bank = await this.tx.one<{ name: string; detail_id: string | null }>(`select name, detail_id from tz_bank_accounts where id = $1 and org_id = $2`, [s.bank.bank_account_id, this.orgId]);
      if (!bank?.detail_id) throw bad("حساب بانکی پیدا نشد");
      await this.push("bank", "signed", D(s.bank.amount).times(sign), { detail_id: bank.detail_id, description: `${this.label} — واریز ${bank.name}${s.bank.ref_no ? ` (${s.bank.ref_no})` : ""}` });
      paid = paid.plus(D(s.bank.amount));
    }
    const remaining = due.abs().minus(paid);
    if (remaining.isNeg()) throw bad("مبلغ پرداختی از مبلغ سند بیشتر است");
    if (!remaining.isZero()) {
      const party = await this.party();
      if (!party) throw bad(`برای ماندن مبلغ ${faDigits(this.m(remaining))} به حساب، ${KINDS[this.doc.kind].partyLabel || "طرف حساب"} را انتخاب کنید`);
      await this.push(partyKey, "signed", remaining.times(sign), { detail_id: party.detail_id, description: `${this.label} — مانده به حساب ${party.name}` });
    }
  }

  // ------------------------------------------------------------ kinds

  private async sale() {
    const gold = this.lines.filter((l) => l.direction === "out" && (l.kind === "piece" || l.kind === "bulk"));
    const coinsOut = this.lines.filter((l) => l.direction === "out" && l.kind === "coin");
    const barsOut = this.lines.filter((l) => l.direction === "out" && l.kind === "bar");
    const sum = (pick: (l: LineRow) => Num, ls = gold) => ls.reduce((a, l) => a.plus(D(pick(l))), D(0));
    // revenue: a discount comes off the seller's profit first, then off the wage (coins priced
    // by weight likewise; a board coin's discount comes off its price)
    const weighted = [...gold, ...coinsOut.filter((l) => !D(l.wage).isZero() || !D(l.profit).isZero())];
    const profit = sum((l) => l.profit, weighted);
    const wage = sum((l) => l.wage, weighted);
    const discount = sum((l) => l.discount, weighted);
    const offProfit = Decimal_min(discount, profit);
    const offWage = discount.minus(offProfit);
    await this.push("gold_sales", "cr", sum((l) => l.gold_value));
    await this.push("gold_wage_income", "signed", wage.minus(offWage).neg());
    await this.push("gold_profit_income", "signed", profit.minus(offProfit).neg());
    await this.push("vat_out", "cr", sum((l) => l.tax, [...gold, ...coinsOut, ...barsOut]));
    await this.push("stone_sales", "cr", sum((l) => l.stone));
    const coinRevenue = coinsOut.reduce((a, l) => {
      const w = !D(l.wage).isZero() || !D(l.profit).isZero();
      return a.plus(w ? D(l.gold_value) : D(l.total).minus(D(l.tax)));
    }, D(0));
    if (coinsOut.length) await this.push("coin_sales", "cr", coinRevenue, { description: `فروش سکه — ${this.label}` });
    if (barsOut.length) await this.push("bar_sales", "cr", sum((l) => D(l.total).minus(D(l.tax)), barsOut), { description: `فروش شمش — ${this.label}` });
    // what the customer trades in: used gold, coins and bars
    for (const l of this.lines.filter((x) => x.kind === "old")) {
      l.cost = this.m(l.total);
      await this.push("gold_old", "dr", l.total, { w_debit: l.weight750, fineness: l.fineness, raw_weight: l.weight, description: `طلای مستعمل دریافتی — ${this.label}` });
    }
    await this.barsIn(this.lines.filter((x) => x.kind === "bar" && x.direction === "in"), (l) => this.m(l.total), "دریافت");
    await this.settlement(settleDue("sale", undefined, this.lines), "receive", "ar");

    // cost of what was sold
    let ownCost = D(0);
    let ownW = D(0);
    let ownRaw = D(0);
    for (const l of gold.filter((x) => x.kind === "piece")) {
      const it = this.outItems.get(l.gold_item_id!)!;
      if (it.ownership === "consignment") {
        await this.consignedSale(l, it);
        continue;
      }
      l.cost = it.cost !== null && it.cost !== undefined && D(it.cost).gt(0) ? this.m(it.cost) : await this.costOf("gold_inventory", l.weight750);
      ownCost = ownCost.plus(D(l.cost));
      ownW = ownW.plus(D(l.weight750));
      ownRaw = ownRaw.plus(D(l.weight));
    }
    if (!ownW.isZero() || !ownCost.isZero()) {
      await this.push("gold_cogs", "dr", ownCost, { description: `بهای تمام‌شده‌ی مصنوعات — ${this.label}` });
      await this.push("gold_inventory", "cr", ownCost, { w_credit: ownW, raw_weight: ownRaw, description: `خروج مصنوعات — ${this.label}` });
    }
    await this.bulkOut(gold.filter((x) => x.kind === "bulk"), "gold_cogs");
    await this.coinLines("coin_cogs");
    const ownBars: LineRow[] = [];
    for (const l of barsOut) {
      const b = this.outBars.get(l.gold_bar_id!)!;
      if (b.ownership === "consignment") await this.consignedBarSale(l, b);
      else ownBars.push(l);
    }
    await this.barsOut(ownBars, "bar_cogs");
  }

  /** Supplier terms of a consigned piece (from the consignment document that brought it in). */
  private async consignTerms(it: GoldItemRow): Promise<ConsignTerms> {
    const r = await this.tx.one<{ wage_type: string | null; wage_value: string | null; mode: string | null; party_id: string | null }>(
      `select l.wage_type, l.wage_value, d.settle->>'mode' as mode, d.party_id
       from tz_gold_lines l join tz_gold_docs d on d.id = l.doc_id
       where l.org_id = $1 and l.gold_item_id = $2 and d.kind = 'consign_in' and d.status = 'posted' and d.deleted_at is null
       order by d.date desc, d.created_at desc limit 1`,
      [this.orgId, it.id],
    );
    const supplier = r?.party_id ?? it.supplier_id;
    if (!supplier) throw bad(`امانت‌گذارِ اتیکت ${faDigits(it.tag_no)} مشخص نیست`);
    return { mode: r?.mode === "rial" ? "rial" : "weight", wage_type: r?.wage_type ?? null, wage_value: r?.wage_value ?? null, supplier_id: supplier };
  }

  /** Selling a consigned piece: the memo comes off and the supplier is owed (rial or weight). */
  private async consignedSale(l: LineRow, it: GoldItemRow) {
    const t = await this.consignTerms(it);
    const sup = await this.partyById(t.supplier_id);
    const gold = D(l.gold_value);
    const v = D(t.wage_value ?? 0);
    const wage = D(
      t.wage_type === "per_gram" ? roundTo(D(l.weight).times(v), this.step) : t.wage_type === "fixed" ? roundTo(v, this.step) : roundTo(gold.times(v).div(100), this.step),
    );
    l.cost = this.m(gold.plus(wage));
    const tag = `اتیکت ${faDigits(it.tag_no)}`;
    await this.push("gold_consign_contra", "dr", 0, { w_debit: l.weight750, detail_id: sup.detail_id, description: `فروش امانی ${tag} — ${this.label}` });
    await this.push("gold_consign_memo", "cr", 0, { w_credit: l.weight750, detail_id: sup.detail_id, description: `فروش امانی ${tag} — ${this.label}` });
    await this.push("gold_cogs", "dr", l.cost, { description: `بهای امانی ${tag} — ${sup.name}` });
    if (t.mode === "weight") {
      await this.push("gold_parties", "cr", gold, { w_credit: l.weight750, detail_id: sup.detail_id, fineness: l.fineness, raw_weight: l.weight, description: `بدهی وزنی بابت امانی ${tag}` });
      await this.push("ap", "cr", wage, { detail_id: sup.detail_id, description: `اجرت امانی ${tag}` });
    } else {
      await this.push("ap", "cr", l.cost, { detail_id: sup.detail_id, description: `بهای امانی ${tag}` });
    }
  }

  /** Weighed gold leaving an inventory account at its average cost. */
  private async bulkOut(lines: LineRow[], debitKey: "gold_cogs" | null) {
    if (!lines.length) return;
    let total = D(0);
    for (const l of lines) {
      const key = bulkAccountKey(l.form);
      l.cost = await this.costOf(key, l.weight750);
      total = total.plus(D(l.cost));
      await this.push(key, "cr", l.cost, {
        w_credit: l.weight750, fineness: l.fineness, raw_weight: l.weight,
        description: `${l.title || (key === "gold_bullion" ? "آبشده" : "طلای مستعمل")} ${formatWeight(l.weight)} گرم عیار ${faDigits(D(l.fineness ?? 750).toString())}${l.assay_no ? ` انگ ${l.assay_no}` : ""}`,
      });
    }
    if (debitKey) await this.push(debitKey, "dr", total, { description: `بهای تمام‌شده‌ی طلای وزنی — ${this.label}` });
  }

  private async purchase() {
    const party = (await this.party(true))!;
    const mode = this.doc.settle?.mode === "weight" ? "weight" : "rial";
    const gold = this.lines.filter((l) => l.kind === "piece" || l.kind === "bulk");
    let pieceCost = D(0);
    let pieceW = D(0);
    let pieceRaw = D(0);
    for (const l of gold) {
      l.cost = this.m(D(l.gold_value).plus(D(l.wage)).plus(D(l.stone)));
      if (l.kind === "piece") {
        pieceCost = pieceCost.plus(D(l.cost));
        pieceW = pieceW.plus(D(l.weight750));
        pieceRaw = pieceRaw.plus(D(l.weight));
      } else {
        await this.push(bulkAccountKey(l.form), "dr", l.cost, { w_debit: l.weight750, fineness: l.fineness, raw_weight: l.weight, description: `${l.title || "طلای وزنی"} — ${this.label}` });
      }
    }
    if (!pieceW.isZero()) await this.push("gold_inventory", "dr", pieceCost, { w_debit: pieceW, raw_weight: pieceRaw, description: `ورود مصنوعات — ${this.label}` });
    const bars = this.lines.filter((l) => l.kind === "bar");
    await this.barsIn(bars, (l) => this.m(D(l.gold_value).plus(D(l.wage))), "خرید");
    await this.coinLines(null);
    await this.push("vat_in", "dr", this.lines.reduce((a, l) => a.plus(D(l.tax)), D(0)));
    if (mode === "weight") {
      const goldValue = [...gold, ...bars].reduce((a, l) => a.plus(D(l.gold_value)), D(0));
      const w = [...gold, ...bars].reduce((a, l) => a.plus(D(l.weight750)), D(0));
      await this.push("gold_parties", "cr", goldValue, { w_credit: w, detail_id: party.detail_id, description: `بدهی وزنی (طلا به طلا) — ${this.label}` });
    }
    await this.settlement(settleDue("purchase", mode, this.lines), "pay", "ap");
  }

  private async buyback() {
    await this.coinLines(null);
    await this.barsIn(this.lines.filter((l) => l.kind === "bar"), (l) => this.m(l.total), "خرید از مشتری");
    for (const l of this.lines.filter((x) => x.kind === "old")) {
      l.cost = this.m(l.total);
      await this.push("gold_old", "dr", l.total, { w_debit: l.weight750, fineness: l.fineness, raw_weight: l.weight, description: `${l.title || "طلای مستعمل"} — کسر ${faDigits(D(l.deduction_pct ?? 0).toString())}٪ — ${this.label}` });
    }
    await this.settlement(settleDue("buyback", undefined, this.lines), "pay", "ar");
  }

  private async consignMemo(direction: "in" | "out") {
    const party = (await this.party(true))!;
    const w = this.lines.reduce((a, l) => a.plus(D(l.weight750)), D(0));
    const raw = this.lines.reduce((a, l) => a.plus(D(l.weight)), D(0));
    const e = { detail_id: party.detail_id, raw_weight: raw.toString(), description: `${this.label} — ${party.name}` };
    if (direction === "in") {
      await this.push("gold_consign_memo", "dr", 0, { ...e, w_debit: w });
      await this.push("gold_consign_contra", "cr", 0, { ...e, w_credit: w });
    } else {
      await this.push("gold_consign_contra", "dr", 0, { ...e, w_debit: w });
      await this.push("gold_consign_memo", "cr", 0, { ...e, w_credit: w });
    }
  }

  private async workshopOut() {
    const party = (await this.party(true))!;
    await this.bulkOut(this.lines.filter((l) => l.kind === "bulk"), null);
    await this.barsOut(this.lines.filter((l) => l.kind === "bar"), null);
    const cost = this.lines.reduce((a, l) => a.plus(D(l.cost ?? 0)), D(0));
    const w = this.lines.reduce((a, l) => a.plus(D(l.weight750)), D(0));
    await this.push("gold_at_workshop", "dr", cost, { w_debit: w, detail_id: party.detail_id, description: `ارسال طلا به ${party.name} — ${this.label}` });
  }

  private async workshopIn() {
    const party = (await this.party(true))!;
    const s = this.doc.settle ?? {};
    const pieces = this.lines.filter((l) => l.kind === "piece");
    const bulk = this.lines.filter((l) => l.kind === "bulk");
    const P = pieces.reduce((a, l) => a.plus(D(l.weight750)), D(0));
    const B = bulk.reduce((a, l) => a.plus(D(l.weight750)), D(0));
    let C = P.plus(B);
    if (s.close_workshop) {
      const bal = await this.ledgerBalance("gold_at_workshop", party.detail_id);
      if (bal.w.gt(0)) C = bal.w;
    } else if (s.consumed_weight750 && D(s.consumed_weight750).gt(0)) C = D(s.consumed_weight750);
    C = C.toDecimalPlaces(3);
    const avg = (await this.avg("gold_at_workshop", party.detail_id)) ?? (await this.avg("gold_old")) ?? (await this.g18());
    const Rc = D(this.m(C.times(avg)));
    let Rb = D(0);
    for (const l of bulk) {
      l.cost = this.m(D(l.weight750).times(avg));
      Rb = Rb.plus(D(l.cost));
      await this.push(bulkAccountKey(l.form), "dr", l.cost, { w_debit: l.weight750, fineness: l.fineness, raw_weight: l.weight, description: `برگشتی از ${party.name} — ${this.label}` });
    }
    const L = C.minus(P).minus(B);
    const RL = D(this.m(L.times(avg)));
    const Rp = Rc.minus(Rb).minus(RL);
    // the pieces' gold cost is shared by weight; each piece adds its own wage and stones
    let left = Rp;
    pieces.forEach((l, i) => {
      const share = i === pieces.length - 1 ? left : D(this.m(P.isZero() ? 0 : Rp.times(D(l.weight750)).div(P)));
      left = left.minus(share);
      l.cost = this.m(share.plus(D(l.wage)).plus(D(l.stone)));
    });
    const pieceCost = pieces.reduce((a, l) => a.plus(D(l.cost ?? 0)), D(0));
    if (pieces.length) {
      await this.push("gold_inventory", "dr", pieceCost, { w_debit: P, raw_weight: pieces.reduce((a, l) => a.plus(D(l.weight)), D(0)).toString(), description: `دریافت مصنوعات از ${party.name} — ${this.label}` });
    }
    if (L.gt(0)) await this.push("gold_loss", "dr", RL, { w_debit: L, description: `افت ساخت نزد ${party.name} — ${this.label}` });
    else if (L.lt(0)) await this.push("gold_gain", "cr", RL.neg(), { w_credit: L.neg(), description: `اضافه وزن از ${party.name} — ${this.label}` });
    await this.push("gold_at_workshop", "cr", Rc, { w_credit: C, detail_id: party.detail_id, description: `مصرف طلای نزد ${party.name} — ${this.label}` });
    await this.settlement(settleDue("workshop_in", undefined, this.lines), "pay", "ap");
  }

  private async melt() {
    const inputs = this.lines.filter((l) => l.direction === "out");
    const outputs = this.lines.filter((l) => l.direction === "in");
    if (!inputs.length || !outputs.length) throw bad("ذوب باید هم طلای ورودی (مستعمل یا جنس) و هم آبشده‌ی حاصل را داشته باشد");
    await this.bulkOut(inputs.filter((l) => l.kind === "bulk"), null);
    await this.barsOut(inputs.filter((l) => l.kind === "bar"), null);
    await this.coinLines(null);
    let pieceCost = D(0);
    let pieceW = D(0);
    for (const l of inputs.filter((x) => x.kind === "piece")) {
      const it = this.outItems.get(l.gold_item_id!)!;
      l.cost = it.cost !== null && it.cost !== undefined && D(it.cost).gt(0) ? this.m(it.cost) : await this.costOf("gold_inventory", l.weight750);
      pieceCost = pieceCost.plus(D(l.cost));
      pieceW = pieceW.plus(D(l.weight750));
    }
    if (!pieceW.isZero()) await this.push("gold_inventory", "cr", pieceCost, { w_credit: pieceW, description: `ذوب مصنوعات — ${this.label}` });
    const Rin = inputs.reduce((a, l) => a.plus(D(l.cost ?? 0)), D(0));
    const Win = inputs.reduce((a, l) => a.plus(D(l.weight750)), D(0));
    const Wout = outputs.reduce((a, l) => a.plus(D(l.weight750)), D(0));
    if (Win.lte(0)) throw bad("وزن طلای ورودی ذوب صفر است");
    const avgIn = Rin.div(Win);
    let Rout = D(0);
    for (const l of outputs) {
      l.cost = this.m(D(l.weight750).times(avgIn));
      Rout = Rout.plus(D(l.cost));
      if (l.kind === "bar") {
        await this.barsIn([l], () => l.cost!, "ری‌گیری");
        continue;
      }
      await this.push(bulkAccountKey(l.form ?? "bullion"), "dr", l.cost, {
        w_debit: l.weight750, fineness: l.fineness, raw_weight: l.weight,
        description: `آبشده ${formatWeight(l.weight)} گرم عیار ${faDigits(D(l.fineness ?? 750).toString())}${l.assay_no ? ` — انگ ${l.assay_no}` : ""}`,
      });
    }
    const dW = Win.minus(Wout);
    const dR = Rin.minus(Rout);
    if (dW.gt(0)) await this.push("gold_loss", "signed", dR, { w_debit: dW, description: `افت ذوب و ری‌گیری — ${this.label}` });
    else if (dW.lt(0)) await this.push("gold_gain", "signed", dR, { w_credit: dW.neg(), description: `اضافه‌ی ری‌گیری — ${this.label}` });
    else if (!dR.isZero()) await this.push("rounding", "signed", dR);
  }

  private async bullionSale() {
    const mode = this.doc.settle?.mode === "weight" ? "weight" : "rial";
    const value = this.lines.reduce((a, l) => a.plus(D(l.total)), D(0));
    const bulk = this.lines.filter((l) => l.kind === "bulk");
    const bars = this.lines.filter((l) => l.kind === "bar");
    if (bulk.length) await this.push("gold_sales", "cr", bulk.reduce((a, l) => a.plus(D(l.total)), D(0)), { description: `فروش آب‌شده — ${this.label}` });
    if (bars.length) await this.push("bar_sales", "cr", bars.reduce((a, l) => a.plus(D(l.total)), D(0)), { description: `فروش شمش — ${this.label}` });
    await this.bulkOut(bulk, "gold_cogs");
    await this.barsOut(bars, "bar_cogs");
    if (mode === "weight") {
      const party = (await this.party(true))!;
      const w = this.lines.reduce((a, l) => a.plus(D(l.weight750)), D(0));
      await this.push("gold_parties", "dr", value, { w_debit: w, detail_id: party.detail_id, description: `تسویه‌ی وزنی با آبشده — ${this.label}` });
    } else await this.settlement(settleDue("bullion_sale", mode, this.lines), "receive", "ar");
  }

  private async opening() {
    const pieces = this.lines.filter((l) => l.kind === "piece");
    let total = D(0);
    for (const l of this.lines) {
      if (l.kind !== "coin") l.cost = this.m(l.total);
      total = total.plus(D(l.total));
    }
    await this.barsIn(this.lines.filter((l) => l.kind === "bar"), (l) => this.m(l.total), "موجودی اول دوره —");
    if (pieces.length) {
      await this.push("gold_inventory", "dr", pieces.reduce((a, l) => a.plus(D(l.cost ?? 0)), D(0)), {
        w_debit: pieces.reduce((a, l) => a.plus(D(l.weight750)), D(0)), description: `مصنوعات اول دوره — ${this.label}`,
      });
    }
    for (const l of this.lines.filter((x) => x.kind === "bulk")) {
      await this.push(bulkAccountKey(l.form), "dr", l.cost ?? 0, { w_debit: l.weight750, fineness: l.fineness, raw_weight: l.weight, description: `${l.title || "طلای وزنی"} اول دوره` });
    }
    await this.coinLines(null);
    await this.push("opening_balance", "cr", total, { description: this.label });
  }

  // ------------------------------------------------------------ run

  async run(): Promise<string | null> {
    await this.consumePieces();
    await this.consumeBars();
    await this.coinCosts();
    switch (this.doc.kind) {
      case "sale":
        await this.sale();
        break;
      case "purchase":
        await this.purchase();
        break;
      case "buyback":
        await this.buyback();
        break;
      case "consign_in":
        await this.consignMemo("in");
        break;
      case "consign_return":
        await this.consignMemo("out");
        break;
      case "workshop_out":
        await this.workshopOut();
        break;
      case "workshop_in":
        await this.workshopIn();
        break;
      case "melt":
        await this.melt();
        break;
      case "bullion_sale":
        await this.bullionSale();
        break;
      case "opening":
        await this.opening();
        break;
    }
    await this.createPieces();
    await this.createBars();
    await this.writeCoinMoves();
    // a back-dated document must not leave a later coin sale without stock
    await assertCoinStock(this.tx, this.orgId, this.lines.filter((l) => l.kind === "coin" && l.direction === "out").map((l) => l.item_id!), this.doc.date);
    const party = this.doc.party_id ? await this.party() : null;
    const voucherId = await postAuto(
      this.tx,
      this.ctx.org,
      {
        type: "gold_doc",
        id: this.doc.id,
        date: this.doc.date,
        description: `${this.label}${party ? ` — ${party.name}` : ""}${this.doc.description ? ` — ${this.doc.description}` : ""}`,
        refNo: String(this.doc.no),
        voucherId: this.doc.voucher_id,
      },
      this.v,
      { userId: this.ctx.user.id, origin: this.ctx.cfg.origin },
    );
    for (const l of this.lines) {
      await this.tx.query(`update tz_gold_lines set cost = $2, gold_item_id = $3, tag_no = $4, gold_bar_id = $5, extra = $6::jsonb where id = $1`, [
        l.id, l.cost, l.gold_item_id, l.tag_no, l.gold_bar_id ?? null, JSON.stringify(l.extra ?? {}),
      ]);
    }
    return voucherId;
  }
}

function Decimal_min(a: Decimal, b: Decimal) {
  return a.lt(b) ? a : b;
}

/** Post a document: pieces, coin moves and the automatic voucher. Returns the voucher id. */
export async function applyDoc(tx: Tx, ctx: Ctx, doc: DocRow, lines: LineRow[]): Promise<string | null> {
  return new Posting(tx, ctx, doc, lines).run();
}

/**
 * Undo a posted document. Tags it created are removed (refused if a later document used them),
 * pieces it consumed go back to stock, its coin moves go and — unless `keepVoucher` (an edit
 * that re-posts right after) — its voucher is removed.
 */
export async function unapplyDoc(tx: Tx, ctx: Ctx, doc: DocRow, opts: { keepVoucher?: boolean } = {}): Promise<{ coinItems: string[] }> {
  const orgId = ctx.org.id;
  const created = await tx.query<GoldItemRow>(`select * from tz_gold_items where org_id = $1 and in_doc_id = $2 and deleted_at is null`, [orgId, doc.id]);
  for (const it of created) {
    if (it.status !== "in_stock" || (it.out_doc_id && it.out_doc_id !== doc.id)) {
      const used = it.out_doc_id
        ? await tx.one<{ kind: DocKind; no: number }>(`select kind, no from tz_gold_docs where id = $1`, [it.out_doc_id])
        : null;
      throw conflict(
        `اتیکت ${faDigits(it.tag_no)} «${statusTitle(it.status)}» است${used ? ` (${KINDS[used.kind]?.title ?? ""} ش ${faDigits(used.no)})` : ""}؛ ابتدا آن سند را باطل کنید`,
      );
    }
  }
  if (created.length) {
    await tx.query(`update tz_gold_items set deleted_at = now(), origin = $3 where org_id = $1 and in_doc_id = $2 and deleted_at is null`, [orgId, doc.id, ctx.cfg.origin]);
  }
  await tx.query(
    `update tz_gold_items set status = 'in_stock', out_doc_id = null, origin = $3 where org_id = $1 and out_doc_id = $2 and deleted_at is null`,
    [orgId, doc.id, ctx.cfg.origin],
  );
  await unapplyBars(tx, ctx, doc);
  const moves = await tx.query<{ item_id: string; date: string }>(
    `select item_id, min(date) as date from tz_stock_moves where org_id = $1 and source_id = $2 group by item_id`,
    [orgId, doc.id],
  );
  await tx.query(`delete from tz_stock_moves where org_id = $1 and source_id = $2`, [orgId, doc.id]);
  const coinItems = moves.map((m) => m.item_id);
  // coins it brought in must not have been sold since (an edit that re-posts checks after re-posting)
  if (!opts.keepVoucher) for (const m of moves) await assertCoinStock(tx, orgId, [m.item_id], String(m.date).slice(0, 10));
  if (!opts.keepVoucher) await removeAuto(tx, orgId, "gold_doc", doc.id);
  return { coinItems };
}

/** Bars a document brought in are removed (or, bought back, restored); bars it took out return. */
async function unapplyBars(tx: Tx, ctx: Ctx, doc: DocRow) {
  const orgId = ctx.org.id;
  const lines = await tx.query<{ gold_bar_id: string; direction: string; extra: Record<string, unknown> }>(
    `select gold_bar_id, direction, extra from tz_gold_lines where doc_id = $1 and kind = 'bar' and gold_bar_id is not null`,
    [doc.id],
  );
  for (const l of lines) {
    const b = await tx.one<BarRow>(`select * from tz_gold_bars where id = $1 and org_id = $2`, [l.gold_bar_id, orgId]);
    if (!b) continue;
    if (l.direction === "out") {
      if (b.out_doc_id !== doc.id) {
        if (b.deleted_at) continue;
        const used = b.in_doc_id ? await tx.one<{ kind: DocKind; no: number }>(`select kind, no from tz_gold_docs where id = $1`, [b.in_doc_id]) : null;
        throw conflict(`شمش ${faDigits(b.bar_no)} پس از این سند دوباره وارد شده است${used ? ` (${KINDS[used.kind]?.title ?? ""} ش ${faDigits(used.no)})` : ""}؛ ابتدا آن سند را باطل کنید`);
      }
      await tx.query(`update tz_gold_bars set status = 'in_stock', out_doc_id = null, origin = $3 where id = $1 and org_id = $2`, [b.id, orgId, ctx.cfg.origin]);
      continue;
    }
    if (b.in_doc_id !== doc.id || b.deleted_at) continue;
    if (b.status !== "in_stock" || (b.out_doc_id && b.out_doc_id !== doc.id)) {
      const used = b.out_doc_id ? await tx.one<{ kind: DocKind; no: number }>(`select kind, no from tz_gold_docs where id = $1`, [b.out_doc_id]) : null;
      throw conflict(`شمش ${faDigits(b.bar_no)} «${barStatusTitle(b.status)}» است${used ? ` (${KINDS[used.kind]?.title ?? ""} ش ${faDigits(used.no)})` : ""}؛ ابتدا آن سند را باطل کنید`);
    }
    const prev = (l.extra?.prev_bar ?? null) as Record<string, unknown> | null;
    if (prev) await updateRow(tx, "tz_gold_bars", { id: b.id, org_id: orgId }, { ...prev, origin: ctx.cfg.origin });
    else await tx.query(`update tz_gold_bars set deleted_at = now(), origin = $3 where id = $1 and org_id = $2`, [b.id, orgId, ctx.cfg.origin]);
  }
}

export { type Num };

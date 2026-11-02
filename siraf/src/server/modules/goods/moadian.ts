// Electronic invoice in the shape of the Iranian tax system (سامانه مؤدیان / سامانه‌ی صورتحساب
// الکترونیکی): header + body items (+ payments), ready for a future submission client.
// The tax system's wire format uses JSON numbers for amounts (whole rials), so this payload is
// the one place where amounts are numbers; they are computed with decimals and checked to be
// exact safe integers. Unknown values stay null and are listed in `warnings`.
import type { Ctx } from "../../context";
import { bad } from "../../http/errors";
import { D, type Num } from "@shared/money";
import { getInvoice } from "./invoices";

// ---------------------------------------------------------------- tax id (شماره‌ی منحصربه‌فرد مالیاتی)

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** Verhoeff check digit of a string of decimal digits. */
export function verhoeff(digits: string): number {
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][Number(rev[i])]];
  return VERHOEFF_INV[c];
}

/**
 * Tax id of an invoice as the tax organisation's SDK builds it: memory id (6 chars) + days since
 * 1970 in hex (5) + internal serial in hex (10) + Verhoeff check digit of the decimal forms.
 */
export function moadianTaxId(memoryId: string, serial: number, dateMs: number): string {
  const days = Math.floor(dateMs / 86_400_000);
  const head = `${memoryId}${days.toString(16).padStart(5, "0")}${serial.toString(16).padStart(10, "0")}`;
  const memoryDecimal = memoryId.split("").map((ch) => (/\d/.test(ch) ? ch : String(ch.charCodeAt(0)))).join("");
  const control = `${memoryDecimal}${String(days).padStart(6, "0")}${String(serial).padStart(12, "0")}`;
  return `${head}${verhoeff(control)}`.toUpperCase();
}

// ---------------------------------------------------------------- payload

function rial(v: Num): number {
  const d = D(v).toDecimalPlaces(0);
  const n = Number(d.toFixed());
  if (!Number.isSafeInteger(n)) throw bad("مبلغ فاکتور برای سامانه‌ی مؤدیان بیش از حد بزرگ است");
  return n;
}

const decimalNumber = (v: Num) => Number(D(v).toFixed());

export async function moadianInvoice(ctx: Ctx, id: string) {
  const inv = await getInvoice(ctx, id);
  if (inv.kind !== "sale" && inv.kind !== "sale_return") throw bad("فقط فاکتور فروش و برگشت از فروش به سامانه‌ی مؤدیان فرستاده می‌شود");
  if (inv.status !== "posted") throw bad("فاکتور هنوز ثبت قطعی نشده است");
  const warnings: string[] = [];
  const buyer = (inv.buyer ?? {}) as Record<string, string | null>;
  const buyerId = buyer.national_id || buyer.economic_code || null;
  // نوع اول: with the buyer's identity; نوع دوم: without (retail)
  const inty = buyerId ? 1 : 2;
  const tob = buyer.kind === "company" ? 2 : 1;
  if (!ctx.org.economic_code) warnings.push("کد اقتصادی فروشنده (اطلاعات کسب‌وکار) وارد نشده است");
  if (inty === 1 && !buyer.postal_code) warnings.push("کد پستی خریدار وارد نشده است");
  const indatim = Date.parse(`${inv.date}T12:00:00+03:30`);
  const settings = (ctx.org.settings?.moadian ?? {}) as { memory_id?: string; branch_code?: string };
  const taxid = settings.memory_id ? moadianTaxId(settings.memory_id, Number(inv.no), indatim) : null;
  if (!taxid) warnings.push("شناسه‌ی یکتای حافظه‌ی مالیاتی تنظیم نشده است؛ شماره‌ی منحصربه‌فرد مالیاتی ساخته نشد");

  const body = (inv.lines as Record<string, any>[]).map((l, i) => {
    if (!l.tax_goods_id) warnings.push(`ردیف ${i + 1}: شناسه‌ی کالا/خدمت «${l.item_name}» در سامانه‌ی مؤدیان وارد نشده است`);
    const gross = D(l.gross);
    const net = D(l.net);
    const vat = D(l.vat);
    return {
      sstid: l.tax_goods_id ?? null,
      sstt: l.description ? `${l.item_name} — ${l.description}` : l.item_name,
      am: decimalNumber(l.qty),
      mu: null as string | null, // the tax system's unit code (not kept for units yet)
      fee: rial(l.unit_price),
      cfee: null,
      cut: null,
      exr: null,
      prdis: rial(gross),
      dis: rial(gross.minus(net)),
      adis: rial(net),
      vra: decimalNumber(l.vat_pct),
      vam: rial(vat),
      odt: null,
      odr: null,
      odam: null,
      olt: null,
      olr: null,
      olam: null,
      consfee: null,
      spro: null,
      bros: null,
      tcpbs: null,
      cop: null,
      vop: null,
      bsrn: null,
      tsstam: rial(net.plus(vat)),
    };
  });
  if (body.some((b) => b.mu === null)) warnings.push("کد واحد اندازه‌گیری سامانه‌ی مؤدیان برای ردیف‌ها تعیین نشده است");
  if (!D(inv.additions).isZero() || !D(inv.deductions).isZero()) {
    warnings.push("اضافات و کسورات فاکتور در صورتحساب الکترونیکی نمی‌آیند؛ آن‌ها را به‌صورت ردیف خدمت ثبت کنید");
  }
  const tprdis = body.reduce((a, b) => a + b.prdis, 0);
  const tdis = body.reduce((a, b) => a + b.dis, 0);
  const tadis = body.reduce((a, b) => a + b.adis, 0);
  const tvam = body.reduce((a, b) => a + b.vam, 0);
  const tbill = tadis + tvam;
  const allocated = D(inv.allocated ?? 0);
  const setm = inv.settlement === "cash" ? 1 : inv.settlement === "credit" ? 2 : inv.settlement === "mixed" ? 3 : allocated.gte(D(inv.total)) ? 1 : allocated.gt(0) ? 3 : 2;
  const cash = Math.min(rial(allocated), tbill);
  const ref = inv.ref_invoice as { id: string } | null;
  let irtaxid: string | null = null;
  if (inv.kind === "sale_return") {
    const orig = ref ? await ctx.db.one<{ moadian: Record<string, any> }>(`select moadian from tz_invoices where id = $1`, [ref.id]) : null;
    irtaxid = (orig?.moadian?.taxid as string | undefined) ?? null;
    if (!irtaxid) warnings.push("شماره‌ی مالیاتی صورتحساب اصلی (برای برگشت از فروش) در دسترس نیست");
  }
  return {
    header: {
      taxid,
      indatim,
      Indati2m: Date.parse(inv.created_at),
      inty,
      inno: String(inv.no),
      irtaxid,
      inp: 1, // الگوی فروش
      ins: inv.kind === "sale_return" ? 4 : 1, // 1 اصلی، 4 برگشت از فروش
      tins: ctx.org.economic_code ?? null,
      tob: inty === 1 ? tob : null,
      bid: inty === 1 ? buyer.national_id ?? null : null,
      tinb: inty === 1 ? buyer.economic_code ?? null : null,
      sbc: settings.branch_code ?? null,
      bpc: inty === 1 ? buyer.postal_code ?? null : null,
      bbc: null,
      ft: null,
      bpn: null,
      scln: null,
      scc: null,
      crn: null,
      billid: null,
      tprdis,
      tdis,
      tadis,
      tvam,
      todam: 0,
      tbill,
      setm,
      cap: cash,
      insp: tbill - cash,
      tvop: null,
      tax17: null,
    },
    body,
    payments: [] as unknown[],
    meta: { invoice_id: inv.id, kind: inv.kind, no: inv.no, buyer_name: buyer.name ?? inv.party_name, warnings },
  };
}

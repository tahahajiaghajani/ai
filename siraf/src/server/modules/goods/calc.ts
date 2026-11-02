// Invoice arithmetic — pure (no I/O, decimals only). The server uses it as the authoritative
// calculation and the invoice editor imports the very same file for its live totals, so both
// always agree to the last rial.
//
// Per line:   gross = qty × unit_price
//             line discount = gross × discount_pct ÷ 100 (or the amount typed)
//             header discount share = the invoice discount spread over lines pro-rata
//             net = gross − line discount − header share   (the VAT base)
//             vat = net × vat_pct ÷ 100,  total = net + vat
// Invoice:    total = Σ net + Σ vat + additions − deductions
import { D, Decimal, type Num } from "@shared/money";

type Dec = InstanceType<typeof Decimal>;

export interface CalcLineIn {
  qty: Num;
  unit_price: Num;
  discount_pct?: Num;
  discount?: Num;
  vat_pct?: Num;
}

export interface CalcIn {
  lines: CalcLineIn[];
  /** header discount amount (ignored when discount_pct > 0) */
  discount?: Num;
  discount_pct?: Num;
  additions?: Num;
  deductions?: Num;
  /** money decimals of the organisation (rial: 0) */
  dp?: number;
}

export interface CalcLineOut {
  gross: string;
  line_discount: string;
  header_discount: string;
  net: string;
  vat: string;
  total: string;
}

export interface CalcOut {
  lines: CalcLineOut[];
  subtotal: string;
  line_discount: string;
  discount: string;
  /** Σ net — the taxable amount after every discount */
  net: string;
  tax: string;
  additions: string;
  deductions: string;
  total: string;
}

const roundTo = (x: Dec, dp: number) => x.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);

/**
 * Split `amount` over `weights` in proportion, rounded to `dp` decimals, so that the parts add
 * up to exactly `amount` (largest-remainder method; ties go to the earlier line).
 */
export function allocate(amount: Num, weights: Num[], dp = 0): string[] {
  const total = D(amount);
  const ws = weights.map((w) => (D(w).isNeg() ? D(0) : D(w)));
  if (!ws.length) return [];
  if (total.isZero()) return ws.map(() => "0");
  let sumW = ws.reduce((a, w) => a.plus(w), D(0));
  const eff = sumW.isZero() ? ws.map(() => D(1)) : ws;
  if (sumW.isZero()) sumW = D(ws.length);
  const raw = eff.map((w) => total.times(w).div(sumW));
  const parts = raw.map((r) => r.toDecimalPlaces(dp, Decimal.ROUND_DOWN));
  const unit = D(1).div(D(10).pow(dp)).times(total.isNeg() ? -1 : 1);
  let rest = total.minus(parts.reduce((a, p) => a.plus(p), D(0)));
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(parts[i]).abs() }))
    .sort((a, b) => b.frac.cmp(a.frac) || a.i - b.i);
  for (let k = 0; !rest.isZero() && k < order.length * 2; k++) {
    const j = order[k % order.length].i;
    parts[j] = parts[j].plus(unit);
    rest = rest.minus(unit);
  }
  return parts.map((p) => p.toString());
}

export function calcInvoice(input: CalcIn): CalcOut {
  const dp = input.dp ?? 0;
  const pre = input.lines.map((l) => {
    const gross = roundTo(D(l.qty).times(D(l.unit_price)), dp);
    const pct = D(l.discount_pct);
    const ld = pct.gt(0) ? roundTo(gross.times(pct).div(100), dp) : roundTo(D(l.discount), dp);
    return { gross, ld, base: gross.minus(ld), vatPct: D(l.vat_pct) };
  });
  const subtotal = pre.reduce((a, p) => a.plus(p.gross), D(0));
  const lineDiscount = pre.reduce((a, p) => a.plus(p.ld), D(0));
  const before = subtotal.minus(lineDiscount);
  const hpct = D(input.discount_pct);
  const discount = hpct.gt(0) ? roundTo(before.times(hpct).div(100), dp) : roundTo(D(input.discount), dp);
  const shares = allocate(discount, pre.map((p) => p.base), dp);
  let net = D(0);
  let tax = D(0);
  const lines: CalcLineOut[] = pre.map((p, i) => {
    const n = p.base.minus(D(shares[i]));
    const vat = roundTo(n.times(p.vatPct).div(100), dp);
    net = net.plus(n);
    tax = tax.plus(vat);
    return {
      gross: p.gross.toString(),
      line_discount: p.ld.toString(),
      header_discount: D(shares[i]).toString(),
      net: n.toString(),
      vat: vat.toString(),
      total: n.plus(vat).toString(),
    };
  });
  const additions = roundTo(D(input.additions), dp);
  const deductions = roundTo(D(input.deductions), dp);
  return {
    lines,
    subtotal: subtotal.toString(),
    line_discount: lineDiscount.toString(),
    discount: discount.toString(),
    net: net.toString(),
    tax: tax.toString(),
    additions: additions.toString(),
    deductions: deductions.toString(),
    total: net.plus(tax).plus(additions).minus(deductions).toString(),
  };
}

/**
 * Inventory (landed) cost of each line of a purchase or purchase return: its net amount plus
 * its share of the additions (freight…) minus its share of the deductions. Shares go to goods
 * lines only when there are any (freight belongs to goods), otherwise to every line.
 */
export function landedCosts(nets: Num[], isGoods: boolean[], additions: Num, deductions: Num, dp = 0): string[] {
  const anyGoods = isGoods.some(Boolean);
  const weights = nets.map((n, i) => (!anyGoods || isGoods[i] ? n : 0));
  const add = allocate(additions, weights, dp);
  const ded = allocate(deductions, weights, dp);
  return nets.map((n, i) => D(n).plus(D(add[i])).minus(D(ded[i])).toString());
}

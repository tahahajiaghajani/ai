// A4 print of an invoice in the layout of the official Iranian sales invoice (صورتحساب فروش
// کالا و خدمات): seller and buyer boxes, the items table with discounts and VAT per line,
// totals, the amount in words and signatures. Only visible when printing.
import { useOrg } from "../../lib/org";
import { D, type Num } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { amountToWords } from "@shared/words";
import { PrintColophon, PrintHead } from "./print";
import { LatinRuns } from "./components";
import { docNo } from "../../lib/fa";
import { INVOICE_META, type InvoiceKind } from "./labels";

export interface PrintLine {
  code: string;
  name: string;
  description?: string | null;
  qty: Num;
  unit?: string | null;
  unit_price: Num;
  gross: Num;
  discount: Num;
  net: Num;
  vat: Num;
  total: Num;
}

export interface PrintData {
  kind: InvoiceKind;
  no?: number | null;
  date: string | null;
  dueDate?: string | null;
  refNo?: string | null;
  draft?: boolean;
  party: Record<string, string | null> | null;
  lines: PrintLine[];
  totals: { subtotal: Num; discount: Num; tax: Num; additions: Num; deductions: Num; total: Num };
  notes?: string | null;
  terms?: string | null;
}

/** A party block: a 9 pt label over 10.5 pt values, the facts in two quiet columns. */
function Box({ title, rows }: { title: string; rows: [string, string | null | undefined][] }) {
  const [name, ...rest] = rows;
  return (
    <div className="sf-pr-party">
      <div className="l">{title}</div>
      <div className="v">{name?.[1] || "—"}</div>
      <div className="m grid grid-cols-2 gap-x-4">
        {rest.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className={k === "نشانی" ? "col-span-2" : ""}>
            {k} {faDigits(v ?? "")}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The page of a printed invoice (also passed to the Windows app by the print button). */
export const INVOICE_PAGE = { size: "A4 landscape", margin: "10mm 12mm 12mm" } as const;

export function InvoicePrint({ data }: { data: PrintData }) {
  const { org, unit } = useOrg();
  const dp = org.money_decimals ?? 0;
  const m = (v: Num) => formatNumber(v, { dp });
  const meta = INVOICE_META[data.kind];
  const footer = (org.settings?.print?.footer as string | undefined) ?? "";
  const orgBox: [string, string | null | undefined][] = [
    ["نام", org.legal_name || org.name],
    ["شماره اقتصادی", org.economic_code],
    ["شناسه/کد ملی", org.national_id],
    ["شماره ثبت", org.registration_no],
    ["کد پستی", org.postal_code],
    ["تلفن", org.phone],
    ["نشانی", [org.province, org.city, org.address].filter(Boolean).join("، ")],
  ];
  const p = data.party ?? {};
  const partyBox: [string, string | null | undefined][] = [
    ["نام", p.name],
    ["شماره اقتصادی", p.economic_code],
    ["شناسه/کد ملی", p.national_id],
    ["شماره ثبت", p.registration_no],
    ["کد پستی", p.postal_code],
    ["تلفن", p.phone],
    ["نشانی", [p.province, p.city, p.address].filter(Boolean).join("، ")],
  ];
  const seller = meta.sale ? orgBox : partyBox;
  const buyer = meta.sale ? partyBox : orgBox;
  const t = data.totals;
  const totalRows: [string, Num][] = [
    ["جمع پس از تخفیف", D(t.subtotal).minus(D(t.discount)).toString()],
    ["مالیات و عوارض ارزش افزوده", t.tax],
  ];
  if (!D(t.additions).isZero()) totalRows.push(["اضافات (حمل و …)", t.additions]);
  if (!D(t.deductions).isZero()) totalRows.push(["کسورات", t.deductions]);
  return (
    <div className="print-sheet sf-pr hidden print:block" dir="rtl">
      {/* eleven columns, as on the official form: A4 landscape (portrait cuts the last columns of six money figures) */}
      <style>{`@media print { @page { size: ${INVOICE_PAGE.size}; margin: ${INVOICE_PAGE.margin}; } }`}</style>
      <PrintHead
        title={data.kind === "sale" ? "صورتحساب فروش کالا و خدمات" : meta.title}
        rows={[
          <>شماره‌ی <b>{data.no ? docNo(Number(data.no)) : "—"}</b></>,
          <>تاریخ <b>{formatJalali(data.date)}</b></>,
          ...(data.dueDate ? [<>{data.kind === "quote" ? "اعتبار تا" : "سررسید"} {formatJalali(data.dueDate)}</>] : []),
          ...(data.refNo ? [<>شماره‌ی عطف {faDigits(data.refNo)}</>] : []),
        ]}
        badge={data.draft ? "پیش‌نویس" : null}
      />
      <div className="sf-pr-parties">
        <Box title="فروشنده" rows={seller} />
        <Box title="خریدار" rows={buyer} />
      </div>
      <table>
        <thead>
          <tr>
            <th className="c">ردیف</th>
            <th className="n">کد</th>
            <th className="desc">شرح کالا یا خدمت</th>
            <th className="n">مقدار</th>
            <th>واحد</th>
            <th className="n">مبلغ واحد</th>
            <th className="n">مبلغ کل</th>
            <th className="n">تخفیف</th>
            <th className="n">پس از تخفیف</th>
            <th className="n">مالیات و عوارض</th>
            <th className="n">جمع کل ({unit})</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l, i) => (
            <tr key={i}>
              <td className="c">{faDigits(i + 1)}</td>
              <td className="n">{faDigits(l.code)}</td>
              <td className="desc">
                <LatinRuns text={l.name} />
                {l.description ? <span className="sub">{l.description}</span> : null}
              </td>
              <td className="n">{formatNumber(l.qty, { dp: 3 })}</td>
              <td>{l.unit ?? ""}</td>
              <td className="n">{m(l.unit_price)}</td>
              <td className="n">{m(l.gross)}</td>
              <td className="n">{D(l.discount).isZero() ? "—" : m(l.discount)}</td>
              <td className="n">{m(l.net)}</td>
              <td className="n">{D(l.vat).isZero() ? "—" : m(l.vat)}</td>
              <td className="n"><b>{m(l.total)}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>جمع</td>
            <td className="n">{m(t.subtotal)}</td>
            <td className="n">{m(t.discount)}</td>
            <td className="n">{m(D(t.subtotal).minus(D(t.discount)))}</td>
            <td className="n">{m(t.tax)}</td>
            <td className="n">{m(D(t.subtotal).minus(D(t.discount)).plus(D(t.tax)))}</td>
          </tr>
        </tfoot>
      </table>
      <div className="sf-pr-foot">
        <div className="sf-pr-box">
          <div>مبلغ قابل پرداخت به حروف: <b>{amountToWords(t.total, unit)}</b></div>
          {data.notes ? <div className="mt-1">توضیحات: {data.notes}</div> : null}
          {data.terms ? <div className="mt-1">شرایط: {data.terms}</div> : null}
        </div>
        <div className="sf-pr-sums">
          {totalRows.map(([k, v]) => (
            <div key={k} className="r">
              <span>{k}</span>
              <span className="n">{m(v)}</span>
            </div>
          ))}
          <div className="r is-total">
            <span>مبلغ نهایی ({unit})</span>
            <span className="n">{m(t.total)}</span>
          </div>
        </div>
      </div>
      <div className="sf-pr-sign">
        <div>مهر و امضای فروشنده</div>
        <div>مهر و امضای خریدار</div>
      </div>
      <PrintColophon note={footer || undefined} />
    </div>
  );
}

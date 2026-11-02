// A4 print of an invoice in the layout of the official Iranian sales invoice (صورتحساب فروش
// کالا و خدمات): seller and buyer boxes, the items table with discounts and VAT per line,
// totals, the amount in words and signatures. Only visible when printing.
import { useOrg } from "../../lib/org";
import { D, type Num } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { amountToWords } from "@shared/words";
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

function Box({ title, rows }: { title: string; rows: [string, string | null | undefined][] }) {
  return (
    <div className="rounded border border-black/60">
      <div className="border-b border-black/60 bg-black/5 px-2 py-1 text-center text-[11px] font-bold">{title}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-2 py-1.5 text-[11px]">
        {rows.map(([k, v]) => (
          <div key={k} className={k === "نشانی" ? "col-span-2" : ""}>
            <span className="text-black/60">{k}: </span>
            <span className="num">{v ? faDigits(v) : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InvoicePrint({ data }: { data: PrintData }) {
  const { org, unit } = useOrg();
  const dp = org.money_decimals ?? 0;
  const m = (v: Num) => formatNumber(v, { dp });
  const meta = INVOICE_META[data.kind];
  const showLogo = org.settings?.print?.show_logo !== false && !!org.logo;
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
    <div className="print-sheet hidden text-black print:block" dir="rtl">
      <style>{"@media print { @page { size: A4 portrait; margin: 10mm; } }"}</style>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="w-40 text-[11px] leading-5">
          <div>شماره: <b className="num">{data.no ? faDigits(data.no) : "—"}</b></div>
          <div>تاریخ: <b className="num">{formatJalali(data.date)}</b></div>
          {data.dueDate ? <div>{data.kind === "quote" ? "اعتبار تا" : "سررسید"}: <span className="num">{formatJalali(data.dueDate)}</span></div> : null}
          {data.refNo ? <div>شماره عطف: <span className="num">{faDigits(data.refNo)}</span></div> : null}
        </div>
        <div className="text-center">
          <div className="text-base font-extrabold">{data.kind === "sale" ? "صورتحساب فروش کالا و خدمات" : meta.title}</div>
          <div className="text-[12px]">{org.name}</div>
          {data.draft ? <div className="text-[11px] font-bold">(پیش‌نویس)</div> : null}
        </div>
        <div className="flex w-40 justify-end">{showLogo ? <img src={org.logo!} alt="" className="max-h-16 max-w-36 object-contain" /> : null}</div>
      </div>
      <div className="mb-2 grid gap-2">
        <Box title="مشخصات فروشنده" rows={seller} />
        <Box title="مشخصات خریدار" rows={buyer} />
      </div>
      <table className="w-full border-collapse text-[10px]">
        <colgroup>
          <col style={{ width: "3.5%" }} />
          <col style={{ width: "6.5%" }} />
          <col style={{ width: "23%" }} />
          <col style={{ width: "5%" }} />
          <col style={{ width: "5%" }} />
        </colgroup>
        <thead>
          <tr className="bg-black/5">
            {["ردیف", "کد", "شرح کالا یا خدمت", "مقدار", "واحد", `مبلغ واحد (${unit})`, "مبلغ کل", "تخفیف", "مبلغ پس از تخفیف", "مالیات و عوارض", "جمع کل"].map((h) => (
              <th key={h} className="border border-black/60 px-0.5 py-1 font-bold leading-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l, i) => (
            <tr key={i}>
              <td className="num border border-black/60 px-1 text-center">{faDigits(i + 1)}</td>
              <td className="num border border-black/60 px-1 text-center">{faDigits(l.code)}</td>
              <td className="border border-black/60 px-1">
                {l.name}
                {l.description ? <span className="text-black/70"> — {l.description}</span> : null}
              </td>
              <td className="num border border-black/60 px-1 text-center">{formatNumber(l.qty, { dp: 3 })}</td>
              <td className="border border-black/60 px-1 text-center">{l.unit ?? ""}</td>
              <td className="num border border-black/60 px-1 text-left">{m(l.unit_price)}</td>
              <td className="num border border-black/60 px-1 text-left">{m(l.gross)}</td>
              <td className="num border border-black/60 px-1 text-left">{D(l.discount).isZero() ? "" : m(l.discount)}</td>
              <td className="num border border-black/60 px-1 text-left">{m(l.net)}</td>
              <td className="num border border-black/60 px-1 text-left">{D(l.vat).isZero() ? "" : m(l.vat)}</td>
              <td className="num border border-black/60 px-1 text-left font-bold">{m(l.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-black/5 font-bold">
            <td colSpan={6} className="border border-black/60 px-1 text-center">جمع</td>
            <td className="num border border-black/60 px-1 text-left">{m(t.subtotal)}</td>
            <td className="num border border-black/60 px-1 text-left">{m(t.discount)}</td>
            <td className="num border border-black/60 px-1 text-left">{m(D(t.subtotal).minus(D(t.discount)))}</td>
            <td className="num border border-black/60 px-1 text-left">{m(t.tax)}</td>
            <td className="num border border-black/60 px-1 text-left">{m(D(t.subtotal).minus(D(t.discount)).plus(D(t.tax)))}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-2 grid grid-cols-[1fr_220px] gap-2 text-[11px]">
        <div className="rounded border border-black/60 p-2 leading-5">
          <div>
            <span className="text-black/60">مبلغ قابل پرداخت به حروف: </span>
            <b>{amountToWords(t.total, unit)}</b>
          </div>
          {data.notes ? <div className="mt-1"><span className="text-black/60">توضیحات: </span>{data.notes}</div> : null}
          {data.terms ? <div className="mt-1"><span className="text-black/60">شرایط: </span>{data.terms}</div> : null}
        </div>
        <div className="rounded border border-black/60">
          {totalRows.map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-black/30 px-2 py-0.5">
              <span>{k}</span>
              <span className="num">{m(v)}</span>
            </div>
          ))}
          <div className="flex justify-between px-2 py-1 text-[12px] font-extrabold">
            <span>مبلغ نهایی</span>
            <span className="num">{m(t.total)} {unit}</span>
          </div>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 text-center text-[11px]">
        <div>مهر و امضای فروشنده</div>
        <div>مهر و امضای خریدار</div>
      </div>
      {footer ? <div className="mt-6 border-t border-black/30 pt-1 text-center text-[10px] text-black/70">{footer}</div> : null}
    </div>
  );
}

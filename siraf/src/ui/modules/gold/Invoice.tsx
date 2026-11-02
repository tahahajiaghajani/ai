// Printable gold documents. The sale invoice lists weight, fineness, gold value, wage, seller
// profit and VAT separately (as Iranian rules for gold sellers require; VAT is charged on wage
// and profit only), with the amount in words. Formats: A5 invoice, 80 mm till receipt, and a
// generic A5 sheet for the other document kinds. Rendered hidden on screen, shown in print.
import type { ReactNode } from "react";
import { useOrg } from "../../lib/org";
import { D, type Num } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { amountToWords, weightToWords } from "@shared/words";
import { APP_NAME } from "@shared/constants";
import { SirafMark } from "../../components/brand";
import { docNo } from "../../lib/fa";
import { KINDS, formTitle, printWithPage, wageText, type DocKind } from "./shared";

export type PrintFormat = "a5" | "receipt";

/** Money for print: tabular, start-aligned, accounting parentheses for negatives; zero is «—». */
function M({ v, zero = "—", neg }: { v: Num; zero?: string; neg?: boolean }) {
  const { org } = useOrg();
  const d = D(v);
  if (d.isZero()) return <span>{zero}</span>;
  const s = formatNumber(d.abs(), { dp: org.money_decimals ?? 0 });
  return <span>{neg || d.isNeg() ? `(${s})` : s}</span>;
}

/** Gold weight for print: always three decimals. */
function W({ v }: { v: Num }) {
  return D(v).isZero() ? <span>—</span> : <span>{formatNumber(v, { dp: 3, minDp: 3 })}</span>;
}

const fin = (v: Num | null | undefined) => faDigits(D(v ?? 750).toString());

function SellerBlock({ title, doc }: { title: string; doc: any }) {
  const { org } = useOrg();
  const legal = [
    org.economic_code ? `کد اقتصادی ${faDigits(org.economic_code)}` : null,
    org.national_id ? `شناسه‌ی ملی ${faDigits(org.national_id)}` : null,
    org.registration_no ? `شماره‌ی ثبت ${faDigits(org.registration_no)}` : null,
  ].filter(Boolean).join("، ");
  const addr = [[org.province, org.city, org.address].filter(Boolean).join("، "), org.postal_code ? `کد پستی ${faDigits(org.postal_code)}` : null, org.phone ? `تلفن ${faDigits(org.phone)}` : null]
    .filter(Boolean)
    .join("، ");
  return (
    <header className="sf-pr-head">
      <div className="sf-pr-brand">{org.logo ? <img src={org.logo} alt="" /> : <SirafMark size={32} variant="mono" />}</div>
      <div className="sf-pr-biz">
        <b>{org.legal_name || org.name}</b>
        {legal ? <span>{legal}</span> : null}
        {addr ? <span>{addr}</span> : null}
      </div>
      <div className="sf-pr-doc">
        <b className="t">{title}</b>
        <div>شماره‌ی <b>{docNo(Number(doc.no))}</b></div>
        <div>تاریخ <b>{formatJalali(doc.date)}</b></div>
        {doc.status === "cancelled" ? <span className="sf-pr-badge">باطل شده</span> : null}
        {doc.status === "draft" ? <span className="sf-pr-badge">پیش‌نویس</span> : null}
      </div>
    </header>
  );
}

function BuyerBlock({ doc, label = "خریدار" }: { doc: any; label?: string }) {
  const { org } = useOrg();
  const p = doc.party ?? {};
  const b = doc.buyer ?? {};
  const name = p.name ?? b.name ?? "مشتری گذری";
  const nid = p.national_id ?? b.national_id;
  const mobile = p.mobile ?? b.mobile;
  const eco = p.economic_code ?? b.economic_code;
  const addr = p.address ?? b.address;
  const postal = p.postal_code ?? b.postal_code;
  const meta = [nid ? `کد/شناسه‌ی ملی ${faDigits(nid)}` : null, eco ? `کد اقتصادی ${faDigits(eco)}` : null, mobile ? `تلفن ${faDigits(mobile)}` : null].filter(Boolean).join("، ");
  return (
    <section className="sf-pr-parties">
      <div className="sf-pr-party">
        <div className="l">فروشنده</div>
        <div className="v">{org.legal_name || org.name}</div>
        <div className="m">{[org.city, org.phone ? `تلفن ${faDigits(org.phone)}` : null].filter(Boolean).join("، ")}</div>
      </div>
      <div className="sf-pr-party">
        <div className="l">{label}</div>
        <div className="v">{name}{p.code ? <span> ({faDigits(p.code)})</span> : null}</div>
        {meta ? <div className="m">{meta}</div> : null}
        {addr || postal ? <div className="m">{addr ?? ""}{postal ? `، کد پستی ${faDigits(postal)}` : ""}</div> : null}
      </div>
    </section>
  );
}

function RateLine({ doc }: { doc: any }) {
  const { unit } = useOrg();
  if (!doc.gram18 && !doc.mazaneh) return null;
  return (
    <div className="sf-pr-note">
      نرخ روز: هر گرم طلای ۱۸ عیار (۷۵۰) <b>{formatNumber(doc.gram18 ?? 0)}</b> {unit}
      {doc.mazaneh ? <>، مظنه (مثقال ۷۰۵) <b>{formatNumber(doc.mazaneh)}</b> {unit}</> : null}
    </div>
  );
}

function Colophon() {
  return (
    <div className="sf-pr-colophon">
      <span>چاپ: {formatJalaliDateTime(new Date().toISOString())}</span>
      <span>{APP_NAME} <span className="latn">| siraf.app</span></span>
    </div>
  );
}

function Signatures({ left = "امضای خریدار", right = "مهر و امضای فروشنده" }: { left?: string; right?: string }) {
  return (
    <div className="sf-pr-sign">
      <div>{right}</div>
      <div>{left}</div>
    </div>
  );
}

function payments(doc: any) {
  const s = doc.settle ?? {};
  const n = doc.settle_names ?? {};
  const rows: [string, string][] = [];
  if (s.cash && !D(s.cash.amount).isZero()) rows.push([`نقد${n.cash ? ` (${n.cash})` : ""}`, s.cash.amount]);
  if (s.pos && !D(s.pos.amount).isZero()) rows.push([`کارتخوان${n.pos ? ` (${n.pos})` : ""}`, s.pos.amount]);
  if (s.bank && !D(s.bank.amount).isZero()) rows.push([`واریز بانکی${n.bank ? ` (${n.bank})` : ""}${s.bank.ref_no ? `، پیگیری ${faDigits(s.bank.ref_no)}` : ""}`, s.bank.amount]);
  return rows;
}

/** One row of the print totals: the label, then the figure in the shared start-aligned column. */
function Row({ k, v, strong, sub }: { k: ReactNode; v: ReactNode; strong?: boolean; sub?: boolean }) {
  return (
    <div className={`r ${strong ? "is-total" : ""} ${sub ? "is-sub" : ""}`}>
      <span>{k}</span>
      <span className="n">{v}</span>
    </div>
  );
}

/** A5 sale invoice (فاکتور فروش طلا و جواهر). */
export function SaleInvoice({ doc }: { doc: any }) {
  const { unit } = useOrg();
  const out = (doc.lines ?? []).filter((l: any) => l.direction === "out");
  const old = (doc.lines ?? []).filter((l: any) => l.kind === "old");
  const coins = out.filter((l: any) => l.kind === "coin").reduce((a: any, l: any) => a.plus(D(l.total)), D(0));
  const net = D(doc.total).minus(D(doc.old_value));
  const paid = payments(doc);
  const remaining = D(doc.settle?.remaining ?? 0);
  return (
    <div className="gold-print sf-pr">
      <SellerBlock title="فاکتور فروش طلا و جواهر" doc={doc} />
      <BuyerBlock doc={doc} />
      <RateLine doc={doc} />
      <table>
        <thead>
          <tr>
            <th className="c">ردیف</th>
            <th>شرح کالا</th>
            <th className="c">عیار</th>
            <th className="n">وزن (گرم)</th>
            <th className="n">ارزش طلا</th>
            <th className="n">اجرت</th>
            <th className="n">سود</th>
            <th className="n">تخفیف</th>
            <th className="n">مالیات</th>
            <th className="n">سنگ</th>
            <th className="n">مبلغ ({unit})</th>
          </tr>
        </thead>
        <tbody>
          {out.map((l: any, i: number) => (
            <tr key={l.id ?? i}>
              <td className="c">{faDigits(i + 1)}</td>
              <td>
                {l.kind === "coin" ? `${l.title ?? l.coin_name ?? "سکه"} × ${faDigits(D(l.qty).toString())}` : l.title}
                {l.tag_no ? <span className="sub">اتیکت {faDigits(l.tag_no)}{l.kind === "piece" && l.wage_type ? `، اجرت ${wageText(l.wage_type, l.wage_value)}${l.profit_pct ? `، سود ${faDigits(D(l.profit_pct).toString())}٪` : ""}` : ""}</span> : null}
              </td>
              <td className="c">{fin(l.fineness)}</td>
              <td className="n"><W v={l.weight} /></td>
              <td className="n"><M v={l.gold_value} /></td>
              <td className="n"><M v={l.wage} /></td>
              <td className="n"><M v={l.profit} /></td>
              <td className="n"><M v={l.discount} /></td>
              <td className="n"><M v={l.tax} /></td>
              <td className="n"><M v={l.stone} /></td>
              <td className="n"><b><M v={l.total} /></b></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>جمع</td>
            <td className="n"><W v={out.filter((l: any) => l.kind !== "coin").reduce((a: any, l: any) => a.plus(D(l.weight)), D(0)).toString()} /></td>
            <td className="n"><M v={doc.gold_value} /></td>
            <td className="n"><M v={doc.wage} /></td>
            <td className="n"><M v={doc.profit} /></td>
            <td className="n"><M v={doc.discount} /></td>
            <td className="n"><M v={doc.tax} /></td>
            <td className="n"><M v={doc.stone} /></td>
            <td className="n"><M v={doc.total} /></td>
          </tr>
        </tfoot>
      </table>

      <div className="sf-pr-foot">
        <div className="sf-pr-box">
          {old.length ? (
            <>
              <div className="t">طلای مستعمل دریافتی از خریدار</div>
              <div className="sf-pr-sums">
                {old.map((l: any, i: number) => (
                  <Row key={i} k={<>{l.title ?? "طلای مستعمل"}، {formatNumber(l.weight, { dp: 3, minDp: 3 })} گرم عیار {fin(l.fineness)}{!D(l.discount).isZero() ? `، کسر ${faDigits(D(l.deduction_pct ?? 0).toString())}٪` : ""}</>} v={<M v={l.total} />} />
                ))}
              </div>
            </>
          ) : null}
          <div className="t" style={old.length ? { marginBlockStart: "2mm" } : undefined}>دریافت</div>
          <div className="sf-pr-sums">
            {paid.map(([k, v]) => <Row key={k} k={k} v={<M v={v} />} />)}
            {!remaining.isZero() ? <Row k={net.isNeg() ? "مانده (بستانکار خریدار)" : "مانده (نسیه)"} v={<M v={remaining.toString()} />} strong /> : null}
            {!paid.length && remaining.isZero() ? <Row k="تسویه شده" v="" /> : null}
          </div>
        </div>
        <div className="sf-pr-sums">
          <Row k="ارزش طلا" v={<M v={doc.gold_value} />} />
          <Row k="اجرت ساخت" v={<M v={doc.wage} />} />
          <Row k="سود فروشنده" v={<M v={doc.profit} />} />
          {!D(doc.discount).isZero() ? <Row k="تخفیف" v={<M v={doc.discount} neg />} /> : null}
          <Row k="مالیات بر ارزش افزوده (اجرت و سود)" v={<M v={doc.tax} />} />
          {!D(doc.stone).isZero() ? <Row k="سنگ و جواهر" v={<M v={doc.stone} />} /> : null}
          {!coins.isZero() ? <Row k="سکه" v={<M v={coins.toString()} />} /> : null}
          <Row k="جمع کل فاکتور" v={<M v={doc.total} />} strong />
          {!D(doc.old_value).isZero() ? (
            <>
              <Row k="کسر: طلای مستعمل" v={<M v={doc.old_value} neg />} />
              <Row k={net.isNeg() ? "قابل پرداخت به خریدار" : "مبلغ قابل پرداخت"} v={<M v={net.abs().toString()} />} strong />
            </>
          ) : null}
        </div>
      </div>
      <div className="sf-pr-words">
        مبلغ کل فاکتور به حروف: <b>{amountToWords(doc.total, unit)}</b>
        {!D(doc.old_value).isZero() ? <>، قابل پرداخت: <b>{amountToWords(net.abs(), unit)}</b></> : null}
      </div>
      <div className="sf-pr-note">
        مالیات بر ارزش افزوده فقط بر اجرت ساخت و سود فروشنده محاسبه شده و اصل طلا از آن معاف است. وزن‌ها به گرم و عیارها در هزار است.
        {doc.description ? <> توضیحات: {doc.description}</> : null}
      </div>
      <Signatures />
      <Colophon />
    </div>
  );
}

/** 80 mm till receipt of a sale: one column, 9 pt body, 11 pt total, the karat as text. */
export function SaleReceipt({ doc }: { doc: any }) {
  const { org, unit } = useOrg();
  const out = (doc.lines ?? []).filter((l: any) => l.direction === "out");
  const old = (doc.lines ?? []).filter((l: any) => l.kind === "old");
  const net = D(doc.total).minus(D(doc.old_value));
  const name = doc.party?.name ?? doc.buyer?.name ?? "مشتری گذری";
  const R = ({ k, v, total }: { k: ReactNode; v: ReactNode; total?: boolean }) => (
    <div className={`sf-rc-row ${total ? "is-total" : ""}`}>
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
  return (
    <div data-gold-receipt className="gold-print sf-rc">
      <div className="sf-rc-c">
        <b className="biz">{org.name}</b>
        {org.phone ? <div>{faDigits(org.phone)}</div> : null}
        <b className="t">رسید فروش طلا</b>
        <div>شماره‌ی {docNo(Number(doc.no))}، {formatJalali(doc.date)}، {formatJalaliDateTime(doc.created_at).split(" ")[1] ?? ""}</div>
        <div>خریدار: {name}</div>
        {doc.gram18 ? <div>نرخ هر گرم ۱۸ عیار {formatNumber(doc.gram18)} {unit}</div> : null}
      </div>
      <hr />
      {out.map((l: any, i: number) => (
        <div key={l.id ?? i} className="sf-rc-item">
          <b>
            {faDigits(i + 1)}. {l.kind === "coin" ? `${l.title ?? "سکه"} × ${faDigits(D(l.qty).toString())}` : l.title}
          </b>
          {l.tag_no ? <span> (اتیکت {faDigits(l.tag_no)})</span> : null}
          {l.kind !== "coin" ? (
            <div className="m">
              وزن {formatNumber(l.weight, { dp: 3, minDp: 3 })} گرم، عیار {fin(l.fineness)}
              <br />
              طلا <M v={l.gold_value} />، اجرت <M v={l.wage} />، سود <M v={l.profit} />، مالیات <M v={l.tax} />
              {!D(l.discount).isZero() ? <>، تخفیف <M v={l.discount} /></> : null}
              {!D(l.stone).isZero() ? <>، سنگ <M v={l.stone} /></> : null}
            </div>
          ) : null}
          <R k="جمع ردیف" v={<M v={l.total} />} />
        </div>
      ))}
      <hr />
      <R k="مالیات (اجرت و سود)" v={<M v={doc.tax} />} />
      <R k="جمع فاکتور" v={<M v={doc.total} />} total />
      {old.map((l: any, i: number) => (
        <R key={i} k={<>طلای کهنه {formatNumber(l.weight, { dp: 3, minDp: 3 })} گرم، عیار {fin(l.fineness)}</>} v={<M v={l.total} neg />} />
      ))}
      {old.length ? <R k={net.isNeg() ? "پرداختی به خریدار" : "قابل پرداخت"} v={<M v={net.abs().toString()} />} total /> : null}
      {payments(doc).map(([k, v]) => <R key={k} k={k} v={<M v={v} />} />)}
      {!D(doc.settle?.remaining ?? 0).isZero() ? <R k="مانده" v={<M v={doc.settle.remaining} />} total /> : null}
      <div className="sf-pr-note">{amountToWords(net.abs(), unit)}</div>
      <hr />
      <div className="sf-rc-thanks">مالیات فقط بر اجرت و سود است. از خرید شما سپاسگزاریم.</div>
    </div>
  );
}

const PARTY_LABEL: Partial<Record<DocKind, string>> = {
  purchase: "فروشنده (همکار)", buyback: "فروشنده", consign_in: "امانت‌گذار", consign_return: "امانت‌گذار", workshop_out: "کارگاه", workshop_in: "کارگاه",
  melt: "ذوب‌کار", bullion_sale: "خریدار", opening: "—",
};

/** A5 sheet of any non-sale gold document (receipt, delivery note, melt report…). */
export function DocSheet({ doc }: { doc: any }) {
  const { unit } = useOrg();
  const kind = doc.kind as DocKind;
  const lines = doc.lines ?? [];
  const money = !["consign_in", "consign_return", "workshop_out", "melt"].includes(kind);
  const sumW = (f: (l: any) => boolean, k = "weight750") => lines.filter(f).reduce((a: any, l: any) => a.plus(D(l[k])), D(0)).toString();
  const paid = payments(doc);
  return (
    <div className="gold-print sf-pr">
      <SellerBlock title={KINDS[kind]?.title ?? "سند طلا"} doc={doc} />
      {doc.party || doc.buyer?.name ? <BuyerBlock doc={doc} label={PARTY_LABEL[kind] ?? "طرف حساب"} /> : null}
      <RateLine doc={doc} />
      <table>
        <thead>
          <tr>
            <th className="c">ردیف</th>
            <th>شرح</th>
            <th>نوع</th>
            <th className="c">عیار</th>
            <th className="n">وزن (گرم)</th>
            <th className="n">معادل ۷۵۰</th>
            {money ? <th className="n">ارزش طلا</th> : null}
            {money ? <th className="n">اجرت</th> : null}
            {money ? <th className="n">مبلغ ({unit})</th> : <th className="n">بها (دفتری)</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l: any, i: number) => (
            <tr key={l.id ?? i}>
              <td className="c">{faDigits(i + 1)}</td>
              <td>
                {l.kind === "coin" ? `${l.title ?? "سکه"} × ${faDigits(D(l.qty).toString())}` : l.title}
                {l.tag_no || l.assay_no || (l.kind === "old" && l.deduction_pct) ? (
                  <span className="sub">
                    {[l.tag_no ? `اتیکت ${faDigits(l.tag_no)}` : null, l.assay_no ? `انگ ${l.assay_no}` : null, l.kind === "old" && l.deduction_pct ? `کسر ${faDigits(D(l.deduction_pct).toString())}٪` : null].filter(Boolean).join("، ")}
                  </span>
                ) : null}
              </td>
              <td>
                {l.kind === "piece" ? "جنس" : l.kind === "coin" ? "سکه" : l.kind === "old" ? "مستعمل" : formTitle(l.form)}
                {kind === "melt" ? (l.direction === "out" ? " (ورودی)" : " (حاصل)") : ""}
              </td>
              <td className="c">{fin(l.fineness)}</td>
              <td className="n"><W v={l.weight} /></td>
              <td className="n">{l.kind === "coin" ? "—" : <W v={l.weight750} />}</td>
              {money ? <td className="n"><M v={l.gold_value} /></td> : null}
              {money ? <td className="n"><M v={l.wage} /></td> : null}
              {money ? <td className="n"><b><M v={l.total} /></b></td> : <td className="n"><M v={l.cost ?? 0} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sf-pr-foot">
        <div className="sf-pr-box">
          <div className="sf-pr-sums">
            {!D(doc.weight_out).isZero() ? <Row k={kind === "melt" ? "وزن ۷۵۰ ورودی ذوب" : "وزن ۷۵۰ خروجی"} v={<W v={doc.weight_out} />} /> : null}
            {!D(doc.weight_in).isZero() ? <Row k={kind === "melt" ? "وزن ۷۵۰ آبشده‌ی حاصل" : "وزن ۷۵۰ ورودی"} v={<W v={doc.weight_in} />} /> : null}
            {kind === "melt" ? <Row k="افت / اضافه" v={<W v={D(doc.weight_out).minus(D(doc.weight_in)).toString()} />} strong /> : null}
            {kind === "consign_in" || kind === "consign_return" ? <Row k="تعداد اجناس" v={faDigits(lines.length)} /> : null}
            {kind === "workshop_in" && doc.settle?.consumed_weight750 ? <Row k="وزن مصرف‌شده از حساب کارگاه" v={<W v={doc.settle.consumed_weight750} />} /> : null}
          </div>
          <div className="sf-pr-note">به حروف: {weightToWords(sumW(() => true))} (معادل ۷۵۰)</div>
        </div>
        {money ? (
          <div>
            <div className="sf-pr-sums">
              {!D(doc.gold_value).isZero() ? <Row k="ارزش طلا" v={<M v={doc.gold_value} />} /> : null}
              {!D(doc.wage).isZero() ? <Row k="اجرت" v={<M v={doc.wage} />} /> : null}
              {!D(doc.tax).isZero() ? <Row k="مالیات" v={<M v={doc.tax} />} /> : null}
              <Row k="جمع کل" v={<M v={doc.total} />} strong />
              {doc.settle?.mode === "weight" ? <Row k="تسویه" v="وزنی (طلا به طلا)" /> : null}
              {paid.map(([k, v]) => <Row key={k} k={k} v={<M v={v} />} sub />)}
              {!D(doc.settle?.remaining ?? 0).isZero() ? <Row k="مانده به حساب طرف" v={<M v={doc.settle.remaining} />} strong /> : null}
            </div>
            <div className="sf-pr-words">{amountToWords(doc.total, unit)}</div>
          </div>
        ) : null}
      </div>
      {doc.description ? <div className="sf-pr-note">توضیحات: {doc.description}</div> : null}
      <Signatures left="تحویل‌گیرنده" right="تحویل‌دهنده" />
      <Colophon />
    </div>
  );
}

/**
 * The print sheet for a document in the chosen format. On screen it is laid out off-canvas (so
 * the receipt can be measured), in print it is the only thing on the page.
 */
export function PrintArea({ doc, format }: { doc: any; format: PrintFormat }) {
  if (!doc) return null;
  return (
    <div aria-hidden className="print-sheet pointer-events-none fixed top-0 -left-[400mm] w-[210mm] print:pointer-events-auto print:static print:w-auto">
      {doc.kind === "sale" ? format === "receipt" ? <SaleReceipt doc={doc} /> : <SaleInvoice doc={doc} /> : <DocSheet doc={doc} />}
    </div>
  );
}

/**
 * Print the sheet rendered by <PrintArea>: A5, or an 80 mm roll receipt whose page is exactly as
 * long as the receipt (CSS has no «auto» page height). Call after switching the format.
 */
export function printSheet(format: PrintFormat) {
  setTimeout(() => {
    if (format === "receipt") {
      const el = document.querySelector<HTMLElement>("[data-gold-receipt]");
      const px = el?.getBoundingClientRect().height ?? 900;
      printWithPage(`80mm ${Math.ceil((px * 25.4) / 96) + 6}mm`, "2mm 4mm");
    } else printWithPage("A5 portrait", "7mm");
  }, 80);
}

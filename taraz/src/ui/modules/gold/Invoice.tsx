// Printable gold documents. The sale invoice lists weight, fineness, gold value, wage, seller
// profit and VAT separately (as Iranian rules for gold sellers require; VAT is charged on wage
// and profit only), with the amount in words. Formats: A5 invoice, 80 mm till receipt, and a
// generic A5 sheet for the other document kinds. Rendered hidden on screen, shown in print.
import type { ReactNode } from "react";
import { useOrg } from "../../lib/org";
import { D, type Num } from "@shared/money";
import { faDigits, formatNumber, formatWeight } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { amountToWords, weightToWords } from "@shared/words";
import { KINDS, formTitle, printWithPage, wageText, type DocKind } from "./shared";

export type PrintFormat = "a5" | "receipt";

const cell = "border border-[#444] px-1 py-0.5 align-middle";
const head = `${cell} bg-[#eee] font-bold text-center`;

function M({ v, zero = "—" }: { v: Num; zero?: string }) {
  const { org } = useOrg();
  const d = D(v);
  if (d.isZero()) return <span>{zero}</span>;
  return <span className="num">{formatNumber(d, { dp: org.money_decimals ?? 0 })}</span>;
}

function W({ v }: { v: Num }) {
  return D(v).isZero() ? <span>—</span> : <span className="num">{formatWeight(v)}</span>;
}

function SellerBlock({ title, doc }: { title: string; doc: any }) {
  const { org } = useOrg();
  return (
    <header className="mb-2 flex items-start gap-3 border-b-2 border-black pb-2">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {org.logo ? <img src={org.logo} alt="" className="h-12 w-12 object-contain" /> : null}
        <div className="min-w-0">
          <div className="text-[14px] font-extrabold">{org.legal_name || org.name}</div>
          <div className="text-[10px]">
            {org.economic_code ? <>کد اقتصادی: <span className="num">{faDigits(org.economic_code)}</span>، </> : null}
            {org.national_id ? <>شناسه ملی: <span className="num">{faDigits(org.national_id)}</span>، </> : null}
            {org.registration_no ? <>شماره ثبت: <span className="num">{faDigits(org.registration_no)}</span></> : null}
          </div>
          <div className="text-[10px]">
            {[org.province, org.city, org.address].filter(Boolean).join("، ")}
            {org.postal_code ? <>، کد پستی: <span className="num">{faDigits(org.postal_code)}</span></> : null}
            {org.phone ? <>، تلفن: <span className="num">{faDigits(org.phone)}</span></> : null}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-center">
        <div className="text-[15px] font-extrabold">{title}</div>
        {doc.status === "cancelled" ? <div className="mt-1 border border-black px-2 text-[11px] font-bold">باطل شده</div> : null}
        {doc.status === "draft" ? <div className="mt-1 border border-black px-2 text-[11px] font-bold">پیش‌نویس</div> : null}
      </div>
      <div className="shrink-0 text-[11px] leading-5">
        <div>شماره: <b className="num">{faDigits(doc.no)}</b></div>
        <div>تاریخ: <b className="num">{formatJalali(doc.date)}</b></div>
        {doc.created_at ? <div className="text-[10px]">ثبت: <span className="num">{formatJalaliDateTime(doc.created_at)}</span></div> : null}
      </div>
    </header>
  );
}

function BuyerBlock({ doc, label = "خریدار" }: { doc: any; label?: string }) {
  const p = doc.party ?? {};
  const b = doc.buyer ?? {};
  const name = p.name ?? b.name ?? "مشتری گذری";
  const nid = p.national_id ?? b.national_id;
  const mobile = p.mobile ?? b.mobile;
  const eco = p.economic_code ?? b.economic_code;
  const addr = p.address ?? b.address;
  const postal = p.postal_code ?? b.postal_code;
  return (
    <section className="mb-2 grid grid-cols-3 gap-x-3 rounded border border-[#444] px-2 py-1 text-[11px]">
      <div className="col-span-1">{label}: <b>{name}</b>{p.code ? <span className="num"> ({faDigits(p.code)})</span> : null}</div>
      <div>{nid ? <>کد/شناسه ملی: <span className="num">{faDigits(nid)}</span></> : null}{eco ? <>، کد اقتصادی: <span className="num">{faDigits(eco)}</span></> : null}</div>
      <div>{mobile ? <>تلفن: <span className="num">{faDigits(mobile)}</span></> : null}</div>
      {addr || postal ? <div className="col-span-3">نشانی: {addr ?? ""}{postal ? <>، کد پستی: <span className="num">{faDigits(postal)}</span></> : null}</div> : null}
    </section>
  );
}

function RateLine({ doc }: { doc: any }) {
  const { unit } = useOrg();
  if (!doc.gram18 && !doc.mazaneh) return null;
  return (
    <div className="mb-1 text-[11px]">
      نرخ روز: هر گرم طلای ۱۸ عیار (۷۵۰) <b className="num">{formatNumber(doc.gram18 ?? 0)}</b> {unit}
      {doc.mazaneh ? <>، مظنه (مثقال ۷۰۵) <span className="num">{formatNumber(doc.mazaneh)}</span> {unit}</> : null}
    </div>
  );
}

function Signatures({ left = "امضای خریدار", right = "مهر و امضای فروشنده" }: { left?: string; right?: string }) {
  return (
    <div className="mt-6 grid grid-cols-2 text-center text-[11px]">
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
  if (s.bank && !D(s.bank.amount).isZero()) rows.push([`واریز بانکی${n.bank ? ` (${n.bank})` : ""}${s.bank.ref_no ? ` — پیگیری ${faDigits(s.bank.ref_no)}` : ""}`, s.bank.amount]);
  return rows;
}

function Row({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "text-[12px] font-extrabold" : ""}`}>
      <span>{k}</span>
      <span>{v}</span>
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
    <div className="gold-print bg-white text-[11px] leading-5 text-black">
      <SellerBlock title="فاکتور فروش طلا و جواهر" doc={doc} />
      <BuyerBlock doc={doc} />
      <RateLine doc={doc} />
      <table className="w-full border-collapse text-[10.5px]">
        <thead>
          <tr>
            <th className={head}>ردیف</th>
            <th className={head}>شرح کالا</th>
            <th className={head}>عیار</th>
            <th className={head}>وزن (گرم)</th>
            <th className={head}>ارزش طلا</th>
            <th className={head}>اجرت ساخت</th>
            <th className={head}>سود فروشنده</th>
            <th className={head}>تخفیف</th>
            <th className={head}>مالیات بر ارزش افزوده</th>
            <th className={head}>ارزش سنگ</th>
            <th className={head}>مبلغ کل</th>
          </tr>
        </thead>
        <tbody>
          {out.map((l: any, i: number) => (
            <tr key={l.id ?? i}>
              <td className={`${cell} text-center num`}>{faDigits(i + 1)}</td>
              <td className={cell}>
                {l.kind === "coin" ? `${l.title ?? l.coin_name ?? "سکه"} × ${faDigits(D(l.qty).toString())}` : l.title}
                {l.tag_no ? <span className="num text-[9.5px]"> — اتیکت {faDigits(l.tag_no)}</span> : null}
                {l.kind === "piece" && l.wage_type ? <div className="text-[9px]">اجرت: {wageText(l.wage_type, l.wage_value)}{l.profit_pct ? `، سود ${faDigits(D(l.profit_pct).toString())}٪` : ""}</div> : null}
              </td>
              <td className={`${cell} text-center num`}>{faDigits(D(l.fineness ?? 750).toString())}</td>
              <td className={`${cell} text-center`}><W v={l.weight} /></td>
              <td className={`${cell} text-left`}><M v={l.gold_value} /></td>
              <td className={`${cell} text-left`}><M v={l.wage} /></td>
              <td className={`${cell} text-left`}><M v={l.profit} /></td>
              <td className={`${cell} text-left`}><M v={l.discount} /></td>
              <td className={`${cell} text-left`}><M v={l.tax} /></td>
              <td className={`${cell} text-left`}><M v={l.stone} /></td>
              <td className={`${cell} text-left font-bold`}><M v={l.total} /></td>
            </tr>
          ))}
          <tr>
            <td className={`${cell} font-bold`} colSpan={3}>جمع</td>
            <td className={`${cell} text-center font-bold`}><W v={out.filter((l: any) => l.kind !== "coin").reduce((a: any, l: any) => a.plus(D(l.weight)), D(0)).toString()} /></td>
            <td className={`${cell} text-left font-bold`}><M v={doc.gold_value} /></td>
            <td className={`${cell} text-left font-bold`}><M v={doc.wage} /></td>
            <td className={`${cell} text-left font-bold`}><M v={doc.profit} /></td>
            <td className={`${cell} text-left font-bold`}><M v={doc.discount} /></td>
            <td className={`${cell} text-left font-bold`}><M v={doc.tax} /></td>
            <td className={`${cell} text-left font-bold`}><M v={doc.stone} /></td>
            <td className={`${cell} text-left font-bold`}><M v={doc.total} /></td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 grid grid-cols-2 gap-3">
        <div className="rounded border border-[#444] p-2">
          {old.length ? (
            <>
              <div className="mb-1 font-bold">طلای مستعمل دریافتی از خریدار</div>
              {old.map((l: any, i: number) => (
                <Row key={i} k={<span>{l.title ?? "طلای مستعمل"}: <span className="num">{formatWeight(l.weight)}</span> گرم عیار <span className="num">{faDigits(D(l.fineness).toString())}</span>{!D(l.discount).isZero() ? <> (کسر <span className="num">{faDigits(D(l.deduction_pct ?? 0).toString())}٪</span>)</> : null}</span>} v={<M v={l.total} />} />
              ))}
              <div className="my-1 border-t border-[#999]" />
            </>
          ) : null}
          {paid.map(([k, v]) => <Row key={k} k={k} v={<M v={v} />} />)}
          {!remaining.isZero() ? <Row k={net.isNeg() ? "مانده (بستانکار خریدار)" : "مانده (نسیه)"} v={<M v={remaining.toString()} />} strong /> : null}
          {!paid.length && remaining.isZero() && !old.length ? <div className="text-[10px]">تسویه شده</div> : null}
        </div>
        <div className="rounded border border-[#444] p-2">
          <Row k="جمع ارزش طلا" v={<M v={doc.gold_value} />} />
          <Row k="جمع اجرت ساخت" v={<M v={doc.wage} />} />
          <Row k="جمع سود فروشنده" v={<M v={doc.profit} />} />
          {!D(doc.discount).isZero() ? <Row k="تخفیف" v={<>(<M v={doc.discount} />)</>} /> : null}
          <Row k="مالیات بر ارزش افزوده (اجرت و سود)" v={<M v={doc.tax} />} />
          {!D(doc.stone).isZero() ? <Row k="ارزش سنگ و جواهر" v={<M v={doc.stone} />} /> : null}
          {!coins.isZero() ? <Row k="سکه" v={<M v={coins.toString()} />} /> : null}
          <Row k="جمع کل فاکتور" v={<M v={doc.total} />} strong />
          {!D(doc.old_value).isZero() ? <Row k="کسر: طلای مستعمل" v={<>(<M v={doc.old_value} />)</>} /> : null}
          <Row k={net.isNeg() ? "قابل پرداخت به خریدار" : "مبلغ قابل پرداخت"} v={<M v={net.abs().toString()} />} strong />
        </div>
      </div>
      <div className="mt-2 text-[11px]">
        مبلغ کل فاکتور به حروف: <b>{amountToWords(doc.total, unit)}</b>
        {!D(doc.old_value).isZero() ? <>، قابل پرداخت: <b>{amountToWords(net.abs(), unit)}</b></> : null}
      </div>
      <div className="mt-1 text-[9.5px]">
        مالیات بر ارزش افزوده فقط بر اجرت ساخت و سود فروشنده محاسبه شده و اصل طلا از آن معاف است. وزن‌ها به گرم و عیارها در هزار است.
        {doc.description ? <>، توضیحات: {doc.description}</> : null}
      </div>
      <Signatures />
    </div>
  );
}

/** 80 mm till receipt of a sale. */
export function SaleReceipt({ doc }: { doc: any }) {
  const { org, unit } = useOrg();
  const out = (doc.lines ?? []).filter((l: any) => l.direction === "out");
  const old = (doc.lines ?? []).filter((l: any) => l.kind === "old");
  const net = D(doc.total).minus(D(doc.old_value));
  const name = doc.party?.name ?? doc.buyer?.name ?? "مشتری گذری";
  return (
    <div data-gold-receipt className="gold-print mx-auto w-[72mm] bg-white text-[10.5px] leading-[1.55] text-black">
      <div className="text-center">
        <div className="text-[13px] font-extrabold">{org.name}</div>
        {org.phone ? <div className="num">{faDigits(org.phone)}</div> : null}
        <div className="mt-1 font-bold">رسید فروش طلا</div>
        <div className="num">ش {faDigits(doc.no)}، {formatJalali(doc.date)}، {formatJalaliDateTime(doc.created_at).split(" ")[1] ?? ""}</div>
        <div>خریدار: {name}</div>
        {doc.gram18 ? <div>گرم ۱۸: <span className="num">{formatNumber(doc.gram18)}</span></div> : null}
      </div>
      <div className="my-1 border-t border-dashed border-black" />
      {out.map((l: any, i: number) => (
        <div key={l.id ?? i} className="mb-1">
          <div className="font-bold">
            {faDigits(i + 1)}. {l.kind === "coin" ? `${l.title ?? "سکه"} × ${faDigits(D(l.qty).toString())}` : l.title}
            {l.tag_no ? <span className="num font-normal"> ({faDigits(l.tag_no)})</span> : null}
          </div>
          {l.kind !== "coin" ? (
            <div className="num">وزن {formatWeight(l.weight)} گرم، عیار {faDigits(D(l.fineness ?? 750).toString())}</div>
          ) : null}
          {l.kind !== "coin" ? (
            <div className="grid grid-cols-2 gap-x-2">
              <span>طلا: <M v={l.gold_value} /></span>
              <span>اجرت: <M v={l.wage} /></span>
              <span>سود: <M v={l.profit} /></span>
              <span>مالیات: <M v={l.tax} /></span>
              {!D(l.discount).isZero() ? <span>تخفیف: <M v={l.discount} /></span> : null}
              {!D(l.stone).isZero() ? <span>سنگ: <M v={l.stone} /></span> : null}
            </div>
          ) : null}
          <Row k="جمع ردیف" v={<M v={l.total} />} />
        </div>
      ))}
      <div className="my-1 border-t border-dashed border-black" />
      <Row k="جمع فاکتور" v={<M v={doc.total} />} strong />
      <Row k="مالیات (اجرت و سود)" v={<M v={doc.tax} />} />
      {old.map((l: any, i: number) => (
        <Row key={i} k={<span>طلای کهنه <span className="num">{formatWeight(l.weight)}</span>گ/<span className="num">{faDigits(D(l.fineness).toString())}</span></span>} v={<>(<M v={l.total} />)</>} />
      ))}
      <Row k={net.isNeg() ? "پرداختی به خریدار" : "قابل پرداخت"} v={<M v={net.abs().toString()} />} strong />
      {payments(doc).map(([k, v]) => <Row key={k} k={k} v={<M v={v} />} />)}
      {!D(doc.settle?.remaining ?? 0).isZero() ? <Row k="مانده" v={<M v={doc.settle.remaining} />} strong /> : null}
      <div className="mt-1 text-[9.5px]">{amountToWords(net.abs(), unit)}</div>
      <div className="my-1 border-t border-dashed border-black" />
      <div className="text-center text-[9.5px]">مالیات فقط بر اجرت و سود است، از خرید شما سپاسگزاریم</div>
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
    <div className="gold-print bg-white text-[11px] leading-5 text-black">
      <SellerBlock title={KINDS[kind]?.title ?? "سند طلا"} doc={doc} />
      {doc.party || doc.buyer?.name ? <BuyerBlock doc={doc} label={PARTY_LABEL[kind] ?? "طرف حساب"} /> : null}
      <RateLine doc={doc} />
      <table className="w-full border-collapse text-[10.5px]">
        <thead>
          <tr>
            <th className={head}>ردیف</th>
            <th className={head}>شرح</th>
            <th className={head}>نوع</th>
            <th className={head}>عیار</th>
            <th className={head}>وزن (گرم)</th>
            <th className={head}>معادل ۷۵۰</th>
            {money ? <th className={head}>ارزش طلا</th> : null}
            {money ? <th className={head}>اجرت</th> : null}
            {money ? <th className={head}>مبلغ</th> : <th className={head}>بها (دفتری)</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l: any, i: number) => (
            <tr key={l.id ?? i}>
              <td className={`${cell} text-center num`}>{faDigits(i + 1)}</td>
              <td className={cell}>
                {l.kind === "coin" ? `${l.title ?? "سکه"} × ${faDigits(D(l.qty).toString())}` : l.title}
                {l.tag_no ? <span className="num text-[9.5px]"> — اتیکت {faDigits(l.tag_no)}</span> : null}
                {l.assay_no ? <span className="text-[9.5px]"> — انگ {l.assay_no}</span> : null}
                {l.kind === "old" && l.deduction_pct ? <span className="text-[9.5px]"> — کسر {faDigits(D(l.deduction_pct).toString())}٪</span> : null}
              </td>
              <td className={`${cell} text-center`}>
                {l.kind === "piece" ? "جنس" : l.kind === "coin" ? "سکه" : l.kind === "old" ? "مستعمل" : formTitle(l.form)}
                {kind === "melt" ? (l.direction === "out" ? " (ورودی)" : " (حاصل)") : ""}
              </td>
              <td className={`${cell} text-center num`}>{faDigits(D(l.fineness ?? 750).toString())}</td>
              <td className={`${cell} text-center`}><W v={l.weight} /></td>
              <td className={`${cell} text-center`}>{l.kind === "coin" ? "—" : <W v={l.weight750} />}</td>
              {money ? <td className={`${cell} text-left`}><M v={l.gold_value} /></td> : null}
              {money ? <td className={`${cell} text-left`}><M v={l.wage} /></td> : null}
              {money ? <td className={`${cell} text-left font-bold`}><M v={l.total} /></td> : <td className={`${cell} text-left`}><M v={l.cost ?? 0} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div className="rounded border border-[#444] p-2">
          {!D(doc.weight_out).isZero() ? <Row k={kind === "melt" ? "وزن ۷۵۰ ورودی ذوب" : "وزن ۷۵۰ خروجی"} v={<W v={doc.weight_out} />} /> : null}
          {!D(doc.weight_in).isZero() ? <Row k={kind === "melt" ? "وزن ۷۵۰ آبشده‌ی حاصل" : "وزن ۷۵۰ ورودی"} v={<W v={doc.weight_in} />} /> : null}
          {kind === "melt" ? <Row k="افت / اضافه" v={<W v={D(doc.weight_out).minus(D(doc.weight_in)).toString()} />} strong /> : null}
          {kind === "consign_in" || kind === "consign_return" ? <Row k="تعداد اجناس" v={<span className="num">{faDigits(lines.length)}</span>} /> : null}
          {kind === "workshop_in" && doc.settle?.consumed_weight750 ? <Row k="وزن مصرف‌شده از حساب کارگاه" v={<W v={doc.settle.consumed_weight750} />} /> : null}
          <div className="mt-1 text-[10px]">به حروف: {weightToWords(sumW(() => true))} (معادل ۷۵۰)</div>
        </div>
        {money ? (
          <div className="rounded border border-[#444] p-2">
            {!D(doc.gold_value).isZero() ? <Row k="ارزش طلا" v={<M v={doc.gold_value} />} /> : null}
            {!D(doc.wage).isZero() ? <Row k="اجرت" v={<M v={doc.wage} />} /> : null}
            {!D(doc.tax).isZero() ? <Row k="مالیات" v={<M v={doc.tax} />} /> : null}
            <Row k="جمع کل" v={<M v={doc.total} />} strong />
            {doc.settle?.mode === "weight" ? <Row k="تسویه" v="وزنی (طلا به طلا)" /> : null}
            {paid.map(([k, v]) => <Row key={k} k={k} v={<M v={v} />} />)}
            {!D(doc.settle?.remaining ?? 0).isZero() ? <Row k="مانده به حساب طرف" v={<M v={doc.settle.remaining} />} strong /> : null}
            <div className="mt-1 text-[10px]">{amountToWords(doc.total, unit)}</div>
          </div>
        ) : null}
      </div>
      {doc.description ? <div className="mt-2 text-[10.5px]">توضیحات: {doc.description}</div> : null}
      <Signatures left="تحویل‌گیرنده" right="تحویل‌دهنده" />
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

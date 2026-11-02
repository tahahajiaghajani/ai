// The printed A5 slip of a receipt, payment or transfer (رسید دریافت/پرداخت وجه), components.md §12: the business
// and the document at the top, the lines with 0.5 pt rules, the total in words, signatures and «سیراف» at the foot.
// Only visible when printing; the page size is A5 while the document screen is open. Ink on white only.
import { useOrg } from "../../lib/org";
import { faDigits, formatMoney } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { amountToWords } from "@shared/words";
import { D } from "@shared/money";
import { KIND_SLIP, METHOD_SHORT, type DocKind } from "./labels";
import type { Line } from "./editor";
import { PrintFoot, PrintHead, Ref } from "../reports/kit";
import { Fragment, type ReactNode } from "react";

interface Props {
  kind: DocKind;
  no: number | null;
  date: string | null;
  partyName: string | null;
  accountName: string | null;
  description: string;
  lines: Line[];
}

export function PrintSlip({ kind, no, date, partyName, accountName, description, lines }: Props) {
  const { org, unit } = useOrg();
  const dp = org.money_decimals ?? 0;
  const total = kind === "transfer" ? D(lines.find((l) => l.direction === "in")?.amount) : lines.reduce((a, l) => a.plus(D(l.amount)), D(0));
  const fees = lines.reduce((a, l) => a.plus(D(l.fee)), D(0));
  const who = partyName ?? accountName ?? "";

  // bank references are Latin by nature: Geist Mono, LTR, Latin digits (grouped in 4 when long)
  const ref = (label: string, v: string) => (
    <>
      {label} <Ref v={v} />
    </>
  );
  const detail = (l: Line) => {
    const parts: ReactNode[] = [];
    if (kind === "transfer") parts.push(l.direction === "out" ? "برداشت از" : "واریز به");
    else if (!(l.method === "pos" && l.names.src?.includes(METHOD_SHORT.pos))) parts.push(`${METHOD_SHORT[l.method]} —`);
    if (l.method === "cheque") {
      const c = l.cheque;
      if (c.serial_no) parts.push(`سریال ${faDigits(c.serial_no)}`);
      if (c.sayad_no) parts.push(ref("صیادی", c.sayad_no));
      if (c.bank_name || l.names.bank) parts.push(`بانک ${c.bank_name || l.names.bank}`);
      if (c.due_date) parts.push(`سررسید ${formatJalali(c.due_date)}`);
      if (l.names.party && !partyName) parts.push(`(${l.names.party})`);
    } else {
      if (l.names.src) parts.push(l.names.src);
      if (l.names.detail) parts.push(l.names.detail);
      if (l.ref_no) parts.push(ref("پیگیری", l.ref_no));
    }
    if (l.description) parts.push(`— ${l.description}`);
    return parts.map((p, i) => <Fragment key={i}>{i ? " " : null}{p}</Fragment>);
  };

  return (
    <div className="bk-po bk-slip">
      <style>{"@media print { @page { size: A5 portrait; margin: 10mm; } }"}</style>
      <PrintHead title={KIND_SLIP[kind]} no={no} date={date} />
      {kind !== "transfer" ? (
        <div className="bk-pparty">
          <div>
            <small>{kind === "receipt" ? "دریافت از" : "پرداخت به"}</small>
            <b>{who || "—"}</b>
          </div>
          {partyName && accountName ? (
            <div>
              <small>بابت</small>
              {accountName}
            </div>
          ) : null}
        </div>
      ) : null}
      <table className="bk-ptbl">
        <thead>
          <tr>
            <th style={{ width: 22 }}>#</th>
            <th>شرح</th>
            <th style={{ width: 104 }}>مبلغ ({unit})</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.key}>
              <td className="n">{faDigits(i + 1)}</td>
              <td>{detail(l)}</td>
              <td className="n">{formatMoney(l.amount ?? 0, dp)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              جمع
              {fees.gt(0) ? <span style={{ fontWeight: 400 }}> (کارمزد بانکی {formatMoney(fees, dp)})</span> : null}
            </td>
            <td className="n">{formatMoney(total, dp)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="bk-pwords">به حروف: {amountToWords(total, unit)}</div>
      {description ? <div className="bk-pwords">توضیحات: {description}</div> : null}
      <PrintFoot sign={[kind === "payment" ? "امضای دریافت‌کننده" : "امضای پرداخت‌کننده", "امضای صندوقدار"]} />
    </div>
  );
}

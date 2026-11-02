// The printed A5 slip of a receipt, payment or transfer (رسید دریافت/پرداخت وجه): only visible when
// printing; the page size is set to A5 while the document screen is open.
import { useOrg } from "../../lib/org";
import { faDigits, formatMoney } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { amountToWords } from "@shared/words";
import { D } from "@shared/money";
import { KIND_SLIP, METHOD_SHORT, type DocKind } from "./labels";
import type { Line } from "./editor";

interface Props {
  kind: DocKind;
  no: number | null;
  date: string | null;
  partyName: string | null;
  accountName: string | null;
  description: string;
  lines: Line[];
}

const cell = { border: "1px solid #888", padding: "3px 6px" } as const;

export function PrintSlip({ kind, no, date, partyName, accountName, description, lines }: Props) {
  const { org, unit } = useOrg();
  const dp = org.money_decimals ?? 0;
  const total = kind === "transfer" ? D(lines.find((l) => l.direction === "in")?.amount) : lines.reduce((a, l) => a.plus(D(l.amount)), D(0));
  const fees = lines.reduce((a, l) => a.plus(D(l.fee)), D(0));
  const who = partyName ?? accountName ?? "";

  const detail = (l: Line) => {
    const parts: string[] = [];
    if (kind === "transfer") parts.push(l.direction === "out" ? "برداشت از" : "واریز به");
    else if (!(l.method === "pos" && l.names.src?.includes(METHOD_SHORT.pos))) parts.push(`${METHOD_SHORT[l.method]} —`);
    if (l.method === "cheque") {
      const c = l.cheque;
      if (c.serial_no) parts.push(`سریال ${faDigits(c.serial_no)}`);
      if (c.sayad_no) parts.push(`صیادی ${faDigits(c.sayad_no)}`);
      if (c.bank_name || l.names.bank) parts.push(`بانک ${c.bank_name || l.names.bank}`);
      if (c.due_date) parts.push(`سررسید ${formatJalali(c.due_date)}`);
      if (l.names.party && !partyName) parts.push(`(${l.names.party})`);
    } else {
      if (l.names.src) parts.push(l.names.src);
      if (l.names.detail) parts.push(l.names.detail);
      if (l.ref_no) parts.push(`پیگیری ${faDigits(l.ref_no)}`);
    }
    if (l.description) parts.push(`— ${l.description}`);
    return parts.join(" ");
  };

  return (
    <div className="print-sheet hidden text-[12px] leading-6 text-black print:block">
      <style>{"@media print { @page { size: A5 portrait; margin: 8mm; } .ant-layout { background: #fff !important; } }"}</style>
      <div className="flex items-start justify-between gap-3 pb-2" style={{ borderBottom: "2px solid #333" }}>
        <div className="min-w-0">
          <div className="text-[15px] font-bold">{org.name}</div>
          {org.phone ? <div className="text-[11px]">تلفن: {faDigits(String(org.phone))}</div> : null}
        </div>
        <div className="text-center text-[16px] font-bold">{KIND_SLIP[kind]}</div>
        <div className="text-left text-[11px]">
          <div>شماره: {no ? faDigits(no) : "—"}</div>
          <div>تاریخ: {formatJalali(date)}</div>
        </div>
      </div>
      {kind !== "transfer" ? (
        <div className="my-2">
          {kind === "receipt" ? "دریافت از" : "پرداخت به"}: <b>{who}</b>
          {partyName && accountName ? <span> — بابت {accountName}</span> : null}
        </div>
      ) : (
        <div className="my-2" />
      )}
      <table className="w-full" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...cell, width: 28 }}>#</th>
            <th style={cell}>شرح</th>
            <th style={{ ...cell, width: 120 }}>مبلغ ({unit})</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.key}>
              <td style={{ ...cell, textAlign: "center" }}>{faDigits(i + 1)}</td>
              <td style={cell}>{detail(l)}</td>
              <td style={{ ...cell, textAlign: "left" }}>{formatMoney(l.amount ?? 0, dp)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={cell} colSpan={2}>
              <b>جمع</b>
              {fees.gt(0) ? <span> (کارمزد بانکی: {formatMoney(fees, dp)})</span> : null}
            </td>
            <td style={{ ...cell, textAlign: "left" }}>
              <b>{formatMoney(total, dp)}</b>
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-2">مبلغ به حروف: {amountToWords(total, unit)}</div>
      {description ? <div className="mt-1">توضیحات: {description}</div> : null}
      <div className="mt-12 grid grid-cols-2 text-center">
        <div>{kind === "payment" ? "امضای دریافت‌کننده" : "امضای پرداخت‌کننده"}</div>
        <div>امضای صندوقدار</div>
      </div>
    </div>
  );
}

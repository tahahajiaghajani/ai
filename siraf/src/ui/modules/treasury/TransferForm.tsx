// Transfer between cash boxes and bank accounts (انتقال وجه): a source, a destination, the amount
// and an optional bank fee on either side. Shows the current balance of both sides.
import { Input, Segmented } from "antd";
import { ArrowLeft, Landmark, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toLatinDigits } from "../../lib/fa";
import { useOrg } from "../../lib/org";
import { MoneyInput, RefSelect } from "../../components/inputs";
import { Balance } from "../../components/display";
import { normalizeDigits } from "@shared/money";
import { amountToWords } from "@shared/words";
import { remember, type Line } from "./editor";
import { Field, ICON } from "../reports/kit";

export function TransferForm({ lines, setLines, readonly }: { lines: Line[]; setLines: (fn: (ls: Line[]) => Line[]) => void; readonly: boolean }) {
  const { api, unit } = useOrg();
  const bal = useQuery({ queryKey: ["treasury-balances"], queryFn: () => api.get("/treasury/balances"), staleTime: 30_000 });
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const amount = lines[0]?.amount ?? null;

  const balanceOf = (l: Line) => {
    if (!bal.data) return null;
    const row = l.method === "cash" ? bal.data.boxes.find((b: any) => b.id === l.cash_box_id) : bal.data.banks.find((b: any) => b.id === l.bank_account_id);
    return row ? row.balance : null;
  };

  const side = (i: 0 | 1) => {
    const l = lines[i];
    if (!l) return null;
    const isBank = l.method !== "cash";
    const b = balanceOf(l);
    return (
      <div className="bk-xfer-side">
        <h3>
          {isBank ? <Landmark {...ICON} className="bk-3" aria-hidden /> : <Wallet {...ICON} className="bk-3" aria-hidden />}
          {i === 0 ? "از (برداشت)" : "به (واریز)"}
          <Segmented
            size="small"
            disabled={readonly}
            value={isBank ? "bank" : "cash"}
            options={[
              { value: "cash", label: "صندوق" },
              { value: "bank", label: "بانک" },
            ]}
            onChange={(v) =>
              set(i, v === "cash" ? { method: "cash", bank_account_id: null, fee: null, ref_no: "" } : { method: "bank", cash_box_id: null })
            }
          />
        </h3>
        <Field label={isBank ? "حساب بانکی" : "صندوق"} extra={b !== null ? <>موجودی <Balance v={b} /></> : null}>
          {isBank ? (
            <RefSelect
              entity="bank_account"
              className="w-full"
              value={l.bank_account_id}
              disabled={readonly}
              placeholder="حساب بانکی"
              onChange={(id, o) => {
                set(i, { bank_account_id: id, names: { ...l.names, src: o?.label } });
                remember("bank_account", id);
              }}
            />
          ) : (
            <RefSelect
              entity="cash_box"
              className="w-full"
              value={l.cash_box_id}
              disabled={readonly}
              placeholder="صندوق"
              onChange={(id, o) => {
                set(i, { cash_box_id: id, names: { ...l.names, src: o?.label } });
                remember("cash_box", id);
              }}
            />
          )}
        </Field>
        {isBank ? (
          <div className="bk-grid2" style={{ rowGap: 12 }}>
            <Field label="شمارهٔ پیگیری">
              <Input dir="ltr" className="sf-code" style={{ textAlign: "right" }} value={toLatinDigits(l.ref_no ?? "")} disabled={readonly} onChange={(e) => set(i, { ref_no: normalizeDigits(e.target.value) })} />
            </Field>
            <Field label="کارمزد بانکی" extra="اختیاری">
              <MoneyInput value={l.fee} disabled={readonly} placeholder="—" onChange={(v) => set(i, { fee: v })} />
            </Field>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      <div className="bk-xfer">
        {side(0)}
        <div className="bk-xfer-arrow" aria-hidden>
          <span>
            <ArrowLeft {...ICON} />
          </span>
        </div>
        {side(1)}
      </div>
      <div className="bk-amount">
        <Field label="مبلغ انتقال" hint={amount ? amountToWords(amount, unit) : null}>
          <MoneyInput size="large" value={amount} disabled={readonly} showUnit onChange={(v) => setLines((ls) => ls.map((l) => ({ ...l, amount: v })))} />
        </Field>
      </div>
    </div>
  );
}

// Transfer between cash boxes and bank accounts (انتقال وجه): a source, a destination, the amount
// and an optional bank fee on either side. Shows the current balance of both sides.
import { Input, Segmented } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { MoneyInput, RefSelect } from "../../components/inputs";
import { Balance } from "../../components/display";
import { normalizeDigits } from "@shared/money";
import { faDigits } from "@shared/format";
import { amountToWords } from "@shared/words";
import { remember, type Line } from "./editor";

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
      <div className="tz-soft flex-1 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-bold">{i === 0 ? "از (برداشت)" : "به (واریز)"}</span>
          <Segmented
            size="small"
            className="ms-auto"
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
        </div>
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
        <div className="mt-1 min-h-5 text-xs text-muted">{b !== null ? <>موجودی فعلی: <Balance v={b} /></> : null}</div>
        {isBank ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <div className="mb-0.5 text-[11px] text-muted">شماره پیگیری</div>
              <Input dir="ltr" className="num" value={faDigits(l.ref_no)} disabled={readonly} onChange={(e) => set(i, { ref_no: normalizeDigits(e.target.value) })} />
            </div>
            <div>
              <div className="mb-0.5 text-[11px] text-muted">کارمزد بانکی</div>
              <MoneyInput value={l.fee} disabled={readonly} placeholder="—" onChange={(v) => set(i, { fee: v })} />
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      <div className="flex flex-col items-stretch gap-3 md:flex-row">
        {side(0)}
        <ArrowLeftOutlined className="self-center text-xl text-muted max-md:rotate-[-90deg]" />
        {side(1)}
      </div>
      <div className="mt-4 max-w-md">
        <div className="mb-1 text-xs text-muted">مبلغ انتقال</div>
        <MoneyInput
          size="large"
          value={amount}
          disabled={readonly}
          showUnit
          onChange={(v) => setLines((ls) => ls.map((l) => ({ ...l, amount: v })))}
        />
        <div className="mt-1 text-xs text-muted">{amount ? amountToWords(amount, unit) : ""}</div>
      </div>
    </div>
  );
}

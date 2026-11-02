// The small form of a cheque operation: deposit to a bank, clearance, cash collection, bounce,
// endorsement to another party, return, cancellation — or taking back the last operation.
import { useState } from "react";
import { Input, Modal, Radio } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { DateInput, PartySelect, RefSelect } from "../../components/inputs";
import { JDate } from "../../components/display";
import { Amt, Field, Note } from "../reports/kit";
import { faDigits } from "@shared/format";
import { formatJalali, todayISO } from "@shared/jalali";
import { ACTION_LABEL, OP_TITLE, type ChequeAction, type Direction } from "./labels";

export interface ChequeLike {
  id: string;
  direction: Direction;
  status: string;
  amount: string;
  due_date: string;
  serial_no: string | null;
  sayad_no: string | null;
  bank_name: string | null;
  party_id: string | null;
  party_name: string | null;
  bank_account_id: string | null;
  bank_account_name?: string | null;
  last_op_date?: string | null;
  last_op_action?: ChequeAction | null;
  history?: { action: ChequeAction; date: string }[];
}

export function chequeTitle(c: Pick<ChequeLike, "serial_no" | "sayad_no" | "bank_name">) {
  const no = c.serial_no || c.sayad_no || "";
  return `چک ${faDigits(no)}${c.bank_name ? ` ${c.bank_name}` : ""}`;
}

export function ChequeActionModal({ cheque, action, onClose }: { cheque: ChequeLike; action: ChequeAction; onClose: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const dir = cheque.direction;
  const [date, setDate] = useState<string | null>(todayISO());
  const [bankId, setBankId] = useState<string | null>(cheque.bank_account_id ?? null);
  const [boxId, setBoxId] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [toAccount, setToAccount] = useState<"bounced" | "ar">("bounced");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const undo = action === "undo";
  const last =
    cheque.history?.[cheque.history.length - 1] ??
    (cheque.last_op_action && cheque.last_op_date ? { action: cheque.last_op_action, date: cheque.last_op_date } : undefined);

  const needBank = (dir === "received" && (action === "deposit" || action === "clear"));
  const ready = undo || (!!date && (!needBank || !!bankId) && (action !== "cash" || !!boxId) && (action !== "endorse" || !!partyId));

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await api.post(`/treasury/cheques/${cheque.id}/action`, {
        action,
        date: undo ? null : date,
        bank_account_id: needBank ? bankId : null,
        cash_box_id: action === "cash" ? boxId : null,
        party_id: action === "endorse" ? partyId : null,
        to_account: action === "bounce" && dir === "received" ? toAccount : null,
        note: note.trim() || null,
      });
      n.ok(undo ? `آخرین عملیات ${chequeTitle(cheque)} برگشت داده شد.` : `${ACTION_LABEL[dir][action]}، ${chequeTitle(cheque)} ثبت شد.`);
      for (const key of [["treasury-cheques"], ["treasury-cheque", cheque.id], ["treasury-summary"], ["treasury-balances"], ["treasury-book"], ["treasury-due"], ["treasury-doc"], ["table"], ["dashboard"]]) {
        qc.invalidateQueries({ queryKey: key });
      }
      onClose();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      onOk={run}
      okText={undo ? "برگرداندن عملیات" : "ثبت"}
      cancelText="انصراف"
      okButtonProps={{ disabled: !ready, danger: undo || action === "bounce" }}
      confirmLoading={busy}
      title={`${ACTION_LABEL[dir][action] ?? action}، ${chequeTitle(cheque)}`}
      destroyOnHidden
      width={480}
    >
      <dl className="bk-dl bk-well mb-4" style={{ ["--cols" as string]: 3 }}>
        <div>
          <dt>{dir === "received" ? "از" : "در وجه"}</dt>
          <dd>{cheque.party_name ?? "—"}</dd>
        </div>
        <div>
          <dt>مبلغ</dt>
          <dd><Amt v={cheque.amount} /></dd>
        </div>
        <div>
          <dt>سررسید</dt>
          <dd><JDate v={cheque.due_date} /></dd>
        </div>
      </dl>
      {undo ? (
        <Note tone="warning">
          {last ? (
            <>
              <b>«{OP_TITLE[dir][last.action] ?? last.action}» مورخ {formatJalali(last.date)}</b> برگردانده و سند حسابداری آن حذف می‌شود.
            </>
          ) : (
            <><b>آخرین عملیات این چک</b> برگردانده و سند حسابداری آن حذف می‌شود.</>
          )}
        </Note>
      ) : (
        <div className="grid gap-4">
          <Field label="تاریخ عملیات">
            <DateInput value={date} onChange={setDate} autoFocus />
          </Field>
          {needBank ? (
            <Field label={action === "deposit" ? "واگذاری به حساب بانکی" : "حساب بانکی وصول‌کننده"}>
              <RefSelect entity="bank_account" value={bankId} onChange={setBankId} className="w-full" />
            </Field>
          ) : null}
          {dir === "issued" && action === "clear" ? (
            <div className="bk-f-h">از حساب بانکی <b className="bk-2" style={{ fontWeight: 500 }}>{cheque.bank_account_name ?? "—"}</b></div>
          ) : null}
          {action === "cash" ? (
            <Field label="صندوق دریافت‌کننده">
              <RefSelect entity="cash_box" value={boxId} onChange={setBoxId} className="w-full" />
            </Field>
          ) : null}
          {action === "endorse" ? (
            <Field label="واگذاری (خرج) به شخص" hint="مبلغ چک از بدهی ما به این شخص کم می‌شود.">
              <PartySelect value={partyId} onChange={setPartyId} className="w-full" />
            </Field>
          ) : null}
          {action === "bounce" && dir === "received" ? (
            <Field label="ثبت چک برگشتی در">
              <Radio.Group
                value={toAccount}
                onChange={(e) => setToAccount(e.target.value)}
                options={[
                  { value: "bounced", label: "اسناد برگشتی (پیگیری چک)" },
                  { value: "ar", label: "حساب دریافتنی شخص" },
                ]}
              />
            </Field>
          ) : null}
          {action === "bounce" && dir === "issued" ? <div className="bk-f-h">مبلغ چک دوباره به بدهی ما به {cheque.party_name ?? "شخص"} برمی‌گردد.</div> : null}
          {action === "cancel" ? <div className="bk-f-h">برگ چک باطل و مبلغ آن دوباره بدهی ما به {cheque.party_name ?? "شخص"} می‌شود.</div> : null}
          {action === "return" ? <div className="bk-f-h">چک به صاحبش پس داده می‌شود و مبلغ آن دوباره طلب ما از او می‌شود.</div> : null}
          <Field label="یادداشت (اختیاری)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} onPressEnter={run} maxLength={500} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

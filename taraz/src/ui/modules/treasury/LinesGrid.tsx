// The lines of a receipt or payment: a keyboard-first grid. The method of a line (cash, bank,
// POS, card, cheque, other account) decides which fields it shows; a cheque line opens a second
// row with the cheque's details (Sayad number, bank, due date …). Enter moves to the next field
// and from the last one to a new line.
import { Fragment, useRef } from "react";
import { AutoComplete, Button, Input, Select, Tag, Tooltip } from "antd";
import { DeleteOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { AccountSelect, DateInput, DetailSelect, MoneyInput, PartySelect, RefSelect } from "../../components/inputs";
import { Money, StatusTag } from "../../components/display";
import { faDigits } from "@shared/format";
import { normalizeDigits } from "@shared/money";
import { amountToWords } from "@shared/words";
import { BANKS, KIND_METHODS, METHOD_LABEL, chequeStatusMap, isSayad, type DocKind, type Method } from "./labels";
import { blankLine, lineTotals, remember, withMethod, type ChequeFields, type Line } from "./editor";

interface Props {
  kind: DocKind;
  lines: Line[];
  setLines: (fn: (ls: Line[]) => Line[]) => void;
  readonly: boolean;
  /** the document has a party: cheque lines use it as drawer/payee */
  hasParty: boolean;
}

/** Fields of a line in keyboard order (data-f keys). */
function fieldOrder(l: Line, needParty: boolean): string[] {
  switch (l.method) {
    case "cash":
      return ["method", "src", "amount", "desc"];
    case "other":
      return ["method", "src", "detail", "amount", "desc"];
    case "cheque":
      return l.direction === "in"
        ? ["method", "ref", "amount", "due", "sayad", "bank", "branch", "acct", "owner", ...(needParty ? ["party"] : []), "desc"]
        : ["method", "src", "ref", "amount", "due", "sayad", ...(needParty ? ["party"] : []), "desc"];
    default:
      return ["method", "src", "ref", "amount", "fee", "desc"];
  }
}

export function LinesGrid({ kind, lines, setLines, readonly, hasParty }: Props) {
  const { api, unit } = useOrg();
  const grid = useRef<HTMLDivElement>(null);
  const needParty = !hasParty;
  const methods = KIND_METHODS[kind];

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setCheque = (i: number, patch: Partial<ChequeFields>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, cheque: { ...l.cheque, ...patch } } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine(kind, ls[ls.length - 1]?.method === "cheque" ? "cheque" : ls[ls.length - 1]?.method ?? "cash")]);

  const focus = (i: number, f: string) =>
    requestAnimationFrame(() => {
      const el = grid.current?.querySelector<HTMLInputElement>(`[data-f="${i}:${f}"] input`);
      if (!el) return;
      el.focus();
      el.select?.();
    });
  const next = (i: number, f: string, line?: Line) => {
    const l = line ?? lines[i];
    if (!l) return;
    const order = fieldOrder(l, needParty);
    const k = order.indexOf(f);
    if (k >= 0 && k < order.length - 1) return focus(i, order[k + 1]);
    if (i === lines.length - 1) addLine();
    focus(i + 1, "method");
  };

  const pickBook = async (i: number, id: string | null, o?: { bank_account_id?: string; label?: string }) => {
    setCheque(i, { cheque_book_id: id, bank_account_id: o?.bank_account_id ?? null });
    set(i, { names: { ...lines[i].names, book: o?.label } });
    remember("cheque_book", id);
    if (id && !lines[i].cheque.serial_no) {
      try {
        const r = await api.get<{ serial: string | null }>(`/treasury/cheque-books/${id}/next-serial`);
        if (r.serial) setLines((ls) => ls.map((l, j) => (j === i && !l.cheque.serial_no ? { ...l, cheque: { ...l.cheque, serial_no: r.serial! } } : l)));
      } catch {
        /* suggestion only */
      }
    }
    if (id) next(i, "src");
  };

  const totals = lineTotals(lines);

  return (
    <div ref={grid} className="overflow-x-auto">
      <table className="tz-grid min-w-[920px]">
        <thead>
          <tr>
            <th className="w-10">ردیف</th>
            <th className="min-w-[150px]">روش</th>
            <th className="min-w-[220px]">صندوق / بانک / حساب</th>
            <th className="min-w-[170px]">پیگیری / سریال / تفصیلی</th>
            <th className="min-w-[160px]">مبلغ</th>
            <th className="min-w-[120px]">کارمزد بانکی</th>
            <th className="min-w-[180px]">شرح</th>
            {!readonly ? <th className="no-print w-10" /> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const lock = readonly || l.locked;
            const bankish = l.method === "bank" || l.method === "card" || l.method === "pos";
            const cq = l.cheque;
            return (
              <Fragment key={l.key}>
                <tr>
                  <td className="num text-center text-xs text-muted">{faDigits(i + 1)}</td>
                  <td data-f={`${i}:method`}>
                    <Select
                      variant="borderless"
                      className="w-full"
                      value={l.method}
                      disabled={lock}
                      popupMatchSelectWidth={false}
                      options={methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
                      onSelect={(m: Method) => {
                        const nl = m === l.method ? l : withMethod(l, m);
                        if (m !== l.method) set(i, nl);
                        remember(`method.${kind}`, m);
                        focus(i, fieldOrder(nl, needParty)[1]);
                      }}
                    />
                  </td>
                  <td data-f={`${i}:src`}>
                    {l.method === "cash" ? (
                      <RefSelect
                        className="w-full"
                        entity="cash_box"
                        variant="borderless"
                        value={l.cash_box_id}
                        disabled={lock}
                        placeholder="صندوق"
                        status={!l.cash_box_id && l.amount ? "warning" : undefined}
                        onChange={(id, o) => {
                          set(i, { cash_box_id: id, names: { ...l.names, src: o?.label } });
                          remember("cash_box", id);
                          if (id) next(i, "src");
                        }}
                      />
                    ) : l.method === "bank" || l.method === "card" ? (
                      <RefSelect
                        className="w-full"
                        entity="bank_account"
                        variant="borderless"
                        value={l.bank_account_id}
                        disabled={lock}
                        placeholder="حساب بانکی"
                        status={!l.bank_account_id && l.amount ? "warning" : undefined}
                        onChange={(id, o) => {
                          set(i, { bank_account_id: id, names: { ...l.names, src: o?.label } });
                          remember("bank_account", id);
                          if (id) next(i, "src");
                        }}
                      />
                    ) : l.method === "pos" ? (
                      <RefSelect
                        className="w-full"
                        entity="pos_terminal"
                        variant="borderless"
                        value={l.pos_id}
                        disabled={lock}
                        placeholder="کارتخوان"
                        status={!l.pos_id && l.amount ? "warning" : undefined}
                        onChange={(id, o) => {
                          set(i, { pos_id: id, names: { ...l.names, src: o?.label } });
                          remember("pos", id);
                          if (id) next(i, "src");
                        }}
                      />
                    ) : l.method === "other" ? (
                      <AccountSelect
                        className="w-full"
                        variant="borderless"
                        value={l.account_id}
                        disabled={lock}
                        onChange={(id, o) => {
                          set(i, { account_id: id, account: o ?? null, detail_id: null, names: { ...l.names, src: o?.label } });
                          if (id) focus(i, o?.detail_mode && o.detail_mode !== "none" ? "detail" : "amount");
                        }}
                      />
                    ) : l.direction === "out" ? (
                      <RefSelect
                        className="w-full"
                        entity="cheque_book"
                        variant="borderless"
                        value={cq.cheque_book_id}
                        disabled={lock}
                        showCode={false}
                        placeholder="دسته‌چک"
                        onChange={(id, o) => pickBook(i, id, o)}
                      />
                    ) : (
                      <span className="px-2 text-xs text-muted">چک دریافتی — مشخصات در ردیف زیر</span>
                    )}
                  </td>
                  <td data-f={`${i}:${l.method === "other" ? "detail" : "ref"}`}>
                    {bankish ? (
                      <Input
                        variant="borderless"
                        dir="ltr"
                        className="num"
                        value={faDigits(l.ref_no)}
                        disabled={lock}
                        placeholder="شماره پیگیری"
                        onChange={(e) => set(i, { ref_no: normalizeDigits(e.target.value) })}
                        onPressEnter={() => next(i, "ref")}
                      />
                    ) : l.method === "cheque" ? (
                      <Input
                        variant="borderless"
                        dir="ltr"
                        className="num"
                        value={faDigits(cq.serial_no)}
                        disabled={readonly}
                        placeholder="سریال چک"
                        onChange={(e) => setCheque(i, { serial_no: normalizeDigits(e.target.value).replace(/[^\d/-]/g, "") })}
                        onPressEnter={() => next(i, "ref")}
                      />
                    ) : l.method === "other" ? (
                      <DetailSelect
                        className="w-full"
                        variant="borderless"
                        value={l.detail_id}
                        kinds={l.account?.detail_kinds}
                        disabled={lock || !l.account || l.account.detail_mode === "none"}
                        status={l.account?.detail_mode === "required" && !l.detail_id ? "warning" : undefined}
                        placeholder={!l.account || l.account.detail_mode === "none" ? "—" : l.account.detail_mode === "required" ? "تفصیلی (الزامی)" : "تفصیلی (اختیاری)"}
                        onChange={(id, o) => {
                          set(i, { detail_id: id, names: { ...l.names, detail: o?.label } });
                          if (id) next(i, "detail");
                        }}
                      />
                    ) : (
                      <span className="px-2 text-muted">—</span>
                    )}
                  </td>
                  <td data-f={`${i}:amount`}>
                    <MoneyInput variant="borderless" value={l.amount} disabled={lock} placeholder="۰" onChange={(v) => set(i, { amount: v })} onPressEnter={() => next(i, "amount")} />
                  </td>
                  <td data-f={`${i}:fee`}>
                    {bankish ? (
                      <MoneyInput variant="borderless" value={l.fee} disabled={lock} placeholder="—" onChange={(v) => set(i, { fee: v })} onPressEnter={() => next(i, "fee")} />
                    ) : (
                      <span className="px-2 text-muted">—</span>
                    )}
                  </td>
                  <td data-f={`${i}:desc`}>
                    <Input variant="borderless" value={l.description} disabled={readonly} placeholder="شرح ردیف" onChange={(e) => set(i, { description: e.target.value })} onPressEnter={() => next(i, "desc")} />
                  </td>
                  {!readonly ? (
                    <td className="no-print text-center">
                      {l.locked ? (
                        <Tooltip title="این چک عملیات خورده است؛ مبلغ و شخص آن قفل است و ردیف حذف نمی‌شود">
                          <LockOutlined className="text-muted" />
                        </Tooltip>
                      ) : (
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          tabIndex={-1}
                          aria-label="حذف ردیف"
                          onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blankLine(kind, ls[0].method)]))}
                        />
                      )}
                    </td>
                  ) : null}
                </tr>
                {l.method === "cheque" ? (
                  <tr className="bg-gold-soft/40">
                    <td />
                    <td colSpan={readonly ? 6 : 7}>
                      <div className="flex flex-wrap items-end gap-2 py-1">
                        {l.status ? (
                          <div className="flex items-center gap-1 self-center">
                            <StatusTag s={l.status} map={chequeStatusMap(l.direction === "in" ? "received" : "issued")} />
                          </div>
                        ) : null}
                        <Field label="سررسید" w="w-36" f={`${i}:due`}>
                          <DateInput
                            value={cq.due_date}
                            disabled={readonly}
                            onChange={(v) => setCheque(i, { due_date: v })}
                            onPressEnter={() => next(i, "due")}
                          />
                        </Field>
                        <Field label="شناسه صیادی (۱۶ رقم)" w="w-48" f={`${i}:sayad`}>
                          <Input
                            dir="ltr"
                            className="num"
                            maxLength={16}
                            value={faDigits(cq.sayad_no)}
                            disabled={readonly}
                            status={cq.sayad_no && !isSayad(cq.sayad_no) ? "warning" : undefined}
                            onChange={(e) => setCheque(i, { sayad_no: normalizeDigits(e.target.value).replace(/\D/g, "") })}
                            onPressEnter={() => next(i, "sayad")}
                          />
                        </Field>
                        {l.direction === "in" ? (
                          <>
                            <Field label="بانک" w="w-36" f={`${i}:bank`}>
                              <AutoComplete
                                className="w-full"
                                value={cq.bank_name}
                                disabled={readonly}
                                options={BANKS}
                                showSearch={{ filterOption: (input, option) => String(option?.value ?? "").includes(input) }}
                                onChange={(v) => setCheque(i, { bank_name: v })}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") next(i, "bank");
                                }}
                              />
                            </Field>
                            <Field label="شعبه" w="w-32" f={`${i}:branch`}>
                              <Input value={cq.branch_name} disabled={readonly} onChange={(e) => setCheque(i, { branch_name: e.target.value })} onPressEnter={() => next(i, "branch")} />
                            </Field>
                            <Field label="شماره حساب" w="w-36" f={`${i}:acct`}>
                              <Input
                                dir="ltr"
                                className="num"
                                value={faDigits(cq.account_no)}
                                disabled={readonly}
                                onChange={(e) => setCheque(i, { account_no: normalizeDigits(e.target.value) })}
                                onPressEnter={() => next(i, "acct")}
                              />
                            </Field>
                            <Field label="صاحب حساب (صادرکننده)" w="w-44" f={`${i}:owner`}>
                              <Input value={cq.account_owner} disabled={readonly} onChange={(e) => setCheque(i, { account_owner: e.target.value })} onPressEnter={() => next(i, "owner")} />
                            </Field>
                          </>
                        ) : (
                          <Field label={cq.cheque_book_id ? "حساب بانکی (از دسته‌چک)" : "حساب بانکی"} w="w-52" f={`${i}:chqbank`}>
                            <RefSelect
                              className="w-full"
                              entity="bank_account"
                              value={cq.bank_account_id}
                              disabled={lock || !!cq.cheque_book_id}
                              placeholder="بدون دسته‌چک: حساب بانکی"
                              onChange={(id, o) => {
                                setCheque(i, { bank_account_id: id });
                                set(i, { names: { ...l.names, bank: o?.label } });
                              }}
                            />
                          </Field>
                        )}
                        {needParty ? (
                          <Field label={l.direction === "in" ? "طرف حساب چک" : "در وجه"} w="w-56" f={`${i}:party`}>
                            <PartySelect
                              className="w-full"
                              value={cq.party_id}
                              disabled={lock}
                              status={!cq.party_id ? "warning" : undefined}
                              onChange={(id, o) => {
                                setCheque(i, { party_id: id });
                                set(i, { names: { ...l.names, party: o?.label } });
                                if (id) next(i, "party");
                              }}
                            />
                          </Field>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>
              <div className="flex items-center gap-3">
                {!readonly ? (
                  <Button size="small" icon={<PlusOutlined />} onClick={addLine} className="no-print">
                    ردیف
                  </Button>
                ) : null}
                <span className="text-xs font-normal text-muted">{totals.amount.gt(0) ? amountToWords(totals.amount, unit) : ""}</span>
              </div>
            </td>
            <td>
              <Money v={totals.amount.toString()} />
            </td>
            <td>{totals.fee.gt(0) ? <Money v={totals.fee.toString()} /> : null}</td>
            <td colSpan={readonly ? 1 : 2}>
              {totals.fee.gt(0) ? (
                <Tag variant="filled" className="!m-0 text-xs font-normal">
                  {kind === "receipt" ? "خالص پس از کارمزد" : "جمع با کارمزد"}: <Money v={(kind === "receipt" ? totals.amount.minus(totals.fee) : totals.amount.plus(totals.fee)).toString()} />
                </Tag>
              ) : null}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Field({ label, children, w, f }: { label: string; children: React.ReactNode; w: string; f: string }) {
  return (
    <div className={w} data-f={f}>
      <div className="mb-0.5 text-[11px] text-muted">{label}</div>
      {children}
    </div>
  );
}

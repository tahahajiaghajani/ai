// The lines of a receipt or payment: a keyboard-first grid. The method of a line (cash, bank,
// POS, card, cheque, other account) decides which fields it shows; a cheque line opens a second
// row with the cheque's details (Sayad number, bank, due date …). Enter moves to the next field
// and from the last one to a new line.
import { Fragment, useRef } from "react";
import { AutoComplete, Button, Input, Select, Tooltip } from "antd";
import { Lock, Plus, Trash2 } from "lucide-react";
import { useOrg } from "../../lib/org";
import { AccountSelect, DateInput, DetailSelect, MoneyInput, PartySelect, RefSelect } from "../../components/inputs";
import { StatusTag } from "../../components/display";
import { Amt, Field, ICON14, Keys, cx } from "../reports/kit";
import { faDigits } from "@shared/format";
import { normalizeDigits } from "@shared/money";
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

/** An issued cheque's bank details follow its book / bank account (the server fills them in on save). */
const NO_BANK: Partial<ChequeFields> = { bank_name: "", branch_name: "", account_no: "", account_owner: "" };

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
    setCheque(i, { cheque_book_id: id, bank_account_id: o?.bank_account_id ?? null, ...NO_BANK });
    set(i, { names: { ...lines[i].names, book: o?.label, bank: undefined } });
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
    <>
    <div ref={grid} className="bk-gridwrap">
      <table className="bk-grid" style={{ minInlineSize: 960 }} role="grid" aria-label="ردیف‌های سند">
        <thead>
          <tr>
            <th className="bk-rn">ردیف</th>
            <th style={{ inlineSize: 168 }}>روش</th>
            <th style={{ minInlineSize: 220 }}>صندوق، بانک یا حساب</th>
            <th style={{ minInlineSize: 168 }}>پیگیری، سریال یا تفصیلی</th>
            <th className="bk-money">مبلغ ({unit})</th>
            <th style={{ inlineSize: 136 }}>کارمزد بانکی</th>
            <th style={{ minInlineSize: 180 }}>شرح</th>
            {!readonly ? <th className="bk-del" aria-label="حذف" /> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const lock = readonly || l.locked;
            const bankish = l.method === "bank" || l.method === "card" || l.method === "pos";
            const cq = l.cheque;
            return (
              <Fragment key={l.key}>
                <tr className={cx(l.method === "cheque" && "bk-has-sub")}>
                  <td className="bk-rn">{faDigits(i + 1)}</td>
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
                      <span className="bk-muted">چک دریافتی؛ مشخصات زیر همین ردیف</span>
                    )}
                  </td>
                  <td data-f={`${i}:${l.method === "other" ? "detail" : "ref"}`}>
                    {bankish ? (
                      <Input
                        variant="borderless"
                        dir="ltr"
                        className="sf-num"
                        style={{ textAlign: "right" }}
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
                        className="sf-num"
                        style={{ textAlign: "right" }}
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
                      <span className="bk-muted">—</span>
                    )}
                  </td>
                  <td data-f={`${i}:amount`} className="bk-money">
                    <MoneyInput variant="borderless" value={l.amount} disabled={lock} placeholder="—" onChange={(v) => set(i, { amount: v })} onPressEnter={() => next(i, "amount")} />
                  </td>
                  <td data-f={`${i}:fee`}>
                    {bankish ? (
                      <MoneyInput variant="borderless" value={l.fee} disabled={lock} placeholder="—" onChange={(v) => set(i, { fee: v })} onPressEnter={() => next(i, "fee")} />
                    ) : (
                      <span className="bk-muted">—</span>
                    )}
                  </td>
                  <td data-f={`${i}:desc`}>
                    <Input variant="borderless" value={l.description} disabled={readonly} placeholder="شرح ردیف" onChange={(e) => set(i, { description: e.target.value })} onPressEnter={() => next(i, "desc")} />
                  </td>
                  {!readonly ? (
                    <td className="bk-del">
                      {l.locked ? (
                        <Tooltip title="این چک عملیات خورده است؛ مبلغ و شخص آن قفل است و ردیف حذف نمی‌شود.">
                          <span className="bk-3 inline-grid" style={{ opacity: 1 }}>
                            <Lock {...ICON14} aria-label="قفل" />
                          </span>
                        </Tooltip>
                      ) : (
                        <Button
                          type="text"
                          size="small"
                          icon={<Trash2 {...ICON14} />}
                          tabIndex={-1}
                          aria-label="حذف ردیف"
                          onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blankLine(kind, ls[0].method)]))}
                        />
                      )}
                    </td>
                  ) : null}
                </tr>
                {l.method === "cheque" ? (
                  <tr className="bk-sub">
                    <td />
                    <td colSpan={readonly ? 6 : 7}>
                      <div className="bk-sub-in">
                        {l.status ? (
                          <div className="bk-sub-st">
                            وضعیت چک <StatusTag s={l.status} map={chequeStatusMap(l.direction === "in" ? "received" : "issued")} chip />
                          </div>
                        ) : null}
                        <SubField label="سررسید" w="w-36" f={`${i}:due`}>
                          <DateInput
                            value={cq.due_date}
                            disabled={readonly}
                            onChange={(v) => setCheque(i, { due_date: v })}
                            onPressEnter={() => next(i, "due")}
                          />
                        </SubField>
                        <SubField label="شناسهٔ صیادی (۱۶ رقم)" w="w-52" f={`${i}:sayad`}>
                          <Input
                            dir="ltr"
                            className="sf-code"
                            maxLength={16}
                            value={faDigits(cq.sayad_no)}
                            disabled={readonly}
                            status={cq.sayad_no && !isSayad(cq.sayad_no) ? "warning" : undefined}
                            onChange={(e) => setCheque(i, { sayad_no: normalizeDigits(e.target.value).replace(/\D/g, "") })}
                            onPressEnter={() => next(i, "sayad")}
                          />
                        </SubField>
                        {l.direction === "in" ? (
                          <>
                            <SubField label="بانک" w="w-36" f={`${i}:bank`}>
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
                            </SubField>
                            <SubField label="شعبه" w="w-32" f={`${i}:branch`}>
                              <Input value={cq.branch_name} disabled={readonly} onChange={(e) => setCheque(i, { branch_name: e.target.value })} onPressEnter={() => next(i, "branch")} />
                            </SubField>
                            <SubField label="شمارهٔ حساب" w="w-36" f={`${i}:acct`}>
                              <Input
                                dir="ltr"
                                className="sf-num"
                                style={{ textAlign: "right" }}
                                value={faDigits(cq.account_no)}
                                disabled={readonly}
                                onChange={(e) => setCheque(i, { account_no: normalizeDigits(e.target.value) })}
                                onPressEnter={() => next(i, "acct")}
                              />
                            </SubField>
                            <SubField label="صاحب حساب (صادرکننده)" w="w-44" f={`${i}:owner`}>
                              <Input value={cq.account_owner} disabled={readonly} onChange={(e) => setCheque(i, { account_owner: e.target.value })} onPressEnter={() => next(i, "owner")} />
                            </SubField>
                          </>
                        ) : (
                          <SubField label={cq.cheque_book_id ? "حساب بانکی (از دسته‌چک)" : "حساب بانکی"} w="w-52" f={`${i}:chqbank`}>
                            <RefSelect
                              className="w-full"
                              entity="bank_account"
                              value={cq.bank_account_id}
                              disabled={lock || !!cq.cheque_book_id}
                              placeholder="بدون دسته‌چک: حساب بانکی"
                              onChange={(id, o) => {
                                setCheque(i, { bank_account_id: id, ...NO_BANK });
                                set(i, { names: { ...l.names, bank: o?.label } });
                              }}
                            />
                          </SubField>
                        )}
                        {needParty ? (
                          <SubField label={l.direction === "in" ? "طرف حساب چک" : "در وجه"} w="w-56" f={`${i}:party`}>
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
                          </SubField>
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
          <tr className="bk-vt" data-state={totals.amount.gt(0) ? "settled" : "empty"}>
            <td colSpan={4}>
              <span className="bk-vt-track" aria-hidden />
              <div className="bk-vt-lab">
                <b>جمع</b>
                <span className="bk-plain">{faDigits(lines.filter((l) => l.amount).length)} ردیف</span>
              </div>
            </td>
            <td className="bk-money">
              <span className="bk-vt-n"><Amt v={totals.amount.toString()} /></span>
            </td>
            <td>
              <span className="bk-vt-n">{totals.fee.gt(0) ? <Amt v={totals.fee.toString()} /> : null}</span>
            </td>
            <td colSpan={readonly ? 1 : 2} />
          </tr>
        </tfoot>
      </table>
    </div>
    {!readonly ? (
      <div className="bk-grid-add">
        <Tooltip title={<Keys k={["Enter"]} />}>
          <Button size="small" type="text" icon={<Plus {...ICON14} />} onClick={addLine}>
            ردیف
          </Button>
        </Tooltip>
        <span className="bk-keys" aria-hidden>
          <span><Keys k={["Enter"]} /> خانهٔ بعد</span>
          <span><Keys k={["+"]} /> سه صفر</span>
          <span><Keys k={["Alt", "F2"]} /> ثبت و سند جدید</span>
        </span>
      </div>
    ) : null}
    </>
  );
}

function SubField({ label, children, w, f }: { label: string; children: React.ReactNode; w: string; f: string }) {
  return (
    <div className={w} data-f={f}>
      <Field label={label}>{children}</Field>
    </div>
  );
}

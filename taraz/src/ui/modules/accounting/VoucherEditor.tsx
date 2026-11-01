// Voucher (سند حسابداری) editor: a keyboard-first grid. Enter moves on, the last cell adds a
// row, «=» in an amount fills the balancing figure, F2 saves, Alt+N adds a row.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select, Tag, Tooltip, Alert, Dropdown, Spin } from "antd";
import { PlusOutlined, DeleteOutlined, SaveOutlined, PrinterOutlined, CheckCircleOutlined, CopyOutlined, MoreOutlined, ScissorOutlined, SwapOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useNotify, useHotkey } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { AccountSelect, DetailSelect, DateInput, MoneyInput, NumberInput, WeightInput, CurrencySelect, type Opt } from "../../components/inputs";
import { Money, StatusTag, JDateTime } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { todayISO, formatJalali } from "@shared/jalali";
import { amountToWords } from "@shared/words";
import { uuidv7 } from "@shared/id";

interface Line {
  key: string;
  account_id: string | null;
  account?: Opt | null;
  detail_id: string | null;
  description: string;
  debit: string | null;
  credit: string | null;
  currency_id: string | null;
  fx_debit: string | null;
  fx_credit: string | null;
  fx_rate: string | null;
  w_debit: string | null;
  w_credit: string | null;
}

const blank = (): Line => ({ key: uuidv7(), account_id: null, detail_id: null, description: "", debit: null, credit: null, currency_id: null, fx_debit: null, fx_credit: null, fx_rate: null, w_debit: null, w_credit: null });

const SOURCE_LABEL: Record<string, string> = {
  invoice: "فاکتور", treasury_doc: "سند خزانه", cheque_op: "عملیات چک", stock_doc: "سند انبار", gold_doc: "سند طلا", fx_deal: "معامله‌ی ارز", remittance: "حواله", fx_revaluation: "تسعیر ارز", closing: "بستن حساب‌ها", opening: "افتتاحیه",
};
const SOURCE_PATH: Record<string, string> = {
  invoice: "sales/invoices", treasury_doc: "treasury/docs", cheque_op: "treasury/cheque-ops", stock_doc: "inventory/docs", gold_doc: "gold/docs", fx_deal: "fx/deals", remittance: "fx/remittances", fx_revaluation: "fx/revaluation",
};

export default function VoucherEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const { api, org, can, orgId, unit } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const [date, setDate] = useState<string | null>(todayISO());
  const [description, setDescription] = useState("");
  const [refNo, setRefNo] = useState("");
  const [kind, setKind] = useState<"normal" | "opening">("normal");
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [showFx, setShowFx] = useState(false);
  const [showW, setShowW] = useState(false);
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const q = useQuery({ queryKey: ["voucher", id], queryFn: () => api.get(`/accounting/vouchers/${id}`).then((r) => r.voucher), enabled: !isNew });
  const v = q.data;
  const readonly = !!v && (v.kind === "auto" || v.status === "final" || !can("accounting", "edit"));

  useEffect(() => {
    if (!v) return;
    setDate(v.date);
    setDescription(v.description ?? "");
    setRefNo(v.ref_no ?? "");
    setKind(v.kind === "opening" ? "opening" : "normal");
    const ls: Line[] = v.lines.map((l: any) => ({
      key: l.id,
      account_id: l.account_id,
      account: { id: l.account_id, label: l.account_name, sub: l.account_code },
      detail_id: l.detail_id,
      description: l.description ?? "",
      debit: D(l.debit).isZero() ? null : l.debit,
      credit: D(l.credit).isZero() ? null : l.credit,
      currency_id: l.currency_id,
      fx_debit: D(l.fx_debit).isZero() ? null : l.fx_debit,
      fx_credit: D(l.fx_credit).isZero() ? null : l.fx_credit,
      fx_rate: l.fx_rate,
      w_debit: D(l.w_debit).isZero() ? null : l.w_debit,
      w_credit: D(l.w_credit).isZero() ? null : l.w_credit,
    }));
    setLines(readonly ? ls : [...ls, blank()]);
    setShowFx(ls.some((l) => l.currency_id));
    setShowW(ls.some((l) => l.w_debit || l.w_credit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  const totals = useMemo(() => {
    const dr = lines.reduce((a, l) => a.plus(D(l.debit)), D(0));
    const cr = lines.reduce((a, l) => a.plus(D(l.credit)), D(0));
    return { dr, cr, diff: dr.minus(cr) };
  }, [lines]);

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ensureTail = () => setLines((ls) => (ls[ls.length - 1]?.account_id ? [...ls, blank()] : ls));

  const focusCell = (row: number, col: number) => {
    requestAnimationFrame(() => {
      const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row}-${col}"] input, [data-cell="${row}-${col}"] .ant-select-selector`);
      if (el) (el as HTMLElement).focus?.();
      const input = gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${row}-${col}"] input`);
      input?.focus();
      input?.select?.();
    });
  };
  const COLS = 5;
  const onEnter = (row: number, col: number) => {
    if (col < COLS - 1) focusCell(row, col + 1);
    else {
      if (row === lines.length - 1) setLines((ls) => [...ls, blank()]);
      focusCell(row + 1, 0);
    }
  };

  const balanceLine = (i: number, side: "debit" | "credit") => {
    const others = lines.filter((_, j) => j !== i);
    const dr = others.reduce((a, l) => a.plus(D(l.debit)), D(0));
    const cr = others.reduce((a, l) => a.plus(D(l.credit)), D(0));
    const diff = side === "debit" ? cr.minus(dr) : dr.minus(cr);
    if (diff.gt(0)) set(i, side === "debit" ? { debit: diff.toString(), credit: null } : { credit: diff.toString(), debit: null });
  };

  const payload = (status: "draft" | "posted") => ({
    date,
    description: description || null,
    ref_no: refNo || null,
    kind,
    status,
    lines: lines
      .filter((l) => l.account_id)
      .map((l) => ({
        account_id: l.account_id,
        detail_id: l.detail_id,
        description: l.description || null,
        debit: l.debit ?? "0",
        credit: l.credit ?? "0",
        currency_id: l.currency_id,
        fx_debit: l.fx_debit ?? "0",
        fx_credit: l.fx_credit ?? "0",
        fx_rate: l.fx_rate,
        w_debit: l.w_debit ?? "0",
        w_credit: l.w_credit ?? "0",
      })),
  });

  const save = async (status: "draft" | "posted" = "posted") => {
    if (readonly || saving) return;
    if (!date) return n.warn("تاریخ سند را وارد کنید");
    setSaving(true);
    try {
      const r = isNew ? await api.post("/accounting/vouchers", payload(status)) : await api.put(`/accounting/vouchers/${id}`, payload(status));
      n.ok(`سند شماره‌ی ${faDigits(r.voucher.no)} ${status === "draft" ? "به‌صورت پیش‌نویس " : ""}ذخیره شد`);
      qc.invalidateQueries({ queryKey: ["table"] });
      qc.invalidateQueries({ queryKey: ["voucher", r.voucher.id] });
      if (isNew) nav(`/${orgId}/accounting/vouchers/${r.voucher.id}`, { replace: true });
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  useHotkey("f2", () => save("posted"), [lines, date, description, refNo, saving]);
  useHotkey("alt+n", () => setLines((ls) => [...ls, blank()]), []);

  const setStatus = async (status: "final" | "posted" | "draft") => {
    try {
      await api.post(`/accounting/vouchers/${id}/status`, { status });
      n.ok(status === "final" ? "سند قطعی شد" : "وضعیت تغییر کرد");
      q.refetch();
      qc.invalidateQueries({ queryKey: ["table"] });
    } catch (e) {
      n.error(e);
    }
  };

  const remove = async () => {
    if (!(await n.confirm("حذف این سند؟", undefined, true))) return;
    try {
      await api.del(`/accounting/vouchers/${id}`);
      n.ok("سند حذف شد");
      qc.invalidateQueries({ queryKey: ["table"] });
      nav(`/${orgId}/accounting/vouchers`);
    } catch (e) {
      n.error(e);
    }
  };

  if (!isNew && q.isLoading) return <div className="grid h-64 place-content-center"><Spin /></div>;
  if (!isNew && q.error) return <Alert type="error" title={errorText(q.error)} />;

  const balanced = totals.diff.isZero() && totals.dr.gt(0);
  return (
    <div>
      <PageHeader
        back={`/${orgId}/accounting/vouchers`}
        title={isNew ? "سند حسابداری جدید" : `سند شماره‌ی ${faDigits(v?.no)}`}
        subtitle={v ? <>ثبت: <JDateTime v={v.created_at} /></> : "Enter: خانه‌ی بعد · «=» در مبلغ: مبلغ تراز‌کننده · F2: ثبت"}
        extra={v ? <div className="flex gap-1"><StatusTag s={v.status} />{v.kind === "auto" ? <Tag color="purple" variant="filled">خودکار</Tag> : null}{v.kind === "opening" ? <Tag color="blue" variant="filled">افتتاحیه</Tag> : null}</div> : null}
        actions={
          <>
            {!readonly ? (
              <>
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => save("posted")}>
                  ثبت سند <span className="tz-kbd ltr ms-1 !bg-transparent !text-white/80">F2</span>
                </Button>
                <Button onClick={() => save("draft")} disabled={saving}>
                  پیش‌نویس
                </Button>
              </>
            ) : null}
            {!isNew ? (
              <>
                <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
                  چاپ
                </Button>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      ...(v?.status === "posted" && v?.kind !== "auto" && can("accounting", "full") ? [{ key: "final", icon: <CheckCircleOutlined />, label: "قطعی کردن سند", onClick: () => setStatus("final") }] : []),
                      { key: "copy", icon: <CopyOutlined />, label: "کپی به سند جدید", onClick: () => { nav(`/${orgId}/accounting/vouchers/new`); setTimeout(() => { setLines(lines.map((l) => ({ ...l, key: uuidv7() }))); }, 50); } },
                      ...(!readonly && can("accounting", "full") ? [{ key: "del", icon: <DeleteOutlined />, danger: true, label: "حذف سند", onClick: remove }] : []),
                    ],
                  }}
                >
                  <Button icon={<MoreOutlined />} aria-label="بیشتر" />
                </Dropdown>
              </>
            ) : null}
          </>
        }
      />

      {v?.kind === "auto" && v.source_type ? (
        <Alert
          className="!mb-4"
          type="info"
          showIcon
          title={
            <span>
              این سند خودکار از «{SOURCE_LABEL[v.source_type] ?? v.source_type}» ساخته شده و فقط از همان‌جا تغییر می‌کند.{" "}
              {SOURCE_PATH[v.source_type] ? <Link to={`/${orgId}/${SOURCE_PATH[v.source_type]}/${v.source_id}`}>مشاهده‌ی سند مبدأ</Link> : null}
            </span>
          }
        />
      ) : null}

      <div className="print-sheet tz-card p-4">
        <div className="mb-4 hidden text-center print:block">
          <div className="text-lg font-bold">{org.name}</div>
          <div className="text-base">سند حسابداری شماره‌ی {faDigits(v?.no ?? "")} — تاریخ {formatJalali(date)}</div>
        </div>
        <div className="no-print mb-4 grid gap-3 md:grid-cols-[160px_140px_1fr_160px_auto]">
          <div>
            <div className="mb-1 text-xs text-muted">تاریخ سند</div>
            <DateInput value={date} onChange={setDate} disabled={readonly} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">نوع سند</div>
            <Select
              className="w-full"
              value={kind}
              disabled={readonly || (!!v && v.kind !== "normal" && v.kind !== "opening")}
              onChange={setKind}
              options={[{ value: "normal", label: "عادی" }, { value: "opening", label: "افتتاحیه" }]}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">شرح سند</div>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={readonly} placeholder="شرح کلی سند (در ردیف‌هایی که شرح ندارند هم می‌آید)" />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">شماره‌ی عطف</div>
            <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} disabled={readonly} dir="ltr" />
          </div>
          <div className="flex items-end gap-2">
            <Tooltip title="ستون‌های ارزی (مبلغ ارز و نرخ)">
              <Button type={showFx ? "primary" : "default"} ghost={showFx} onClick={() => setShowFx(!showFx)} icon={<SwapOutlined />}>
                ارز
              </Button>
            </Tooltip>
            <Tooltip title="ستون‌های وزن طلا (گرم ۷۵۰)">
              <Button type={showW ? "primary" : "default"} ghost={showW} onClick={() => setShowW(!showW)} icon={<ScissorOutlined />}>
                وزن
              </Button>
            </Tooltip>
          </div>
        </div>

        <div ref={gridRef} className="overflow-x-auto">
          <table className="tz-grid min-w-[900px]">
            <thead>
              <tr>
                <th className="w-10">ردیف</th>
                <th className="min-w-[230px]">حساب معین</th>
                <th className="min-w-[200px]">تفصیلی</th>
                <th className="min-w-[200px]">شرح</th>
                {showFx ? <><th className="min-w-[120px]">ارز</th><th className="min-w-[120px]">مبلغ ارزی بد/بس</th><th className="min-w-[100px]">نرخ</th></> : null}
                {showW ? <th className="min-w-[110px]">وزن (گرم) بد/بس</th> : null}
                <th className="min-w-[150px]">بدهکار</th>
                <th className="min-w-[150px]">بستانکار</th>
                {!readonly ? <th className="no-print w-10" /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const acc = l.account;
                const needsDetail = acc?.detail_mode && acc.detail_mode !== "none";
                return (
                  <tr key={l.key}>
                    <td className="num text-center text-xs text-muted">{faDigits(i + 1)}</td>
                    <td data-cell={`${i}-0`}>
                      <AccountSelect
                        variant="borderless"
                        value={l.account_id}
                        disabled={readonly}
                        onChange={(id, o) => {
                          set(i, { account_id: id, account: o ?? null, detail_id: o?.detail_mode === "none" ? null : l.detail_id, currency_id: o?.currency_id ?? l.currency_id });
                          if (o?.fx_mode && o.fx_mode !== "none") setShowFx(true);
                          if (o?.weight_mode && o.weight_mode !== "none") setShowW(true);
                          if (id) ensureTail();
                          focusCell(i, o?.detail_mode && o.detail_mode !== "none" ? 1 : 2);
                        }}
                      />
                    </td>
                    <td data-cell={`${i}-1`}>
                      <DetailSelect
                        variant="borderless"
                        value={l.detail_id}
                        kinds={acc?.detail_kinds}
                        disabled={readonly || !needsDetail}
                        status={acc?.detail_mode === "required" && !l.detail_id && l.account_id ? "warning" : undefined}
                        placeholder={needsDetail ? (acc?.detail_mode === "required" ? "الزامی" : "اختیاری") : "—"}
                        onChange={(id) => {
                          set(i, { detail_id: id });
                          focusCell(i, 2);
                        }}
                      />
                    </td>
                    <td data-cell={`${i}-2`}>
                      <Input variant="borderless" value={l.description} disabled={readonly} placeholder={description || "شرح ردیف"} onChange={(e) => set(i, { description: e.target.value })} onPressEnter={() => onEnter(i, 2)} />
                    </td>
                    {showFx ? (
                      <>
                        <td>
                          <CurrencySelect variant="borderless" value={l.currency_id} disabled={readonly} onChange={(cid) => set(i, { currency_id: cid })} allowClear />
                        </td>
                        <td>
                          <NumberInput
                            variant="borderless"
                            decimals={8}
                            disabled={readonly || !l.currency_id}
                            value={l.fx_debit ?? (l.fx_credit ? `-${l.fx_credit}` : null)}
                            allowNegative
                            placeholder="+ بد / − بس"
                            onChange={(x) => {
                              const d = D(x);
                              const patch: Partial<Line> = d.isNeg() ? { fx_credit: d.abs().toString(), fx_debit: null } : { fx_debit: x, fx_credit: null };
                              if (l.fx_rate && x) {
                                const base = d.abs().times(D(l.fx_rate)).toDecimalPlaces(org.money_decimals).toString();
                                Object.assign(patch, d.isNeg() ? { credit: base, debit: null } : { debit: base, credit: null });
                              }
                              set(i, patch);
                            }}
                          />
                        </td>
                        <td>
                          <NumberInput
                            variant="borderless"
                            decimals={6}
                            disabled={readonly || !l.currency_id}
                            value={l.fx_rate}
                            onChange={(rate) => {
                              const fx = D(l.fx_debit ?? l.fx_credit);
                              const patch: Partial<Line> = { fx_rate: rate };
                              if (rate && !fx.isZero()) {
                                const base = fx.times(D(rate)).toDecimalPlaces(org.money_decimals).toString();
                                Object.assign(patch, l.fx_credit ? { credit: base, debit: null } : { debit: base, credit: null });
                              }
                              set(i, patch);
                            }}
                          />
                        </td>
                      </>
                    ) : null}
                    {showW ? (
                      <td>
                        <WeightInput
                          variant="borderless"
                          allowNegative
                          disabled={readonly}
                          value={l.w_debit ?? (l.w_credit ? `-${l.w_credit}` : null)}
                          placeholder="+ بد / − بس"
                          onChange={(x) => {
                            const d = D(x);
                            set(i, d.isNeg() ? { w_credit: d.abs().toString(), w_debit: null } : { w_debit: x, w_credit: null });
                          }}
                        />
                      </td>
                    ) : null}
                    <td data-cell={`${i}-3`}>
                      <AmountCell value={l.debit} disabled={readonly} onChange={(x) => set(i, { debit: x, credit: x ? null : l.credit })} onEq={() => balanceLine(i, "debit")} onEnter={() => (l.debit ? onEnter(i, 4) : onEnter(i, 3))} />
                    </td>
                    <td data-cell={`${i}-4`}>
                      <AmountCell value={l.credit} disabled={readonly} onChange={(x) => set(i, { credit: x, debit: x ? null : l.debit })} onEq={() => balanceLine(i, "credit")} onEnter={() => onEnter(i, 4)} />
                    </td>
                    {!readonly ? (
                      <td className="no-print text-center">
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} tabIndex={-1} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blank()]))} aria-label="حذف ردیف" />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4 + (showFx ? 3 : 0) + (showW ? 1 : 0)}>
                  <div className="flex items-center gap-3">
                    {!readonly ? (
                      <Button size="small" icon={<PlusOutlined />} onClick={() => setLines((ls) => [...ls, blank()])} className="no-print">
                        ردیف
                      </Button>
                    ) : null}
                    <span className="text-xs font-normal text-muted">{totals.dr.gt(0) ? amountToWords(totals.dr, unit) : ""}</span>
                  </div>
                </td>
                <td>
                  <Money v={totals.dr.toString()} />
                </td>
                <td>
                  <Money v={totals.cr.toString()} />
                </td>
                {!readonly ? <td className="no-print" /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="no-print mt-3 flex items-center gap-2 text-sm">
          {balanced ? (
            <Tag color="success" variant="filled">سند تراز است</Tag>
          ) : totals.dr.gt(0) || totals.cr.gt(0) ? (
            <Tag color="error" variant="filled">
              اختلاف: <span className="num">{formatNumber(totals.diff.abs(), { dp: org.money_decimals })}</span> {totals.diff.gt(0) ? "(بدهکار بیشتر)" : "(بستانکار بیشتر)"}
            </Tag>
          ) : null}
        </div>
        <div className="mt-10 hidden grid-cols-3 text-center text-sm print:grid">
          <div>تنظیم‌کننده</div>
          <div>بررسی‌کننده</div>
          <div>تأییدکننده</div>
        </div>
      </div>
    </div>
  );
}

function AmountCell({ value, onChange, onEq, onEnter, disabled }: { value: string | null; onChange: (v: string | null) => void; onEq: () => void; onEnter: () => void; disabled?: boolean }) {
  return (
    <div
      onKeyDownCapture={(e) => {
        if (e.key === "=") {
          e.preventDefault();
          onEq();
        }
      }}
    >
      <MoneyInput variant="borderless" value={value} onChange={onChange} disabled={disabled} onPressEnter={onEnter} placeholder="۰" />
    </div>
  );
}

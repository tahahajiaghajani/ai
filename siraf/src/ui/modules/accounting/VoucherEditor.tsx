// Voucher (سند حسابداری) editor: a keyboard-first grid (components.md §4.10). Enter moves on and the last cell adds a
// row; ↑/↓ stay in the column; «=» or Space in an empty amount fills the balancing figure; Ctrl+D copies the cell
// above; Ctrl+Delete removes the line; F2 or Ctrl+Enter saves; Alt+N adds a row. When debit equals credit the totals
// «settle» (نشستن): the difference chip shrinks into a nuqta that lands on the totals rule as it draws.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate, useParams, useLocation, Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select, Tooltip, Dropdown } from "antd";
import { Plus, Trash2, Printer, CircleCheck, Copy, Ellipsis, Coins, Weight as WeightIcon, CircleAlert } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useNotify, useHotkey } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { AccountSelect, DetailSelect, DateInput, MoneyInput, NumberInput, WeightInput, CurrencySelect, type Opt } from "../../components/inputs";
import { Chip, EmptyState, JDateTime, Skeleton, StatusTag } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { todayISO } from "@shared/jalali";
import { amountToWords } from "@shared/words";
import { uuidv7 } from "@shared/id";
import { Amt, BtnKeys, Card, Field, ICON, ICON14, Keys, Note, PrintFoot, PrintHead, docNo } from "../reports/kit";

interface Line {
  key: string;
  account_id: string | null;
  account?: Opt | null;
  detail_id: string | null;
  /** the subsidiary's name, for the printed voucher */
  detail?: string | null;
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

/** What «کپی به سند جدید» hands to the new-voucher form (as navigation state). */
interface Copy {
  date: string | null;
  description: string;
  refNo: string;
  kind: "normal" | "opening";
  lines: Line[];
}

const SOURCE_LABEL: Record<string, string> = {
  invoice: "فاکتور", treasury_doc: "سند خزانه", cheque_op: "عملیات چک", stock_doc: "سند انبار", gold_doc: "سند طلا", fx_deal: "معاملهٔ ارز", remittance: "حواله", fx_revaluation: "تسعیر ارز", closing: "بستن حساب‌ها", opening: "افتتاحیه",
};
const SOURCE_PATH: Record<string, string> = {
  invoice: "sales/invoices", treasury_doc: "treasury/docs", cheque_op: "treasury/cheque-ops", stock_doc: "inventory/docs", gold_doc: "gold/docs", fx_deal: "fx/deals", remittance: "fx/remittances", fx_revaluation: "fx/revaluation",
};
const KIND_WORD: Record<string, string> = { auto: "خودکار", opening: "افتتاحیه", closing: "اختتامیه", temp_closing: "بستن موقت" };

/** Grid columns that take keyboard focus, in order (data-cell="row-col"). */
const COLS = 5;
const FIELD_OF_COL = ["account", "detail", "description", "debit", "credit"] as const;

export default function VoucherEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const { api, org, can, orgId, unit } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const loc = useLocation();
  const copy = isNew ? ((loc.state as { copy?: Copy } | null)?.copy ?? null) : null;
  const [date, setDate] = useState<string | null>(copy ? copy.date : todayISO());
  const [description, setDescription] = useState(copy?.description ?? "");
  const [refNo, setRefNo] = useState(copy?.refNo ?? "");
  const [kind, setKind] = useState<"normal" | "opening">(copy?.kind ?? "normal");
  const [lines, setLines] = useState<Line[]>(() => (copy ? [...copy.lines.map((l) => ({ ...l, key: uuidv7() })), blank()] : [blank(), blank()]));
  const [showFx, setShowFx] = useState(() => !!copy?.lines.some((l) => l.currency_id));
  const [showW, setShowW] = useState(() => !!copy?.lines.some((l) => l.w_debit || l.w_credit));
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
      detail: l.detail_name ?? null,
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
      const cell = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row}-${col}"]`);
      if (!cell) return;
      const input = cell.querySelector<HTMLInputElement>("input:not([disabled])");
      if (input) {
        input.focus();
        input.select?.();
      } else if (col < COLS - 1) focusCell(row, col + 1);
    });
  };
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

  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blank()]));

  /** Grid keys on top of Enter: ↑/↓ in a column, Ctrl+D copies the cell above, Ctrl+Delete removes the line. */
  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (readonly) return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!cell) return;
    const [row, col] = cell.dataset.cell!.split("-").map(Number);
    const inSelect = !!(e.target as HTMLElement).closest(".ant-select");
    if (e.ctrlKey && !e.altKey && e.code === "KeyD") {
      e.preventDefault();
      const above = lines[row - 1];
      if (!above) return;
      const f = FIELD_OF_COL[col];
      if (f === "account") set(row, { account_id: above.account_id, account: above.account, detail_id: above.detail_id, detail: above.detail });
      else if (f === "detail") set(row, { detail_id: above.detail_id, detail: above.detail });
      else if (f === "description") set(row, { description: above.description });
      else if (f === "debit") set(row, { debit: above.debit, credit: above.debit ? null : lines[row].credit });
      else set(row, { credit: above.credit, debit: above.credit ? null : lines[row].debit });
      if (f === "account" && row === lines.length - 1 && above.account_id) setLines((ls) => [...ls, blank()]);
    } else if (e.ctrlKey && (e.key === "Delete" || e.code === "Delete")) {
      e.preventDefault();
      removeLine(row);
      focusCell(Math.min(row, lines.length - 2), col);
    } else if (!inSelect && !e.ctrlKey && !e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const to = row + (e.key === "ArrowDown" ? 1 : -1);
      if (to < 0 || to >= lines.length) return;
      e.preventDefault();
      focusCell(to, col);
    }
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
      n.ok(`سند ${docNo(r.voucher.no)} ${status === "draft" ? "به‌صورت پیش‌نویس " : ""}ذخیره شد.`);
      qc.invalidateQueries({ queryKey: ["table"] });
      qc.invalidateQueries({ queryKey: ["voucher", r.voucher.id] });
      if (isNew) nav(`/${orgId}/accounting/vouchers/${r.voucher.id}`, { replace: true });
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useHotkey("f2", () => saveRef.current("posted"), []);
  useHotkey("ctrl+enter", () => saveRef.current("posted"), []);
  useHotkey("alt+n", () => setLines((ls) => [...ls, blank()]), []);

  const setStatus = async (status: "final" | "posted" | "draft") => {
    try {
      await api.post(`/accounting/vouchers/${id}/status`, { status });
      n.ok(status === "final" ? `سند ${docNo(v?.no)} قطعی شد.` : "وضعیت سند تغییر کرد.");
      q.refetch();
      qc.invalidateQueries({ queryKey: ["table"] });
    } catch (e) {
      n.error(e);
    }
  };

  const remove = async () => {
    if (!(await n.confirm(`حذف سند ${docNo(v?.no)}؟`, `این سند و ${faDigits(lines.filter((l) => l.account_id).length)} ردیفش از دفتر کل برداشته می‌شود.`, true))) return;
    try {
      await api.del(`/accounting/vouchers/${id}`);
      n.ok(`سند ${docNo(v?.no)} حذف شد.`);
      qc.invalidateQueries({ queryKey: ["table"] });
      nav(`/${orgId}/accounting/vouchers`);
    } catch (e) {
      n.error(e);
    }
  };

  const back = `/${orgId}/accounting/vouchers`;
  if (!isNew && q.isLoading)
    return (
      <div>
        <PageHeader back={back} title="سند" />
        <Card>
          <Skeleton rows={8} />
        </Card>
      </div>
    );
  if (!isNew && (q.error || !v))
    return (
      <div>
        <PageHeader back={back} title="سند" />
        <Card>
          <EmptyState icon={CircleAlert} title="بارگذاری انجام نشد" description={q.error ? errorText(q.error) : "سند پیدا نشد."} action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} />
        </Card>
      </div>
    );

  const hasAmounts = totals.dr.gt(0) || totals.cr.gt(0);
  const state = !hasAmounts ? "empty" : totals.diff.isZero() ? "settled" : "diff";
  const filled = lines.filter((l) => l.account_id);
  const extraCols = (showFx ? 3 : 0) + (showW ? 1 : 0);

  return (
    <div>
      <PageHeader
        back={back}
        title={isNew ? "سند حسابداری جدید" : `سند ${docNo(v?.no)}`}
        subtitle={
          v ? (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <StatusTag s={v.status} />
              {KIND_WORD[v.kind] ? (
                <>
                  <span className="bk-sep" />
                  <span>{KIND_WORD[v.kind]}</span>
                </>
              ) : null}
              <span className="bk-sep" />
              <span>
                ثبت <JDateTime v={v.created_at} />
                {v.created_by_name ? `، ${v.created_by_name}` : ""}
              </span>
            </span>
          ) : null
        }
        actions={
          <>
            {!isNew ? (
              <>
                <Tooltip title="چاپ">
                  <Button type="text" icon={<Printer {...ICON} />} onClick={() => window.print()} aria-label="چاپ" />
                </Tooltip>
                <Dropdown
                  trigger={["click"]}
                  rootClassName="sf-glass"
                  menu={{
                    items: [
                      ...(v?.status === "posted" && v?.kind !== "auto" && can("accounting", "full") ? [{ key: "final", icon: <CircleCheck {...ICON} />, label: "قطعی کردن سند", onClick: () => setStatus("final") }] : []),
                      { key: "copy", icon: <Copy {...ICON} />, label: "کپی به سند جدید", onClick: () => nav(`/${orgId}/accounting/vouchers/new`, { state: { copy: { date, description, refNo, kind, lines: filled } satisfies Copy } }) },
                      ...(!readonly && can("accounting", "full") ? [{ type: "divider" as const }, { key: "del", icon: <Trash2 {...ICON} />, danger: true, label: "حذف سند", onClick: remove }] : []),
                    ],
                  }}
                >
                  <Button type="text" icon={<Ellipsis {...ICON} />} aria-label="بیشتر" />
                </Dropdown>
              </>
            ) : null}
            {!readonly ? (
              <>
                <Button onClick={() => save("draft")} disabled={saving}>
                  پیش‌نویس
                </Button>
                <Button type="primary" loading={saving} onClick={() => save("posted")}>
                  {saving ? "در حال ثبت…" : "ثبت سند"}
                  <BtnKeys k={["F2"]} />
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {v?.kind === "auto" && v.source_type ? (
        <Note
          className="no-print mb-4"
          action={
            SOURCE_PATH[v.source_type] ? (
              <Link className="sf-link" to={`/${orgId}/${SOURCE_PATH[v.source_type]}/${v.source_id}`}>
                مشاهدهٔ سند مبدأ
              </Link>
            ) : null
          }
        >
          این سند خودکار از «{SOURCE_LABEL[v.source_type] ?? v.source_type}» ساخته شده و فقط از همان‌جا تغییر می‌کند.
        </Note>
      ) : v?.status === "final" ? (
        <Note className="no-print mb-4">این سند قطعی شده و دیگر ویرایش نمی‌شود.</Note>
      ) : null}

      <section className="bk-card no-print">
        <div className="bk-fields bk-vh">
            <Field label="تاریخ سند">
              <DateInput value={date} onChange={setDate} disabled={readonly} />
            </Field>
            <Field label="نوع سند">
              <Select
                className="w-full"
                value={kind}
                disabled={readonly || (!!v && v.kind !== "normal" && v.kind !== "opening")}
                onChange={setKind}
                options={[{ value: "normal", label: "عادی" }, { value: "opening", label: "افتتاحیه" }]}
              />
            </Field>
            <Field label="شرح سند">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={readonly} placeholder="شرح کلی؛ ردیف‌های بی‌شرح همین را می‌گیرند" />
            </Field>
            <Field label="شمارهٔ عطف" extra="اختیاری">
              <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} disabled={readonly} dir="ltr" className="sf-num" style={{ textAlign: "right" }} />
            </Field>
            <div className="flex items-center gap-1 pb-px">
              <Tooltip title="ستون‌های ارزی: ارز، مبلغ ارزی و نرخ">
                <button type="button" className="bk-tog" aria-pressed={showFx} onClick={() => setShowFx(!showFx)}>
                  <Coins {...ICON} aria-hidden />
                  ارز
                </button>
              </Tooltip>
              <Tooltip title="ستون وزن طلا (گرم)">
                <button type="button" className="bk-tog" aria-pressed={showW} onClick={() => setShowW(!showW)}>
                  <WeightIcon {...ICON} aria-hidden />
                  وزن
                </button>
              </Tooltip>
            </div>
        </div>

        <div ref={gridRef} className="bk-gridwrap" onKeyDownCapture={onGridKey}>
          <table className="bk-grid" style={{ minInlineSize: 900 + extraCols * 130 }} role="grid" aria-label="ردیف‌های سند">
            <thead>
              <tr>
                <th className="bk-rn">ردیف</th>
                <th style={{ minInlineSize: 240 }}>حساب معین</th>
                <th style={{ minInlineSize: 200 }}>تفصیلی</th>
                <th style={{ minInlineSize: 200 }}>شرح</th>
                {showFx ? (
                  <>
                    <th style={{ minInlineSize: 112 }}>ارز</th>
                    <th style={{ minInlineSize: 136 }}>مبلغ ارزی</th>
                    <th style={{ minInlineSize: 112 }}>نرخ</th>
                  </>
                ) : null}
                {showW ? <th style={{ minInlineSize: 128 }}>وزن (گرم)</th> : null}
                <th className="bk-money">بدهکار</th>
                <th className="bk-money">بستانکار</th>
                {!readonly ? <th className="bk-del" aria-label="حذف" /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const acc = l.account;
                const needsDetail = acc?.detail_mode && acc.detail_mode !== "none";
                return (
                  <tr key={l.key}>
                    <td className="bk-rn">{faDigits(i + 1)}</td>
                    <td data-cell={`${i}-0`}>
                      <AccountSelect
                        className="w-full"
                        variant="borderless"
                        value={l.account_id}
                        disabled={readonly}
                        onChange={(aid, o) => {
                          set(i, { account_id: aid, account: o ?? null, detail_id: o?.detail_mode === "none" ? null : l.detail_id, currency_id: o?.currency_id ?? l.currency_id });
                          if (o?.fx_mode && o.fx_mode !== "none") setShowFx(true);
                          if (o?.weight_mode && o.weight_mode !== "none") setShowW(true);
                          if (aid) ensureTail();
                          focusCell(i, o?.detail_mode && o.detail_mode !== "none" ? 1 : 2);
                        }}
                      />
                    </td>
                    <td data-cell={`${i}-1`}>
                      {needsDetail || l.detail_id ? (
                        <DetailSelect
                          className="w-full"
                          variant="borderless"
                          value={l.detail_id}
                          kinds={acc?.detail_kinds}
                          disabled={readonly || !needsDetail}
                          status={acc?.detail_mode === "required" && !l.detail_id && l.account_id ? "warning" : undefined}
                          placeholder={acc?.detail_mode === "required" ? "الزامی" : "اختیاری"}
                          onChange={(did, o) => {
                            set(i, { detail_id: did, detail: o?.label ?? null });
                            focusCell(i, 2);
                          }}
                        />
                      ) : (
                        <span className="bk-muted">—</span>
                      )}
                    </td>
                    <td data-cell={`${i}-2`}>
                      <Input variant="borderless" value={l.description} disabled={readonly} placeholder={description || "شرح ردیف"} onChange={(e) => set(i, { description: e.target.value })} onPressEnter={() => onEnter(i, 2)} />
                    </td>
                    {showFx ? (
                      <>
                        <td>
                          <CurrencySelect className="w-full" variant="borderless" value={l.currency_id} disabled={readonly} onChange={(cid) => set(i, { currency_id: cid })} allowClear placeholder="—" />
                        </td>
                        <td>
                          <NumberInput
                            variant="borderless"
                            decimals={8}
                            disabled={readonly || !l.currency_id}
                            value={l.fx_debit ?? (l.fx_credit ? `-${l.fx_credit}` : null)}
                            allowNegative
                            placeholder="+ بد، − بس"
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
                            placeholder="—"
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
                          suffix={null}
                          value={l.w_debit ?? (l.w_credit ? `-${l.w_credit}` : null)}
                          placeholder="+ بد، − بس"
                          onChange={(x) => {
                            const d = D(x);
                            set(i, d.isNeg() ? { w_credit: d.abs().toString(), w_debit: null } : { w_debit: x, w_credit: null });
                          }}
                        />
                      </td>
                    ) : null}
                    <td data-cell={`${i}-3`} className="bk-money">
                      <AmountCell value={l.debit} disabled={readonly} onChange={(x) => set(i, { debit: x, credit: x ? null : l.credit })} onEq={() => balanceLine(i, "debit")} onEnter={() => (l.debit ? onEnter(i, 4) : onEnter(i, 3))} />
                    </td>
                    <td data-cell={`${i}-4`} className="bk-money">
                      <AmountCell value={l.credit} disabled={readonly} onChange={(x) => set(i, { credit: x, debit: x ? null : l.debit })} onEq={() => balanceLine(i, "credit")} onEnter={() => onEnter(i, 4)} />
                    </td>
                    {!readonly ? (
                      <td className="bk-del">
                        <Tooltip title={<>حذف ردیف <Keys k={["Ctrl", "Delete"]} /></>}>
                          <Button type="text" size="small" icon={<Trash2 {...ICON14} />} tabIndex={-1} onClick={() => removeLine(i)} aria-label="حذف ردیف" />
                        </Tooltip>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bk-vt" data-state={state}>
                <td colSpan={4 + extraCols}>
                  <span className="bk-vt-track" aria-hidden />
                  <span className="bk-vt-rule" aria-hidden />
                  <span className="bk-vt-nq" aria-hidden />
                  <div className="bk-vt-lab">
                    <b>جمع</b>
                    <span className="bk-vt-chip" aria-hidden={state !== "diff"}>
                      <Chip tone="warning" fig>
                        اختلاف {formatNumber(totals.diff.abs(), { dp: org.money_decimals })}
                      </Chip>
                    </span>
                    <span className="bk-vt-ok" aria-hidden={state !== "settled"}>
                      سند تراز است
                    </span>
                    <span className="sf-sr" aria-live="polite">
                      {state === "settled" ? "سند تراز است" : state === "diff" ? `اختلاف ${formatNumber(totals.diff.abs())}، ${totals.diff.gt(0) ? "بدهکار بیشتر" : "بستانکار بیشتر"}` : ""}
                    </span>
                  </div>
                </td>
                <td className="bk-money">
                  <span className="bk-vt-n"><Amt v={totals.dr.toString()} zero="—" /></span>
                </td>
                <td className="bk-money">
                  <span className="bk-vt-n"><Amt v={totals.cr.toString()} zero="—" /></span>
                </td>
                {!readonly ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="bk-grid-add">
          {!readonly ? (
            <Tooltip title={<Keys k={["Alt", "N"]} />}>
              <Button size="small" type="text" icon={<Plus {...ICON14} />} onClick={() => setLines((ls) => [...ls, blank()])}>
                ردیف
              </Button>
            </Tooltip>
          ) : null}
          <span className="bk-cap" style={{ whiteSpace: "normal" }}>{totals.dr.gt(0) ? amountToWords(totals.dr, unit) : null}</span>
          {!readonly ? (
            <span className="bk-keys" aria-hidden>
              <span><Keys k={["Enter"]} /> خانهٔ بعد</span>
              <span><Keys k={["="]} /> مبلغ تراز‌کننده</span>
              <span><Keys k={["Ctrl", "D"]} /> مثل ردیف بالا</span>
            </span>
          ) : null}
        </div>
      </section>

      <VoucherPrint no={v?.no ?? null} date={date} description={description} refNo={refNo} lines={filled} dr={totals.dr.toString()} cr={totals.cr.toString()} />
    </div>
  );
}

function AmountCell({ value, onChange, onEq, onEnter, disabled }: { value: string | null; onChange: (v: string | null) => void; onEq: () => void; onEnter: () => void; disabled?: boolean }) {
  return (
    <div
      onKeyDownCapture={(e) => {
        if (e.key === "=" || (e.key === " " && !value)) {
          e.preventDefault();
          onEq();
        }
      }}
    >
      <MoneyInput variant="borderless" value={value} onChange={onChange} disabled={disabled} onPressEnter={onEnter} placeholder="—" />
    </div>
  );
}

/** The printed voucher (components.md §12.3): the business and the document, the lines, totals, words, signatures. */
function VoucherPrint({ no, date, description, refNo, lines, dr, cr }: { no: number | null; date: string | null; description: string; refNo: string; lines: Line[]; dr: string; cr: string }) {
  const { unit } = useOrg();
  return (
    <div className="bk-po">
      <PrintHead title="سند حسابداری" no={no} date={date} lines={refNo ? [`عطف ${faDigits(refNo)}`] : undefined} />
      {description ? <div className="bk-pwords" style={{ marginBlock: "0 8px" }}>شرح: {description}</div> : null}
      <table className="bk-ptbl">
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th style={{ width: 70 }}>کد</th>
            <th>حساب و تفصیلی</th>
            <th>شرح</th>
            <th style={{ width: 112 }}>بدهکار ({unit})</th>
            <th style={{ width: 112 }}>بستانکار ({unit})</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.key}>
              <td className="n">{faDigits(i + 1)}</td>
              <td className="n">{faDigits(l.account?.sub ?? "")}</td>
              <td>
                {l.account?.label}
                {l.detail ? ` — ${l.detail}` : ""}
              </td>
              <td>{l.description || description}</td>
              <td className="n">{D(l.debit).isZero() ? "" : formatNumber(l.debit ?? 0)}</td>
              <td className="n">{D(l.credit).isZero() ? "" : formatNumber(l.credit ?? 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>جمع</td>
            <td className="n">{formatNumber(dr)}</td>
            <td className="n">{formatNumber(cr)}</td>
          </tr>
        </tfoot>
      </table>
      {D(dr).gt(0) ? <div className="bk-pwords">به حروف: {amountToWords(dr, unit)}</div> : null}
      <PrintFoot sign={["تنظیم‌کننده", "بررسی‌کننده", "تأییدکننده"]} />
    </div>
  );
}


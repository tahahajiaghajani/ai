// Stock document editor: receipt (opening stock / goods in without invoice), issue, transfer,
// adjustment and stock count. Keyboard-first grid (Enter moves on, F2 posts); the count mode
// loads the warehouse's items with their system quantity and shows the differences.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Dropdown, Input, Select, Spin, Tooltip } from "antd";
import { DeleteOutlined, FileTextOutlined, MoreOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SaveOutlined, UndoOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useHotkey, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { AccountSelect, DateInput, DetailSelect, MoneyInput, NumberInput, PartySelect, RefSelect, type Opt } from "../../components/inputs";
import { JDateTime, Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { formatJalali, todayISO } from "@shared/jalali";
import { uuidv7 } from "@shared/id";
import { STOCK_DOC_KINDS, STOCK_DOC_META, type StockDocKind } from "./labels";
import { InvoiceStatus, ItemSelect, KindTag, Qty, type ItemOpt } from "./components";

interface Line {
  key: string;
  id?: string | null;
  item: ItemOpt | null;
  qty: string | null;
  unit_id: string | null;
  unit_cost: string | null;
  counted_qty: string | null;
  system_qty: string | null;
  cost?: string | null;
  description: string;
}

const blank = (): Line => ({ key: uuidv7(), item: null, qty: null, unit_id: null, unit_cost: null, counted_qty: null, system_qty: null, description: "" });
const isUnit2 = (l: Line) => !!(l.item && l.unit_id && l.unit_id === l.item.unit2_id);
const unitName = (l: Line) => (isUnit2(l) ? l.item?.unit2_name : l.item?.unit_name) ?? "";

export default function StockDocEditorRoute() {
  const { id } = useParams();
  const loc = useLocation();
  return <StockDocEditor key={`${loc.pathname}${loc.search}`} id={id && id !== "new" ? id : null} />;
}

function StockDocEditor({ id }: { id: string | null }) {
  const isNew = !id;
  const [sp] = useSearchParams();
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const { api, org, can, orgId } = useOrg();
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";
  const pathKind: StockDocKind | null = loc.pathname.includes("/inventory/count") ? "count" : null;
  const initial = (pathKind ?? (sp.get("kind") as StockDocKind) ?? "receipt") as StockDocKind;
  const [kind, setKind] = useState<StockDocKind>(STOCK_DOC_KINDS.includes(initial) ? initial : "receipt");
  const [date, setDate] = useState<string | null>(todayISO(tz));
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [destId, setDestId] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [account, setAccount] = useState<Opt | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [saving, setSaving] = useState(false);
  const [allItems, setAllItems] = useState(false);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const meta = STOCK_DOC_META[kind];
  const count = kind === "count";
  const base = count ? "inventory/count" : "inventory/docs";

  const q = useQuery({ queryKey: ["goods-stock-doc", id], queryFn: () => api.get(`/goods/stock-docs/${id}`).then((r) => r.doc), enabled: !!id });
  const doc = q.data;
  const whQ = useQuery({ queryKey: ["goods-warehouses"], queryFn: () => api.get("/data/warehouse/options").then((r) => r.options as { id: string }[]), staleTime: 60_000 });
  // the chosen counter account's rules (does it take a detail?) for a loaded document
  const accQ = useQuery({
    queryKey: ["option", "account", accountId],
    queryFn: () => api.get("/data/account/options", { ids: accountId }).then((r) => (r.options[0] ?? null) as Opt | null),
    enabled: !!accountId && !account,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (!doc) return;
    setKind(doc.kind);
    setDate(doc.date);
    setWarehouseId(doc.warehouse_id);
    setDestId(doc.dest_warehouse_id);
    setPartyId(doc.party_id);
    setAccountId(doc.account_id);
    setDetailId(doc.detail_id);
    setDescription(doc.description ?? "");
    const ls: Line[] = doc.lines.map((l: any) => ({
      key: l.id,
      id: l.id,
      item: {
        id: l.item_id, code: l.item_code, name: l.item_name, kind: "goods", barcode: null,
        unit_id: l.item_unit_id, unit_name: l.main_unit_name, unit_decimals: l.main_unit_decimals,
        unit2_id: l.item_unit2_id, unit2_name: l.unit2_name, unit2_decimals: l.unit2_decimals, unit2_factor: l.item_unit2_factor,
        sale_price: null, purchase_price: null, vat_pct: null,
      } as ItemOpt,
      qty: l.qty,
      unit_id: l.unit_id,
      unit_cost: l.unit_cost,
      counted_qty: l.counted_qty,
      system_qty: l.system_qty,
      cost: l.cost,
      description: l.description ?? "",
    }));
    setLines(can("inventory", "edit") ? [...ls, blank()] : ls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  useEffect(() => {
    if (isNew && !warehouseId && whQ.data?.length) setWarehouseId(whQ.data[0].id);
  }, [whQ.data, isNew, warehouseId]);

  const readonly = !!doc && !can("inventory", "edit");
  const lookupCtx = useMemo(() => ({ kinds: "goods", warehouse_id: warehouseId, date }), [warehouseId, date]);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ensureTail = (ls: Line[]) => (ls.length && !ls[ls.length - 1].item ? ls : [...ls, blank()]);
  const focusCell = (row: number, col: number) =>
    requestAnimationFrame(() => {
      const input = gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${row}-${col}"] input`);
      input?.focus();
      input?.select?.();
    });
  const cols = kind === "receipt" || kind === "adjust" ? 3 : 2;
  const onEnter = (row: number, col: number) => {
    if (col < cols - 1) focusCell(row, col + 1);
    else {
      if (row === lines.length - 1) setLines((ls) => [...ls, blank()]);
      focusCell(row + 1, 0);
    }
  };
  const pick = (i: number, it: ItemOpt | null) => {
    if (!it) return set(i, { item: null });
    setLines((ls) =>
      ensureTail(
        ls.map((l, j) =>
          j === i
            ? {
                ...l,
                item: it,
                unit_id: it.unit_id,
                qty: l.qty ?? (count ? null : "1"),
                unit_cost: kind === "receipt" ? (it.purchase_price ?? it.avg_cost ?? null) : null,
                system_qty: count ? it.wh_stock ?? it.stock ?? "0" : null,
              }
            : l,
        ),
      ),
    );
    focusCell(i, 1);
  };

  const loadSheet = async () => {
    if (!warehouseId) return n.warn("انبار را انتخاب کنید");
    setLoadingSheet(true);
    try {
      const r = await api.get("/goods/stock-docs/count-sheet", { warehouse_id: warehouseId, date, all: allItems ? 1 : 0 });
      const had = new Map(lines.filter((l) => l.item).map((l) => [l.item!.id, l]));
      const next: Line[] = r.rows.map((x: any) => {
        const prev = had.get(x.item_id);
        return {
          key: prev?.key ?? uuidv7(),
          id: prev?.id ?? null,
          item: { id: x.item_id, code: x.code, name: x.name, kind: "goods", barcode: x.barcode, unit_id: null, unit_name: x.unit_name, unit_decimals: x.unit_decimals, unit2_id: null, unit2_name: null, unit2_decimals: null, unit2_factor: null, sale_price: null, purchase_price: null, vat_pct: null } as ItemOpt,
          qty: null,
          unit_id: null,
          unit_cost: null,
          counted_qty: prev?.counted_qty ?? null,
          system_qty: x.system_qty,
          description: prev?.description ?? "",
        };
      });
      for (const [itemId, l] of had) if (!r.rows.some((x: any) => x.item_id === itemId)) next.push(l);
      setLines([...next, blank()]);
      n.ok(`${faDigits(r.rows.length)} کالا بارگذاری شد`);
    } catch (e) {
      n.error(e);
    } finally {
      setLoadingSheet(false);
    }
  };

  const payload = (status: "draft" | "posted") => ({
    kind,
    status,
    date,
    warehouse_id: warehouseId,
    dest_warehouse_id: kind === "transfer" ? destId : null,
    party_id: partyId,
    account_id: kind === "transfer" || kind === "count" ? null : accountId,
    detail_id: kind === "transfer" || kind === "count" ? null : detailId,
    description: description.trim() || null,
    lines: lines
      .filter((l) => l.item && (!count || (l.counted_qty !== null && l.counted_qty !== "")))
      .map((l) => ({
        id: l.id ?? null,
        item_id: l.item!.id,
        qty: count ? null : l.qty,
        unit_id: count ? null : l.unit_id,
        unit_cost: kind === "receipt" || kind === "adjust" ? l.unit_cost : null,
        counted_qty: count ? l.counted_qty : null,
        description: l.description.trim() || null,
      })),
  });

  const save = async (status: "draft" | "posted") => {
    if (readonly || saving) return;
    if (!date) return n.warn("تاریخ را وارد کنید");
    if (!warehouseId) return n.warn("انبار را انتخاب کنید");
    if (kind === "transfer" && !destId) return n.warn("انبار مقصد را انتخاب کنید");
    const body = payload(status);
    if (!body.lines.length) return n.warn(count ? "مقدار شمارش‌شده‌ی دست‌کم یک کالا را وارد کنید" : "دست‌کم یک ردیف کالا وارد کنید");
    setSaving(true);
    try {
      const r = isNew ? await api.post("/goods/stock-docs", body) : await api.put(`/goods/stock-docs/${id}`, body);
      n.ok(`${meta.title} شماره‌ی ${faDigits(r.doc.no)} ${status === "draft" ? "به‌صورت پیش‌نویس " : ""}ذخیره شد`);
      for (const k of [["table"], ["goods-stock-doc"], ["goods-items"], ["goods-stock"], ["goods-kardex"]]) qc.invalidateQueries({ queryKey: k });
      nav(`/${orgId}/${base}/${r.doc.id}`, { replace: true });
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useHotkey("f2", () => saveRef.current("posted"), []);
  useHotkey("alt+n", () => setLines((ls) => [...ls, blank()]), []);

  const action = async (fn: () => Promise<any>, ok: string, after?: () => void) => {
    try {
      await fn();
      n.ok(ok);
      for (const k of [["table"], ["goods-stock-doc"], ["goods-items"], ["goods-stock"]]) qc.invalidateQueries({ queryKey: k });
      if (after) after();
      else q.refetch();
    } catch (e) {
      n.error(e);
    }
  };

  if (id && q.isLoading) return <div className="grid h-64 place-content-center"><Spin /></div>;
  if (id && q.error) return <Alert type="error" showIcon title={errorText(q.error)} />;

  const itemLines = lines.filter((l) => l.item);
  const receiptTotal = itemLines.reduce((a, l) => a.plus(D(l.qty).abs().times(D(l.unit_cost))), D(0)).toDecimalPlaces(org.money_decimals ?? 0);
  const posted = doc?.status === "posted";
  const docValue = doc ? (doc.kind === "transfer" ? D(doc.value_in) : D(doc.value_in).plus(D(doc.value_out))) : null;
  const showCost = posted && kind !== "receipt";
  // grid columns between «کالا» and «توضیح» (for the footer)
  const middleCols = count ? 3 + (posted ? 1 : 0) : 2 + (kind === "receipt" || kind === "adjust" ? 1 : 0) + (kind === "receipt" ? 1 : 0) + (showCost ? 1 : 0);
  const accountInfo = account ?? accQ.data ?? null;
  const needsDetail = accountInfo?.detail_mode && accountInfo.detail_mode !== "none";
  const accountHint: Record<string, string> = {
    receipt: partyId ? "خالی = حساب‌های پرداختنی شخص" : "خالی = تراز افتتاحیه (موجودی اول دوره)",
    issue: "خالی = هزینه‌های متفرقه",
    adjust: "خالی = اضافی / کسری انبار",
  };

  return (
    <div>
      <PageHeader
        back={`/${orgId}/${base}`}
        title={doc ? `${meta.title} شماره‌ی ${faDigits(doc.no)}` : `${meta.title} جدید`}
        subtitle={doc ? <>ثبت: <JDateTime v={doc.created_at} />{doc.created_by_name ? ` · ${doc.created_by_name}` : ""}</> : meta.hint}
        extra={doc ? <InvoiceStatus s={doc.status} /> : null}
        actions={
          <>
            {!readonly ? (
              <>
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => save("posted")}>
                  ثبت سند <span className="tz-kbd ltr ms-1 !bg-transparent !text-white/80">F2</span>
                </Button>
                <Button onClick={() => save("draft")} disabled={saving}>پیش‌نویس</Button>
              </>
            ) : null}
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ</Button>
            {doc ? (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    ...(doc.voucher_id && can("accounting", "view") ? [{ key: "v", icon: <FileTextOutlined />, label: `سند حسابداری ${faDigits(doc.voucher_no ?? "")}`, onClick: () => nav(`/${orgId}/accounting/vouchers/${doc.voucher_id}`) }] : []),
                    ...(posted && can("inventory", "edit") ? [{ key: "unpost", icon: <UndoOutlined />, label: "برگشت به پیش‌نویس", onClick: async () => { if (await n.confirm("سند به پیش‌نویس برگردد؟", "اثر آن روی موجودی و حساب‌ها حذف می‌شود.")) action(() => api.post(`/goods/stock-docs/${doc.id}/unpost`), "به پیش‌نویس برگشت"); } }] : []),
                    ...(can("inventory", "full") ? [{ key: "del", icon: <DeleteOutlined />, danger: true, label: "حذف سند", onClick: async () => { if (await n.confirm(`حذف ${meta.title}؟`, undefined, true)) action(() => api.del(`/goods/stock-docs/${doc.id}`), "حذف شد", () => nav(`/${orgId}/${base}`)); } }] : []),
                  ],
                }}
              >
                <Button icon={<MoreOutlined />} aria-label="بیشتر" />
              </Dropdown>
            ) : null}
          </>
        }
      />

      <div className="tz-card print-sheet p-4">
        <div className="mb-4 hidden text-center print:block">
          <div className="text-lg font-bold">{org.name}</div>
          <div className="text-base">{meta.title} شماره‌ی {faDigits(doc?.no ?? "")} — تاریخ {formatJalali(date)}</div>
          <div className="text-xs">انبار: {doc?.warehouse_name ?? ""}{kind === "transfer" ? ` ← ${doc?.dest_warehouse_name ?? ""}` : ""}</div>
        </div>
        <div className="no-print mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div>
            <div className="mb-1 text-xs text-muted">نوع سند</div>
            {isNew && !pathKind ? (
              <Select className="w-full" value={kind} onChange={setKind} options={STOCK_DOC_KINDS.filter((k) => k !== "count").map((k) => ({ value: k, label: STOCK_DOC_META[k].title }))} />
            ) : (
              <div className="pt-1"><KindTag kind={kind} /></div>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">تاریخ</div>
            <DateInput value={date} onChange={setDate} disabled={readonly} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">{kind === "transfer" ? "انبار مبدأ" : "انبار"}</div>
            <RefSelect entity="warehouse" value={warehouseId} onChange={setWarehouseId} disabled={readonly} showCode={false} />
          </div>
          {kind === "transfer" ? (
            <div>
              <div className="mb-1 text-xs text-muted">انبار مقصد</div>
              <RefSelect entity="warehouse" value={destId} onChange={setDestId} disabled={readonly} showCode={false} />
            </div>
          ) : null}
          {kind === "receipt" || kind === "issue" ? (
            <div>
              <div className="mb-1 text-xs text-muted">{kind === "receipt" ? "تحویل‌دهنده (اختیاری)" : "تحویل‌گیرنده (اختیاری)"}</div>
              <PartySelect value={partyId} onChange={setPartyId} allowClear disabled={readonly} />
            </div>
          ) : null}
          {kind === "receipt" || kind === "issue" || kind === "adjust" ? (
            <div className={needsDetail ? "" : "xl:col-span-2"}>
              <div className="mb-1 text-xs text-muted">حساب طرف سند</div>
              <AccountSelect
                value={accountId}
                allowClear
                disabled={readonly}
                placeholder={accountHint[kind]}
                onChange={(aid, o) => {
                  setAccountId(aid);
                  setAccount(o ?? null);
                  if (!o || o.detail_mode === "none") setDetailId(null);
                }}
              />
            </div>
          ) : null}
          {needsDetail && kind !== "transfer" && kind !== "count" ? (
            <div>
              <div className="mb-1 text-xs text-muted">تفصیلی</div>
              <DetailSelect value={detailId} onChange={setDetailId} kinds={accountInfo?.detail_kinds} allowClear disabled={readonly} />
            </div>
          ) : null}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-muted">شرح</div>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={readonly} />
          </div>
        </div>

        {count && !readonly ? (
          <div className="no-print mb-3 flex flex-wrap items-center gap-3">
            <Button icon={<ReloadOutlined />} loading={loadingSheet} onClick={loadSheet}>بارگذاری کالاهای انبار</Button>
            <Checkbox checked={allItems} onChange={(e) => setAllItems(e.target.checked)}>همه‌ی کالاها (حتی بدون موجودی)</Checkbox>
            <span className="text-xs text-muted">ردیف‌های بدون مقدار شمارش‌شده ثبت نمی‌شوند. اختلاف هنگام ثبت با موجودی همان لحظه محاسبه می‌شود.</span>
          </div>
        ) : null}

        <div ref={gridRef} className="overflow-x-auto">
          <table className="tz-grid min-w-[860px]">
            <thead>
              <tr>
                <th className="w-10">ردیف</th>
                <th className="min-w-[260px]">کالا</th>
                {count ? (
                  <>
                    <th className="w-[130px]">موجودی سیستم</th>
                    <th className="w-[140px]">شمارش‌شده</th>
                    <th className="w-[120px]">اختلاف</th>
                    {posted ? <th className="w-[140px]">ارزش اختلاف</th> : null}
                  </>
                ) : (
                  <>
                    <th className="w-[130px]">{kind === "adjust" ? "مقدار (+ اضافی / − کسری)" : "مقدار"}</th>
                    <th className="w-[100px]">واحد</th>
                    {kind === "receipt" || kind === "adjust" ? <th className="w-[150px]">بهای واحد</th> : null}
                    {kind === "receipt" ? <th className="w-[150px]">جمع بها</th> : null}
                    {showCost ? <th className="w-[150px]">بها (میانگین)</th> : null}
                  </>
                )}
                <th className="min-w-[160px]">توضیح</th>
                {!readonly ? <th className="no-print w-10" /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const diff = l.counted_qty !== null && l.counted_qty !== "" ? D(l.counted_qty).minus(D(l.system_qty)) : null;
                return (
                  <tr key={l.key}>
                    <td className="num text-center text-xs text-muted">{faDigits(i + 1)}</td>
                    <td data-cell={`${i}-0`}>
                      <ItemSelect variant="borderless" value={l.item?.id} item={l.item} ctx={lookupCtx} disabled={readonly} onChange={(it) => pick(i, it)} />
                    </td>
                    {count ? (
                      <>
                        <td className="px-2"><Qty v={l.system_qty ?? 0} unit={l.item?.unit_name} /></td>
                        <td data-cell={`${i}-1`}>
                          <NumberInput variant="borderless" decimals={l.item?.unit_decimals ?? 3} value={l.counted_qty} disabled={readonly || !l.item} onChange={(v) => set(i, { counted_qty: v })} onPressEnter={() => onEnter(i, 1)} />
                        </td>
                        <td className="px-2">{diff ? (diff.isZero() ? <span className="text-xs text-muted">بدون اختلاف</span> : <span className={diff.gt(0) ? "text-ok" : "text-bad"}><Qty v={diff.toString()} /></span>) : null}</td>
                        {posted ? <td className="px-2 text-left"><Money v={l.cost ?? 0} zero="—" /></td> : null}
                      </>
                    ) : (
                      <>
                        <td data-cell={`${i}-1`}>
                          <NumberInput variant="borderless" decimals={(isUnit2(l) ? l.item?.unit2_decimals : l.item?.unit_decimals) ?? 3} allowNegative={kind === "adjust"} value={l.qty} disabled={readonly || !l.item} onChange={(v) => set(i, { qty: v })} onPressEnter={() => onEnter(i, 1)} />
                        </td>
                        <td>
                          {l.item?.unit2_id ? (
                            <Select
                              variant="borderless"
                              className="w-full"
                              value={l.unit_id ?? l.item.unit_id ?? undefined}
                              disabled={readonly}
                              onChange={(u) => set(i, { unit_id: u })}
                              options={[{ value: l.item.unit_id ?? "", label: l.item.unit_name ?? "اصلی" }, { value: l.item.unit2_id, label: l.item.unit2_name ?? "فرعی" }]}
                            />
                          ) : (
                            <span className="px-2 text-xs text-muted">{unitName(l)}</span>
                          )}
                        </td>
                        {kind === "receipt" || kind === "adjust" ? (
                          <td data-cell={`${i}-2`}>
                            <Tooltip title={kind === "adjust" ? "برای اضافی انبار؛ خالی = میانگین بهای کالا" : undefined}>
                              <MoneyInput variant="borderless" value={l.unit_cost} disabled={readonly || !l.item || (kind === "adjust" && D(l.qty).lte(0))} onChange={(v) => set(i, { unit_cost: v })} onPressEnter={() => onEnter(i, 2)} placeholder={kind === "adjust" ? "میانگین" : "۰"} />
                            </Tooltip>
                          </td>
                        ) : null}
                        {kind === "receipt" ? <td className="px-2 text-left">{l.item ? <Money v={D(l.qty).times(D(l.unit_cost)).toDecimalPlaces(org.money_decimals ?? 0).toString()} /> : null}</td> : null}
                        {showCost ? <td className="px-2 text-left"><Money v={l.cost ?? 0} zero="—" /></td> : null}
                      </>
                    )}
                    <td>
                      <Input variant="borderless" value={l.description} disabled={readonly || !l.item} onChange={(e) => set(i, { description: e.target.value })} />
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
                <td colSpan={2}>
                  {!readonly ? <Button size="small" icon={<PlusOutlined />} className="no-print" onClick={() => setLines((ls) => [...ls, blank()])}>ردیف</Button> : null}
                  <span className="ms-3 text-xs font-normal text-muted">{faDigits(itemLines.length)} ردیف</span>
                </td>
                <td colSpan={middleCols} className="text-left">
                  {kind === "receipt" ? <Money v={receiptTotal.toString()} /> : docValue && !docValue.isZero() ? <span>ارزش سند: <Money v={docValue.toString()} /></span> : null}
                </td>
                <td colSpan={!readonly ? 2 : 1} />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-10 hidden grid-cols-3 text-center text-sm print:grid">
          <div>تحویل‌دهنده</div>
          <div>تحویل‌گیرنده</div>
          <div>انباردار</div>
        </div>
      </div>
    </div>
  );
}

// Tagged pieces (اجناس / اتیکت‌ها): filters (status, category, ownership, weight range), weight
// sums, editing, reserving, bulk tag creation for stock already in the showcase, and label
// printing with barcodes.
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Dropdown, Input, Select, Space, Table, Tag, Alert } from "antd";
import { PlusOutlined, PrinterOutlined, SearchOutlined, MoreOutlined, EditOutlined, AppstoreAddOutlined, FileExcelOutlined, LockOutlined, UnlockOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useAction, useDebounced, useNotify } from "../../lib/hooks";
import { exportExcel } from "../../lib/excel";
import { PageHeader } from "../../components/layout";
import { EntityForm } from "../../components/data";
import { MoneyInput, NumberInput, PartySelect, PctInput, RefSelect, WeightInput } from "../../components/inputs";
import { Money } from "../../components/display";
import { ENTITIES } from "@shared/entities";
import { D, normalizeDigits } from "@shared/money";
import { faDigits, formatWeight } from "@shared/format";
import { uuidv7 } from "@shared/id";
import { ITEM_STATUS, StatusOf, wageText, wageTypeOptions } from "./shared";
import { PrintLabelsModal, type LabelItem } from "./Labels";

export default function Items() {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [status, setStatus] = useState<string | undefined>(sp.get("status") ?? "in_stock,reserved");
  const [category, setCategory] = useState<string | null>(sp.get("category") ?? null);
  const [ownership, setOwnership] = useState<string | undefined>(sp.get("ownership") ?? undefined);
  const [minW, setMinW] = useState<string | null>(null);
  const [maxW, setMaxW] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [selected, setSelected] = useState<Map<string, any>>(new Map());
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const [bulk, setBulk] = useState(false);
  const [labels, setLabels] = useState<LabelItem[] | null>(null);
  const dq = useDebounced(q);
  const params = { q: dq, status, category_id: category, ownership, min_weight: minW, max_weight: maxW };
  const list = useQuery({
    queryKey: ["table", "/gold/items", params, page, size],
    queryFn: () => api.get("/gold/items", { ...params, page, size }),
    placeholderData: keepPreviousData,
  });
  const rows: any[] = list.data?.rows ?? [];
  const sums = list.data?.sums;
  const reserve = useAction((x: { id: string; on: boolean }) => api.post(`/gold/items/${x.id}/${x.on ? "reserve" : "release"}`), { success: "ذخیره شد", invalidate: [["table"]] });

  const printOne = (r: any) => setLabels([r]);
  const exportAll = async () => {
    try {
      const all = await api.get("/gold/items", { ...params, page: 1, size: 1000 });
      await exportExcel("اجناس طلا", [
        { title: "اتیکت", value: (r: any) => r.tag_no },
        { title: "شرح", value: (r: any) => r.title ?? "" },
        { title: "دسته", value: (r: any) => r.category_name ?? "" },
        { title: "عیار", value: (r: any) => r.fineness, type: "number" },
        { title: "وزن کل", value: (r: any) => r.gross_weight, type: "number" },
        { title: "وزن سنگ", value: (r: any) => r.stone_weight, type: "number" },
        { title: "وزن خالص", value: (r: any) => r.net_weight, type: "number" },
        { title: "معادل ۷۵۰", value: (r: any) => r.weight750, type: "number" },
        { title: "اجرت", value: (r: any) => wageText(r.wage_type, r.wage_value) },
        { title: "بها", value: (r: any) => r.cost, type: "number" },
        { title: "مالکیت", value: (r: any) => (r.ownership === "consignment" ? "امانی" : "متعلق به ما") },
        { title: "وضعیت", value: (r: any) => ITEM_STATUS[r.status]?.[0] ?? r.status },
        { title: "تأمین‌کننده", value: (r: any) => r.supplier_name ?? "" },
      ], all.rows);
    } catch (e) {
      n.error(e);
    }
  };

  return (
    <div>
      <PageHeader
        title="اجناس طلا (اتیکت‌ها)"
        actions={
          <>
            <Button icon={<PrinterOutlined />} disabled={!selected.size} onClick={() => setLabels([...selected.values()])}>
              چاپ اتیکت {selected.size ? `(${faDigits(selected.size)})` : ""}
            </Button>
            {can("gold", "edit") ? <Button icon={<AppstoreAddOutlined />} onClick={() => setBulk(true)}>ساخت گروهی اتیکت</Button> : null}
            {can("gold", "edit") ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>جنس جدید</Button> : null}
          </>
        }
      />
      <div className="no-print">
        <div className="mb-3 grid gap-3 sm:grid-cols-4">
          <Stat k="تعداد" v={<span className="num">{faDigits(sums?.n ?? 0)}</span>} />
          <Stat k="وزن کل" v={<span className="num">{formatWeight(sums?.gross ?? 0)}</span>} />
          <Stat k="وزن خالص طلا" v={<span className="num">{formatWeight(sums?.net ?? 0)}</span>} />
          <Stat k="معادل ۷۵۰" v={<span className="num text-gold">{formatWeight(sums?.w750 ?? 0)}</span>} />
        </div>
        <div className="tz-card p-3 md:p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input allowClear prefix={<SearchOutlined className="text-muted" />} placeholder="اتیکت، شرح یا سنگ…" className="!w-56" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            <Select
              allowClear
              placeholder="وضعیت"
              className="!w-40"
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={[{ value: "in_stock,reserved", label: "موجود و رزرو" }, ...Object.entries(ITEM_STATUS).map(([value, [label]]) => ({ value, label }))]}
            />
            <RefSelect entity="gold_category" showCode={false} value={category} onChange={(v) => { setCategory(v); setPage(1); }} allowClear placeholder="دسته" className="!w-40" />
            <Select allowClear placeholder="مالکیت" className="!w-36" value={ownership} onChange={(v) => { setOwnership(v); setPage(1); }} options={[{ value: "own", label: "متعلق به ما" }, { value: "consignment", label: "امانی" }]} />
            <Space.Compact className="!w-56">
              <WeightInput placeholder="از وزن" value={minW} onChange={(v) => { setMinW(v); setPage(1); }} />
              <WeightInput placeholder="تا وزن" value={maxW} onChange={(v) => { setMaxW(v); setPage(1); }} />
            </Space.Compact>
            <div className="ms-auto flex gap-1">
              {selected.size ? <Button size="small" type="link" onClick={() => setSelected(new Map())}>لغو انتخاب {faDigits(selected.size)}</Button> : null}
              <Button icon={<FileExcelOutlined />} onClick={exportAll} aria-label="خروجی اکسل" />
            </div>
          </div>
          <Table
            className="tz-table"
            size="small"
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            scroll={{ x: "max-content" }}
            rowClassName={(r: any) => (r.status !== "in_stock" && r.status !== "reserved" ? "row-muted" : "")}
            rowSelection={{
              selectedRowKeys: [...selected.keys()],
              preserveSelectedRowKeys: true,
              onChange: (keys, picked) => {
                const m = new Map(selected);
                for (const k of [...m.keys()]) if (!keys.includes(k) && rows.some((r) => r.id === k)) m.delete(k);
                for (const r of picked) if (r) m.set(r.id, r);
                setSelected(m);
              },
            }}
            onRow={(r: any) => ({ onDoubleClick: () => can("gold", "edit") && setEditing(r) })}
            pagination={{ current: page, pageSize: size, total: list.data?.total ?? 0, showSizeChanger: true, pageSizeOptions: [50, 100, 200, 500], size: "small", showTotal: (t) => `${faDigits(t)} جنس`, onChange: (p, s) => { setPage(p); setSize(s); } }}
            columns={[
              { key: "tag", dataIndex: "tag_no", title: "اتیکت", render: (v) => <b className="num ltr">{faDigits(v)}</b> },
              { key: "title", title: "شرح", render: (_, r: any) => <div><div>{r.title || r.category_name || "—"}</div>{r.stone_desc ? <div className="text-[11px] text-muted">{r.stone_desc}</div> : null}</div> },
              { key: "cat", dataIndex: "category_name", title: "دسته" },
              { key: "fin", dataIndex: "fineness", title: "عیار", render: (v) => <span className="num">{faDigits(D(v).toString())}</span> },
              { key: "gross", dataIndex: "gross_weight", title: "وزن کل", align: "left", render: (v) => <span className="num">{formatWeight(v)}</span> },
              { key: "stone", dataIndex: "stone_weight", title: "سنگ", align: "left", render: (v) => (D(v).isZero() ? <span className="text-muted">—</span> : <span className="num">{formatWeight(v)}</span>) },
              { key: "net", dataIndex: "net_weight", title: "خالص", align: "left", render: (v) => <span className="num">{formatWeight(v)}</span> },
              { key: "w750", dataIndex: "weight750", title: "۷۵۰", align: "left", render: (v) => <span className="num text-gold">{formatWeight(v)}</span> },
              { key: "wage", title: "اجرت", render: (_, r: any) => wageText(r.wage_type, r.wage_value) },
              { key: "cost", dataIndex: "cost", title: "بها", align: "left", render: (v) => <Money v={v ?? 0} zero="—" /> },
              { key: "own", dataIndex: "ownership", title: "مالکیت", render: (v, r: any) => (v === "consignment" ? <Tag color="purple" variant="filled" className="!m-0">امانی {r.supplier_name ? `، ${r.supplier_name}` : ""}</Tag> : <span className="text-xs text-muted">{r.supplier_name ?? ""}</span>) },
              { key: "st", dataIndex: "status", title: "وضعیت", render: (v) => <StatusOf s={v} map={ITEM_STATUS} /> },
              {
                key: "act", width: 44, fixed: "left" as const, render: (_, r: any) => (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: [
                          ...(can("gold", "edit") ? [{ key: "e", icon: <EditOutlined />, label: "ویرایش", onClick: () => setEditing(r) }] : []),
                          { key: "p", icon: <PrinterOutlined />, label: "چاپ اتیکت", onClick: () => printOne(r) },
                          ...(can("gold", "edit") && r.status === "in_stock" ? [{ key: "r", icon: <LockOutlined />, label: "رزرو برای مشتری", onClick: () => reserve.mutate({ id: r.id, on: true }) }] : []),
                          ...(can("gold", "edit") && r.status === "reserved" ? [{ key: "u", icon: <UnlockOutlined />, label: "آزاد کردن رزرو", onClick: () => reserve.mutate({ id: r.id, on: false }) }] : []),
                          ...(r.in_doc_id ? [{ key: "i", label: "سند ورود", onClick: () => nav(`/${orgId}/gold/docs/${r.in_doc_id}`) }] : []),
                          ...(r.out_doc_id ? [{ key: "o", label: "سند خروج / فروش", onClick: () => nav(`/${orgId}/gold/docs/${r.out_doc_id}`) }] : []),
                        ],
                      }}
                    >
                      <Button type="text" size="small" icon={<MoreOutlined />} aria-label="عملیات" />
                    </Dropdown>
                  </span>
                ),
              },
            ]}
          />
        </div>
      </div>
      <Drawer open={editing !== undefined} onClose={() => setEditing(undefined)} size={820} title={editing?.id ? `ویرایش اتیکت ${faDigits(editing.tag_no)}` : "جنس جدید"} destroyOnHidden styles={{ body: { paddingBottom: 0 } }} rootClassName="no-print">
        {editing !== undefined ? (
          <>
            {!editing?.id ? <Alert className="!mb-3" type="info" showIcon title="جنسی که از همکار خریده می‌شود را با «خرید از همکار» ثبت کنید تا سند حسابداری آن هم صادر شود؛ اینجا فقط اتیکت ساخته می‌شود." /> : null}
            <EntityForm
              def={ENTITIES.gold_item}
              initial={editing}
              onCancel={() => setEditing(undefined)}
              onSaved={() => {
                setEditing(undefined);
                qc.invalidateQueries({ queryKey: ["table"] });
              }}
            />
          </>
        ) : null}
      </Drawer>
      <BulkTags open={bulk} onClose={() => setBulk(false)} onCreated={(items) => { setBulk(false); qc.invalidateQueries({ queryKey: ["table"] }); setLabels(items); }} />
      <PrintLabelsModal open={!!labels} onClose={() => setLabels(null)} items={labels ?? []} />
    </div>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="tz-card px-4 py-3">
      <div className="text-xs text-muted">{k}</div>
      <div className="mt-1 text-lg font-bold">{v}</div>
    </div>
  );
}

interface BulkRow {
  key: string;
  gross_weight: string | null;
  stone_weight: string | null;
  title: string;
  tag_no: string;
  wage_value: string | null;
  stone_price: string | null;
}

const blankRow = (): BulkRow => ({ key: uuidv7(), gross_weight: null, stone_weight: null, title: "", tag_no: "", wage_value: null, stone_price: null });

/** Many tags at once: shared defaults and one row per piece (weights can be pasted). */
function BulkTags({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (items: LabelItem[]) => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const [def, setDef] = useState<Record<string, any>>({ fineness: "750", ownership: "own" });
  const [rows, setRows] = useState<BulkRow[]>(() => Array.from({ length: 5 }, blankRow));
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  const filled = useMemo(() => rows.filter((r) => r.gross_weight && D(r.gross_weight).gt(0)), [rows]);
  const set = (key: string, patch: Partial<BulkRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const submit = async () => {
    if (!filled.length) return n.warn("وزن دست‌کم یک جنس را وارد کنید");
    setSaving(true);
    try {
      const r = await api.post("/gold/items/bulk", {
        defaults: { category_id: def.category_id ?? null, fineness: def.fineness, wage_type: def.wage_type ?? null, wage_value: def.wage_value ?? null, profit_pct: def.profit_pct ?? null, supplier_id: def.supplier_id ?? null, ownership: def.ownership, title: def.title || null },
        items: filled.map((x) => ({ gross_weight: x.gross_weight, stone_weight: x.stone_weight, title: x.title || undefined, tag_no: x.tag_no || undefined, wage_value: x.wage_value ?? undefined, stone_price: x.stone_price ?? undefined })),
      });
      n.ok(`${faDigits(r.count)} اتیکت ساخته شد`);
      setRows(Array.from({ length: 5 }, blankRow));
      onCreated(r.items);
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} size={860} title="ساخت گروهی اتیکت" destroyOnHidden rootClassName="no-print" footer={<Button type="primary" block loading={saving} onClick={submit}>ساخت {faDigits(filled.length)} اتیکت و چاپ</Button>}>
      <Alert className="!mb-3" type="info" showIcon title="برای برچسب‌زدن اجناس موجود در ویترین؛ سند حسابداری صادر نمی‌شود (موجودی اول دوره را با سند «موجودی اول دوره» ثبت کنید)." />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><div className="mb-1 text-xs text-muted">دسته</div><RefSelect entity="gold_category" showCode={false} value={def.category_id ?? null} onChange={(v) => setDef({ ...def, category_id: v })} allowClear /></div>
        <div><div className="mb-1 text-xs text-muted">عیار</div><NumberInput decimals={1} value={def.fineness} onChange={(v) => setDef({ ...def, fineness: v })} /></div>
        <div><div className="mb-1 text-xs text-muted">نوع اجرت</div><Select className="w-full" allowClear placeholder="پیش‌فرض دسته" value={def.wage_type} onChange={(v) => setDef({ ...def, wage_type: v })} options={wageTypeOptions} /></div>
        <div><div className="mb-1 text-xs text-muted">اجرت</div><NumberInput decimals={3} value={def.wage_value} onChange={(v) => setDef({ ...def, wage_value: v })} placeholder="پیش‌فرض دسته" /></div>
        <div><div className="mb-1 text-xs text-muted">سود ٪ (خالی = پیش‌فرض)</div><PctInput value={def.profit_pct} onChange={(v) => setDef({ ...def, profit_pct: v })} /></div>
        <div><div className="mb-1 text-xs text-muted">شرح مشترک</div><Input value={def.title ?? ""} onChange={(e) => setDef({ ...def, title: e.target.value })} /></div>
        <div><div className="mb-1 text-xs text-muted">تأمین‌کننده</div><PartySelect value={def.supplier_id ?? null} onChange={(v) => setDef({ ...def, supplier_id: v })} allowClear /></div>
        <div><div className="mb-1 text-xs text-muted">مالکیت</div><Select className="w-full" value={def.ownership} onChange={(v) => setDef({ ...def, ownership: v })} options={[{ value: "own", label: "متعلق به ما" }, { value: "consignment", label: "امانی" }]} /></div>
      </div>
      <div className="mb-2 flex items-end gap-2">
        <Input.TextArea className="!w-72" autoSize={{ minRows: 1, maxRows: 4 }} placeholder="چسباندن وزن‌ها: هر خط یک وزن (از اکسل)" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <Button
          disabled={!paste.trim()}
          onClick={() => {
            const weights = normalizeDigits(paste).split(/[\n,;\t]+/).map((s) => s.trim().replace(/٫/g, ".")).filter((s) => /^\d+(\.\d+)?$/.test(s));
            setRows((rs) => [...rs.filter((r) => r.gross_weight), ...weights.map((w) => ({ ...blankRow(), gross_weight: w }))]);
            setPaste("");
          }}
        >
          افزودن وزن‌ها
        </Button>
        <Button className="ms-auto" icon={<PlusOutlined />} onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 5 }, blankRow)])}>۵ ردیف</Button>
      </div>
      <table className="tz-grid">
        <thead>
          <tr>
            <th className="w-8">#</th>
            <th>وزن کل</th>
            <th>وزن سنگ</th>
            <th>شرح</th>
            <th>اتیکت (خالی = خودکار)</th>
            <th>اجرت</th>
            <th>ارزش سنگ</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td className="num text-center text-xs text-muted">{faDigits(i + 1)}</td>
              <td><WeightInput variant="borderless" value={r.gross_weight} onChange={(v) => set(r.key, { gross_weight: v })} /></td>
              <td><WeightInput variant="borderless" value={r.stone_weight} onChange={(v) => set(r.key, { stone_weight: v })} /></td>
              <td><Input variant="borderless" value={r.title} onChange={(e) => set(r.key, { title: e.target.value })} /></td>
              <td><Input variant="borderless" dir="ltr" value={r.tag_no} onChange={(e) => set(r.key, { tag_no: e.target.value })} /></td>
              <td><NumberInput variant="borderless" decimals={3} value={r.wage_value} onChange={(v) => set(r.key, { wage_value: v })} placeholder="پیش‌فرض" /></td>
              <td><MoneyInput variant="borderless" value={r.stone_price} onChange={(v) => set(r.key, { stone_price: v })} /></td>
              <td><Button type="text" size="small" danger onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="حذف">×</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-xs text-muted">
        {faDigits(filled.length)} جنس، وزن کل <span className="num">{formatWeight(filled.reduce((a, r) => a.plus(D(r.gross_weight)), D(0)))}</span> گرم
      </div>
    </Drawer>
  );
}

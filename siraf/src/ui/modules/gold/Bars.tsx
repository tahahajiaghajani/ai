// «شمش‌ها»: the bar register (every bar with its maker's serial, certificate, seal and weights,
// its owner, status and own cost; filters and the register as of a date), a bar's card with its
// history and today's price, editing of its descriptive fields, labels with QR — and the bar models.
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Button, Drawer, Dropdown, Input, Segmented, Select, Table, Tooltip } from "antd";
import { Ellipsis, FileSpreadsheet, Gem, Lock, LockOpen, Pencil, Plus, Printer, Search, Weight, Boxes, CircleDollarSign } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useAction, useDebounced, useNotify } from "../../lib/hooks";
import { exportExcel } from "../../lib/excel";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDate, Money, StatCard } from "../../components/display";
import { DateInput, FilterChip } from "../../components/inputs";
import { D } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { BAR_OWNERSHIP_TITLES, BAR_SOURCE_TITLES, BAR_STATUS_TITLES, BAR_TYPE_TITLES, SEAL_TITLES } from "@shared/gold-catalogue";
import { BAR_STATUS, gw, KINDS, KIND_PATH, SplitButton, StatusOf, useCatalogue, type Bar, type CatalogueRow, type DocKind } from "./shared";
import { ProductForm } from "./ProductForm";
import { PrintLabelsModal, barLabel, type LabelItem } from "./Labels";

const opts = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));

export default function Bars() {
  const { can } = useOrg();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<"register" | "models">("register");
  return (
    <div>
      <BarsHeader />
      <div className="mb-3">
        <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "register", label: "شمش‌ها" }, { value: "models", label: "مدل‌ها" }]} />
      </div>
      {tab === "register" ? <Register initialQ={sp.get("q") ?? ""} /> : <Models editable={can("gold", "full")} />}
    </div>
  );
}

function BarsHeader() {
  const { can, orgId } = useOrg();
  const nav = useNavigate();
  const doc = (kind: DocKind) => nav(`/${orgId}/${KIND_PATH[kind]}/new`);
  return (
    <PageHeader
      title="شمش‌ها"
      actions={
        can("gold", "edit") ? (
          <SplitButton
            type="primary"
            icon={<Ic icon={Plus} />}
            onClick={() => doc("purchase")}
            items={[
              { key: "buyback", label: KINDS.buyback.title, onClick: () => doc("buyback") },
              { key: "consign", label: KINDS.consign_in.title, onClick: () => doc("consign_in") },
              { key: "opening", label: "موجودی اول دوره", onClick: () => doc("opening") },
            ]}
          >
            خرید شمش
          </SplitButton>
        ) : null
      }
    />
  );
}

function Register({ initialQ }: { initialQ: string }) {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const models = useCatalogue("bar");
  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState<string | null>("in_stock,reserved");
  const [model, setModel] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [selected, setSelected] = useState<Map<string, Bar>>(new Map());
  const [labels, setLabels] = useState<LabelItem[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q);
  const params = { q: dq, status: asOf ? undefined : status ?? undefined, item_id: model, ownership, brand, to: asOf };
  const list = useQuery({ queryKey: ["table", "/gold/bars", params, page, size], queryFn: () => api.get("/gold/bars", { ...params, page, size }), placeholderData: keepPreviousData });
  const rows: (Bar & Record<string, any>)[] = list.data?.rows ?? [];
  const sums = list.data?.sums;
  const reserve = useAction((x: { id: string; on: boolean }) => api.post(`/gold/bars/${x.id}/${x.on ? "reserve" : "release"}`), { success: "ذخیره شد", invalidate: [["table"]] });
  const exportAll = async () => {
    try {
      const all = await api.get("/gold/bars", { ...params, page: 1, size: 1000 });
      await exportExcel("ثبت شمش‌ها", [
        { title: "شماره", value: (r: any) => r.bar_no },
        { title: "مدل", value: (r: any) => r.model_name ?? "" },
        { title: "برند", value: (r: any) => r.brand ?? "" },
        { title: "سریال", value: (r: any) => r.serial_no ?? "" },
        { title: "وزن", value: (r: any) => r.weight, type: "number" },
        { title: "عیار", value: (r: any) => r.fineness, type: "number" },
        { title: "طلای خالص", value: (r: any) => r.fine_weight, type: "number" },
        { title: "گواهی", value: (r: any) => r.certificate_no ?? "" },
        { title: "پلمپ", value: (r: any) => SEAL_TITLES[r.seal_status as keyof typeof SEAL_TITLES] ?? r.seal_status },
        { title: "مالکیت", value: (r: any) => BAR_OWNERSHIP_TITLES[r.ownership as keyof typeof BAR_OWNERSHIP_TITLES] ?? r.ownership },
        { title: "وضعیت", value: (r: any) => BAR_STATUS_TITLES[r.status as keyof typeof BAR_STATUS_TITLES] ?? r.status },
        { title: "بها", value: (r: any) => r.cost, type: "number" },
      ], all.rows);
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <>
      <div className="mb-4 grid sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="تعداد شمش" icon={<Ic icon={Boxes} />} value={<span className="sf-num">{faDigits(sums?.n ?? 0)}</span>} />
        <StatCard title="وزن" icon={<Ic icon={Weight} />} value={<span className="sf-num">{gw(sums?.weight ?? 0)}</span>} />
        <StatCard title="طلای خالص" icon={<Ic icon={Gem} />} value={<span className="sf-num">{gw(sums?.fine ?? 0)}</span>} hint={<>معادل ۷۵۰: <span className="sf-num">{gw(sums?.w750 ?? 0)}</span></>} />
        <StatCard title="بهای تمام‌شده" icon={<Ic icon={CircleDollarSign} />} value={<Money v={sums?.cost ?? 0} />} />
      </div>
      <div className="sf-filters">
        <Input allowClear prefix={<Ic icon={Search} className="text-ink-3" />} placeholder="شماره، سریال، برند یا گواهی…" className="!w-60" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        {!asOf ? <FilterChip label="وضعیت" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "in_stock,reserved", label: "موجود و رزرو" }, ...opts(BAR_STATUS_TITLES)]} /> : null}
        <FilterChip label="مدل" value={model} onChange={(v) => { setModel(v); setPage(1); }} options={(models.data?.rows ?? []).map((m) => ({ value: m.id, label: m.name }))} />
        <FilterChip label="مالکیت" value={ownership} onChange={(v) => { setOwnership(v); setPage(1); }} options={opts(BAR_OWNERSHIP_TITLES)} />
        {list.data?.brands?.length ? <FilterChip label="برند" value={brand} onChange={(v) => { setBrand(v); setPage(1); }} options={list.data.brands.map((b: string) => ({ value: b, label: b }))} /> : null}
        <DateInput allowClear placeholder="موجود در تاریخ" value={asOf} onChange={(v) => { setAsOf(v); setPage(1); }} className="!w-40" />
        <div className="sf-filters-end">
          <Button icon={<Ic icon={Printer} />} disabled={!selected.size} onClick={() => setLabels([...selected.values()].map(barLabel))}>
            چاپ برچسب{selected.size ? <span className="sf-num">&nbsp;({faDigits(selected.size)})</span> : null}
          </Button>
          <Tooltip title="خروجی اکسل"><Button icon={<Ic icon={FileSpreadsheet} />} onClick={exportAll} aria-label="خروجی اکسل" /></Tooltip>
        </div>
      </div>
      <div className="sf-card">
        {!list.isLoading && !rows.length && !dq && !model && !brand && !asOf ? (
          <EmptyState title="هنوز شمشی ثبت نشده است." action={can("gold", "edit") ? <Button type="primary" onClick={() => nav(`/${orgId}/${KIND_PATH.purchase}/new`)}>خرید شمش</Button> : undefined} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            scroll={{ x: "max-content" }}
            rowClassName={(r) => (r.status !== "in_stock" && r.status !== "reserved" && !asOf ? "row-muted" : "")}
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
            onRow={(r) => ({ onDoubleClick: () => setOpen(r.id) })}
            pagination={{ current: page, pageSize: size, total: list.data?.total ?? 0, showSizeChanger: true, pageSizeOptions: [50, 100, 200, 500], size: "small", showTotal: (t) => `${faDigits(t)} شمش`, onChange: (p, s) => { setPage(p); setSize(s); } }}
            columns={[
              { key: "no", dataIndex: "bar_no", title: "شماره", render: (v) => <span className="sf-docno">{faDigits(v)}</span> },
              { key: "model", title: "شمش", render: (_, r) => <div className="leading-5"><div>{r.model_name ?? "شمش"}</div>{r.brand ? <div className="text-[12px] text-ink-3">{r.brand}</div> : null}</div> },
              { key: "sn", dataIndex: "serial_no", title: "سریال", render: (v) => (v ? <span className="ltr" dir="ltr">{v}</span> : <span className="sf-zero">—</span>) },
              { key: "w", dataIndex: "weight", title: "وزن", className: "sf-num", render: (v) => <span className="sf-num">{gw(v)}</span> },
              { key: "f", dataIndex: "fineness", title: "عیار", className: "sf-num", render: (v) => <span className="sf-num">{faDigits(D(v).toString())}</span> },
              { key: "fine", dataIndex: "fine_weight", title: "خالص", className: "sf-num", render: (v) => <span className="sf-num">{gw(v)}</span> },
              { key: "seal", dataIndex: "seal_status", title: "پلمپ", render: (v) => <span className="text-[13px] text-ink-2">{SEAL_TITLES[v as keyof typeof SEAL_TITLES] ?? v}</span> },
              { key: "own", dataIndex: "ownership", title: "مالکیت", render: (v, r) => (v === "own" ? <span className="text-[13px] text-ink-3">{BAR_SOURCE_TITLES[r.source as keyof typeof BAR_SOURCE_TITLES] ?? ""}</span> : <Chip tone="neutral">{BAR_OWNERSHIP_TITLES[v as keyof typeof BAR_OWNERSHIP_TITLES]}</Chip>) },
              { key: "cost", dataIndex: "cost", title: "بها", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
              { key: "st", dataIndex: "status", title: "وضعیت", render: (v) => <StatusOf s={v} map={BAR_STATUS} /> },
              {
                key: "act", width: 44, fixed: "end" as const, render: (_, r) => (
                  <span className="sf-row-act" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: [
                          { key: "o", label: "مشخصات و سابقه", onClick: () => setOpen(r.id) },
                          { key: "p", icon: <Ic icon={Printer} />, label: "چاپ برچسب", onClick: () => setLabels([barLabel(r)]) },
                          ...(can("gold", "edit") && r.status === "in_stock" ? [{ key: "r", icon: <Ic icon={Lock} />, label: "رزرو برای مشتری", onClick: () => reserve.mutate({ id: r.id, on: true }) }] : []),
                          ...(can("gold", "edit") && r.status === "reserved" ? [{ key: "u", icon: <Ic icon={LockOpen} />, label: "آزاد کردن رزرو", onClick: () => reserve.mutate({ id: r.id, on: false }) }] : []),
                        ],
                      }}
                    >
                      <Button type="text" size="small" icon={<Ic icon={Ellipsis} />} aria-label="عملیات" />
                    </Dropdown>
                  </span>
                ),
              },
            ]}
          />
        )}
      </div>
      <BarCard id={open} onClose={() => setOpen(null)} />
      <PrintLabelsModal open={!!labels} onClose={() => setLabels(null)} items={labels ?? []} />
    </>
  );
}

/** A bar's card: identity, today's price, history; editing of its descriptive fields. */
function BarCard({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["gold-bar", orgId, id], enabled: !!id, queryFn: () => api.get<{ bar: Bar; price: { total: string } | null; history: any[] }>(`/gold/bars/${id}`) });
  const [edit, setEdit] = useState<Partial<Bar> | null>(null);
  const save = useAction(() => api.patch(`/gold/bars/${id}`, edit), { success: "ذخیره شد", invalidate: [["table"], ["gold-bar"]], onSuccess: () => setEdit(null) });
  const b = q.data?.bar;
  const kv = (k: string, v: ReactNode) => (
    <div className="flex justify-between gap-3 border-b border-line py-1.5 text-[13px]"><span className="text-ink-3">{k}</span><span className="text-end">{v ?? "—"}</span></div>
  );
  return (
    <Drawer
      open={!!id}
      onClose={() => { setEdit(null); onClose(); }}
      size={620}
      destroyOnHidden
      title={b ? `شمش ${faDigits(b.bar_no)}` : ""}
      extra={b && can("gold", "edit") && !edit ? <Button icon={<Ic icon={Pencil} />} onClick={() => setEdit({ brand: b.brand, serial_no: b.serial_no, certificate_no: b.certificate_no, certificate_issuer: b.certificate_issuer, assay_lab: b.assay_lab, assay_no: b.assay_no, seal_status: b.seal_status, qr: b.qr, notes: b.notes })}>ویرایش</Button> : null}
      footer={edit ? <Button type="primary" block loading={save.isPending} onClick={() => save.mutate(undefined)}>ذخیره</Button> : null}
    >
      {b && edit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["brand", "serial_no", "certificate_no", "certificate_issuer", "assay_lab", "assay_no", "qr"] as const).map((k) => (
            <label key={k} className={k === "qr" ? "sm:col-span-2" : ""}>
              <div className="sf-field-l mb-1.5">{FIELD_TITLES[k]}</div>
              <Input className={k === "brand" || k === "certificate_issuer" || k === "assay_lab" ? "" : "ltr"} dir={k === "brand" || k === "certificate_issuer" || k === "assay_lab" ? undefined : "ltr"} value={(edit[k] as string) ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
            </label>
          ))}
          <label>
            <div className="sf-field-l mb-1.5">وضعیت پلمپ</div>
            <Select className="w-full" value={edit.seal_status} onChange={(seal_status) => setEdit({ ...edit, seal_status })} options={opts(SEAL_TITLES)} />
          </label>
          <label className="sm:col-span-2">
            <div className="sf-field-l mb-1.5">یادداشت</div>
            <Input.TextArea rows={2} value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
          </label>
        </div>
      ) : b ? (
        <div className="grid gap-4">
          <div>
            {kv("مدل", (b as any).model_name)}
            {kv("برند / پالایشگاه", b.brand)}
            {kv("سریال", b.serial_no ? <span className="ltr" dir="ltr">{b.serial_no}</span> : null)}
            {kv("وزن / عیار", <span className="sf-num">{gw(b.weight)} · {faDigits(D(b.fineness).toString())}</span>)}
            {kv("طلای خالص / معادل ۷۵۰", <span className="sf-num">{gw(b.fine_weight)} · {gw(b.weight750)}</span>)}
            {kv("گواهی", b.certificate_no ? `${b.certificate_no}${b.certificate_issuer ? ` — ${b.certificate_issuer}` : ""}` : null)}
            {kv("ری‌گیری", b.assay_no ? `${b.assay_no}${b.assay_lab ? ` — ${b.assay_lab}` : ""}` : null)}
            {kv("پلمپ", SEAL_TITLES[b.seal_status as keyof typeof SEAL_TITLES])}
            {kv("منبع", `${BAR_SOURCE_TITLES[b.source as keyof typeof BAR_SOURCE_TITLES] ?? b.source}${b.source_ref ? ` — ${b.source_ref}` : ""}`)}
            {kv("مالکیت", BAR_OWNERSHIP_TITLES[b.ownership as keyof typeof BAR_OWNERSHIP_TITLES])}
            {kv("وضعیت", <StatusOf s={b.status} map={BAR_STATUS} />)}
            {kv("بهای تمام‌شده", <Money v={b.cost ?? 0} zero="—" />)}
            {q.data?.price ? kv("قیمت فروش امروز", <Money v={q.data.price.total} />) : null}
          </div>
          <div>
            <div className="sf-sec-t mb-2"><span>سابقه</span></div>
            <Table
              size="small"
              rowKey={(r: any) => `${r.id}-${r.direction}`}
              dataSource={q.data?.history ?? []}
              pagination={false}
              onRow={(r: any) => ({ onClick: () => nav(`/${orgId}/gold/docs/${r.id}`), className: "cursor-pointer" })}
              columns={[
                { key: "d", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
                { key: "k", title: "سند", render: (_, r: any) => <span>{KINDS[r.kind as DocKind]?.title ?? r.kind} <span className="sf-num">{faDigits(r.no)}</span></span> },
                { key: "dir", dataIndex: "direction", title: "", render: (v) => <span className="text-ink-3">{v === "in" ? "ورود" : "خروج"}</span> },
                { key: "p", dataIndex: "party_name", title: "طرف حساب", render: (v) => v ?? "—" },
                { key: "t", dataIndex: "total", title: "مبلغ", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
              ]}
            />
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

const FIELD_TITLES = { brand: "برند / پالایشگاه", serial_no: "سریال", certificate_no: "شماره‌ی گواهی", certificate_issuer: "صادرکننده‌ی گواهی", assay_lab: "آزمایشگاه", assay_no: "شماره‌ی ری‌گیری (انگ)", qr: "متن QR / هولوگرام" } as const;

function Models({ editable }: { editable: boolean }) {
  const cat = useCatalogue("bar");
  const [editing, setEditing] = useState<CatalogueRow | null | undefined>(undefined);
  const rows = useMemo(() => cat.data?.rows ?? [], [cat.data]);
  return (
    <div className="sf-card">
      <div className="flex justify-end p-2">{editable ? <Button icon={<Ic icon={Plus} />} onClick={() => setEditing(null)}>مدل جدید</Button> : null}</div>
      <Table
        size="small"
        rowKey="id"
        loading={cat.isLoading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: "max-content" }}
        rowClassName={(r) => (!r.is_active ? "row-muted" : "")}
        onRow={(r) => ({ onDoubleClick: () => editable && setEditing(r) })}
        columns={[
          { key: "n", dataIndex: "name", title: "مدل" },
          { key: "t", title: "نوع", render: (_, r) => <span className="text-ink-2">{BAR_TYPE_TITLES[r.gold_meta.bar_type ?? "other"]}</span> },
          { key: "b", title: "برند", render: (_, r) => r.gold_meta.brand ?? "—" },
          { key: "w", dataIndex: "gold_weight", title: "وزن اسمی", className: "sf-num", render: (v) => (v ? <span className="sf-num">{gw(v)}</span> : <span className="text-ink-3">آزاد</span>) },
          { key: "f", dataIndex: "fineness", title: "عیار", className: "sf-num", render: (v) => <span className="sf-num">{faDigits(D(v ?? 0).toString())}</span> },
          { key: "q", dataIndex: "qty", title: "موجودی", className: "sf-num", render: (v) => (D(v).isZero() ? <span className="sf-zero">—</span> : <span className="sf-num">{formatNumber(v)}</span>) },
          { key: "s", dataIndex: "sell", title: "فروش امروز", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
          { key: "by", dataIndex: "buy", title: "خرید امروز", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
          ...(editable ? [{ key: "e", width: 44, render: (_: unknown, r: CatalogueRow) => <Button type="text" size="small" icon={<Ic icon={Pencil} />} aria-label="ویرایش" onClick={() => setEditing(r)} /> }] : []),
        ]}
      />
      {editing !== undefined ? <ProductForm kind="bar" product={editing} open onClose={() => setEditing(undefined)} /> : null}
    </div>
  );
}

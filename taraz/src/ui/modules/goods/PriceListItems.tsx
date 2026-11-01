// Price list editor: the price of each item in a list (optionally from a minimum quantity),
// with "add all items", percentage change and rounding of all prices, then save (replace).
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Popover, Spin, Table, Tag } from "antd";
import { DeleteOutlined, PercentageOutlined, PlusOutlined, SaveOutlined, SearchOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useHotkey, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { JDate, Money } from "../../components/display";
import { MoneyInput, NumberInput } from "../../components/inputs";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { uuidv7 } from "@shared/id";
import { ItemSelect, type ItemOpt } from "./components";

interface Row {
  key: string;
  item_id: string;
  code: string;
  name: string;
  unit_name: string | null;
  sale_price: string | null;
  price: string | null;
  min_qty: string | null;
}

export default function PriceListItems() {
  const { id } = useParams();
  const { api, orgId, can } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [pct, setPct] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>("1000");
  const q = useQuery({ queryKey: ["goods-price-list", id], queryFn: () => api.get(`/goods/price-lists/${id}/items`) });
  const editable = can("sales", "edit");

  useEffect(() => {
    if (!q.data) return;
    setRows(q.data.rows.map((r: any) => ({ key: r.id, item_id: r.item_id, code: r.code, name: r.name, unit_name: r.unit_name, sale_price: r.sale_price, price: r.price, min_qty: r.min_qty })));
    setDirty(false);
  }, [q.data]);

  const set = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const add = (it: ItemOpt | null) => {
    if (!it) return;
    if (rows.some((r) => r.item_id === it.id && !r.min_qty)) return n.warn("این کالا در فهرست هست");
    setRows((rs) => [{ key: uuidv7(), item_id: it.id, code: it.code, name: it.name, unit_name: it.unit_name, sale_price: it.sale_price, price: it.sale_price, min_qty: null }, ...rs]);
    setDirty(true);
  };
  const addAll = async () => {
    if (adding) return;
    setAdding(true);
    try {
      // every active good and service in one call (sales permission, no page limit)
      const r = await api.get<{ rows: any[] }>(`/goods/price-lists/${id}/all-items`);
      const have = new Set(rows.map((x) => x.item_id));
      const extra: Row[] = r.rows
        .filter((it) => !have.has(it.item_id))
        .map((it) => ({ key: uuidv7(), item_id: it.item_id, code: it.code, name: it.name, unit_name: it.unit_name, sale_price: it.sale_price, price: it.sale_price, min_qty: null }));
      if (!extra.length) return n.info("همه‌ی کالاها در فهرست هستند");
      setRows((rs) => [...rs, ...extra]);
      setDirty(true);
      n.ok(`${faDigits(extra.length)} کالا اضافه شد`);
    } catch (e) {
      n.error(e);
    } finally {
      setAdding(false);
    }
  };
  const applyPct = () => {
    const p = D(pct);
    const s = D(step);
    setRows((rs) =>
      rs.map((r) => {
        if (r.price === null) return r;
        let v = D(r.price).times(D(100).plus(p)).div(100);
        v = s.gt(0) ? v.div(s).toDecimalPlaces(0).times(s) : v.toDecimalPlaces(0);
        return { ...r, price: v.toString() };
      }),
    );
    setDirty(true);
  };
  const save = async () => {
    if (!editable || saving) return;
    const missing = rows.find((r) => r.price === null || r.price === "");
    if (missing) return n.warn(`قیمت «${missing.name}» را وارد کنید`);
    setSaving(true);
    try {
      const r = await api.put(`/goods/price-lists/${id}/items`, { items: rows.map((x) => ({ item_id: x.item_id, price: x.price, min_qty: x.min_qty })) });
      n.ok(`${faDigits(r.count)} قیمت ذخیره شد`);
      qc.invalidateQueries({ queryKey: ["goods-price-list", id] });
      qc.invalidateQueries({ queryKey: ["goods-items"] });
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useHotkey("f2", () => saveRef.current(), []);

  const shown = useMemo(() => {
    const s = search.trim();
    return s ? rows.filter((r) => r.name.includes(s) || r.code.includes(s)) : rows;
  }, [rows, search]);

  if (q.isLoading) return <div className="grid h-64 place-content-center"><Spin /></div>;
  if (q.error) return <Alert type="error" showIcon title={errorText(q.error)} />;
  const list = q.data.price_list;
  return (
    <div>
      <PageHeader
        back={`/${orgId}/sales/price-lists`}
        title={`فهرست قیمت: ${list.name}`}
        subtitle={
          <span>
            {list.is_default ? <Tag color="cyan" variant="filled">پیش‌فرض</Tag> : null}
            {list.valid_from || list.valid_to ? <span>اعتبار: <JDate v={list.valid_from} /> تا <JDate v={list.valid_to} /></span> : "بدون محدودیت زمانی"}
          </span>
        }
        actions={
          editable ? (
            <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>
              ذخیره <span className="tz-kbd ltr ms-1 !bg-transparent !text-white/80">F2</span>
            </Button>
          ) : null
        }
      />
      <div className="tz-card p-3 md:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {editable ? (
            <>
              <div className="w-80"><ItemSelect value={null} ctx={{}} onChange={add} placeholder="افزودن کالا یا خدمت…" /></div>
              <Button icon={<PlusOutlined />} loading={adding} onClick={addAll}>افزودن همه‌ی کالاها</Button>
              <Popover
                trigger="click"
                content={
                  <div className="grid w-60 gap-2">
                    <div className="text-xs text-muted">درصد تغییر (منفی = کاهش)</div>
                    <NumberInput value={pct} onChange={setPct} decimals={2} allowNegative suffix="٪" />
                    <div className="text-xs text-muted">گرد کردن به</div>
                    <MoneyInput value={step} onChange={setStep} />
                    <Button type="primary" onClick={applyPct} disabled={!pct}>اعمال روی همه</Button>
                  </div>
                }
              >
                <Button icon={<PercentageOutlined />}>تغییر درصدی</Button>
              </Popover>
            </>
          ) : null}
          <Input allowClear prefix={<SearchOutlined className="text-muted" />} placeholder="جستجو در فهرست" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-56 ms-auto" />
        </div>
        <Table
          className="tz-table"
          size="small"
          rowKey="key"
          dataSource={shown}
          pagination={{ pageSize: 100, hideOnSinglePage: true, size: "small", showTotal: (t) => `${faDigits(t)} قیمت` }}
          scroll={{ x: "max-content" }}
          columns={[
            { key: "code", dataIndex: "code", title: "کد", width: 90, render: (v) => <span className="num">{faDigits(v)}</span> },
            { key: "name", dataIndex: "name", title: "کالا / خدمت" },
            { key: "sale", dataIndex: "sale_price", title: "قیمت فروش کالا", align: "left", width: 150, render: (v) => (v ? <Money v={v} /> : <span className="text-muted">—</span>) },
            { key: "price", title: "قیمت در این فهرست", width: 180, render: (_, r: Row) => <MoneyInput value={r.price} onChange={(v) => set(r.key, { price: v })} disabled={!editable} /> },
            { key: "min", title: "از مقدار (اختیاری)", width: 150, render: (_, r: Row) => <NumberInput decimals={3} value={r.min_qty} onChange={(v) => set(r.key, { min_qty: v })} disabled={!editable} placeholder="همه" /> },
            {
              key: "diff",
              title: "تفاوت",
              width: 90,
              render: (_, r: Row) => {
                if (!r.price || !r.sale_price || D(r.sale_price).isZero()) return null;
                const d = D(r.price).minus(D(r.sale_price)).div(D(r.sale_price)).times(100).toDecimalPlaces(1);
                return d.isZero() ? null : <span className={`num text-xs ${d.lt(0) ? "text-ok" : "text-bad"}`}>{d.gt(0) ? "+" : ""}{faDigits(d.toString())}٪</span>;
              },
            },
            ...(editable
              ? [{ key: "del", width: 50, render: (_: unknown, r: Row) => <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setDirty(true); }} aria-label="حذف" /> }]
              : []),
          ]}
        />
        <div className="mt-2 text-xs text-muted">
          قیمت فهرست برای مشتریانی که این فهرست را دارند (یا گروهشان) در فاکتور فروش و پیش‌فاکتور به‌طور خودکار می‌آید.
        </div>
      </div>
    </div>
  );
}

// Rate board (تابلوی نرخ): live market tickers, the buy/sell grid against the base currency
// (typed by hand or «به‌روزرسانی از بازار»), rate history and a full-screen board for customers.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Dropdown, Input, Modal, Segmented, Space, Switch, Table, Tooltip, Alert, Checkbox, Select, Spin } from "antd";
import {
  SyncOutlined, SaveOutlined, FullscreenOutlined, SettingOutlined, HistoryOutlined, SearchOutlined, DeleteOutlined,
  ArrowUpOutlined, ArrowDownOutlined, PlusOutlined, CloseOutlined, ThunderboltOutlined, DownOutlined,
} from "@ant-design/icons";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend } from "recharts";
import { useOrg } from "../../lib/org";
import { useAction, useHotkey, useNotify } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { NumberInput, PctInput, MoneyInput } from "../../components/inputs";
import { JDateTime, EmptyState } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatCompact } from "@shared/format";
import { formatJalali, formatJalaliDateTime, todayISO } from "@shared/jalali";
import { ago, Change, CurrencyChip, CUR_KIND_FA, fnum, rateLabel, SOURCE_FA, SourceTag, useBoard, useLive, type BoardCurrency, type Kind } from "./shared";

const TICKER = ["BTC", "ETH", "USDT", "TRX", "SOL", "TON", "USD", "EUR"];

export default function RatesBoard() {
  const { api, orgId, can, unit, org } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const [display, setDisplay] = useState(false);
  const board = useBoard(display ? Math.max(10, Number(org.settings?.fx?.refresh_seconds) || 60) * 1000 : undefined);
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, { buy?: string | null; sell?: string | null }>>({});
  const [history, setHistory] = useState<BoardCurrency | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const canEdit = can("fx", "edit");
  const live = useLive(TICKER);
  const base = board.data?.base;
  const dp = base?.decimals ?? org.money_decimals ?? 0;

  const rows = useMemo(
    () =>
      (board.data?.currencies ?? []).filter(
        (c) => !c.is_base && c.is_active && (kind === "all" || c.kind === kind) && (!q.trim() || c.code.toLowerCase().includes(q.trim().toLowerCase()) || c.name.includes(q.trim())),
      ),
    [board.data, kind, q],
  );
  const changed = Object.entries(edits).filter(([id, e]) => {
    const c = board.data?.currencies.find((x) => x.id === id);
    return c && ((e.buy !== undefined && !D(e.buy).eq(D(c.rate?.buy))) || (e.sell !== undefined && !D(e.sell).eq(D(c.rate?.sell))));
  });

  const save = useAction(
    () =>
      api.post("/fx/rates", {
        rates: changed.map(([id, e]) => {
          const c = board.data!.currencies.find((x) => x.id === id)!;
          return { currency_id: id, buy: e.buy !== undefined ? e.buy : c.rate?.buy ?? null, sell: e.sell !== undefined ? e.sell : c.rate?.sell ?? null };
        }),
      }),
    {
      success: (d: any) => `${faDigits(d.saved)} نرخ ثبت شد`,
      invalidate: [["fx-board"], ["fx-summary"]],
      onSuccess: () => setEdits({}),
    },
  );
  useHotkey("f2", () => {
    if (changed.length && !save.isPending) save.mutate(undefined);
  }, [changed.length, save.isPending, edits]);

  const refresh = useAction((kinds: Kind[] | undefined) => api.post("/fx/rates/refresh", { kinds }), {
    invalidate: [["fx-board"], ["fx-summary"]],
    onSuccess: (r: any) => {
      const head = r.updated ? `${faDigits(r.updated)} نرخ از بازار به‌روز شد` : "نرخ تازه‌ای نبود";
      const details = [
        r.unchanged ? `${faDigits(r.unchanged)} نرخ بدون تغییر` : null,
        r.missing?.length ? `بدون قیمت: ${r.missing.join("، ")}` : null,
        r.usd_rate ? `نرخ دلار مبنا: ${rateLabel(r.usd_rate, dp)} (${SOURCE_FA[r.usd_source] ?? r.usd_source})` : null,
      ].filter(Boolean);
      if (r.errors?.length) n.notify.warning({ title: head, description: <div className="text-xs leading-6">{[...details, ...r.errors].map((x: string, i: number) => <div key={i}>{x}</div>)}</div>, duration: 8 });
      else n.notify.success({ title: head, description: details.length ? <div className="text-xs leading-6">{details.map((x, i) => <div key={i}>{x}</div>)}</div> : undefined, duration: 5 });
    },
  });

  const focusCell = (row: number, col: number) =>
    requestAnimationFrame(() => {
      const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${row}-${col}"] input`);
      el?.focus();
      el?.select();
    });

  return (
    <div>
      <PageHeader
        title="تابلوی نرخ ارز"
        subtitle={board.data ? <>نرخ‌ها به {unit} · حاشیه‌ی پیش‌فرض {fnum(board.data.settings.margin_pct, 3)}٪ · منابع: {board.data.settings.providers.map((p) => SOURCE_FA[p] ?? p).join("، ")}</> : null}
        actions={
          <>
            <Tooltip title="نمایش تمام‌صفحه برای مشتریان">
              <Button icon={<FullscreenOutlined />} onClick={() => setDisplay(true)} />
            </Tooltip>
            {can("fx", "full") ? <Tooltip title="تنظیمات نرخ و منابع قیمت"><Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} /></Tooltip> : null}
            {canEdit ? (
              <>
                <Space.Compact>
                  <Button icon={<SyncOutlined spin={refresh.isPending} />} disabled={refresh.isPending} onClick={() => refresh.mutate(undefined)}>
                    به‌روزرسانی از بازار
                  </Button>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        { key: "crypto", label: "فقط رمزارزها و فلزها", onClick: () => refresh.mutate(["crypto", "metal"]) },
                        { key: "fiat", label: "فقط ارزها", onClick: () => refresh.mutate(["fiat"]) },
                      ],
                    }}
                  >
                    <Button icon={<DownOutlined />} disabled={refresh.isPending} aria-label="گزینه‌های به‌روزرسانی" />
                  </Dropdown>
                </Space.Compact>
                <Button type="primary" icon={<SaveOutlined />} disabled={!changed.length} loading={save.isPending} onClick={() => save.mutate(undefined)}>
                  ذخیره‌ی نرخ‌ها {changed.length ? `(${faDigits(changed.length)})` : ""} <span className="tz-kbd ltr ms-1 !bg-transparent !text-white/80">F2</span>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <LiveStrip />

      <Section
        className="mt-4"
        title="نرخ خرید و فروش"
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented size="small" value={kind} onChange={(v) => setKind(v as "all" | Kind)} options={[{ value: "all", label: "همه" }, { value: "fiat", label: "ارز" }, { value: "crypto", label: "رمزارز" }, { value: "metal", label: "فلز" }]} />
            <Input size="small" allowClear prefix={<SearchOutlined className="text-muted" />} placeholder="جستجو…" value={q} onChange={(e) => setQ(e.target.value)} className="!w-40" />
          </div>
        }
        bodyClass="p-0"
      >
        {board.isLoading ? (
          <div className="grid h-40 place-content-center"><Spin /></div>
        ) : !rows.length ? (
          <EmptyState title="ارزی برای نمایش نیست؛ از «ارزها و رمزارزها» ارز فعال کنید" />
        ) : (
          <div ref={gridRef} className="overflow-x-auto">
            <table className="tz-grid min-w-[860px]">
              <thead>
                <tr>
                  <th className="min-w-[200px]">ارز</th>
                  <th className="min-w-[170px]" style={{ textAlign: "left" }}>نرخ خرید ما</th>
                  <th className="min-w-[170px]" style={{ textAlign: "left" }}>نرخ فروش ما</th>
                  <th className="min-w-[130px]" style={{ textAlign: "left" }}>میانگین</th>
                  <th style={{ textAlign: "left" }}>اختلاف</th>
                  <th>تغییر</th>
                  <th>منبع</th>
                  <th>زمان</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => {
                  const e = edits[c.id] ?? {};
                  const buy = e.buy !== undefined ? e.buy : c.rate?.buy ?? null;
                  const sell = e.sell !== undefined ? e.sell : c.rate?.sell ?? null;
                  const mid = buy && sell ? D(buy).plus(D(sell)).div(2).toFixed() : c.rate?.mid ?? buy ?? sell;
                  const spread = buy && sell && D(buy).gt(0) ? D(sell).minus(D(buy)).div(D(buy)).times(100) : null;
                  const dirty = (e.buy !== undefined && !D(e.buy).eq(D(c.rate?.buy))) || (e.sell !== undefined && !D(e.sell).eq(D(c.rate?.sell)));
                  const decimals = mid && D(mid).lt(100) ? 8 : dp;
                  return (
                    <tr key={c.id} className={dirty ? "bg-gold-soft" : ""}>
                      <td>
                        <div className="flex items-center gap-2 px-1">
                          <CurrencyChip c={c} />
                          <span className="font-semibold">{c.name}</span>
                          <span className="text-[11px] text-muted">{CUR_KIND_FA[c.kind]}</span>
                        </div>
                      </td>
                      <td data-cell={`${i}-0`}>
                        <NumberInput variant="borderless" decimals={decimals} value={buy} disabled={!canEdit} onChange={(v) => setEdits({ ...edits, [c.id]: { ...e, buy: v } })} onPressEnter={() => focusCell(i, 1)} />
                      </td>
                      <td data-cell={`${i}-1`}>
                        <NumberInput variant="borderless" decimals={decimals} value={sell} disabled={!canEdit} onChange={(v) => setEdits({ ...edits, [c.id]: { ...e, sell: v } })} onPressEnter={() => focusCell(i + 1, 0)} />
                      </td>
                      <td className="num px-2 text-muted" style={{ textAlign: "left" }}>{mid ? rateLabel(mid, dp) : "—"}</td>
                      <td className="num px-2 text-xs text-muted" style={{ textAlign: "left" }}>{spread ? `${fnum(spread.toFixed(), 2)}٪` : "—"}</td>
                      <td className="px-2"><Change pct={c.change_pct} /></td>
                      <td className="px-2"><SourceTag s={c.rate?.source} /></td>
                      <td className="px-2 text-xs text-muted">{c.rate ? <Tooltip title={formatJalaliDateTime(c.rate.at)}>{ago(c.rate.at)}</Tooltip> : "—"}</td>
                      <td className="text-center">
                        <Tooltip title="تاریخچه‌ی نرخ">
                          <Button type="text" size="small" icon={<HistoryOutlined />} tabIndex={-1} onClick={() => setHistory(c)} />
                        </Tooltip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <HistoryDrawer currency={history} onClose={() => setHistory(null)} dp={dp} />
      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ["org", orgId] }); qc.invalidateQueries({ queryKey: ["fx-board"] }); }} /> : null}
      {display && board.data ? <DisplayBoard rows={(board.data.currencies ?? []).filter((c) => !c.is_base && c.is_active && c.rate)} onClose={() => setDisplay(false)} dp={dp} unit={unit} live={live.data?.quotes ?? []} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- live strip

function LiveStrip() {
  const live = useLive(TICKER);
  const { unit } = useOrg();
  const d = live.data;
  return (
    <Section
      title={<span className="flex items-center gap-2"><ThunderboltOutlined className="text-gold" /> قیمت زنده‌ی بازار</span>}
      extra={
        <span className="flex items-center gap-2 text-[11px] text-muted">
          {d?.usd_rate ? <>دلار مبنا: <b className="num text-ink">{rateLabel(d.usd_rate)}</b> {unit} ({SOURCE_FA[d.usd_source ?? ""] ?? d.usd_source})</> : <span className="text-warn">نرخ دلار مبنا ثبت نشده</span>}
          {d ? <>· {ago(d.at)}</> : null}
          <Button size="small" type="text" icon={<SyncOutlined spin={live.isFetching} />} onClick={() => live.refetch()} aria-label="بازخوانی" />
        </span>
      }
    >
      {live.isLoading ? (
        <div className="grid h-16 place-content-center"><Spin size="small" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {(d?.quotes ?? []).map((x) => (
              <div key={x.code} className="tz-soft px-3 py-2">
                <div className="flex items-center justify-between">
                  <CurrencyChip c={{ code: x.code, kind: x.kind }} />
                  <Change pct={x.change_24h} />
                </div>
                <div className="num mt-1 text-base font-bold ltr text-start">{x.price_usd ? `$${fnum(x.price_usd, D(x.price_usd).lt(10) ? 4 : 2)}` : "—"}</div>
                <div className="num truncate text-[11px] text-muted">{x.price_base ? `${formatCompact(x.price_base)} ${unit}` : x.source ? SOURCE_FA[x.source] ?? x.source : "بی‌پاسخ"}</div>
              </div>
            ))}
          </div>
          {d?.errors?.length ? <div className="mt-2 text-[11px] text-muted">{d.errors.join(" · ")}</div> : null}
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- history

function HistoryDrawer({ currency, onClose, dp }: { currency: BoardCurrency | null; onClose: () => void; dp: number }) {
  const { api, can } = useOrg();
  const q = useQuery({
    queryKey: ["fx-rate-history", currency?.id],
    queryFn: () => api.get<{ rows: { id: string; buy: string | null; sell: string | null; mid: string | null; at: string; source: string }[] }>("/fx/rates/history", { currency_id: currency!.id, limit: 300 }),
    enabled: !!currency,
  });
  const del = useAction((id: string) => api.del(`/fx/rates/${id}`), { success: "نرخ حذف شد", invalidate: [["fx-rate-history"], ["fx-board"]] });
  const n = useNotify();
  const chart = useMemo(
    () => [...(q.data?.rows ?? [])].reverse().map((r) => ({ t: formatJalali(r.at.slice(0, 10)), buy: r.buy ? Number(r.buy) : null, sell: r.sell ? Number(r.sell) : null, mid: r.mid ? Number(r.mid) : null })),
    [q.data],
  );
  return (
    <Drawer open={!!currency} onClose={onClose} size={720} destroyOnHidden title={currency ? <span className="flex items-center gap-2">تاریخچه‌ی نرخ <CurrencyChip c={currency} /> {currency.name}</span> : null}>
      {q.isLoading ? (
        <div className="grid h-40 place-content-center"><Spin /></div>
      ) : (
        <>
          {chart.length > 1 ? (
            <div className="mb-4 h-56">
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--tz-line)" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--tz-muted)" }} reversed />
                  <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fontSize: 10, fill: "var(--tz-muted)" }} orientation="right" width={70} domain={["auto", "auto"]} />
                  <RTooltip formatter={(v) => rateLabel(String(v), dp)} contentStyle={{ fontFamily: "Vazirmatn", borderRadius: 8, direction: "rtl" }} />
                  <Legend formatter={(v) => (v === "buy" ? "خرید" : v === "sell" ? "فروش" : "میانگین")} />
                  <Line type="monotone" dataKey="buy" stroke="#0e7490" dot={false} strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="sell" stroke="#b8862f" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
          <Table
            className="tz-table"
            size="small"
            rowKey="id"
            dataSource={q.data?.rows ?? []}
            pagination={{ pageSize: 50, hideOnSinglePage: true, size: "small" }}
            locale={{ emptyText: <EmptyState title="برای این ارز نرخی ثبت نشده" /> }}
            columns={[
              { key: "at", dataIndex: "at", title: "زمان", render: (v) => <JDateTime v={v} /> },
              { key: "buy", dataIndex: "buy", title: "خرید", align: "left", render: (v) => <span className="num">{v ? rateLabel(v, dp) : "—"}</span> },
              { key: "sell", dataIndex: "sell", title: "فروش", align: "left", render: (v) => <span className="num">{v ? rateLabel(v, dp) : "—"}</span> },
              { key: "mid", dataIndex: "mid", title: "میانگین", align: "left", render: (v) => <span className="num text-muted">{v ? rateLabel(v, dp) : "—"}</span> },
              { key: "src", dataIndex: "source", title: "منبع", render: (v) => <SourceTag s={v} /> },
              ...(can("fx", "full")
                ? [{
                    key: "del",
                    width: 40,
                    render: (_: unknown, r: { id: string }) => (
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={async () => { if (await n.confirm("حذف این نرخ؟", undefined, true)) del.mutate(r.id); }} aria-label="حذف" />
                    ),
                  }]
                : []),
            ]}
          />
        </>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- settings

interface Custom {
  code: string;
  url: string;
  path: string;
  unit: "base" | "usd";
  factor?: string | null;
}

function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ["fx-settings"], queryFn: () => api.get("/fx/settings") });
  const [v, setV] = useState<any>(null);
  useEffect(() => {
    if (q.data && !v) setV({ ...q.data.settings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  const save = useAction(() => api.put("/fx/settings", v), { success: "تنظیمات صرافی ذخیره شد", invalidate: [["fx-settings"], ["fx-live"]], onSuccess: () => { onSaved(); onClose(); } });
  const providers: { id: string; title: string; covers: string }[] = q.data?.providers ?? [];
  const order: string[] = v?.providers ?? [];
  const move = (id: string, d: -1 | 1) => {
    const i = order.indexOf(id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setV({ ...v, providers: next });
  };
  const custom: Custom[] = v?.custom ?? [];
  const setCustom = (i: number, patch: Partial<Custom>) => setV({ ...v, custom: custom.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  return (
    <Modal open onCancel={onClose} title="تنظیمات صرافی و منابع قیمت" width={760} okText="ذخیره" cancelText="انصراف" onOk={() => save.mutate(undefined)} confirmLoading={save.isPending} destroyOnHidden>
      {!v ? (
        <div className="grid h-40 place-content-center"><Spin /></div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <div className="mb-1 text-xs text-muted">حاشیه‌ی خرید/فروش روی نرخ بازار</div>
              <PctInput value={v.margin_pct} onChange={(x) => setV({ ...v, margin_pct: x ?? "0" })} />
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-muted">به‌روزرسانی قیمت زنده (ثانیه)</div>
              <NumberInput value={String(v.refresh_seconds ?? 60)} onChange={(x) => setV({ ...v, refresh_seconds: Number(x || 60) })} />
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-muted">سقف معامله بدون احراز هویت (خالی = همیشه آزاد)</div>
              <MoneyInput value={v.kyc_threshold} onChange={(x) => setV({ ...v, kyc_threshold: x })} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch size="small" checked={!!v.allow_negative} onChange={(x) => setV({ ...v, allow_negative: x })} />
            پرداخت ارز بیش از موجودی صندوق و کیف‌پول مجاز باشد
          </label>
          <div>
            <div className="mb-2 text-xs font-bold text-muted">منابع قیمت (به ترتیب اولویت)</div>
            <div className="grid gap-1.5">
              {[...order.map((id) => providers.find((p) => p.id === id)).filter(Boolean), ...providers.filter((p) => !order.includes(p.id))].map((p) => {
                const on = order.includes(p!.id);
                return (
                  <div key={p!.id} className="tz-soft flex items-center gap-2 px-3 py-1.5">
                    <Checkbox checked={on} onChange={(e) => setV({ ...v, providers: e.target.checked ? [...order, p!.id] : order.filter((x) => x !== p!.id) })} />
                    <b className="w-28">{p!.title}</b>
                    <span className="flex-1 text-xs text-muted">{p!.covers}</span>
                    {on ? (
                      <>
                        <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => move(p!.id, -1)} aria-label="بالا" />
                        <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => move(p!.id, 1)} aria-label="پایین" />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center text-xs font-bold text-muted">
              منابع سفارشی (هر API با پاسخ JSON؛ مثلاً tgju، BrsApi یا Navasan با کلید خودتان)
              <Button size="small" type="link" icon={<PlusOutlined />} className="ms-auto" onClick={() => setV({ ...v, custom: [...custom, { code: "USD", url: "", path: "", unit: "base", factor: null }] })}>
                منبع
              </Button>
            </div>
            {custom.length ? (
              <div className="grid gap-2">
                {custom.map((c, i) => (
                  <div key={i} className="tz-soft grid gap-2 p-2 sm:grid-cols-[80px_1fr_150px_110px_80px_32px]">
                    <Input size="small" dir="ltr" value={c.code} placeholder="USD" onChange={(e) => setCustom(i, { code: e.target.value.toUpperCase() })} />
                    <Input size="small" dir="ltr" value={c.url} placeholder={c.url === "" && q.data?.can_edit === false ? "(محرمانه)" : "https://…"} onChange={(e) => setCustom(i, { url: e.target.value })} />
                    <Input size="small" dir="ltr" value={c.path} placeholder="data.price" onChange={(e) => setCustom(i, { path: e.target.value })} />
                    <Select size="small" value={c.unit} onChange={(u) => setCustom(i, { unit: u })} options={[{ value: "base", label: "به ارز پایه" }, { value: "usd", label: "به دلار" }]} />
                    <Input size="small" dir="ltr" value={c.factor ?? ""} placeholder="ضریب" onChange={(e) => setCustom(i, { factor: e.target.value || null })} />
                    <Button size="small" type="text" danger icon={<CloseOutlined />} onClick={() => setV({ ...v, custom: custom.filter((_, k) => k !== i) })} aria-label="حذف" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted">منبع سفارشی تعریف نشده است.</div>
            )}
            <Alert className="!mt-2" type="info" showIcon title="منبع سفارشی فقط وقتی استفاده می‌شود که «منبع سفارشی» در فهرست بالا فعال باشد. برای ریال به تومان ضریب ۰٫۱ بگذارید." />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- full-screen board

function DisplayBoard({ rows, onClose, dp, unit, live }: { rows: BoardCurrency[]; onClose: () => void; dp: number; unit: string; live: { code: string; price_usd: string | null; change_24h: string | null }[] }) {
  const { org } = useOrg();
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    ref.current?.requestFullscreen?.().catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    const onFs = () => {
      if (!document.fullscreenElement) close.current();
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const fiat = rows.filter((r) => r.kind !== "crypto");
  const crypto = rows.filter((r) => r.kind === "crypto");
  const block = (title: string, list: BoardCurrency[]) =>
    list.length ? (
      <div className="min-w-0 flex-1">
        <div className="mb-3 text-lg font-bold text-[var(--tz-sidebar-text)]">{title}</div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-8 gap-y-1 text-white">
          <div className="text-sm text-[var(--tz-sidebar-text)]">ارز</div>
          <div className="text-sm text-[var(--tz-sidebar-text)]">خرید</div>
          <div className="text-sm text-[var(--tz-sidebar-text)]">فروش</div>
          {list.map((c) => (
            <div key={c.id} className="contents">
              <div className="flex items-center gap-3 border-t border-white/10 py-2 text-2xl"><b className="ltr text-[var(--tz-sidebar-active)]">{c.code}</b> <span className="text-xl">{c.name}</span></div>
              <div className="num border-t border-white/10 py-2 text-2xl font-bold">{c.rate?.buy ? rateLabel(c.rate.buy, dp) : "—"}</div>
              <div className="num border-t border-white/10 py-2 text-2xl font-bold text-[#e0b45e]">{c.rate?.sell ? rateLabel(c.rate.sell, dp) : "—"}</div>
            </div>
          ))}
        </div>
      </div>
    ) : null;
  return (
    <div ref={ref} className="fixed inset-0 z-[1000] overflow-auto p-8" style={{ background: "linear-gradient(180deg, #0b1f33 0%, #102a43 100%)" }} dir="rtl">
      <div className="mb-6 flex items-center gap-4 text-white">
        <div className="text-3xl font-extrabold">{org.name}</div>
        <div className="text-lg text-[var(--tz-sidebar-text)]">نرخ خرید و فروش ({unit})</div>
        <div className="num ms-auto text-2xl">{formatJalali(todayISO(tz), { style: "long" })} · {faDigits(now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }))}</div>
        <Button ghost icon={<CloseOutlined />} onClick={onClose} aria-label="بستن" />
      </div>
      <div className="flex flex-col gap-10 lg:flex-row">
        {block("ارزها", fiat)}
        {block("رمزارزها", crypto)}
      </div>
      {live.length ? (
        <div className="mt-8 flex flex-wrap gap-6 border-t border-white/10 pt-4 text-white">
          {live.filter((l) => l.price_usd).map((l) => (
            <span key={l.code} className="num text-lg">
              <b className="ltr">{l.code}</b> ${fnum(l.price_usd, D(l.price_usd).lt(10) ? 4 : 2)} <Change pct={l.change_24h} />
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

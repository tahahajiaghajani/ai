// Rate board (تابلوی نرخ): live market tickers, the buy/sell grid against the base currency
// (typed by hand or «به‌روزرسانی از بازار»), rate history and a full-screen board for customers.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Dropdown, Input, Modal, Segmented, Space, Switch, Table, Tooltip, Alert, Checkbox, Select } from "antd";
import { ArrowDown, ArrowUp, ChevronDown, Coins, History, Maximize2, Plus, RefreshCw, Save, Search, Settings, Trash2, X } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend } from "recharts";
import { useOrg } from "../../lib/org";
import { useAction, useHotkey, useIsPhone, useNotify } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { NumberInput, PctInput, MoneyInput } from "../../components/inputs";
import { JDateTime, EmptyState, Loader } from "../../components/display";
import { APP_NAME } from "@shared/constants";
import { pct as faPct } from "../../lib/fa";
import { D } from "@shared/money";
import { faDigits, formatCompact, formatNumber } from "@shared/format";
import { formatJalali, formatJalaliDateTime, todayISO } from "@shared/jalali";
import { SirafMark } from "../../components/brand";
import { jTime } from "../../lib/fa";
import { ago, Change, CurrencyAvatar, CurrencyChip, CUR_KIND_FA, fnum, rateLabel, SOURCE_FA, SourceTag, useBoard, useFlash, useLive, type BoardCurrency, type Kind } from "./shared";

const TICKER = ["BTC", "ETH", "USDT", "TRX", "SOL", "TON", "USD", "EUR"];

/** A dollar price: 2 decimals at $1 and above, 4 below («$0.3146»). */
const usd = (v: string) => `$${formatNumber(v, { dp: D(v).lt(1) ? 4 : 2, minDp: D(v).lt(1) ? 4 : 2, fa: false })}`;

/** An amount in millions of the base unit for a strip that states its one scale in the caption. */
const millions = (v: string) => {
  const m = D(v).div(1_000_000);
  return formatNumber(m, { dp: m.lt(10) ? 2 : m.lt(1000) ? 1 : 0 });
};

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
  const phone = useIsPhone();
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
        subtitle={
          board.data ? (
            <span className="sf-doc-meta">
              <span>نرخ‌ها به {unit}</span>
              <span className="sf-sep" aria-hidden />
              <span>حاشیه‌ی پیش‌فرض {fnum(board.data.settings.margin_pct, 3)}٪</span>
            </span>
          ) : null
        }
        actions={
          <>
            <Tooltip title="تابلوی تمام‌صفحه برای مشتریان">
              <Button icon={<Ic icon={Maximize2} />} onClick={() => setDisplay(true)} aria-label="تابلوی مشتری" />
            </Tooltip>
            {canEdit ? (
              <>
                <Space.Compact>
                  <Button icon={<Ic icon={RefreshCw} className={refresh.isPending ? "sf-spin" : undefined} />} disabled={refresh.isPending} onClick={() => refresh.mutate(undefined)}>
                    به‌روزرسانی از بازار
                  </Button>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        { key: "crypto", label: "فقط رمزارزها و فلزها", onClick: () => refresh.mutate(["crypto", "metal"]) },
                        { key: "fiat", label: "فقط ارزها", onClick: () => refresh.mutate(["fiat"]) },
                        ...(can("fx", "full") ? [{ type: "divider" as const }, { key: "settings", icon: <Ic icon={Settings} />, label: "تنظیمات نرخ و منابع قیمت", onClick: () => setSettingsOpen(true) }] : []),
                      ],
                    }}
                  >
                    <Button icon={<Ic icon={ChevronDown} />} disabled={refresh.isPending} aria-label="گزینه‌های به‌روزرسانی" />
                  </Dropdown>
                </Space.Compact>
                <Button type="primary" icon={<Ic icon={Save} />} disabled={!changed.length} loading={save.isPending} onClick={() => save.mutate(undefined)}>
                  ذخیره‌ی نرخ‌ها{changed.length ? <span className="sf-num">&nbsp;({faDigits(changed.length)})</span> : null}
                  <span className="sf-kw" aria-hidden><bdi dir="ltr"><kbd>F2</kbd></bdi></span>
                </Button>
              </>
            ) : can("fx", "full") ? (
              <Button icon={<Ic icon={Settings} />} onClick={() => setSettingsOpen(true)}>تنظیمات نرخ</Button>
            ) : null}
          </>
        }
      />

      <LiveStrip />

      <section className="sf-doc-card mt-4" aria-label="نرخ خرید و فروش">
        <div className="sf-doc-h flex-wrap">
          <h2>نرخ خرید و فروش</h2>
          <span className="sf-doc-hm">مبالغ به {unit}</span>
          <div className="sf-doc-hx">
            <Segmented size="small" value={kind} onChange={(v) => setKind(v as "all" | Kind)} options={[{ value: "all", label: "همه" }, { value: "fiat", label: "ارز" }, { value: "crypto", label: "رمزارز" }, { value: "metal", label: "فلز" }]} />
            <Input size="small" allowClear prefix={<Ic icon={Search} className="text-ink-3" />} placeholder="جستجوی ارز" value={q} onChange={(e) => setQ(e.target.value)} className="!w-44" aria-label="جستجوی ارز" />
          </div>
        </div>
        {board.isLoading ? (
          <div className="grid h-40 place-content-center"><Loader /></div>
        ) : !rows.length ? (
          <EmptyState icon={Coins} title="ارزی برای نمایش نیست" description="از «ارزها و رمزارزها» ارزی را فعال کنید." />
        ) : phone ? (
          <div className="sf-rate-list">
            {rows.map((c) => (
              <RateItem key={c.id} c={c} e={edits[c.id] ?? {}} dp={dp} canEdit={canEdit} onEdit={(patch) => setEdits({ ...edits, [c.id]: { ...(edits[c.id] ?? {}), ...patch } })} onHistory={() => setHistory(c)} />
            ))}
          </div>
        ) : (
          <div ref={gridRef} className="sf-grid-wrap">
            <table className="sf-grid sf-rate-grid min-w-[900px]">
              <thead>
                <tr>
                  <th className="min-w-[220px]">ارز</th>
                  <th className="w-[164px]">نرخ خرید ما</th>
                  <th className="w-[164px]">نرخ فروش ما</th>
                  <th className="w-[140px]">میانگین</th>
                  <th className="w-[84px]">اختلاف</th>
                  <th className="w-[100px]">تغییر</th>
                  <th className="w-[96px]">منبع</th>
                  <th className="w-[110px]">زمان</th>
                  <th className="w-10" aria-label="تاریخچه" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <RateRow
                    key={c.id}
                    c={c}
                    i={i}
                    e={edits[c.id] ?? {}}
                    dp={dp}
                    canEdit={canEdit}
                    onEdit={(patch) => setEdits({ ...edits, [c.id]: { ...(edits[c.id] ?? {}), ...patch } })}
                    focusCell={focusCell}
                    onHistory={() => setHistory(c)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <HistoryDrawer currency={history} onClose={() => setHistory(null)} dp={dp} />
      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ["org", orgId] }); qc.invalidateQueries({ queryKey: ["fx-board"] }); }} /> : null}
      {display && board.data ? <DisplayBoard rows={(board.data.currencies ?? []).filter((c) => !c.is_base && c.is_active && c.rate)} onClose={() => setDisplay(false)} dp={dp} unit={unit} live={live.data?.quotes ?? []} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- one row of the grid

function RateRow({ c, i, e, dp, canEdit, onEdit, focusCell, onHistory }: {
  c: BoardCurrency;
  i: number;
  e: { buy?: string | null; sell?: string | null };
  dp: number;
  canEdit: boolean;
  onEdit: (patch: { buy?: string | null; sell?: string | null }) => void;
  focusCell: (row: number, col: number) => void;
  onHistory: () => void;
}) {
  const buy = e.buy !== undefined ? e.buy : c.rate?.buy ?? null;
  const sell = e.sell !== undefined ? e.sell : c.rate?.sell ?? null;
  const mid = buy && sell ? D(buy).plus(D(sell)).div(2).toFixed() : c.rate?.mid ?? buy ?? sell;
  const spread = buy && sell && D(buy).gt(0) ? D(sell).minus(D(buy)).div(D(buy)).times(100) : null;
  const dirty = (e.buy !== undefined && !D(e.buy).eq(D(c.rate?.buy))) || (e.sell !== undefined && !D(e.sell).eq(D(c.rate?.sell)));
  const decimals = mid && D(mid).lt(100) ? 8 : dp;
  const flashBuy = useFlash(c.rate?.buy);
  const flashSell = useFlash(c.rate?.sell);
  return (
    <tr className={dirty ? "is-dirty" : ""}>
      <td>
        <span className="sf-rate-cur">
          <CurrencyAvatar code={c.code} size="sm" />
          <b>{c.name}</b>
          <bdi dir="ltr" className="sf-latin c">{c.code}</bdi>
          {c.kind !== "fiat" ? <span className="k">{CUR_KIND_FA[c.kind]}</span> : null}
          {dirty ? <span className="inline-flex items-center gap-1.5 text-ink-2"><i className="sf-dirty-dot" aria-hidden />ذخیره‌نشده</span> : null}
        </span>
      </td>
      <td data-cell={`${i}-0`} className={flashBuy}>
        <NumberInput variant="borderless" decimals={decimals} value={buy} placeholder="—" disabled={!canEdit} onChange={(v) => onEdit({ buy: v })} onPressEnter={() => focusCell(i, 1)} aria-label={`نرخ خرید ${c.name}`} />
      </td>
      <td data-cell={`${i}-1`} className={flashSell}>
        <NumberInput variant="borderless" decimals={decimals} value={sell} placeholder="—" disabled={!canEdit} onChange={(v) => onEdit({ sell: v })} onPressEnter={() => focusCell(i + 1, 0)} aria-label={`نرخ فروش ${c.name}`} />
      </td>
      <td className="sf-gn text-ink-2">{mid ? rateLabel(mid, dp) : <span className="sf-zero">—</span>}</td>
      <td className="sf-gn text-ink-3">{spread ? `${fnum(spread.toFixed(), 2)}٪` : <span className="sf-zero">—</span>}</td>
      <td className="sf-gn"><Change pct={c.change_pct} /></td>
      <td className="sf-gn"><SourceTag s={c.rate?.source} /></td>
      <td className="sf-gn text-[13px] text-ink-3">{c.rate ? <Tooltip title={formatJalaliDateTime(c.rate.at)}><span>{ago(c.rate.at)}</span></Tooltip> : <span className="sf-zero">—</span>}</td>
      <td>
        <span className="sf-row-x">
          <Tooltip title="تاریخچه‌ی نرخ">
            <Button type="text" size="small" icon={<Ic icon={History} />} tabIndex={-1} onClick={onHistory} aria-label={`تاریخچه‌ی نرخ ${c.name}`} />
          </Tooltip>
        </span>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- live strip

function LiveStrip() {
  const live = useLive(TICKER);
  const { unit } = useOrg();
  const d = live.data;
  return (
    <section className="sf-doc-card" aria-label="قیمت زنده‌ی بازار">
      <div className="sf-doc-h flex-wrap">
        <h2>بازار جهانی</h2>
        <span className="sf-doc-hm inline-flex flex-wrap items-center gap-x-2">
          {d?.usd_rate ? <>دلار مبنا <b className="sf-num font-medium text-ink">{rateLabel(d.usd_rate)}</b> {unit}<span className="sf-sep" aria-hidden />{SOURCE_FA[d.usd_source ?? ""] ?? d.usd_source}<span className="sf-sep" aria-hidden />معادل‌ها به میلیون {unit}</> : <span className="text-warning">نرخ دلار مبنا ثبت نشده</span>}
        </span>
        <div className="sf-doc-hx text-[12px] text-ink-3">
          {d ? <><i className="sf-nuqta" data-live="" aria-hidden /><span className="sf-num">{jTime(new Date(d.at))}</span></> : null}
          <Tooltip title="بازخوانی">
            <Button size="small" type="text" icon={<Ic icon={RefreshCw} className={live.isFetching ? "sf-spin" : undefined} />} onClick={() => live.refetch()} aria-label="بازخوانی قیمت‌ها" />
          </Tooltip>
        </div>
      </div>
      {live.isLoading ? (
        <div className="grid h-20 place-content-center"><Loader /></div>
      ) : (
        <>
          <div className="sf-fxlive">
            {(d?.quotes ?? []).filter((x) => x.code !== "USD").map((x) => <LiveTile key={x.code} x={x} />)}
          </div>
          {d?.errors?.length ? <div className="border-t border-line px-5 py-2 text-[12px] text-ink-3">{d.errors.join("، ")}</div> : null}
        </>
      )}
    </section>
  );
}

function LiveTile({ x }: { x: { code: string; kind: Kind; price_usd: string | null; change_24h: string | null; price_base: string | null; source: string | null } }) {
  const flash = useFlash(x.price_usd);
  return (
    <div className={flash}>
      <div className="h">
        <CurrencyChip c={{ code: x.code, kind: x.kind }} />
        <Change pct={x.change_24h} />
      </div>
      <bdi className="p" dir="ltr">{x.price_usd ? usd(x.price_usd) : "—"}</bdi>
      <div className="s">{x.price_base ? <span className="sf-num">{millions(x.price_base)}</span> : x.source ? SOURCE_FA[x.source] ?? x.source : "بی‌پاسخ"}</div>
    </div>
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
    <Drawer open={!!currency} onClose={onClose} size={720} destroyOnHidden title={currency ? <span className="flex items-center gap-2">تاریخچه‌ی نرخ {currency.name} <CurrencyChip c={currency} /></span> : null}>
      {q.isLoading ? (
        <div className="grid h-40 place-content-center"><Loader /></div>
      ) : (
        <>
          {chart.length > 1 ? (
            <div className="mb-4 h-56">
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke="var(--sf-chart-grid)" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 12, fill: "var(--sf-text-3)" }} tickLine={false} axisLine={{ stroke: "var(--sf-chart-axis)" }} reversed minTickGap={24} />
                  <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fontSize: 12, fill: "var(--sf-text-3)" }} tickLine={false} axisLine={false} orientation="right" width={64} domain={["auto", "auto"]} />
                  <RTooltip
                    cursor={{ stroke: "var(--sf-chart-crosshair)", strokeWidth: 1 }}
                    formatter={(v, k) => [rateLabel(String(v), dp), k === "buy" ? "خرید" : k === "sell" ? "فروش" : "میانگین"]}
                    contentStyle={{ background: "var(--sf-raised)", border: 0, borderRadius: 8, boxShadow: "var(--sf-shadow-e3)", direction: "rtl", fontSize: 13 }}
                    labelStyle={{ color: "var(--sf-text-3)", fontSize: 12 }}
                  />
                  <Legend iconType="plainline" formatter={(v) => <span className="text-[12px] text-ink-2">{v === "buy" ? "خرید" : v === "sell" ? "فروش" : "میانگین"}</span>} />
                  <Line type="monotone" dataKey="sell" stroke="var(--sf-accent-line)" dot={false} strokeWidth={2} connectNulls animationDuration={500} />
                  <Line type="monotone" dataKey="buy" stroke="var(--sf-chart-3)" dot={false} strokeWidth={2} connectNulls animationDuration={500} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
          <Table
            className=""
            size="small"
            rowKey="id"
            dataSource={q.data?.rows ?? []}
            pagination={{ pageSize: 50, hideOnSinglePage: true, size: "small" }}
            locale={{ emptyText: <EmptyState title="برای این ارز نرخی ثبت نشده" /> }}
            columns={[
              { key: "at", dataIndex: "at", title: "زمان", render: (v) => <JDateTime v={v} /> },
              { key: "buy", dataIndex: "buy", title: "خرید", className: "sf-num", render: (v) => <span className="sf-num">{v ? rateLabel(v, dp) : "—"}</span> },
              { key: "sell", dataIndex: "sell", title: "فروش", className: "sf-num", render: (v) => <span className="sf-num">{v ? rateLabel(v, dp) : "—"}</span> },
              { key: "mid", dataIndex: "mid", title: "میانگین", className: "sf-num", render: (v) => <span className="sf-num text-ink-3">{v ? rateLabel(v, dp) : "—"}</span> },
              { key: "src", dataIndex: "source", title: "منبع", render: (v) => <SourceTag s={v} /> },
              ...(can("fx", "full")
                ? [{
                    key: "del",
                    width: 40,
                    render: (_: unknown, r: { id: string }) => (
                      <span className="sf-row-act"><Button type="text" size="small" icon={<Ic icon={Trash2} />} onClick={async () => { if (await n.confirm("این نرخ حذف شود؟", undefined, true)) del.mutate(r.id); }} aria-label="حذف" /></span>
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
        <div className="grid h-40 place-content-center"><Loader /></div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <div className="sf-field-l mb-1.5">حاشیه‌ی خرید/فروش روی نرخ بازار</div>
              <PctInput value={v.margin_pct} onChange={(x) => setV({ ...v, margin_pct: x ?? "0" })} />
            </label>
            <label className="block">
              <div className="sf-field-l mb-1.5">به‌روزرسانی قیمت زنده (ثانیه)</div>
              <NumberInput value={String(v.refresh_seconds ?? 60)} onChange={(x) => setV({ ...v, refresh_seconds: Number(x || 60) })} />
            </label>
            <label className="block">
              <div className="sf-field-l mb-1.5">سقف معامله بدون احراز هویت (خالی = همیشه آزاد)</div>
              <MoneyInput value={v.kyc_threshold} onChange={(x) => setV({ ...v, kyc_threshold: x })} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch size="small" checked={!!v.allow_negative} onChange={(x) => setV({ ...v, allow_negative: x })} />
            پرداخت ارز بیش از موجودی صندوق و کیف‌پول مجاز باشد
          </label>
          <div>
            <div className="mb-2 text-xs font-semibold text-ink-3">منابع قیمت (به ترتیب اولویت)</div>
            <div className="grid gap-1.5">
              {[...order.map((id) => providers.find((p) => p.id === id)).filter(Boolean), ...providers.filter((p) => !order.includes(p.id))].map((p) => {
                const on = order.includes(p!.id);
                return (
                  <div key={p!.id} className="bg-sunken rounded-lg flex items-center gap-2 px-3 py-1.5">
                    <Checkbox checked={on} onChange={(e) => setV({ ...v, providers: e.target.checked ? [...order, p!.id] : order.filter((x) => x !== p!.id) })} />
                    <b className="w-28">{p!.title}</b>
                    <span className="flex-1 text-xs text-ink-3">{p!.covers}</span>
                    {on ? (
                      <>
                        <Button size="small" type="text" icon={<Ic icon={ArrowUp} />} onClick={() => move(p!.id, -1)} aria-label="بالا" />
                        <Button size="small" type="text" icon={<Ic icon={ArrowDown} />} onClick={() => move(p!.id, 1)} aria-label="پایین" />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center text-xs font-semibold text-ink-3">
              منابع سفارشی (هر API با پاسخ JSON؛ مثلاً Navasan با کلید خودتان)
              <Button size="small" type="link" icon={<Ic icon={Plus} />} className="ms-auto" onClick={() => setV({ ...v, custom: [...custom, { code: "USD", url: "", path: "", unit: "base", factor: null }] })}>
                منبع
              </Button>
            </div>
            {custom.length ? (
              <div className="grid gap-2">
                {custom.map((c, i) => (
                  <div key={i} className="bg-sunken rounded-lg grid gap-2 p-2 sm:grid-cols-[80px_1fr_150px_110px_80px_32px]">
                    <Input size="small" dir="ltr" value={c.code} placeholder="USD" onChange={(e) => setCustom(i, { code: e.target.value.toUpperCase() })} />
                    <Input size="small" dir="ltr" value={c.url} placeholder={c.url === "" && q.data?.can_edit === false ? "(محرمانه)" : "https://…"} onChange={(e) => setCustom(i, { url: e.target.value })} />
                    <Input size="small" dir="ltr" value={c.path} placeholder="data.price" onChange={(e) => setCustom(i, { path: e.target.value })} />
                    <Select size="small" value={c.unit} onChange={(u) => setCustom(i, { unit: u })} options={[{ value: "base", label: "به ارز پایه" }, { value: "usd", label: "به دلار" }]} />
                    <Input size="small" dir="ltr" value={c.factor ?? ""} placeholder="ضریب" onChange={(e) => setCustom(i, { factor: e.target.value || null })} />
                    <Button size="small" type="text" danger icon={<Ic icon={X} />} onClick={() => setV({ ...v, custom: custom.filter((_, k) => k !== i) })} aria-label="حذف" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-ink-3">منبع سفارشی تعریف نشده است.</div>
            )}
            <Alert className="!mt-2" type="info" showIcon title={<>منبع سفارشی فقط وقتی استفاده می‌شود که «منبع سفارشی» در فهرست بالا فعال باشد. مسیر مثل <span className="sf-ltr">data.price</span>، <span className="sf-ltr">items[0].sell</span> یا <span className="sf-ltr">items[symbol=USD].sell</span>؛ برای قیمت ریالی در حساب تومانی ضریب ۰٫۱ و برای قیمت تومانی در حساب ریالی ضریب ۱۰.</>} />
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
  // one figure size for both sections: the longest figure on the whole board sets it
  const len = Math.max(6, ...rows.flatMap((c) => [c.rate?.buy, c.rate?.sell].map((v) => (v ? rateLabel(v, dp).length : 0))));
  const block = (title: string, list: BoardCurrency[]) =>
    list.length ? (
      <section className="sf-tv-sec">
        <h2><i aria-hidden />{title}</h2>
        <div className="sf-tv-t" role="table" aria-label={title}>
          <div className="th" role="columnheader">ارز</div>
          <div className="th n" role="columnheader">خرید</div>
          <div className="th n" role="columnheader">فروش</div>
          {list.map((c) => <TvRow key={c.id} c={c} dp={dp} />)}
        </div>
      </section>
    ) : null;
  return (
    <div ref={ref} className="sf-tv" dir="rtl">
      <header className="sf-tv-h">
        {org.logo ? <img src={org.logo} alt="" className="h-14 w-14 rounded-xl object-contain" /> : null}
        <div className="sf-tv-biz">
          <b>{org.name}</b>
          <span>نرخ خرید و فروش، به {unit}</span>
        </div>
        <div className="sf-tv-clock">
          <b>{jTime(now)}</b>
          <span>{formatJalali(todayISO(tz), { style: "long" })}</span>
        </div>
        <Button type="text" className="sf-tv-x" icon={<Ic icon={X} />} onClick={onClose} aria-label="بستن تابلو" />
      </header>
      <div className={`sf-tv-cols ${rows.length <= 9 ? "is-stacked" : ""}`} style={{ ["--len" as string]: len, ["--rows" as string]: rows.length + 2 * [fiat, crypto].filter((x) => x.length).length }}>
        {block("ارزها", fiat)}
        {block("رمزارزها", crypto)}
      </div>
      <footer className="sf-tv-foot">
        {live.filter((l) => l.price_usd && l.code !== "USD").map((l) => {
          const ch = l.change_24h ? D(l.change_24h) : null;
          return (
            <span key={l.code}>
              <bdi dir="ltr" className="code">{l.code}</bdi>
              <bdi dir="ltr" className="px">{usd(l.price_usd!)}</bdi>
              {ch && !ch.isZero() ? (
                <span className={`dl ${ch.gt(0) ? "up" : "down"}`}>
                  <svg viewBox="0 0 10 10" aria-hidden><path d={ch.gt(0) ? "M5 1.5 9 8H1z" : "M5 8.5 1 2h8z"} fill="currentColor" /></svg>
                  <bdi dir="ltr">{ch.gt(0) ? "+" : "\u2212"}{formatNumber(ch.abs(), { dp: 2, minDp: 2 })}٪</bdi>
                </span>
              ) : null}
            </span>
          );
        })}
        <span className="sf-tv-brand"><SirafMark size={16} variant="white" />{APP_NAME}</span>
      </footer>
    </div>
  );
}

function TvRow({ c, dp }: { c: BoardCurrency; dp: number }) {
  const fb = useFlash(c.rate?.buy);
  const fs = useFlash(c.rate?.sell);
  return (
    <>
      <div className="c" role="cell">
        <bdi dir="ltr" className="code">{c.code}</bdi>
        <span className="nm">{c.name}</span>
      </div>
      <div className={`v is-buy ${fb}`} role="cell">{c.rate?.buy ? rateLabel(c.rate.buy, dp) : "—"}</div>
      <div className={`v is-sell ${fs}`} role="cell">{c.rate?.sell ? rateLabel(c.rate.sell, dp) : "—"}</div>
    </>
  );
}

// ---------------------------------------------------------------- phone: one row per currency

/** On a phone the grid becomes rows: the currency at the start, buy over sell at the end (still editable). */
function RateItem({ c, e, dp, canEdit, onEdit, onHistory }: {
  c: BoardCurrency;
  e: { buy?: string | null; sell?: string | null };
  dp: number;
  canEdit: boolean;
  onEdit: (patch: { buy?: string | null; sell?: string | null }) => void;
  onHistory: () => void;
}) {
  const buy = e.buy !== undefined ? e.buy : c.rate?.buy ?? null;
  const sell = e.sell !== undefined ? e.sell : c.rate?.sell ?? null;
  const mid = buy && sell ? D(buy).plus(D(sell)).div(2).toFixed() : c.rate?.mid ?? buy ?? sell;
  const decimals = mid && D(mid).lt(100) ? 8 : dp;
  return (
    <div className="r">
      <button type="button" className="cur" onClick={onHistory} aria-label={`تاریخچه‌ی نرخ ${c.name}`}>
        <CurrencyAvatar code={c.code} size="sm" />
        <span className="t">
          <b>{c.name}</b>
          <span><bdi dir="ltr" className="sf-latin">{c.code}</bdi>{c.rate ? <><span className="sf-sep" aria-hidden />{ago(c.rate.at)}</> : null}</span>
        </span>
      </button>
      <div className="v">
        <label><span>خرید</span><NumberInput size="small" variant="borderless" decimals={decimals} value={buy} placeholder="—" disabled={!canEdit} onChange={(v) => onEdit({ buy: v })} aria-label={`نرخ خرید ${c.name}`} /></label>
        <label><span>فروش</span><NumberInput size="small" variant="borderless" decimals={decimals} value={sell} placeholder="—" disabled={!canEdit} onChange={(v) => onEdit({ sell: v })} aria-label={`نرخ فروش ${c.name}`} /></label>
      </div>
    </div>
  );
}

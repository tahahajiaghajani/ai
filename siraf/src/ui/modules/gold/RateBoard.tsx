// Price board (تابلوی قیمت): today's prices in big cards, buy and sell prices of every coin and
// bar model of the catalogue with the bubble and stale flags, live prices from the internet,
// manual entry (mazaneh ↔ gram18 linked, a confirmation for prices far from the last ones), a
// counter calculator (jewellery, used gold, آب‌شده, coins and bars) and the price history.
import { useMemo, useState, type ReactNode } from "react";
import { Button, Checkbox, Drawer, Form, Input, Modal, Select, Segmented, Switch, Table, Tooltip, Popconfirm, Alert } from "antd";
import { CloudDownload, Coins, Plus, Settings, Trash2, Calculator as CalcIcon, Clock } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { NumberInput, MoneyInput, PctInput, WeightInput } from "../../components/inputs";
import { Chip, JDateTime, Money } from "../../components/display";
import { Ic } from "../../components/shell/icons";
import { D } from "@shared/money";
import { formatNumber, faDigits } from "@shared/format";
import { gram18FromMazaneh, mazanehFromGram18, priceJewelry, priceOldGold, priceBullion, weightForBudget, type WageType } from "@shared/gold";
import { variantChips } from "@shared/gold-catalogue";
import { productQuote } from "@shared/gold-quote";
import { needsKey, sourceOrigin } from "@shared/price-source";
import { RateChange, RateSource, RateStamp, SplitButton, stepOf, quoteEnvOf, useCatalogue, useGoldSettings, useLatestRate, wageTypeOptions, coinTitle, type Rate, type GoldSettings, type CatalogueRow } from "./shared";
import { BubbleCell } from "./Coins";
import { ApiError } from "../../lib/api";
const SOURCES: Record<string, string> = { manual: "دستی", tgju: "tgju", goldapi: "انس جهانی", custom: "منبع دلخواه" };

/** One tile of the board: label, the figure (proportional, 500) with its unit, and one quiet fact at the foot. */
function Tile({ label, value, foot, lead }: { label: ReactNode; value: string | null | undefined; foot?: ReactNode; lead?: boolean }) {
  const { unit } = useOrg();
  return (
    <div className={`t ${lead ? "is-lead" : ""}`}>
      <div className="l">
        {lead ? <span className="sf-gold-av is-sm" aria-hidden>۱۸</span> : null}
        {label}
      </div>
      <div className="v">
        {value ? <>{formatNumber(value)}<span className="sf-unit">{unit}</span></> : <span className="sf-zero">—</span>}
      </div>
      <div className="f">{foot}</div>
    </div>
  );
}

export default function RateBoard() {
  const { api, can, unit, org } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const latest = useLatestRate();
  const settings = useGoldSettings();
  const [entry, setEntry] = useState(false);
  const [setup, setSetup] = useState(false);
  const r = latest.data?.rate;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["gold-rate"] });
    qc.invalidateQueries({ queryKey: ["gold-rates"] });
    qc.invalidateQueries({ queryKey: ["gold-summary"] });
  };
  // null = the source chosen in «منبع پیش‌فرض» (the server reads it); the menu forces one source
  const fetchLive = useAction((provider: string | null) => api.post("/gold/rates/fetch", { provider }), {
    onSuccess: (d: any) => {
      n.ok(`قیمت زنده از «${d.rate.meta?.source_label ?? SOURCES[d.rate.source] ?? d.rate.source}» ثبت شد`);
      for (const w of d.warnings ?? []) n.info(w);
      invalidate();
    },
  });
  const del = useAction((id: string) => api.del(`/gold/rates/${id}`), { success: "حذف شد", onSuccess: invalidate });
  const canEdit = can("gold", "edit");
  const canSetup = can("gold", "full") || can("settings", "edit");
  const catalogue = useCatalogue();
  const products = catalogue.data?.rows ?? [];
  const boardCoins = products.filter((p) => p.kind === "coin" && p.is_active && p.gold_meta.pricing_mode === "board" && p.rate_key);
  // with a catalogue the coins have their own table (buy, sell, bubble); the strip keeps the world prices
  const stripCoins = products.length ? [] : boardCoins.slice(0, 5);
  const names = new Map(products.filter((p) => p.rate_key).map((p) => [p.rate_key!, p.name]));
  const historyKeys = boardCoins.map((p) => p.rate_key!);

  return (
    <div>
      <PageHeader
        title="تابلوی قیمت طلا و سکه"
        subtitle={<span className="sf-doc-meta"><RateStamp rate={r} /></span>}
        actions={
          <>
            {canEdit ? (
              <SplitButton
                icon={<Ic icon={CloudDownload} />}
                loading={fetchLive.isPending}
                onClick={() => fetchLive.mutate(null)}
                items={[
                  { key: "tgju", label: "tgju.org، بازار داخلی", onClick: () => fetchLive.mutate("tgju") },
                  { key: "goldapi", label: "انس جهانی × دلار بازار آزاد", onClick: () => fetchLive.mutate("goldapi") },
                  { key: "custom", label: "منبع دلخواه (تنظیمات)", disabled: !settings.data?.price_source, onClick: () => fetchLive.mutate("custom") },
                  ...(canSetup ? [{ type: "divider" as const }, { key: "setup", icon: <Ic icon={Settings} />, label: "تنظیمات قیمت و محاسبه", onClick: () => setSetup(true) }] : []),
                ]}
              >
                دریافت قیمت زنده
              </SplitButton>
            ) : canSetup ? (
              <Button icon={<Ic icon={Settings} />} onClick={() => setSetup(true)}>تنظیمات قیمت</Button>
            ) : null}
            {canEdit ? <Button type="primary" icon={<Ic icon={Plus} />} onClick={() => setEntry(true)}>ثبت قیمت</Button> : null}
          </>
        }
      />

      {!r && !latest.isLoading ? (
        <Alert className="!mb-4" type="warning" showIcon title={<><b>هنوز قیمتی ثبت نشده است.</b> قیمت روز را دستی ثبت کنید یا «دریافت قیمت زنده» را بزنید.</>} />
      ) : null}

      <div className="sf-gboard sf-stagger mb-3" role="group" aria-label="قیمت روز">
        <Tile lead label="هر گرم طلای ۱۸ عیار" value={r?.gram18} foot={<><RateChange change={latest.data?.change} pct={latest.data?.change_pct} /><span>نسبت به قیمت پیشین</span></>} />
        <Tile label="مظنه (مثقال ۱۷ عیار)" value={r?.mazaneh} foot={<span>هر مثقال ۴٫۶۰۸ گرم</span>} />
        <Tile label="هر گرم طلای ۲۴ عیار" value={r?.gram24} foot={<span>عیار ۹۹۹٫۹</span>} />
        <Tile label="خرید طلای مستعمل (گرم ۱۸)" value={r?.buy_gram18} foot={r?.buy_gram18 && r?.gram18 ? <span>اختلاف با فروش <span className="sf-num">{formatNumber(D(r.gram18).minus(D(r.buy_gram18)))}</span></span> : null} />
      </div>
      <div className="sf-gcoins mb-4" role="group" aria-label="سکه و ارز">
        {stripCoins.map((c) => (
          <div key={c.id}>
            <Ic icon={Coins} size={16} className="shrink-0 text-ink-3" />
            <div className="t">
              <span className="l">{c.name.replace(/\s*\(.*?\)\s*/g, " ").trim()}</span>
              <span className="v">{r?.coins?.[c.rate_key!] ? formatNumber(r.coins[c.rate_key!]) : <span className="sf-zero">—</span>}</span>
            </div>
          </div>
        ))}
        <div>
          <div className="t">
            <span className="l">انس جهانی</span>
            <span className="v latn">{r?.ounce_usd ? `$${formatNumber(r.ounce_usd, { dp: 2, minDp: 2, fa: false })}` : "—"}</span>
          </div>
        </div>
        <div>
          <div className="t">
            <span className="l">دلار بازار آزاد</span>
            <span className="v">{r?.usd ? formatNumber(r.usd) : <span className="sf-zero">—</span>}</span>
          </div>
        </div>
      </div>

      <CoinBoard rate={r} products={products} settings={settings.data} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Section title="تاریخچه‌ی قیمت‌ها" extra={<span className="text-[12px] text-ink-3">مبالغ به {unit}</span>} bodyClass="">
          <ServerTable<Rate>
            path="/gold/rates"
            queryKey={["gold-rates"]}
            exportName="تاریخچه قیمت طلا"
            exportColumns={[
              { title: "زمان", value: (x) => x.at },
              { title: "گرم ۱۸", value: (x) => x.gram18, type: "number" },
              { title: "مظنه", value: (x) => x.mazaneh, type: "number" },
              { title: "گرم ۲۴", value: (x) => x.gram24, type: "number" },
              { title: "انس", value: (x) => x.ounce_usd, type: "number" },
              { title: "دلار", value: (x) => x.usd, type: "number" },
              ...historyKeys.flatMap((k) => [
                { title: coinTitle(k, names), value: (x: Rate) => x.coins?.[k] ?? null, type: "number" as const },
                { title: `خرید ${coinTitle(k, names)}`, value: (x: Rate) => x.coins_buy?.[k] ?? null, type: "number" as const },
              ]),
              { title: "منبع", value: (x) => (x.source === "custom" && x.meta?.source_label) || SOURCES[x.source] || x.source },
            ]}
            columns={[
              { key: "at", dataIndex: "at", title: "زمان", width: 140, render: (v) => <JDateTime v={v} /> },
              { key: "gram18", dataIndex: "gram18", title: "گرم ۱۸", className: "sf-num", width: 128, render: (v) => <Money v={v} zero="—" /> },
              { key: "mazaneh", dataIndex: "mazaneh", title: "مظنه", className: "sf-num", width: 140, render: (v) => <Money v={v} zero="—" /> },
              { key: "emami", title: "سکه‌ی امامی", className: "sf-num", width: 140, render: (_, x) => <Money v={x.coins?.emami ?? 0} zero="—" /> },
              { key: "bubble", title: "حباب امامی", className: "sf-num", width: 96, render: (_, x) => (x.bubbles?.emami?.domestic ? <span className="sf-num">{formatNumber(x.bubbles.emami.domestic, { dp: 2 })}٪</span> : <span className="sf-zero">—</span>) },
              { key: "ounce", dataIndex: "ounce_usd", title: "انس (دلار)", className: "sf-num", width: 88, render: (v) => (v ? <bdi dir="ltr" className="sf-latin">{formatNumber(v, { dp: 2, minDp: 2, fa: false })}</bdi> : <span className="sf-zero">—</span>) },
              { key: "src", dataIndex: "source", title: "منبع", render: (_, x) => <span className="text-ink-3"><RateSource rate={x} bare /></span> },
              ...(can("gold", "full")
                ? [{
                    key: "del", width: 44, render: (_: unknown, x: Rate) => (
                      <span className="sf-row-act">
                        <Popconfirm title="این قیمت حذف شود؟" okText="حذف" cancelText="انصراف" okButtonProps={{ danger: true }} onConfirm={() => del.mutate(x.id)}>
                          <Button type="text" size="small" icon={<Ic icon={Trash2} />} aria-label="حذف" />
                        </Popconfirm>
                      </span>
                    ),
                  }]
                : []),
            ]}
          />
        </Section>
        <Calculator rate={r ?? null} products={products} gram18={r?.gram18 ?? null} mazaneh={r?.mazaneh ?? null} settings={settings.data} unit={unit} moneyDecimals={org.money_decimals} />
      </div>

      <RateEntry open={entry} onClose={() => setEntry(false)} last={r} onSaved={invalidate} coins={boardCoins} />
      {settings.data ? <PriceSettings open={setup} onClose={() => setSetup(false)} settings={settings.data} /> : null}
    </div>
  );
}

/**
 * Today's buy and sell price of every active coin and bar model: board coins from the board (with
 * the bubble and a stale or carried-over flag), coins priced by weight and bars from the gram price.
 */
function CoinBoard({ rate, products, settings }: { rate: Rate | null | undefined; products: CatalogueRow[]; settings?: GoldSettings }) {
  const { org } = useOrg();
  const [kind, setKind] = useState<"coin" | "bar">("coin");
  const env = quoteEnvOf(settings, org.money_decimals);
  const stale = new Set(rate?.meta?.stale ?? []);
  const rows = products
    .filter((p) => p.kind === kind && p.is_active)
    .map((p) => ({
      ...p,
      sellQ: productQuote(p, rate, env, { side: "sell" }),
      buyQ: productQuote(p, rate, env, { side: "buy" }),
    }));
  if (!products.length) return null;
  return (
    <Section
      className="mb-4"
      title="سکه‌ها و شمش‌ها"
      extra={<Segmented size="small" value={kind} onChange={(v) => setKind(v as typeof kind)} options={[{ value: "coin", label: "سکه" }, { value: "bar", label: "شمش" }]} />}
      bodyClass=""
    >
      <Table
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={false}
        scroll={{ x: "max-content" }}
        columns={[
          {
            key: "n", title: kind === "coin" ? "سکه" : "مدل", render: (_, p) => (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {p.name}
                {variantChips(p.gold_meta).filter((c) => !p.name.includes(c)).map((c) => <Chip key={c} dot={false}>{c}</Chip>)}
                {p.rate_key && stale.has(p.rate_key) ? <Tooltip title={rate?.meta?.carried?.includes(p.rate_key) ? "از قیمت قبلی برداشته شد" : "قیمت منبع قدیمی است"}><span className="text-warning"><Ic icon={Clock} size={14} /></span></Tooltip> : null}
              </span>
            ),
          },
          { key: "m", title: "قیمت‌گذاری", render: (_, p) => <span className="text-[13px] text-ink-3">{p.sellQ?.mode === "board" ? "تابلو" : p.sellQ ? "وزنی" : "—"}</span> },
          { key: "b", title: "خرید", className: "sf-num", render: (_, p) => <Money v={p.buyQ?.unit ?? 0} zero="—" /> },
          { key: "s", title: "فروش", className: "sf-num", render: (_, p) => <Money v={p.sellQ?.unit ?? 0} zero="—" /> },
          ...(kind === "coin"
            ? [
                { key: "r", title: "تک‌فروشی", className: "sf-num", render: (_: unknown, p: CatalogueRow) => <Money v={(p.rate_key && rate?.meta?.retail?.[p.rate_key]) || 0} zero="—" /> },
                { key: "bu", title: "حباب", className: "sf-num", render: (_: unknown, p: CatalogueRow) => <BubbleCell b={p.rate_key && rate?.bubbles?.[p.rate_key] ? rate.bubbles[p.rate_key] : p.bubble} /> },
              ]
            : []),
        ]}
      />
    </Section>
  );
}

/** Manual rate: typing the mazaneh fills the 18k gram and the other way round. */
function RateEntry({ open, onClose, last, onSaved, coins }: { open: boolean; onClose: () => void; last: Rate | null | undefined; onSaved: () => void; coins: CatalogueRow[] }) {
  const { api } = useOrg();
  const n = useNotify();
  const [v, setV] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string, x: string | null) => setV((o) => ({ ...o, [k]: x }));
  const keys = coins.map((c) => c.rate_key!);
  const post = (confirm: boolean) =>
    api.post("/gold/rates", {
      gram18: v.gram18, mazaneh: v.mazaneh, gram24: v.gram24, buy_gram18: v.buy_gram18, ounce_usd: v.ounce_usd, usd: v.usd, note: v.note, confirm,
      coins: Object.fromEntries(keys.map((k) => [k, v[k] ?? null])),
      coins_buy: Object.fromEntries(keys.map((k) => [k, v[`buy:${k}`] ?? null])),
    });
  const done = () => {
    n.ok("قیمت روز ثبت شد");
    onSaved();
    onClose();
  };
  // a price far from the last one is saved only after the user confirms it
  const save = {
    isPending: busy,
    mutate: async () => {
      setBusy(true);
      try {
        await post(false);
        done();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          Modal.confirm({ title: "تأیید قیمت", content: e.message, okText: "ثبت قیمت", cancelText: "بازبینی", onOk: async () => { try { await post(true); done(); } catch (x) { n.error(x); } } });
        } else n.error(e);
      } finally {
        setBusy(false);
      }
    },
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={460}
      title="ثبت قیمت روز"
      destroyOnHidden
      afterOpenChange={(o) => {
        if (o) {
          setV({
            gram18: last?.gram18 ?? null, mazaneh: last?.mazaneh ?? null, buy_gram18: last?.buy_gram18 ?? null, usd: last?.usd ?? null, ounce_usd: last?.ounce_usd ?? null,
            ...Object.fromEntries(keys.map((k) => [k, last?.coins?.[k] ?? null])), ...Object.fromEntries(keys.map((k) => [`buy:${k}`, last?.coins_buy?.[k] ?? null])),
          });
        }
      }}
      footer={<Button type="primary" block loading={save.isPending} onClick={() => save.mutate()}>ثبت قیمت</Button>}
    >
      <div className="grid gap-3">
        <div>
          <div className="sf-field-l mb-1.5">مظنه (مثقال ۱۷ عیار)</div>
          <MoneyInput size="large" value={v.mazaneh} onChange={(x) => setV((o) => ({ ...o, mazaneh: x, gram18: x ? gram18FromMazaneh(x) : o.gram18 }))} />
        </div>
        <div>
          <div className="sf-field-l mb-1.5">هر گرم ۱۸ عیار (= مظنه ÷ ۴٫۳۳۱۸)</div>
          <MoneyInput size="large" value={v.gram18} onChange={(x) => setV((o) => ({ ...o, gram18: x, mazaneh: x ? mazanehFromGram18(x) : o.mazaneh }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="sf-field-l mb-1.5">قیمت خرید مستعمل (گرم ۱۸)</div>
            <MoneyInput value={v.buy_gram18} onChange={(x) => set("buy_gram18", x)} />
          </div>
          <div>
            <div className="sf-field-l mb-1.5">گرم ۲۴ (خالی = خودکار)</div>
            <MoneyInput value={v.gram24} onChange={(x) => set("gram24", x)} />
          </div>
          <div>
            <div className="sf-field-l mb-1.5">انس جهانی (دلار)</div>
            <NumberInput decimals={2} value={v.ounce_usd} onChange={(x) => set("ounce_usd", x)} />
          </div>
          <div>
            <div className="sf-field-l mb-1.5">دلار بازار آزاد</div>
            <MoneyInput value={v.usd} onChange={(x) => set("usd", x)} />
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line pt-2 text-xs font-semibold text-ink-3">
          <span>فروش</span>
          <span>خرید</span>
        </div>
        {coins.map((c) => (
          <div key={c.id}>
            <div className="sf-field-l mb-1.5">{c.name}</div>
            <div className="grid grid-cols-2 gap-3">
              <MoneyInput value={v[c.rate_key!]} onChange={(x) => set(c.rate_key!, x)} aria-label={`فروش ${c.name}`} />
              <MoneyInput value={v[`buy:${c.rate_key}`]} onChange={(x) => set(`buy:${c.rate_key}`, x)} aria-label={`خرید ${c.name}`} />
            </div>
          </div>
        ))}
        <Input placeholder="یادداشت (اختیاری)" value={v.note ?? ""} onChange={(e) => set("note", e.target.value)} />
      </div>
    </Drawer>
  );
}

/** Counter calculator: piece price, used gold, bullion by mazaneh, weight for a budget. */
function Calculator({ rate, products, gram18, mazaneh, settings, unit, moneyDecimals }: { rate: Rate | null; products: CatalogueRow[]; gram18: string | null; mazaneh: string | null; settings?: GoldSettings; unit: string; moneyDecimals: number }) {
  const [mode, setMode] = useState<"piece" | "old" | "bullion" | "budget" | "product">("piece");
  const [f, setF] = useState<Record<string, string | null>>({ fineness: "750", wage_type: "percent", wage_value: "18" });
  const set = (k: string, x: string | null) => setF((o) => ({ ...o, [k]: x }));
  const g18 = f.gram18 ?? gram18 ?? "0";
  const step = stepOf(settings, moneyDecimals);
  const profit = f.profit_pct ?? settings?.profit_pct ?? "7";
  const tax = settings?.tax_pct ?? "10";
  const result = useMemo(() => {
    try {
      if (mode === "piece") return priceJewelry({ weight: f.weight ?? 0, fineness: f.fineness ?? 750, gram18: g18, wageType: (f.wage_type ?? "percent") as WageType, wageValue: f.wage_value ?? 0, profitPct: profit, taxPct: tax, discount: f.discount ?? 0, stonePrice: f.stone ?? 0, roundStep: step });
      if (mode === "old") return priceOldGold({ weight: f.weight ?? 0, fineness: f.fineness ?? 750, gram18: f.gram18 ?? gram18 ?? 0, deductionPct: f.deduction ?? settings?.old_deduction_pct ?? 0, roundStep: step });
      if (mode === "bullion") return { total: priceBullion(f.weight ?? 0, f.fineness ?? 750, f.mazaneh ?? mazaneh ?? 0, step) };
      if (mode === "product") {
        const p = products.find((x) => x.id === f.product);
        if (!p) return null;
        return productQuote(p, rate ? { ...rate, gram18: g18 } : { gram18: g18 }, quoteEnvOf(settings, moneyDecimals), {
          side: f.side === "buy" ? "buy" : "sell", qty: f.qty ?? 1, weight: p.kind === "bar" ? f.weight ?? p.gold_weight : undefined, fineness: p.kind === "bar" ? f.fineness ?? p.fineness : undefined, seal_status: f.seal ?? "sealed",
        });
      }
      return { weight: weightForBudget(f.budget ?? 0, { fineness: f.fineness ?? 750, gram18: g18, wageType: (f.wage_type ?? "percent") as WageType, wageValue: f.wage_value ?? 0, profitPct: profit, taxPct: tax }) };
    } catch {
      return null;
    }
  }, [mode, f, g18, profit, tax, step, gram18, mazaneh, settings, products, rate, moneyDecimals]);
  const product = products.find((x) => x.id === f.product);
  const R = ({ k, v, strong, w }: { k: ReactNode; v?: string; strong?: boolean; w?: boolean }) => (
    <div className={`r ${strong ? "is-total" : ""}`}>
      <span>{k}</span>
      <span className="n">{v && !D(v).isZero() ? (w ? <>{formatNumber(v, { dp: 3, minDp: 3 })}<span className="sf-unit">{"\u00a0"}گرم</span></> : <>{formatNumber(v, { dp: moneyDecimals })}{strong ? <span className="sf-unit">{"\u00a0"}{unit}</span> : null}</>) : <span className="sf-zero">—</span>}</span>
    </div>
  );
  const res = result as Record<string, string> | null;
  const L = ({ children }: { children: ReactNode }) => <div className="sf-field-l">{children}</div>;
  return (
    <Section title={<span className="inline-flex items-center gap-2"><Ic icon={CalcIcon} className="text-ink-3" />ماشین‌حساب طلا</span>} className="sf-gcalc">
      <Select className="w-full" value={mode} onChange={(v) => setMode(v)} aria-label="نوع محاسبه" options={[{ value: "piece", label: "قیمت جنس (اجرت و سود)" }, { value: "product", label: "سکه و شمش" }, { value: "old", label: "خرید طلای مستعمل" }, { value: "bullion", label: "آب‌شده با مظنه" }, { value: "budget", label: "با این مبلغ چند گرم؟" }]} />
      {mode === "product" ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="sf-field col-span-2"><L>سکه یا شمش</L><Select showSearch optionFilterProp="label" className="w-full" value={f.product ?? undefined} onChange={(x) => setF((o) => ({ ...o, product: x, weight: null, fineness: null }))} options={products.filter((p) => p.is_active).map((p) => ({ value: p.id, label: p.name }))} /></div>
          <div className="sf-field"><L>معامله</L><Segmented block value={f.side ?? "sell"} onChange={(x) => set("side", String(x))} options={[{ value: "sell", label: "فروش" }, { value: "buy", label: "خرید" }]} /></div>
          {product?.kind === "bar" ? (
            <>
              <div className="sf-field"><L>وزن</L><WeightInput value={f.weight ?? product.gold_weight} onChange={(x) => set("weight", x)} /></div>
              <div className="sf-field"><L>عیار</L><NumberInput decimals={1} value={f.fineness ?? product.fineness} onChange={(x) => set("fineness", x)} /></div>
              {f.side === "buy" ? <div className="sf-field"><L>پلمپ</L><Segmented block value={f.seal ?? "sealed"} onChange={(x) => set("seal", String(x))} options={[{ value: "sealed", label: "سالم" }, { value: "opened", label: "باز" }]} /></div> : null}
            </>
          ) : (
            <div className="sf-field"><L>تعداد</L><NumberInput value={f.qty ?? "1"} onChange={(x) => set("qty", x)} /></div>
          )}
        </div>
      ) : null}
      <div className={`mt-4 grid grid-cols-2 gap-3 ${mode === "product" ? "hidden" : ""}`}>
        {mode === "budget" ? (
          <div className="sf-field col-span-2"><L>مبلغ</L><MoneyInput value={f.budget} onChange={(x) => set("budget", x)} words={unit} /></div>
        ) : (
          <div className="sf-field"><L>وزن</L><WeightInput value={f.weight} onChange={(x) => set("weight", x)} /></div>
        )}
        <div className="sf-field"><L>{mode === "bullion" ? "عیار ری‌گیری" : "عیار"}</L><NumberInput decimals={1} value={f.fineness} onChange={(x) => set("fineness", x)} /></div>
        {mode === "bullion" ? (
          <div className="sf-field col-span-2"><L>مظنه</L><MoneyInput value={f.mazaneh ?? mazaneh} onChange={(x) => set("mazaneh", x)} /></div>
        ) : (
          <div className="sf-field col-span-2"><L>گرم ۱۸ عیار</L><MoneyInput value={f.gram18 ?? gram18} onChange={(x) => set("gram18", x)} /></div>
        )}
        {mode === "piece" || mode === "budget" ? (
          <>
            <div className="sf-field"><L>نوع اجرت</L><Select className="w-full" value={f.wage_type} onChange={(x) => set("wage_type", x)} options={wageTypeOptions} /></div>
            <div className="sf-field"><L>اجرت</L><NumberInput decimals={3} value={f.wage_value} onChange={(x) => set("wage_value", x)} /></div>
            <div className="sf-field"><L>سود فروشنده</L><PctInput value={f.profit_pct ?? settings?.profit_pct} onChange={(x) => set("profit_pct", x)} /></div>
            {mode === "piece" ? <div className="sf-field"><L>تخفیف</L><MoneyInput value={f.discount} onChange={(x) => set("discount", x)} /></div> : null}
          </>
        ) : null}
        {mode === "old" ? <div className="sf-field col-span-2"><L>کسر</L><PctInput value={f.deduction ?? settings?.old_deduction_pct} onChange={(x) => set("deduction", x)} /></div> : null}
      </div>
      <div className="sf-sums mt-4" aria-live="polite">
        {mode === "piece" && res ? (
          <>
            <R k="ارزش طلا" v={res.goldValue} />
            <R k="اجرت" v={res.wage} />
            <R k="سود" v={res.profit} />
            <R k={<>مالیات <span className="why">{faDigits(tax)}٪</span></>} v={res.tax} />
            <R k="قیمت نهایی" v={res.total} strong />
          </>
        ) : null}
        {mode === "old" && res ? (
          <>
            <R k="معادل ۷۵۰" v={res.weight750} w />
            <R k="ارزش" v={res.gross} />
            <R k="کسر" v={res.deduction} />
            <R k="قابل پرداخت" v={res.total} strong />
          </>
        ) : null}
        {mode === "bullion" && res ? <R k="ارزش آب‌شده" v={res.total} strong /> : null}
        {mode === "product" && result && "breakdown" in (result as object) ? (
          <>
            {(result as { breakdown: { key: string; label: string; amount: string }[] }).breakdown.map((b) => <R key={b.key} k={b.label} v={D(b.amount).abs().toString()} />)}
            <R k="طلای خالص" v={(result as { pure: string }).pure} w />
            {(result as { bubble?: { domestic?: { pct: string } | null } | null }).bubble?.domestic ? <R k={<>حباب <span className="why">{formatNumber((result as any).bubble.domestic.pct, { dp: 2 })}٪</span></>} v={(result as any).bubble.domestic.amount} /> : null}
            <R k={f.side === "buy" ? "قابل پرداخت" : "قیمت نهایی"} v={(result as { total: string }).total} strong />
          </>
        ) : null}
        {mode === "budget" && res ? <R k="وزن قابل خرید" v={res.weight} w strong /> : null}
      </div>
    </Section>
  );
}

/** Live price sources and the pricing defaults of the gold module. */
function PriceSettings({ open, onClose, settings }: { open: boolean; onClose: () => void; settings: GoldSettings }) {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  // the custom source's key on this runtime: where it goes and «…abcd», never the key itself
  const keyInfo = useQuery({
    queryKey: ["gold-price-key", orgId],
    queryFn: () => api.get<{ price_key: { origin: string; hint: string | null; unreadable: boolean } | null; runtime: "cloud" | "desktop" }>("/gold/settings"),
    enabled: open,
  });
  const save = useAction((v: any) => api.put("/gold/settings", v), {
    success: "تنظیمات ذخیره شد",
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gold-settings"] });
      qc.invalidateQueries({ queryKey: ["gold-price-key", orgId] });
      qc.invalidateQueries({ queryKey: ["org", orgId] });
      onClose();
    },
  });
  const url: string | undefined = Form.useWatch(["price_source", "url"], form);
  const header: string | undefined = Form.useWatch(["price_source", "header"], form);
  const runtime = keyInfo.data?.runtime === "desktop" ? "نسخهٔ ویندوز" : "نسخهٔ وب";
  const savedKey = keyInfo.data?.price_key ?? null;
  const stored = savedKey && savedKey.origin === sourceOrigin(url) ? savedKey : null;
  const keyNote = stored
    ? stored.unreadable ? "کلید ذخیره‌شده باز نمی‌شود؛ دوباره وارد کنید" : <>ذخیره‌شده در {runtime}: <bdi dir="ltr" className="sf-latin">{stored.hint ?? "…"}</bdi></>
    : savedKey ? "کلید قبلی برای نشانی دیگری است و با ذخیره حذف می‌شود"
    : needsKey({ url, header }) ? `در ${runtime} کلیدی ذخیره نشده است` : `فقط در ${runtime} نگه داشته می‌شود`;
  const catalogue = useCatalogue("coin");
  const board = (catalogue.data?.rows ?? []).filter((p) => p.is_active && p.rate_key && p.gold_meta.pricing_mode === "board");
  const PATHS: [string, string][] = [
    ["gram18", "گرم ۱۸"], ["mazaneh", "مظنه"], ["gram24", "گرم ۲۴"], ["buy_gram18", "خرید مستعمل"], ["ounce_usd", "انس (دلار)"], ["usd", "دلار"],
    ...board.flatMap((p): [string, string][] => [[p.rate_key!, p.name], [`buy:${p.rate_key}`, `خرید ${p.name}`]]),
  ];
  return (
    <Drawer open={open} onClose={onClose} size={560} title="تنظیمات قیمت و محاسبه‌ی طلا" destroyOnHidden footer={<Button type="primary" block loading={save.isPending} onClick={() => form.submit()}>ذخیره</Button>}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ...settings, price_source: settings.price_source ?? { url: "", unit: "rial", paths: {} } }}
        onFinish={(v) => save.mutate({ ...v, bars: { ...settings.bars, ...v.bars }, price_source: v.price_source?.url ? { ...v.price_source, key: v.price_source.key?.trim() || null } : null })}
      >
        <div className="mb-2 text-xs font-semibold text-ink-3">محاسبه‌ی قیمت</div>
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item name="profit_pct" label="سود فروشنده‌ی پیش‌فرض"><PctInput /></Form.Item>
          <Form.Item name="tax_pct" label="مالیات بر اجرت و سود" extra="۱۴۰۵: ۱۰٪"><PctInput /></Form.Item>
          <Form.Item name="round_step" label="گرد کردن مبالغ به"><NumberInput /></Form.Item>
          <Form.Item name="old_deduction_pct" label="کسر پیش‌فرض طلای مستعمل"><PctInput /></Form.Item>
          <Form.Item name="purchase_tax_pct" label="مالیات خرید بر اجرت همکار" extra="معمولاً صفر"><PctInput /></Form.Item>
          <Form.Item name="deviation_pct" label="هشدار اختلاف قیمت دستی" extra="درصد اختلاف با قیمت قبلی"><PctInput /></Form.Item>
          <Form.Item name="stale_minutes" label="قدیمی بودن قیمت منبع (دقیقه)"><NumberInput /></Form.Item>
        </div>
        <div className="mb-2 mt-2 border-t border-line pt-3 text-xs font-semibold text-ink-3">شناسایی مشتری</div>
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item name={["kyc", "enabled"]} label="کد ملی برای سکه، شمش و آب‌شده" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name={["kyc", "threshold"]} label="از مبلغ" extra="خالی: همه‌ی معاملات"><MoneyInput /></Form.Item>
        </div>
        <div className="mb-2 mt-2 border-t border-line pt-3 text-xs font-semibold text-ink-3">شمش</div>
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item name={["bars", "basis"]} label="عیار محاسبه"><Select options={[{ value: "actual", label: "عیار واقعی" }, { value: "nominal", label: "۲۴ عیار کامل برای ۹۹۹٫۹" }]} /></Form.Item>
          <Form.Item name={["bars", "opened_fineness"]} label="عیار خرید شمش باز"><NumberInput decimals={1} /></Form.Item>
          <Form.Item name={["bars", "fee_sealed_pct"]} label="کارمزد خرید شمش پلمپ"><PctInput /></Form.Item>
          <Form.Item name={["bars", "fee_opened_pct"]} label="کارمزد خرید شمش باز"><PctInput /></Form.Item>
          <Form.Item name={["bars", "assay_fee"]} label="هزینه‌ی ری‌گیری شمش باز"><MoneyInput /></Form.Item>
        </div>
        <div className="mb-2 mt-2 border-t border-line pt-3 text-xs font-semibold text-ink-3">قیمت زنده</div>
        <Form.Item name="provider" label="منبع پیش‌فرض">
          <Select options={[{ value: "auto", label: "خودکار (دلخواه ← tgju ← انس جهانی)" }, { value: "tgju", label: "tgju.org" }, { value: "goldapi", label: "انس جهانی × دلار" }, { value: "custom", label: "منبع دلخواه" }]} />
        </Form.Item>
        <Form.Item name="usd" label="دلار بازار آزاد برای محاسبه از انس" extra="اگر نرخ دلار در ماژول صرافی ثبت شده باشد همان استفاده می‌شود"><MoneyInput /></Form.Item>
        <div className="bg-sunken rounded-lg p-3">
          <div className="mb-2 text-xs font-semibold">منبع دلخواه (JSON)</div>
          <Form.Item name={["price_source", "url"]} label="نشانی (https)" extra={<>کلیدی که در نشانی می‌آید: به جای آن <span className="sf-ltr">{"{key}"}</span></>}><Input dir="ltr" className="sf-code" placeholder="https://example.com/prices.json" /></Form.Item>
          <Form.Item name={["price_source", "unit"]} label="واحد قیمت‌ها"><Select options={[{ value: "rial", label: "ریال" }, { value: "toman", label: "تومان" }]} /></Form.Item>
          <div className="grid grid-cols-2 gap-x-3">
            <Form.Item name={["price_source", "header"]} label="سرآیند کلید"><Input dir="ltr" className="sf-code" placeholder="X-API-Key" /></Form.Item>
            <Form.Item name={["price_source", "key"]} label="کلید API" extra={keyNote}>
              <Input.Password dir="ltr" className="sf-code" autoComplete="new-password" spellCheck={false} placeholder={stored && !stored.unreadable ? stored.hint ?? "" : ""} />
            </Form.Item>
          </div>
          {stored ? (
            <Form.Item name={["price_source", "remove_key"]} valuePropName="checked" className="!-mt-2 !mb-2">
              <Checkbox>حذف کلید ذخیره‌شده</Checkbox>
            </Form.Item>
          ) : null}
          <div className="grid grid-cols-2 gap-x-3">
            <Form.Item name={["price_source", "label"]} label="نام منبع کنار قیمت‌ها"><Input placeholder="EZRate" /></Form.Item>
            <Form.Item name={["price_source", "link"]} label="پیوند نام منبع"><Input dir="ltr" className="sf-code" placeholder="https://ezrate.me" /></Form.Item>
          </div>
          <div className="sf-field-l mb-1.5">مسیر هر قیمت در پاسخ، مثل <span className="sf-ltr">data.gold.g18</span>، <span className="sf-ltr">items[0].price</span> یا <span className="sf-ltr">items[symbol=IR_GOLD_18K].price</span></div>
          <div className="grid grid-cols-2 gap-x-3">
            {PATHS.map(([k, label]) => (
              <Form.Item key={k} name={["price_source", "paths", k]} label={label} className="!mb-2"><Input dir="ltr" size="small" className="sf-code" /></Form.Item>
            ))}
          </div>
        </div>
        <Tooltip title="سایت‌های ایرانی ممکن است از خارج از ایران در دسترس نباشند و برعکس">
          <div className="mt-2 text-xs text-ink-3">اگر یک منبع در دسترس نبود، در حالت خودکار منبع بعدی امتحان می‌شود.</div>
        </Tooltip>
      </Form>
    </Drawer>
  );
}

// Price board (تابلوی قیمت): today's prices in big cards, live prices from the internet, manual
// entry (mazaneh ↔ gram18 linked), a counter calculator and the price history.
import { useMemo, useState, type ReactNode } from "react";
import { Button, Drawer, Form, Input, Select, Segmented, Tooltip, Popconfirm, Alert } from "antd";
import { CloudDownload, Plus, Settings, Trash2, Calculator as CalcIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { NumberInput, MoneyInput, PctInput, WeightInput } from "../../components/inputs";
import { JDateTime, Money } from "../../components/display";
import { Ic } from "../../components/shell/icons";
import { D } from "@shared/money";
import { formatNumber, faDigits } from "@shared/format";
import { gram18FromMazaneh, mazanehFromGram18, priceJewelry, priceOldGold, priceBullion, weightForBudget, type WageType } from "@shared/gold";
import { KaratAvatar } from "./kit";
import { RateChange, RateStamp, SplitButton, stepOf, useGoldSettings, useLatestRate, wageTypeOptions, coinTitle, type Rate, type GoldSettings } from "./shared";

const COIN_KEYS = ["emami", "bahar", "nim", "rob", "gerami"] as const;
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
  const fetchLive = useAction((provider: string) => api.post("/gold/rates/fetch", { provider }), {
    onSuccess: (d: any) => {
      n.ok(`قیمت زنده از «${SOURCES[d.rate.source] ?? d.rate.source}» ثبت شد`);
      for (const w of d.warnings ?? []) n.info(w);
      invalidate();
    },
  });
  const del = useAction((id: string) => api.del(`/gold/rates/${id}`), { success: "حذف شد", onSuccess: invalidate });
  const canEdit = can("gold", "edit");
  const canSetup = can("gold", "full") || can("settings", "edit");

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
                onClick={() => fetchLive.mutate("auto")}
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
        {COIN_KEYS.map((k) => (
          <div key={k}>
            <KaratAvatar kind="coin" small />
            <div className="t">
              <span className="l">سکه‌ی {coinTitle(k)}</span>
              <span className="v">{r?.coins?.[k] ? formatNumber(r.coins[k]) : <span className="sf-zero">—</span>}</span>
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
              ...COIN_KEYS.map((k) => ({ title: `سکه ${coinTitle(k)}`, value: (x: Rate) => x.coins?.[k] ?? null, type: "number" as const })),
              { title: "منبع", value: (x) => SOURCES[x.source] ?? x.source },
            ]}
            columns={[
              { key: "at", dataIndex: "at", title: "زمان", width: 140, render: (v) => <JDateTime v={v} /> },
              { key: "gram18", dataIndex: "gram18", title: "گرم ۱۸", className: "sf-num", width: 128, render: (v) => <Money v={v} zero="—" /> },
              { key: "mazaneh", dataIndex: "mazaneh", title: "مظنه", className: "sf-num", width: 140, render: (v) => <Money v={v} zero="—" /> },
              { key: "emami", title: "سکه‌ی امامی", className: "sf-num", width: 140, render: (_, x) => <Money v={x.coins?.emami ?? 0} zero="—" /> },
              { key: "ounce", dataIndex: "ounce_usd", title: "انس (دلار)", className: "sf-num", width: 88, render: (v) => (v ? <bdi dir="ltr" className="sf-latin">{formatNumber(v, { dp: 2, minDp: 2, fa: false })}</bdi> : <span className="sf-zero">—</span>) },
              { key: "src", dataIndex: "source", title: "منبع", render: (v) => <span className="text-ink-3">{SOURCES[v] ?? v}</span> },
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
        <Calculator gram18={r?.gram18 ?? null} mazaneh={r?.mazaneh ?? null} settings={settings.data} unit={unit} moneyDecimals={org.money_decimals} />
      </div>

      <RateEntry open={entry} onClose={() => setEntry(false)} last={r} onSaved={invalidate} />
      {settings.data ? <PriceSettings open={setup} onClose={() => setSetup(false)} settings={settings.data} /> : null}
    </div>
  );
}

/** Manual rate: typing the mazaneh fills the 18k gram and the other way round. */
function RateEntry({ open, onClose, last, onSaved }: { open: boolean; onClose: () => void; last: Rate | null | undefined; onSaved: () => void }) {
  const { api } = useOrg();
  const [v, setV] = useState<Record<string, string | null>>({});
  const set = (k: string, x: string | null) => setV((o) => ({ ...o, [k]: x }));
  const save = useAction(
    () =>
      api.post("/gold/rates", {
        gram18: v.gram18, mazaneh: v.mazaneh, gram24: v.gram24, buy_gram18: v.buy_gram18, ounce_usd: v.ounce_usd, usd: v.usd, note: v.note,
        coins: Object.fromEntries(COIN_KEYS.map((k) => [k, v[k] ?? null])),
      }),
    { success: "قیمت روز ثبت شد", onSuccess: () => { onSaved(); onClose(); } },
  );
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={460}
      title="ثبت قیمت روز"
      destroyOnHidden
      afterOpenChange={(o) => {
        if (o) setV({ gram18: last?.gram18 ?? null, mazaneh: last?.mazaneh ?? null, buy_gram18: last?.buy_gram18 ?? null, usd: last?.usd ?? null, ounce_usd: last?.ounce_usd ?? null, ...Object.fromEntries(COIN_KEYS.map((k) => [k, last?.coins?.[k] ?? null])) });
      }}
      footer={<Button type="primary" block loading={save.isPending} onClick={() => save.mutate(undefined)}>ثبت قیمت</Button>}
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
        <div className="border-t border-line pt-2 text-xs font-semibold text-ink-3">سکه‌ها</div>
        <div className="grid grid-cols-2 gap-3">
          {COIN_KEYS.map((k) => (
            <div key={k}>
              <div className="sf-field-l mb-1.5">سکه {coinTitle(k)}</div>
              <MoneyInput value={v[k]} onChange={(x) => set(k, x)} />
            </div>
          ))}
        </div>
        <Input placeholder="یادداشت (اختیاری)" value={v.note ?? ""} onChange={(e) => set("note", e.target.value)} />
      </div>
    </Drawer>
  );
}

/** Counter calculator: piece price, used gold, bullion by mazaneh, weight for a budget. */
function Calculator({ gram18, mazaneh, settings, unit, moneyDecimals }: { gram18: string | null; mazaneh: string | null; settings?: GoldSettings; unit: string; moneyDecimals: number }) {
  const [mode, setMode] = useState<"piece" | "old" | "bullion" | "budget">("piece");
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
      return { weight: weightForBudget(f.budget ?? 0, { fineness: f.fineness ?? 750, gram18: g18, wageType: (f.wage_type ?? "percent") as WageType, wageValue: f.wage_value ?? 0, profitPct: profit, taxPct: tax }) };
    } catch {
      return null;
    }
  }, [mode, f, g18, profit, tax, step, gram18, mazaneh, settings]);
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
      <Segmented block value={mode} onChange={(v) => setMode(v as typeof mode)} options={[{ value: "piece", label: "جنس" }, { value: "old", label: "مستعمل" }, { value: "bullion", label: "آبشده" }, { value: "budget", label: "با مبلغ" }]} />
      <div className="mt-4 grid grid-cols-2 gap-3">
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
        {mode === "bullion" && res ? <R k="ارزش آبشده" v={res.total} strong /> : null}
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
  const save = useAction((v: any) => api.put("/gold/settings", v), {
    success: "تنظیمات ذخیره شد",
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gold-settings"] });
      qc.invalidateQueries({ queryKey: ["org", orgId] });
      onClose();
    },
  });
  const PATHS: [string, string][] = [["gram18", "گرم ۱۸"], ["mazaneh", "مظنه"], ["gram24", "گرم ۲۴"], ["buy_gram18", "خرید مستعمل"], ["ounce_usd", "انس (دلار)"], ["usd", "دلار"], ["emami", "سکه امامی"], ["bahar", "سکه بهار"], ["nim", "نیم سکه"], ["rob", "ربع سکه"], ["gerami", "سکه گرمی"]];
  return (
    <Drawer open={open} onClose={onClose} size={560} title="تنظیمات قیمت و محاسبه‌ی طلا" destroyOnHidden footer={<Button type="primary" block loading={save.isPending} onClick={() => form.submit()}>ذخیره</Button>}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ...settings, price_source: settings.price_source ?? { url: "", unit: "rial", paths: {} } }}
        onFinish={(v) => save.mutate({ ...v, price_source: v.price_source?.url ? v.price_source : null })}
      >
        <div className="mb-2 text-xs font-semibold text-ink-3">محاسبه‌ی قیمت</div>
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item name="profit_pct" label="سود فروشنده‌ی پیش‌فرض"><PctInput /></Form.Item>
          <Form.Item name="tax_pct" label="مالیات بر اجرت و سود" extra="۱۴۰۵: ۱۰٪"><PctInput /></Form.Item>
          <Form.Item name="round_step" label="گرد کردن مبالغ به"><NumberInput /></Form.Item>
          <Form.Item name="old_deduction_pct" label="کسر پیش‌فرض طلای مستعمل"><PctInput /></Form.Item>
          <Form.Item name="purchase_tax_pct" label="مالیات خرید بر اجرت همکار" extra="معمولاً صفر"><PctInput /></Form.Item>
        </div>
        <div className="mb-2 mt-2 border-t border-line pt-3 text-xs font-semibold text-ink-3">قیمت زنده</div>
        <Form.Item name="provider" label="منبع پیش‌فرض">
          <Select options={[{ value: "auto", label: "خودکار (دلخواه ← tgju ← انس جهانی)" }, { value: "tgju", label: "tgju.org" }, { value: "goldapi", label: "انس جهانی × دلار" }, { value: "custom", label: "منبع دلخواه" }]} />
        </Form.Item>
        <Form.Item name="usd" label="دلار بازار آزاد برای محاسبه از انس" extra="اگر نرخ دلار در ماژول صرافی ثبت شده باشد همان استفاده می‌شود"><MoneyInput /></Form.Item>
        <div className="bg-sunken rounded-lg p-3">
          <div className="mb-2 text-xs font-semibold">منبع دلخواه (JSON)</div>
          <Form.Item name={["price_source", "url"]} label="نشانی (https)"><Input dir="ltr" placeholder="https://example.com/prices.json" /></Form.Item>
          <Form.Item name={["price_source", "unit"]} label="واحد قیمت‌ها"><Select options={[{ value: "rial", label: "ریال" }, { value: "toman", label: "تومان" }]} /></Form.Item>
          <div className="sf-field-l mb-1.5">مسیر هر قیمت در پاسخ، مثل <span className="sf-ltr">data.gold.g18</span> یا <span className="sf-ltr">items[0].price</span></div>
          <div className="grid grid-cols-2 gap-x-3">
            {PATHS.map(([k, label]) => (
              <Form.Item key={k} name={["price_source", "paths", k]} label={label} className="!mb-2"><Input dir="ltr" size="small" /></Form.Item>
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

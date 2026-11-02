// Price board (تابلوی قیمت): today's prices in big cards, live prices from the internet, manual
// entry (mazaneh ↔ gram18 linked), a counter calculator and the price history.
import { useMemo, useState } from "react";
import { Button, Drawer, Form, Input, Select, Segmented, Tooltip, Popconfirm, Alert } from "antd";
import { CloudDownloadOutlined, PlusOutlined, SettingOutlined, DeleteOutlined, CalculatorOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { NumberInput, MoneyInput, PctInput, WeightInput } from "../../components/inputs";
import { JDateTime, Money } from "../../components/display";
import { D } from "@shared/money";
import { formatNumber, faDigits } from "@shared/format";
import { gram18FromMazaneh, mazanehFromGram18, priceJewelry, priceOldGold, priceBullion, weightForBudget, type WageType } from "@shared/gold";
import { RateChange, RateStamp, SplitButton, stepOf, useGoldSettings, useLatestRate, wageTypeOptions, coinTitle, type Rate, type GoldSettings } from "./shared";

const COIN_KEYS = ["emami", "bahar", "nim", "rob", "gerami"] as const;
const SOURCES: Record<string, string> = { manual: "دستی", tgju: "tgju", goldapi: "انس جهانی", custom: "منبع دلخواه" };

function BigPrice({ title, value, hint, tone = "gold" }: { title: string; value: string | null | undefined; hint?: React.ReactNode; tone?: "gold" | "brand" | "muted" }) {
  const { unit } = useOrg();
  const color = tone === "gold" ? "text-gold" : tone === "brand" ? "text-brand" : "";
  return (
    <div className="tz-card p-4">
      <div className="text-xs text-muted">{title}</div>
      <div className={`num mt-1 text-2xl font-extrabold ${color}`}>{value ? formatNumber(value) : "—"}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
        <span>{value ? unit : ""}</span>
        {hint}
      </div>
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
        subtitle={<RateStamp rate={r} />}
        actions={
          <>
            {canSetup ? <Button icon={<SettingOutlined />} onClick={() => setSetup(true)}>تنظیمات قیمت</Button> : null}
            {canEdit ? (
              <SplitButton
                icon={<CloudDownloadOutlined />}
                loading={fetchLive.isPending}
                onClick={() => fetchLive.mutate("auto")}
                items={[
                  { key: "tgju", label: "tgju.org — بازار داخلی", onClick: () => fetchLive.mutate("tgju") },
                  { key: "goldapi", label: "انس جهانی × دلار بازار آزاد", onClick: () => fetchLive.mutate("goldapi") },
                  { key: "custom", label: "منبع دلخواه (تنظیمات)", disabled: !settings.data?.price_source, onClick: () => fetchLive.mutate("custom") },
                ]}
              >
                دریافت قیمت زنده
              </SplitButton>
            ) : null}
            {canEdit ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setEntry(true)}>ثبت قیمت</Button> : null}
          </>
        }
      />

      {!r && !latest.isLoading ? (
        <Alert className="!mb-4" type="warning" showIcon title="هنوز قیمتی ثبت نشده است؛ قیمت روز را دستی ثبت کنید یا «دریافت قیمت زنده» را بزنید." />
      ) : null}

      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BigPrice title="هر گرم طلای ۱۸ عیار" value={r?.gram18} hint={<RateChange change={latest.data?.change} pct={latest.data?.change_pct} />} />
        <BigPrice title="مظنه (مثقال ۱۷ عیار)" value={r?.mazaneh} tone="brand" />
        <BigPrice title="هر گرم طلای ۲۴ عیار" value={r?.gram24} tone="muted" />
        <BigPrice title="قیمت خرید طلای مستعمل (گرم ۱۸)" value={r?.buy_gram18} tone="muted" />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-7">
        {COIN_KEYS.map((k) => (
          <div key={k} className="tz-soft px-3 py-2">
            <div className="text-[11px] text-muted">سکه {coinTitle(k)}</div>
            <div className="num text-base font-bold">{r?.coins?.[k] ? formatNumber(r.coins[k]) : "—"}</div>
          </div>
        ))}
        <div className="tz-soft px-3 py-2">
          <div className="text-[11px] text-muted">انس جهانی (دلار)</div>
          <div className="num text-base font-bold ltr">{r?.ounce_usd ? formatNumber(r.ounce_usd, { dp: 2 }) : "—"}</div>
        </div>
        <div className="tz-soft px-3 py-2">
          <div className="text-[11px] text-muted">دلار بازار آزاد</div>
          <div className="num text-base font-bold">{r?.usd ? formatNumber(r.usd) : "—"}</div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 xl:grid-cols-[1fr_380px]">
        <Section title="تاریخچه‌ی قیمت‌ها" bodyClass="p-3">
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
              { key: "at", dataIndex: "at", title: "زمان", render: (v) => <JDateTime v={v} /> },
              { key: "gram18", dataIndex: "gram18", title: "گرم ۱۸", align: "left", render: (v) => <Money v={v} /> },
              { key: "mazaneh", dataIndex: "mazaneh", title: "مظنه", align: "left", render: (v) => <Money v={v} /> },
              { key: "emami", title: "امامی", align: "left", render: (_, x) => <Money v={x.coins?.emami ?? 0} zero="—" /> },
              { key: "rob", title: "ربع", align: "left", render: (_, x) => <Money v={x.coins?.rob ?? 0} zero="—" /> },
              { key: "ounce", dataIndex: "ounce_usd", title: "انس", align: "left", render: (v) => (v ? <span className="num ltr">{formatNumber(v, { dp: 2 })}</span> : "—") },
              { key: "src", dataIndex: "source", title: "منبع", render: (v) => SOURCES[v] ?? v },
              ...(can("gold", "full")
                ? [{
                    key: "del", width: 40, render: (_: unknown, x: Rate) => (
                      <Popconfirm title="این قیمت حذف شود؟" okText="بله" cancelText="خیر" onConfirm={() => del.mutate(x.id)}>
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="حذف" />
                      </Popconfirm>
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
          <div className="mb-1 text-xs text-muted">مظنه (مثقال ۱۷ عیار)</div>
          <MoneyInput size="large" value={v.mazaneh} onChange={(x) => setV((o) => ({ ...o, mazaneh: x, gram18: x ? gram18FromMazaneh(x) : o.gram18 }))} />
        </div>
        <div>
          <div className="mb-1 text-xs text-muted">هر گرم ۱۸ عیار (= مظنه ÷ ۴٫۳۳۱۸)</div>
          <MoneyInput size="large" value={v.gram18} onChange={(x) => setV((o) => ({ ...o, gram18: x, mazaneh: x ? mazanehFromGram18(x) : o.mazaneh }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 text-xs text-muted">قیمت خرید مستعمل (گرم ۱۸)</div>
            <MoneyInput value={v.buy_gram18} onChange={(x) => set("buy_gram18", x)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">گرم ۲۴ (خالی = خودکار)</div>
            <MoneyInput value={v.gram24} onChange={(x) => set("gram24", x)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">انس جهانی (دلار)</div>
            <NumberInput decimals={2} value={v.ounce_usd} onChange={(x) => set("ounce_usd", x)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">دلار بازار آزاد</div>
            <MoneyInput value={v.usd} onChange={(x) => set("usd", x)} />
          </div>
        </div>
        <div className="border-t border-line pt-2 text-xs font-bold text-muted">سکه‌ها</div>
        <div className="grid grid-cols-2 gap-3">
          {COIN_KEYS.map((k) => (
            <div key={k}>
              <div className="mb-1 text-xs text-muted">سکه {coinTitle(k)}</div>
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
  const R = ({ k, v, strong }: { k: string; v?: string; strong?: boolean }) => (
    <div className={`flex justify-between py-0.5 ${strong ? "text-base font-extrabold text-gold" : "text-sm"}`}>
      <span className={strong ? "" : "text-muted"}>{k}</span>
      <span className="num">{v ? `${formatNumber(v, { dp: moneyDecimals })} ${strong ? unit : ""}` : "—"}</span>
    </div>
  );
  const res = result as Record<string, string> | null;
  return (
    <Section title={<span><CalculatorOutlined /> ماشین‌حساب طلا</span>}>
      <Segmented block size="small" value={mode} onChange={(v) => setMode(v as typeof mode)} options={[{ value: "piece", label: "جنس" }, { value: "old", label: "مستعمل" }, { value: "bullion", label: "آبشده" }, { value: "budget", label: "با این مبلغ" }]} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        {mode === "budget" ? (
          <div className="col-span-2"><div className="mb-1 text-xs text-muted">مبلغ</div><MoneyInput value={f.budget} onChange={(x) => set("budget", x)} words={unit} /></div>
        ) : (
          <div><div className="mb-1 text-xs text-muted">وزن</div><WeightInput value={f.weight} onChange={(x) => set("weight", x)} /></div>
        )}
        <div><div className="mb-1 text-xs text-muted">{mode === "bullion" ? "عیار ری‌گیری" : "عیار"}</div><NumberInput decimals={1} value={f.fineness} onChange={(x) => set("fineness", x)} /></div>
        {mode === "bullion" ? (
          <div className="col-span-2"><div className="mb-1 text-xs text-muted">مظنه</div><MoneyInput value={f.mazaneh ?? mazaneh} onChange={(x) => set("mazaneh", x)} /></div>
        ) : (
          <div className="col-span-2"><div className="mb-1 text-xs text-muted">گرم ۱۸ عیار</div><MoneyInput value={f.gram18 ?? gram18} onChange={(x) => set("gram18", x)} /></div>
        )}
        {mode === "piece" || mode === "budget" ? (
          <>
            <div><div className="mb-1 text-xs text-muted">نوع اجرت</div><Select className="w-full" value={f.wage_type} onChange={(x) => set("wage_type", x)} options={wageTypeOptions} /></div>
            <div><div className="mb-1 text-xs text-muted">اجرت</div><NumberInput decimals={3} value={f.wage_value} onChange={(x) => set("wage_value", x)} /></div>
            <div><div className="mb-1 text-xs text-muted">سود ٪</div><PctInput value={f.profit_pct ?? settings?.profit_pct} onChange={(x) => set("profit_pct", x)} /></div>
            {mode === "piece" ? <div><div className="mb-1 text-xs text-muted">تخفیف</div><MoneyInput value={f.discount} onChange={(x) => set("discount", x)} /></div> : null}
          </>
        ) : null}
        {mode === "old" ? <div className="col-span-2"><div className="mb-1 text-xs text-muted">کسر ٪</div><PctInput value={f.deduction ?? settings?.old_deduction_pct} onChange={(x) => set("deduction", x)} /></div> : null}
      </div>
      <div className="mt-3 rounded-lg bg-gold-soft p-3">
        {mode === "piece" && res ? (
          <>
            <R k="ارزش طلا" v={res.goldValue} />
            <R k="اجرت" v={res.wage} />
            <R k="سود" v={res.profit} />
            <R k={`مالیات (${faDigits(tax)}٪ اجرت و سود)`} v={res.tax} />
            <R k="قیمت نهایی" v={res.total} strong />
          </>
        ) : null}
        {mode === "old" && res ? (
          <>
            <div className="flex justify-between py-0.5 text-sm">
              <span className="text-muted">معادل ۷۵۰</span>
              <span className="num">{formatNumber(res.weight750 ?? 0, { dp: 3 })} گرم</span>
            </div>
            <R k="ارزش" v={res.gross} />
            <R k="کسر" v={res.deduction} />
            <R k="قابل پرداخت" v={res.total} strong />
          </>
        ) : null}
        {mode === "bullion" && res ? <R k="ارزش آبشده" v={res.total} strong /> : null}
        {mode === "budget" && res ? (
          <div className="flex justify-between text-base font-extrabold text-gold">
            <span>وزن قابل خرید</span>
            <span className="num">{D(res.weight ?? 0).gt(0) ? `${formatNumber(res.weight, { dp: 3 })} گرم` : "—"}</span>
          </div>
        ) : null}
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
        <div className="mb-2 text-xs font-bold text-muted">محاسبه‌ی قیمت</div>
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item name="profit_pct" label="سود فروشنده‌ی پیش‌فرض"><PctInput /></Form.Item>
          <Form.Item name="tax_pct" label="مالیات بر اجرت و سود" extra="۱۴۰۵: ۱۰٪"><PctInput /></Form.Item>
          <Form.Item name="round_step" label="گرد کردن مبالغ به"><NumberInput /></Form.Item>
          <Form.Item name="old_deduction_pct" label="کسر پیش‌فرض طلای مستعمل"><PctInput /></Form.Item>
          <Form.Item name="purchase_tax_pct" label="مالیات خرید بر اجرت همکار" extra="معمولاً صفر"><PctInput /></Form.Item>
        </div>
        <div className="mb-2 mt-2 border-t border-line pt-3 text-xs font-bold text-muted">قیمت زنده</div>
        <Form.Item name="provider" label="منبع پیش‌فرض">
          <Select options={[{ value: "auto", label: "خودکار (دلخواه ← tgju ← انس جهانی)" }, { value: "tgju", label: "tgju.org" }, { value: "goldapi", label: "انس جهانی × دلار" }, { value: "custom", label: "منبع دلخواه" }]} />
        </Form.Item>
        <Form.Item name="usd" label="دلار بازار آزاد برای محاسبه از انس" extra="اگر نرخ دلار در ماژول صرافی ثبت شده باشد همان استفاده می‌شود"><MoneyInput /></Form.Item>
        <div className="tz-soft p-3">
          <div className="mb-2 text-xs font-bold">منبع دلخواه (JSON)</div>
          <Form.Item name={["price_source", "url"]} label="نشانی (https)"><Input dir="ltr" placeholder="https://example.com/prices.json" /></Form.Item>
          <Form.Item name={["price_source", "unit"]} label="واحد قیمت‌ها"><Select options={[{ value: "rial", label: "ریال" }, { value: "toman", label: "تومان" }]} /></Form.Item>
          <div className="mb-1 text-[11px] text-muted">مسیر هر قیمت در پاسخ، مثل <span className="ltr">data.gold.g18</span> یا <span className="ltr">items[0].price</span></div>
          <div className="grid grid-cols-2 gap-x-3">
            {PATHS.map(([k, label]) => (
              <Form.Item key={k} name={["price_source", "paths", k]} label={label} className="!mb-2"><Input dir="ltr" size="small" /></Form.Item>
            ))}
          </div>
        </div>
        <Tooltip title="سایت‌های ایرانی ممکن است از خارج از ایران در دسترس نباشند و برعکس">
          <div className="mt-2 text-[11px] text-muted">اگر یک منبع در دسترس نبود، در حالت خودکار منبع بعدی امتحان می‌شود.</div>
        </Tooltip>
      </Form>
    </Drawer>
  );
}

// Editing a coin or a bar model of the catalogue: name, code, board key, weight and fineness and
// the metadata (family, variant, pricing mode, wage, VAT mode, buy spread; for bars brand, type,
// premium and buy-back fees). Validated again on the server (src/shared/gold-meta.ts).
import { useState, type ReactNode } from "react";
import { Button, Drawer, Input, Select, Switch } from "antd";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { NumberInput, PctInput, WeightInput, MoneyInput } from "../../components/inputs";
import {
  BAR_TYPE_TITLES, DESIGN_TITLES, FAMILY_TITLES, PACKAGING_TITLES, PREMIUM_TYPE_TITLES, PRICING_MODE_TITLES, VAT_MODE_TITLES, dateBandTitle, metaDefaults,
  type GoldMeta, type ProductKind,
} from "@shared/gold-catalogue";
import { wageTypeOptions, type CatalogueRow } from "./shared";

const opts = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));
const BANDS = ["86", "pre86", "1403", "1404", "1405"].map((value) => ({ value, label: dateBandTitle(value)! }));

function Field({ label, children, span = 1 }: { label: string; children: ReactNode; span?: 1 | 2 }) {
  return (
    <label className={span === 2 ? "sm:col-span-2" : ""}>
      <div className="sf-field-l mb-1.5">{label}</div>
      {children}
    </label>
  );
}

export function ProductForm({ kind, product, open, onClose }: { kind: ProductKind; product: CatalogueRow | null; open: boolean; onClose: () => void }) {
  const { api } = useOrg();
  const [v, setV] = useState(() => ({
    name: product?.name ?? "",
    code: product?.code ?? "",
    rate_key: product?.rate_key ?? "",
    gold_weight: product?.gold_weight ?? null,
    fineness: product?.fineness ?? (kind === "bar" ? "995" : "900"),
    barcode: product?.barcode ?? "",
    is_active: product?.is_active ?? true,
  }));
  const [m, setM] = useState<GoldMeta>(() => product?.gold_meta ?? metaDefaults(kind, kind === "bar" ? "bar" : "bank"));
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const meta = (patch: Partial<GoldMeta>) => setM((x) => ({ ...x, ...patch }));
  const save = useAction(
    () => {
      const body = { kind, ...v, rate_key: v.rate_key || null, code: v.code || null, barcode: v.barcode || null, gold_meta: m };
      return product ? api.put(`/gold/catalogue/${product.id}`, body) : api.post("/gold/catalogue", body);
    },
    { success: "ذخیره شد", invalidate: [["gold-catalogue"], ["gold-coins"], ["table"]], onSuccess: onClose },
  );
  const weightMode = m.pricing_mode === "weight";
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={640}
      destroyOnHidden
      title={product ? `ویرایش «${product.name}»` : kind === "bar" ? "مدل شمش جدید" : "سکه‌ی جدید"}
      footer={<Button type="primary" block loading={save.isPending} onClick={() => save.mutate(undefined)}>ذخیره</Button>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="نام" span={2}><Input value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="کد"><Input className="ltr" dir="ltr" value={v.code} placeholder="خودکار" onChange={(e) => set({ code: e.target.value })} /></Field>
        <Field label="کلید تابلوی قیمت"><Input className="ltr" dir="ltr" value={v.rate_key} placeholder="emami_1405" onChange={(e) => set({ rate_key: e.target.value })} /></Field>
        <Field label={kind === "bar" ? "وزن اسمی (گرم)" : "وزن هر سکه (گرم)"}><WeightInput value={v.gold_weight} onChange={(x) => set({ gold_weight: x })} /></Field>
        <Field label="عیار (در هزار)"><NumberInput decimals={1} value={v.fineness} onChange={(x) => set({ fineness: x ?? "" })} /></Field>
        {kind === "coin" ? (
          <>
            <Field label="خانواده"><Select className="w-full" value={m.family} onChange={(family) => setM({ ...metaDefaults("coin", family), ...m, family })} options={opts(FAMILY_TITLES).filter((o) => o.value !== "bar")} /></Field>
            <Field label="روش قیمت‌گذاری"><Select className="w-full" value={m.pricing_mode} onChange={(pricing_mode) => meta({ pricing_mode })} options={opts(PRICING_MODE_TITLES)} /></Field>
            <Field label="طرح"><Select allowClear className="w-full" value={m.design ?? undefined} onChange={(design) => meta({ design: design ?? null })} options={opts(DESIGN_TITLES)} /></Field>
            <Field label="دوره‌ی ضرب"><Select allowClear className="w-full" value={m.date_band ?? undefined} onChange={(date_band) => meta({ date_band: date_band ?? null })} options={BANDS} /></Field>
            <Field label="بسته‌بندی"><Select allowClear className="w-full" value={m.packaging ?? undefined} onChange={(packaging) => meta({ packaging: packaging ?? null })} options={opts(PACKAGING_TITLES)} /></Field>
            <Field label="مالیات بر ارزش افزوده"><Select className="w-full" value={m.vat_mode} onChange={(vat_mode) => meta({ vat_mode })} options={opts(VAT_MODE_TITLES)} /></Field>
            {weightMode ? (
              <>
                <Field label="نوع اجرت"><Select className="w-full" value={m.wage_type ?? "percent"} onChange={(wage_type) => meta({ wage_type })} options={wageTypeOptions} /></Field>
                <Field label="اجرت"><NumberInput decimals={3} value={m.wage_value ?? null} onChange={(wage_value) => meta({ wage_value })} /></Field>
                <Field label="سود فروشنده (٪)"><PctInput value={m.profit_pct ?? null} onChange={(profit_pct) => meta({ profit_pct })} /></Field>
              </>
            ) : (
              <Field label="اختلاف قیمت خرید از فروش (٪)"><PctInput value={m.buy_spread_pct ?? null} onChange={(buy_spread_pct) => meta({ buy_spread_pct })} /></Field>
            )}
            <Field label="کلید منبع tgju"><Input className="ltr" dir="ltr" value={m.tgju ?? ""} onChange={(e) => meta({ tgju: e.target.value || null })} /></Field>
          </>
        ) : (
          <>
            <Field label="برند / پالایشگاه"><Input value={m.brand ?? ""} onChange={(e) => meta({ brand: e.target.value || null })} /></Field>
            <Field label="نوع شمش"><Select className="w-full" value={m.bar_type ?? "minted"} onChange={(bar_type) => meta({ bar_type })} options={opts(BAR_TYPE_TITLES)} /></Field>
            <Field label="نوع حق ضرب"><Select allowClear placeholder="پلکان پیش‌فرض" className="w-full" value={m.premium_type ?? undefined} onChange={(premium_type) => meta({ premium_type: premium_type ?? null })} options={opts(PREMIUM_TYPE_TITLES)} /></Field>
            <Field label="حق ضرب">
              {m.premium_type === "pct" || !m.premium_type ? <PctInput value={m.premium_value ?? null} onChange={(premium_value) => meta({ premium_value })} /> : <MoneyInput value={m.premium_value ?? null} onChange={(premium_value) => meta({ premium_value })} />}
            </Field>
            <Field label="کارمزد خرید شمش پلمپ (٪)"><PctInput value={m.fee_sealed_pct ?? null} onChange={(fee_sealed_pct) => meta({ fee_sealed_pct })} /></Field>
            <Field label="کارمزد خرید شمش باز (٪)"><PctInput value={m.fee_opened_pct ?? null} onChange={(fee_opened_pct) => meta({ fee_opened_pct })} /></Field>
            <Field label="هزینه‌ی ری‌گیری شمش باز"><MoneyInput value={m.assay_fee ?? null} onChange={(assay_fee) => meta({ assay_fee })} /></Field>
            <Field label="مالیات بر ارزش افزوده"><Select className="w-full" value={m.vat_mode} onChange={(vat_mode) => meta({ vat_mode })} options={opts(VAT_MODE_TITLES)} /></Field>
          </>
        )}
        <Field label="بارکد"><Input className="ltr" dir="ltr" value={v.barcode} onChange={(e) => set({ barcode: e.target.value })} /></Field>
        <label className="flex items-center gap-2 self-end pb-1.5 text-[13px] text-ink-2"><Switch size="small" checked={v.is_active} onChange={(is_active) => set({ is_active })} /> فعال</label>
      </div>
    </Drawer>
  );
}

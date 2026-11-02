// Business settings (اطلاعات و تنظیمات کسب‌وکار): identity and contact, tax and calculation defaults per module, and
// the modules themselves. Each tab is one card of titled sections with a sticky save bar.
import { useState, type ReactNode } from "react";
import { Button, Form, Input, Select, Switch, Tabs, Checkbox } from "antd";
import { Package, Gem, ArrowLeftRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ImageInput } from "../../components/data";
import { PctInput, NumberInput } from "../../components/inputs";
import { MODULES, type ModuleKey } from "@shared/constants";
import { Note, cx } from "../reports/kit";

const MOD_ICON: Record<string, typeof Package> = { goods: Package, gold: Gem, fx: ArrowLeftRight };

function Sec({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="bk-set">
      <div>
        <div className="bk-set-t">{title}</div>
        {desc ? <div className="bk-set-d">{desc}</div> : null}
      </div>
      <div className="bk-set-b">{children}</div>
    </div>
  );
}

function SaveBar({ loading, disabled, note }: { loading: boolean; disabled?: boolean; note?: ReactNode }) {
  return (
    <div className="bk-savebar">
      {note ? <span className="bk-savebar-m">{note}</span> : null}
      <Button type="primary" htmlType="submit" loading={loading} disabled={disabled}>
        ذخیره
      </Button>
    </div>
  );
}

export default function OrgSettings() {
  const { org, api, orgId, can, has } = useOrg();
  const qc = useQueryClient();
  const [tab, setTab] = useState("profile");
  const save = useAction((v: any) => api.patch("", v), {
    success: "تنظیمات ذخیره شد.",
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org", orgId] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const s = org.settings ?? {};
  const editable = can("settings", "edit");
  const ltr = { dir: "ltr" as const, className: "sf-num", style: { textAlign: "right" as const } };

  return (
    <div>
      <PageHeader title="کسب‌وکار" subtitle={org.name} />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "profile", label: "مشخصات" },
          { key: "settings", label: "مالیات و محاسبات" },
          { key: "modules", label: "بخش‌ها" },
        ]}
      />
      {tab === "profile" ? (
        <Form layout="vertical" requiredMark={false} disabled={!editable} initialValues={org} onFinish={(v) => save.mutate(v)} className="bk-card">
          <div className="px-5">
            <Sec title="نام و شناسه‌ها" desc="روی فاکتورها، رسیدها و گزارش‌های چاپی می‌آید.">
              <div className="bk-grid3">
                <Form.Item name="name" label="نام تجاری" rules={[{ required: true, message: "نام تجاری را بنویسید." }]}><Input /></Form.Item>
                <Form.Item name="legal_name" label="نام ثبتی (اختیاری)"><Input /></Form.Item>
                <Form.Item name="registration_no" label="شمارهٔ ثبت (اختیاری)"><Input {...ltr} /></Form.Item>
                <Form.Item name="economic_code" label="کد اقتصادی (اختیاری)"><Input {...ltr} /></Form.Item>
                <Form.Item name="national_id" label="شناسهٔ ملی (اختیاری)"><Input {...ltr} /></Form.Item>
              </div>
            </Sec>
            <Sec title="تماس و نشانی">
              <div className="bk-grid3">
                <Form.Item name="phone" label="تلفن"><Input {...ltr} inputMode="tel" /></Form.Item>
                <Form.Item name="mobile" label="همراه"><Input {...ltr} inputMode="tel" /></Form.Item>
                <Form.Item name="email" label="ایمیل"><Input dir="ltr" className="sf-latin" /></Form.Item>
                <Form.Item name="website" label="وب‌سایت"><Input dir="ltr" className="sf-latin" /></Form.Item>
                <Form.Item name="province" label="استان"><Input /></Form.Item>
                <Form.Item name="city" label="شهر"><Input /></Form.Item>
                <Form.Item name="postal_code" label="کد پستی"><Input {...ltr} /></Form.Item>
                <Form.Item name="address" label="نشانی" className="is-wide"><Input.TextArea autoSize={{ minRows: 2 }} /></Form.Item>
              </div>
            </Sec>
            <Sec title="لوگو" desc="روی فاکتورها و چاپ‌ها، کنار نام کسب‌وکار.">
              <Form.Item name="logo"><ImageInput /></Form.Item>
            </Sec>
          </div>
          {editable ? <SaveBar loading={save.isPending} /> : null}
        </Form>
      ) : tab === "settings" ? (
        <Form
          layout="vertical"
          requiredMark={false}
          disabled={!editable}
          initialValues={{ ...s, gold: s.gold ?? {}, fx: s.fx ?? {}, moadian: s.moadian ?? {} }}
          onFinish={(v) => save.mutate({ settings: { ...v, gold: { ...(s.gold ?? {}), ...(v.gold ?? {}) }, fx: { ...(s.fx ?? {}), ...(v.fx ?? {}) } } })}
          className="bk-card"
        >
          <div className="px-5">
            <Sec title="مالیات و انبار">
              <div className="bk-grid3">
                <Form.Item name="vat_pct" label="مالیات بر ارزش افزوده" extra="نرخ ۱۴۰۵: ۱۰٪"><PctInput /></Form.Item>
                <Form.Item name="timezone" label="منطقهٔ زمانی">
                  <Select options={[{ value: "Asia/Tehran", label: "تهران" }, { value: "Asia/Kabul", label: "کابل" }, { value: "Asia/Dubai", label: "دبی" }, { value: "Europe/Istanbul", label: "استانبول" }]} />
                </Form.Item>
                <Form.Item name="costing" label="بهای تمام‌شدهٔ کالا"><Select options={[{ value: "average", label: "میانگین موزون متحرک" }]} /></Form.Item>
                <Form.Item name="allow_negative_stock" label="فروش بیش از موجودی" valuePropName="checked"><Switch /></Form.Item>
              </div>
            </Sec>
            <Sec title="سامانهٔ مؤدیان" desc="برای صورتحساب الکترونیکی؛ شناسه از کارپوشهٔ سامانه.">
              <div className="bk-grid3">
                <Form.Item name={["moadian", "memory_id"]} label="شناسهٔ یکتای حافظهٔ مالیاتی" extra="شش نویسه" rules={[{ pattern: /^[A-Za-z0-9]{6}$/, message: "شناسهٔ حافظه شش نویسهٔ لاتین یا رقم است." }]}>
                  <Input dir="ltr" maxLength={6} className="sf-code" />
                </Form.Item>
                <Form.Item name={["moadian", "branch_code"]} label="کد شعبه (اختیاری)"><Input dir="ltr" maxLength={10} className="sf-code" /></Form.Item>
              </div>
            </Sec>
            {has("gold") ? (
              <Sec title="طلا و جواهر" desc="پیش‌فرض‌های فاکتور فروش و خرید طلا.">
                <div className="bk-grid4">
                  <Form.Item name={["gold", "profit_pct"]} label="سود فروشنده"><PctInput /></Form.Item>
                  <Form.Item name={["gold", "tax_pct"]} label="مالیات اجرت و سود" extra="۱۴۰۵: ۱۰٪"><PctInput /></Form.Item>
                  <Form.Item name={["gold", "round_step"]} label="گرد کردن مبالغ به"><NumberInput /></Form.Item>
                  <Form.Item name={["gold", "old_deduction_pct"]} label="کسر خرید طلای مستعمل"><PctInput /></Form.Item>
                </div>
              </Sec>
            ) : null}
            {has("fx") ? (
              <Sec title="صرافی" desc="حاشیهٔ خرید و فروش و به‌روزرسانی قیمت زنده.">
                <div className="bk-grid3">
                  <Form.Item name={["fx", "margin_pct"]} label="حاشیه روی نرخ بازار"><PctInput /></Form.Item>
                  <Form.Item name={["fx", "refresh_seconds"]} label="به‌روزرسانی قیمت زنده" extra="بر حسب ثانیه"><NumberInput suffix="ثانیه" /></Form.Item>
                </div>
              </Sec>
            ) : null}
          </div>
          {editable ? <SaveBar loading={save.isPending} /> : null}
        </Form>
      ) : (
        <Form layout="vertical" disabled={!can("settings", "full")} initialValues={{ modules: org.modules }} onFinish={(v) => save.mutate(v)} className="bk-card">
          <div className="px-5 pt-5">
            <Note className="mb-4">روشن کردن یک بخش حساب‌ها و تنظیمات پیش‌فرض آن را می‌افزاید؛ خاموش کردن فقط منوها را پنهان می‌کند و داده‌ای حذف نمی‌شود.</Note>
            <Form.Item name="modules" noStyle>
              <ModulePicker disabled={!can("settings", "full")} />
            </Form.Item>
            <div className="h-5" />
          </div>
          {can("settings", "full") ? <SaveBar loading={save.isPending} /> : null}
        </Form>
      )}
    </div>
  );
}

function ModulePicker({ value = [], onChange, disabled }: { value?: ModuleKey[]; onChange?: (v: ModuleKey[]) => void; disabled?: boolean }) {
  return (
    <Checkbox.Group value={value} onChange={(v) => onChange?.(v as ModuleKey[])} disabled={disabled} className="bk-mods w-full">
      {MODULES.map((m) => {
        const Icon = MOD_ICON[m.key] ?? Package;
        const on = value.includes(m.key);
        return (
          <label key={m.key} className={cx("bk-mod", on && "is-on")}>
            <span className="bk-mod-ic" aria-hidden>
              <Icon size={18} strokeWidth={1.4} absoluteStrokeWidth />
            </span>
            <span className="min-w-0">
              <span className="bk-mod-t block">{m.title}</span>
              <span className="bk-mod-d block">{m.description}</span>
            </span>
            <Checkbox value={m.key} />
          </label>
        );
      })}
    </Checkbox.Group>
  );
}

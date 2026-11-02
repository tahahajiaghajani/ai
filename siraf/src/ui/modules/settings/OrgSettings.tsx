import { Button, Form, Input, Select, Switch, Tabs, Alert, Checkbox } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { ImageInput } from "../../components/data";
import { PctInput, NumberInput } from "../../components/inputs";
import { MODULES } from "@shared/constants";

export default function OrgSettings() {
  const { org, api, orgId, can } = useOrg();
  const qc = useQueryClient();
  const save = useAction((v: any) => api.patch("", v), { success: "ذخیره شد", onSuccess: () => { qc.invalidateQueries({ queryKey: ["org", orgId] }); qc.invalidateQueries({ queryKey: ["me"] }); } });
  const s = org.settings ?? {};
  const editable = can("settings", "edit");
  return (
    <div>
      <PageHeader title="اطلاعات و تنظیمات کسب‌وکار" />
      <Tabs
        items={[
          {
            key: "profile",
            label: "مشخصات",
            children: (
              <Section>
                <Form layout="vertical" disabled={!editable} initialValues={org} onFinish={(v) => save.mutate(v)}>
                  <div className="grid gap-x-4 md:grid-cols-3">
                    <Form.Item name="name" label="نام تجاری" rules={[{ required: true }]}><Input /></Form.Item>
                    <Form.Item name="legal_name" label="نام ثبتی"><Input /></Form.Item>
                    <Form.Item name="registration_no" label="شماره‌ی ثبت"><Input dir="ltr" /></Form.Item>
                    <Form.Item name="economic_code" label="کد اقتصادی"><Input dir="ltr" /></Form.Item>
                    <Form.Item name="national_id" label="شناسه‌ی ملی"><Input dir="ltr" /></Form.Item>
                    <Form.Item name="phone" label="تلفن"><Input dir="ltr" /></Form.Item>
                    <Form.Item name="mobile" label="موبایل"><Input dir="ltr" /></Form.Item>
                    <Form.Item name="email" label="ایمیل"><Input dir="ltr" /></Form.Item>
                    <Form.Item name="website" label="وب‌سایت"><Input dir="ltr" /></Form.Item>
                    <Form.Item name="province" label="استان"><Input /></Form.Item>
                    <Form.Item name="city" label="شهر"><Input /></Form.Item>
                    <Form.Item name="postal_code" label="کد پستی"><Input dir="ltr" /></Form.Item>
                    <Form.Item name="address" label="نشانی" className="md:col-span-3"><Input.TextArea autoSize={{ minRows: 2 }} /></Form.Item>
                    <Form.Item name="logo" label="لوگو (روی فاکتورها و چاپ‌ها)" className="md:col-span-3"><ImageInput /></Form.Item>
                  </div>
                  <Button type="primary" htmlType="submit" loading={save.isPending}>ذخیره</Button>
                </Form>
              </Section>
            ),
          },
          {
            key: "settings",
            label: "مالیات، انبار و محاسبات",
            children: (
              <Section>
                <Form
                  layout="vertical"
                  disabled={!editable}
                  initialValues={{ ...s, gold: s.gold ?? {}, fx: s.fx ?? {}, moadian: s.moadian ?? {} }}
                  onFinish={(v) => save.mutate({ settings: { ...v, gold: { ...(s.gold ?? {}), ...(v.gold ?? {}) }, fx: { ...(s.fx ?? {}), ...(v.fx ?? {}) } } })}
                >
                  <div className="grid gap-x-4 md:grid-cols-3">
                    <Form.Item name="vat_pct" label="نرخ پیش‌فرض مالیات بر ارزش افزوده" extra="۱۴۰۵: ۱۰٪"><PctInput /></Form.Item>
                    <Form.Item name="timezone" label="منطقه‌ی زمانی"><Select options={[{ value: "Asia/Tehran", label: "تهران" }, { value: "Asia/Kabul", label: "کابل" }, { value: "Asia/Dubai", label: "دبی" }, { value: "Europe/Istanbul", label: "استانبول" }]} /></Form.Item>
                    <Form.Item name="costing" label="روش بهای تمام‌شده‌ی کالا"><Select options={[{ value: "average", label: "میانگین موزون متحرک" }]} /></Form.Item>
                    <Form.Item name="allow_negative_stock" label="فروش بیش از موجودی مجاز باشد" valuePropName="checked"><Switch /></Form.Item>
                  </div>
                  <div className="mb-3 mt-2 border-b border-line pb-1 text-xs font-bold text-muted">سامانه‌ی مؤدیان (صورتحساب الکترونیکی)</div>
                  <div className="grid gap-x-4 md:grid-cols-3">
                    <Form.Item name={["moadian", "memory_id"]} label="شناسه‌ی یکتای حافظه‌ی مالیاتی" extra="شش نویسه؛ از کارپوشه‌ی سامانه‌ی مؤدیان" rules={[{ pattern: /^[A-Za-z0-9]{6}$/, message: "شناسه‌ی حافظه شش نویسه‌ی لاتین یا رقم است" }]}>
                      <Input dir="ltr" maxLength={6} />
                    </Form.Item>
                    <Form.Item name={["moadian", "branch_code"]} label="کد شعبه (اختیاری)"><Input dir="ltr" maxLength={10} /></Form.Item>
                  </div>
                  <div className="mb-3 mt-2 border-b border-line pb-1 text-xs font-bold text-muted">طلا و جواهر</div>
                  <div className="grid gap-x-4 md:grid-cols-4">
                    <Form.Item name={["gold", "profit_pct"]} label="سود فروشنده‌ی پیش‌فرض"><PctInput /></Form.Item>
                    <Form.Item name={["gold", "tax_pct"]} label="مالیات اجرت و سود" extra="۱۴۰۵: ۱۰٪"><PctInput /></Form.Item>
                    <Form.Item name={["gold", "round_step"]} label="گرد کردن مبالغ به"><NumberInput /></Form.Item>
                    <Form.Item name={["gold", "old_deduction_pct"]} label="کسر پیش‌فرض خرید طلای مستعمل"><PctInput /></Form.Item>
                  </div>
                  <div className="mb-3 mt-2 border-b border-line pb-1 text-xs font-bold text-muted">صرافی</div>
                  <div className="grid gap-x-4 md:grid-cols-3">
                    <Form.Item name={["fx", "margin_pct"]} label="حاشیه‌ی پیش‌فرض خرید/فروش روی نرخ بازار"><PctInput /></Form.Item>
                    <Form.Item name={["fx", "refresh_seconds"]} label="بازه‌ی به‌روزرسانی قیمت زنده (ثانیه)"><NumberInput /></Form.Item>
                  </div>
                  <Button type="primary" htmlType="submit" loading={save.isPending}>ذخیره</Button>
                </Form>
              </Section>
            ),
          },
          {
            key: "modules",
            label: "ماژول‌ها",
            children: (
              <Section>
                <Alert className="!mb-4" type="info" showIcon title="روشن کردن یک ماژول حساب‌ها و تنظیمات پیش‌فرض آن را اضافه می‌کند؛ خاموش کردن فقط منوها را پنهان می‌کند و داده‌ای حذف نمی‌شود." />
                <Form layout="vertical" disabled={!can("settings", "full")} initialValues={{ modules: org.modules }} onFinish={(v) => save.mutate(v)}>
                  <Form.Item name="modules">
                    <Checkbox.Group className="!grid gap-3">
                      {MODULES.map((m) => (
                        <Checkbox key={m.key} value={m.key} className="tz-soft !m-0 !p-3">
                          <b>{m.title}</b> <span className="text-xs text-muted">— {m.description}</span>
                        </Checkbox>
                      ))}
                    </Checkbox.Group>
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={save.isPending}>ذخیره</Button>
                </Form>
              </Section>
            ),
          },
        ]}
      />
    </div>
  );
}

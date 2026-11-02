// New business: kind → modules → identity, currency and fiscal year.
import { useState } from "react";
import { Button, Form, Input, Select, Steps, Checkbox, Alert } from "antd";
import { ShopOutlined, GoldOutlined, DollarOutlined, ToolOutlined, CustomerServiceOutlined, AppstoreOutlined, CheckOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "../../lib/api";
import { Logo } from "../../components/layout";
import { BUSINESS_KINDS, MODULES, BASE_CURRENCIES, type BusinessKind, type ModuleKey } from "@shared/constants";
import { currentJalaliYear } from "@shared/jalali";
import { faDigits } from "@shared/format";

const ICONS: Record<BusinessKind, React.ReactNode> = {
  trading: <ShopOutlined />,
  gold: <GoldOutlined />,
  exchange: <DollarOutlined />,
  manufacturing: <ToolOutlined />,
  services: <CustomerServiceOutlined />,
  mixed: <AppstoreOutlined />,
};
const DESC: Record<BusinessKind, string> = {
  trading: "فروشگاه، پخش، بازرگانی و عمده‌فروشی",
  gold: "طلافروشی، جواهری، بنکداری و کارگاه",
  exchange: "صرافی ارز نقدی، حواله و ارز دیجیتال",
  manufacturing: "تولید و مونتاژ با انبار مواد و کالا",
  services: "شرکت‌های خدماتی و مشاوره",
  mixed: "همه‌ی ماژول‌ها با هم",
};

export default function OrgWizard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<BusinessKind>("trading");
  const [modules, setModules] = useState<ModuleKey[]>(["goods"]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const jy = currentJalaliYear();
  return (
    <div className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <Logo />
        </div>
        <h1 className="m-0 text-2xl font-extrabold">کسب‌وکار تازه</h1>
        <p className="mb-6 mt-2 text-sm text-muted">کدینگ حساب‌ها، سال مالی، صندوق و انبار بر اساس انتخاب شما آماده می‌شود. همه‌چیز بعداً قابل تغییر است.</p>
        <Steps current={step} size="small" className="!mb-8" items={[{ title: "نوع فعالیت" }, { title: "ماژول‌ها" }, { title: "مشخصات" }]} />
        {step === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BUSINESS_KINDS.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => {
                  setKind(b.key);
                  setModules(b.modules);
                  setStep(1);
                }}
                className={`tz-card p-5 text-start transition hover:-translate-y-0.5 ${kind === b.key ? "!border-brand ring-2 ring-brand/20" : ""}`}
              >
                <div className="mb-3 grid h-11 w-11 place-content-center rounded-xl bg-brand-soft text-xl text-brand">{ICONS[b.key]}</div>
                <div className="font-bold">{b.title}</div>
                <div className="mt-1 text-xs text-muted">{DESC[b.key]}</div>
              </button>
            ))}
          </div>
        ) : null}
        {step === 1 ? (
          <div>
            <div className="grid gap-3">
              {MODULES.map((m) => {
                const on = modules.includes(m.key);
                return (
                  <label key={m.key} className={`tz-card flex cursor-pointer items-center gap-4 p-4 ${on ? "!border-brand" : ""}`}>
                    <Checkbox checked={on} onChange={(e) => setModules(e.target.checked ? [...modules, m.key] : modules.filter((x) => x !== m.key))} />
                    <div>
                      <div className="font-bold">{m.title}</div>
                      <div className="text-xs text-muted">{m.description}</div>
                    </div>
                  </label>
                );
              })}
              <div className="tz-soft flex items-center gap-3 p-4 text-sm">
                <CheckOutlined className="text-ok" /> حسابداری، اشخاص، خزانه‌داری، چک و گزارش‌های مالی همیشه فعال‌اند.
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <Button type="primary" size="large" onClick={() => setStep(2)}>
                ادامه
              </Button>
              <Button size="large" onClick={() => setStep(0)}>
                قبلی
              </Button>
            </div>
          </div>
        ) : null}
        {step === 2 ? (
          <Form
            layout="vertical"
            requiredMark="optional"
            initialValues={{ base_currency: "IRR", fiscal_year: jy }}
            onFinish={async (v) => {
              setBusy(true);
              setErr(null);
              try {
                const r = await api.post<{ id: string }>("/orgs", { ...v, business_kind: kind, modules });
                await qc.invalidateQueries({ queryKey: ["me"] });
                nav(`/${r.id}`, { replace: true });
              } catch (e) {
                setErr(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {err ? <Alert type="error" showIcon className="!mb-4" title={err} /> : null}
            <div className="tz-card grid gap-x-4 p-5 sm:grid-cols-2">
              <Form.Item name="name" label="نام کسب‌وکار" rules={[{ required: true, message: "نام را وارد کنید" }]} className="sm:col-span-2">
                <Input size="large" placeholder="مثلاً گالری طلای اعتماد" autoFocus />
              </Form.Item>
              <Form.Item name="legal_name" label="نام ثبتی (اختیاری)">
                <Input />
              </Form.Item>
              <Form.Item name="economic_code" label="کد اقتصادی (اختیاری)">
                <Input dir="ltr" />
              </Form.Item>
              <Form.Item name="base_currency" label="واحد پول پایه‌ی حساب‌ها" extra="مبالغ اسناد با این واحد ذخیره می‌شوند">
                <Select options={BASE_CURRENCIES.map((c) => ({ value: c.code, label: `${c.title} (${c.code})` }))} />
              </Form.Item>
              <Form.Item name="fiscal_year" label="سال مالی">
                <Select options={[jy - 1, jy, jy + 1].map((y) => ({ value: y, label: `سال ${faDigits(y)} (فروردین تا اسفند)` }))} />
              </Form.Item>
              <Form.Item name="phone" label="تلفن">
                <Input dir="ltr" />
              </Form.Item>
              <Form.Item name="city" label="شهر">
                <Input />
              </Form.Item>
              <Form.Item name="address" label="نشانی" className="sm:col-span-2">
                <Input.TextArea autoSize={{ minRows: 2 }} />
              </Form.Item>
            </div>
            <div className="mt-6 flex gap-2">
              <Button type="primary" size="large" htmlType="submit" loading={busy}>
                ساخت کسب‌وکار
              </Button>
              <Button size="large" onClick={() => setStep(1)}>
                قبلی
              </Button>
            </div>
          </Form>
        ) : null}
      </div>
    </div>
  );
}

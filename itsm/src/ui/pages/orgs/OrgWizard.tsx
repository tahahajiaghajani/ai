// New business: kind → modules → identity, currency and fiscal year → ready (components.md §11.2).
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Form, Input, Select } from "antd";
import { Store, Gem, ArrowLeftRight, Factory, BriefcaseBusiness, LayoutGrid, Package, BookOpenText, ArrowRight, ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "../../lib/api";
import { useSession } from "../../lib/session";
import { toPersianDigits } from "../../lib/fa";
import { BrandMark } from "../../components/brand";
import { BUSINESS_KINDS, MODULES, BASE_CURRENCIES, type BusinessKind, type ModuleKey } from "@shared/constants";
import { currentJalaliYear } from "@shared/jalali";
import { AuthLayout } from "../auth/AuthLayout";
import { FormAlert, ICON, useBlurValidation, LTR } from "../kit";

const KIND_ICON: Record<BusinessKind, ReactNode> = {
  trading: <Store {...ICON} />,
  gold: <Gem {...ICON} />,
  exchange: <ArrowLeftRight {...ICON} />,
  manufacturing: <Factory {...ICON} />,
  services: <BriefcaseBusiness {...ICON} />,
  mixed: <LayoutGrid {...ICON} />,
};
const KIND_DESC: Record<BusinessKind, string> = {
  trading: "فروشگاه، پخش، بازرگانی و عمده‌فروشی",
  gold: "طلافروشی، جواهری، بنکداری و کارگاه",
  exchange: "صرافی ارز نقدی، حواله و ارز دیجیتال",
  manufacturing: "تولید و مونتاژ با انبار مواد و کالا",
  services: "شرکت‌های خدماتی، پیمانکاری و مشاوره",
  mixed: "چند فعالیت با هم؛ همهٔ بخش‌ها روشن",
};
const MODULE_ICON: Record<ModuleKey, ReactNode> = {
  goods: <Package {...ICON} />,
  gold: <Gem {...ICON} />,
  fx: <ArrowLeftRight {...ICON} />,
};
const CORE = ["حسابداری و اسناد", "اشخاص", "صندوق و بانک", "چک", "گزارش‌های مالی"];
const STEPS = ["نوع فعالیت", "بخش‌ها", "مشخصات"];

const moduleTitle = (k: ModuleKey) => MODULES.find((m) => m.key === k)?.title ?? k;
const moduleList = (ms: ModuleKey[]) => (ms.length ? ms.map(moduleTitle).join("، ") : "حسابداری و خزانه، بی‌بخش افزوده");
const fy = (y: number) => toPersianDigits(String(y));

function KindCards({ value, onPick }: { value: BusinessKind; onPick: (k: BusinessKind, advance: boolean) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 2, ArrowUp: -2 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const j = (i + d + BUSINESS_KINDS.length) % BUSINESS_KINDS.length;
    onPick(BUSINESS_KINDS[j].key, false);
    refs.current[j]?.focus();
  };
  return (
    <div className="pg-choices" data-cols="2" role="radiogroup" aria-label="نوع فعالیت">
      {BUSINESS_KINDS.map((b, i) => {
        const on = value === b.key;
        return (
          <button
            key={b.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className="pg-choice"
            onClick={() => onPick(b.key, true)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="pg-choice-ic">{KIND_ICON[b.key]}</span>
            <span className="pg-choice-tx">
              <span className="pg-choice-t">{b.title.replace(/\s*\(.*\)$/, "")}</span>
              <span className="pg-choice-d">{KIND_DESC[b.key]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function OrgWizard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me } = useSession();
  const [form] = Form.useForm();
  const onValuesChange = useBlurValidation(form);
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<BusinessKind>("trading");
  const [modules, setModules] = useState<ModuleKey[]>(["goods"]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string; currency: string; year: number } | null>(null);
  const jy = currentJalaliYear();
  const hasOrgs = !!me?.orgs.length;

  const pick = (k: BusinessKind, advance: boolean) => {
    setKind(k);
    setModules(BUSINESS_KINDS.find((b) => b.key === k)?.modules ?? []);
    if (advance) setStep(1);
  };
  const toggle = (k: ModuleKey) => setModules((ms) => (ms.includes(k) ? ms.filter((x) => x !== k) : MODULES.map((m) => m.key).filter((x) => x === k || ms.includes(x))));

  const back =
    hasOrgs && !created && step === 0 ? (
      <Link to="/orgs" className="pg-back">
        <ArrowRight {...ICON} aria-hidden />
        کسب‌وکارها
      </Link>
    ) : null;

  let title: ReactNode;
  let subtitle: ReactNode;
  let body: ReactNode;

  if (created) {
    title = `کسب‌وکار «${created.name}» آماده است.`;
    subtitle = "کدینگ حساب‌ها، سال مالی، صندوق و انبار بر اساس انتخاب شما ساخته شد. همه‌چیز بعداً در «تنظیمات» تغییرپذیر است.";
    const currency = BASE_CURRENCIES.find((c) => c.code === created.currency)?.title ?? created.currency;
    body = (
      <>
        <div className="pg-core !items-center">
          <BrandMark size={48} launch title="" className="me-1" />
          <dl className="m-0 grid flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-[13px] leading-5">
            <dt className="text-ink-3">نوع فعالیت</dt>
            <dd className="m-0 text-ink">{BUSINESS_KINDS.find((b) => b.key === kind)?.title.replace(/\s*\(.*\)$/, "")}</dd>
            <dt className="text-ink-3">بخش‌ها</dt>
            <dd className="m-0 text-ink">{moduleList(modules)}</dd>
            <dt className="text-ink-3">پول و سال مالی</dt>
            <dd className="m-0 text-ink">
              {currency}، سال <span className="ds-num">{fy(created.year)}</span>
            </dd>
          </dl>
        </div>
        <div className="pg-actions !mt-6">
          <Button type="primary" size="large" block autoFocus icon={<ArrowLeft {...ICON} />} iconPlacement="end" onClick={() => nav(`/${created.id}`, { replace: true })}>
            رفتن به پیشخوان
          </Button>
        </div>
      </>
    );
  } else if (step === 0) {
    title = "کسب‌وکار تازه";
    subtitle = "کار اصلی‌تان چیست؟ بخش‌ها و کدینگ حساب‌ها بر همین پایه آماده می‌شوند.";
    body = <KindCards value={kind} onPick={pick} />;
  } else if (step === 1) {
    title = "بخش‌ها";
    subtitle = "بخش‌هایی را که لازم دارید روشن کنید؛ بعداً هم از «تنظیمات» کم و زیاد می‌شوند.";
    body = (
      <>
        <div className="pg-choices">
          {MODULES.map((m) => {
            const on = modules.includes(m.key);
            return (
              <button key={m.key} type="button" role="switch" aria-checked={on} className="pg-choice pg-module" onClick={() => toggle(m.key)}>
                <span className="pg-choice-ic">{MODULE_ICON[m.key]}</span>
                <span className="pg-choice-tx">
                  <span className="pg-choice-t">{m.title}</span>
                  <span className="pg-feats">
                    {m.description.split(/،\s*/).map((f) => (
                      <span key={f} className="pg-feat">
                        {f}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="pg-switch" aria-hidden />
              </button>
            );
          })}
          <div className="pg-core">
            <span className="pg-choice-ic">
              <BookOpenText {...ICON} />
            </span>
            <span className="pg-choice-tx">
              <span className="pg-choice-t">همیشه روشن</span>
              <span className="pg-feats">
                {CORE.map((f) => (
                  <span key={f} className="pg-feat">
                    {f}
                  </span>
                ))}
              </span>
            </span>
          </div>
        </div>
        <div className="pg-row-actions !mt-6">
          <Button type="text" size="large" icon={<ArrowRight {...ICON} />} onClick={() => setStep(0)}>
            قبلی
          </Button>
          <Button type="primary" size="large" className="pg-grow" onClick={() => setStep(2)}>
            ادامه
          </Button>
        </div>
      </>
    );
  } else {
    title = "مشخصات کسب‌وکار";
    subtitle = "نام، واحد پول و سال مالی کافی است؛ بقیه را هر وقت خواستید کامل کنید.";
    body = (
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        validateTrigger="onBlur"
        className="pg-form"
        initialValues={{ base_currency: "IRR", fiscal_year: jy }}
        onValuesChange={(c) => {
          if (err) setErr(null);
          onValuesChange(c);
        }}
        onFinish={async (v) => {
          setBusy(true);
          setErr(null);
          try {
            const r = await api.post<{ id: string }>("/orgs", { ...v, business_kind: kind, modules });
            await qc.invalidateQueries({ queryKey: ["me"] });
            setCreated({ id: r.id, name: String(v.name).trim(), currency: v.base_currency, year: v.fiscal_year });
          } catch (e) {
            setErr(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {err ? <FormAlert>{err}</FormAlert> : null}
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Form.Item name="name" label="نام کسب‌وکار" rules={[{ required: true, whitespace: true, message: "نام کسب‌وکار را وارد کنید." }]} className="sm:col-span-2">
            <Input size="large" placeholder="مثلاً گالری طلای اعتماد" autoFocus />
          </Form.Item>
          <Form.Item name="base_currency" label="واحد پول حساب‌ها" rules={[{ required: true, message: "واحد پول را انتخاب کنید." }]} extra="مبلغ اسناد با این واحد نگه داشته می‌شود.">
            <Select size="large" options={BASE_CURRENCIES.map((c) => ({ value: c.code, label: c.title }))} />
          </Form.Item>
          <Form.Item name="fiscal_year" label="سال مالی" rules={[{ required: true, message: "سال مالی را انتخاب کنید." }]} extra="از ۱ فروردین تا پایان اسفند">
            <Select size="large" options={[jy - 1, jy, jy + 1].map((y) => ({ value: y, label: `سال ${fy(y)}` }))} />
          </Form.Item>
          <Form.Item name="legal_name" label="نام ثبتی">
            <Input size="large" />
          </Form.Item>
          <Form.Item name="economic_code" label="کد اقتصادی">
            <Input size="large" classNames={LTR} inputMode="numeric" />
          </Form.Item>
          <Form.Item name="phone" label="تلفن">
            <Input size="large" classNames={LTR} inputMode="tel" />
          </Form.Item>
          <Form.Item name="city" label="شهر">
            <Input size="large" />
          </Form.Item>
          <Form.Item name="address" label="نشانی" className="sm:col-span-2">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
        </div>
        <div className="pg-row-actions">
          <Button type="text" size="large" icon={<ArrowRight {...ICON} />} onClick={() => setStep(1)}>
            قبلی
          </Button>
          <Button type="primary" size="large" htmlType="submit" className="pg-grow" loading={busy}>
            {busy ? "در حال ساخت…" : "ساخت کسب‌وکار"}
          </Button>
        </div>
      </Form>
    );
  }

  return (
    <AuthLayout wide title={title} subtitle={subtitle} back={back} steps={{ labels: STEPS, current: created ? STEPS.length : step }} swapKey={created ? "done" : step}>
      {body}
    </AuthLayout>
  );
}

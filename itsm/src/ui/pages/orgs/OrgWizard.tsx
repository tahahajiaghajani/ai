// New organisation: its name and (optionally) its time zone → ready. When the app has optional modules (MODULES in
// @shared/constants), a second step switches them on. Everything else is completed later in «تنظیمات».
import { useState, type ReactNode } from "react";
import { Button, Form, Input, Select } from "antd";
import { ArrowLeft, ArrowRight, Puzzle } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "../../lib/api";
import { useSession } from "../../lib/session";
import { BrandMark } from "../../components/brand";
import { DEFAULT_TIMEZONE, MODULES, TIMEZONES, type ModuleKey } from "@shared/constants";
import { AuthLayout } from "../auth/AuthLayout";
import { FormAlert, ICON, useBlurValidation } from "../kit";

const STEPS = MODULES.length ? ["مشخصات", "ماژول‌ها"] : null;

const zoneTitle = (tz: string) => TIMEZONES.find((z) => z.value === tz)?.label ?? tz;
const moduleList = (ms: ModuleKey[]) => ms.map((k) => MODULES.find((m) => m.key === k)?.title ?? k).join("، ");

interface Draft {
  name: string;
  timezone: string;
}

export default function OrgWizard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me } = useSession();
  const [form] = Form.useForm<Draft>();
  const onValuesChange = useBlurValidation(form);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [modules, setModules] = useState<ModuleKey[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string; timezone: string; modules: ModuleKey[] } | null>(null);
  const hasOrgs = !!me?.orgs.length;

  const create = async (d: Draft, ms: ModuleKey[]) => {
    setBusy(true);
    setErr(null);
    try {
      const name = d.name.trim();
      const timezone = d.timezone || DEFAULT_TIMEZONE;
      const r = await api.post<{ id: string }>("/orgs", { name, timezone, modules: ms });
      await qc.invalidateQueries({ queryKey: ["me"] });
      setCreated({ id: r.id, name, timezone, modules: ms });
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (k: ModuleKey) => setModules((ms) => MODULES.map((m) => m.key).filter((x) => (x === k ? !ms.includes(k) : ms.includes(x))));

  const back =
    hasOrgs && !created && step === 0 ? (
      <Link to="/orgs" className="pg-back">
        <ArrowRight {...ICON} aria-hidden />
        سازمان‌ها
      </Link>
    ) : null;

  let title: ReactNode;
  let subtitle: ReactNode;
  let body: ReactNode;

  if (created) {
    title = `سازمان «${created.name}» آماده است.`;
    subtitle = "اعضا، نقش‌ها و تنظیمات را هر وقت خواستید از «تنظیمات» کامل کنید.";
    body = (
      <>
        <div className="pg-core !items-center">
          <BrandMark size={48} launch title="" className="me-1" />
          <dl className="m-0 grid flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-[13px] leading-5">
            <dt className="text-ink-3">نام</dt>
            <dd className="m-0 text-ink">{created.name}</dd>
            <dt className="text-ink-3">منطقهٔ زمانی</dt>
            <dd className="m-0 text-ink">{zoneTitle(created.timezone)}</dd>
            {MODULES.length ? (
              <>
                <dt className="text-ink-3">ماژول‌ها</dt>
                <dd className="m-0 text-ink">{created.modules.length ? moduleList(created.modules) : "هیچ‌کدام"}</dd>
              </>
            ) : null}
          </dl>
        </div>
        <div className="pg-actions !mt-6">
          <Button type="primary" size="large" block autoFocus icon={<ArrowLeft {...ICON} />} iconPlacement="end" onClick={() => nav(`/${created.id}`, { replace: true })}>
            رفتن به خانه
          </Button>
        </div>
      </>
    );
  } else if (step === 0) {
    title = "سازمان تازه";
    subtitle = "نام سازمان کافی است؛ بقیه را هر وقت خواستید در «تنظیمات» کامل کنید.";
    body = (
      <Form<Draft>
        form={form}
        layout="vertical"
        requiredMark="optional"
        validateTrigger="onBlur"
        className="pg-form"
        initialValues={draft ?? { name: "", timezone: DEFAULT_TIMEZONE }}
        onValuesChange={(c) => {
          if (err) setErr(null);
          onValuesChange(c);
        }}
        onFinish={async (v) => {
          setDraft(v);
          if (STEPS) setStep(1);
          else await create(v, []);
        }}
      >
        {err ? <FormAlert>{err}</FormAlert> : null}
        <Form.Item name="name" label="نام سازمان" rules={[{ required: true, whitespace: true, message: "نام سازمان را وارد کنید." }, { min: 2, message: "نام سازمان کوتاه است." }]}>
          <Input size="large" placeholder="مثلاً واحد فناوری اطلاعات شرکت نمونه" maxLength={160} autoFocus />
        </Form.Item>
        <Form.Item name="timezone" label="منطقهٔ زمانی" extra="ساعت رویدادها و گزارش‌ها با این منطقه نشان داده می‌شود.">
          <Select size="large" showSearch optionFilterProp="label" options={TIMEZONES} />
        </Form.Item>
        <div className="pg-actions">
          <Button type="primary" size="large" htmlType="submit" block loading={busy}>
            {STEPS ? "ادامه" : busy ? "در حال ساخت…" : "ساخت سازمان"}
          </Button>
        </div>
      </Form>
    );
  } else {
    title = "ماژول‌ها";
    subtitle = "ماژول‌هایی را که لازم دارید روشن کنید؛ بعداً هم از «تنظیمات» کم و زیاد می‌شوند.";
    body = (
      <>
        {err ? <FormAlert>{err}</FormAlert> : null}
        <div className="pg-choices">
          {MODULES.map((m) => {
            const on = modules.includes(m.key);
            return (
              <button key={m.key} type="button" role="switch" aria-checked={on} className="pg-choice pg-module" onClick={() => toggle(m.key)}>
                <span className="pg-choice-ic">
                  <Puzzle {...ICON} />
                </span>
                <span className="pg-choice-tx">
                  <span className="pg-choice-t">{m.title}</span>
                  <span className="pg-choice-d">{m.description}</span>
                </span>
                <span className="pg-switch" aria-hidden />
              </button>
            );
          })}
        </div>
        <div className="pg-row-actions !mt-6">
          <Button type="text" size="large" icon={<ArrowRight {...ICON} />} onClick={() => setStep(0)}>
            قبلی
          </Button>
          <Button type="primary" size="large" className="pg-grow" loading={busy} onClick={() => draft && create(draft, modules)}>
            {busy ? "در حال ساخت…" : "ساخت سازمان"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <AuthLayout wide={step > 0} title={title} subtitle={subtitle} back={back} steps={STEPS ? { labels: STEPS, current: created ? STEPS.length : step } : undefined} swapKey={created ? "done" : step}>
      {body}
    </AuthLayout>
  );
}

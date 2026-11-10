// First-run setup of the server edition (/setup?token=…, valid once): the organisation and its owner (the platform
// administrator), the address people type and the bank's certificate, the organisation's mail server (Exchange) and
// local AI servers, the backup folder — then the recovery code and the way to the Active Directory settings.
// The token comes from the end of the installation (C:\ProgramData\…\setup-url.txt) or `karizctl setup-token`.
import { useMemo, useState, type ReactNode } from "react";
import { Button, Form, Input, InputNumber, Select, Upload } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Building2, KeyRound, Mail, Server, ShieldCheck, Bot, HardDrive, Plus, Trash2, Lock, Link2, User } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { useSession } from "../../lib/session";
import { fa } from "../../lib/fa";
import { AuthLayout } from "./AuthLayout";
import { RecoveryCode } from "./RecoveryCode";
import { passwordIcon } from "./Login";
import { FormAlert, ICON, LTR, PasswordRules, newPasswordRules, useBlurValidation } from "../kit";
import { APP_NAME } from "@shared/constants";
import { SECURITY_SETTINGS_PATH } from "@shared/auth/paths";

interface CertInfo {
  subject: string;
  names: string[];
  valid_to: string;
  days_left: number;
  self_signed: boolean;
}

interface SetupState {
  required: boolean;
  valid: boolean;
  expired: boolean;
  public_url: string;
  directory_path: string;
  air_gapped: boolean;
  allow?: string[];
  backup_dir?: string;
  cert?: CertInfo | null;
  self_signed?: boolean;
  tls?: boolean;
}

interface Values {
  org_name: string;
  full_name: string;
  email: string;
  password: string;
  public_url: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_security?: "starttls" | "tls" | "none";
  smtp_user?: string;
  smtp_password?: string;
  smtp_from?: string;
  ai: { base_url: string; kind: "ollama" | "openai" }[];
  allow: string;
  backup_dir?: string;
}

const STEPS = ["سازمان و مدیر", "نشانی و گواهی", "ایمیل و هوش مصنوعی", "پشتیبان‌گیری"];

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <fieldset className="mb-5 rounded-[var(--ds-radius-md)] border border-line p-4">
      <legend className="flex items-center gap-2 px-1 text-[13px] font-[var(--ds-weight-medium)] text-ink-2">
        {icon}
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

export default function ServerSetup() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  const { refresh } = useSession();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["server-setup", token], queryFn: () => api.get<SetupState>("/setup/state", { token }), retry: false });
  const [form] = Form.useForm<Values>();
  const onChange = useBlurValidation(form);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cert, setCert] = useState<{ info: CertInfo; warning: string | null } | null>(null);
  const [certFiles, setCertFiles] = useState<{ pfx?: File; cert?: File; key?: File; passphrase?: string }>({});
  const [result, setResult] = useState<{ org_id: string; recovery_code: string | null; warnings: string[]; directory_path: string; security_path?: string } | null>(null);
  const [kept, setKept] = useState(false);
  const s = q.data;

  if (q.isLoading) return <AuthLayout title="راه‌اندازی سرور">در حال بررسی…</AuthLayout>;
  if (q.error || !s) return <AuthLayout title="راه‌اندازی سرور"><FormAlert>{errorText(q.error)}</FormAlert></AuthLayout>;

  if (!s.required && !result)
    return (
      <AuthLayout title="راه‌اندازی انجام شده است" subtitle={`${APP_NAME} آماده است؛ با حساب خود وارد شوید.`}>
        <Button type="primary" size="large" block onClick={() => nav("/login", { replace: true })}>
          ورود
        </Button>
      </AuthLayout>
    );

  if (!s.valid && !result)
    return (
      <AuthLayout title="نشانی راه‌اندازی لازم است" subtitle="راه‌اندازی نخست سرور فقط با نشانی یک‌بارمصرفی انجام می‌شود که نصب‌کننده ساخته است.">
        <FormAlert tone="warning">
          {s.expired ? "این نشانی منقضی شده است. " : token ? "این نشانی معتبر نیست یا پیش‌تر به کار رفته است. " : ""}
          نشانی را از پایان نصب یا فایل <span className="ds-latin">setup-url.txt</span> در پوشهٔ داده‌های سرور بردارید؛ یا روی سرور در خط فرمانِ مدیر اجرا کنید:
        </FormAlert>
        <pre className="pg-ltr mt-3 rounded bg-surface-2 p-3 text-[13px]" dir="ltr">
          karizctl setup-token
        </pre>
      </AuthLayout>
    );

  if (result) {
    const directory = result.directory_path;
    // the paths come from the server (named once in @shared/auth/paths); an older server answers without the second
    const security = result.security_path ?? `/${result.org_id}${SECURITY_SETTINGS_PATH}`;
    return (
      <AuthLayout title="سرور آماده است" subtitle="کد بازیابی حساب مدیر را جای امنی نگه دارید؛ دیگر نشان داده نمی‌شود." steps={{ labels: [...STEPS, "پایان"], current: 4 }}>
        {result.warnings.length ? (
          <FormAlert tone="warning">
            {result.warnings.map((w) => (
              <span key={w} className="block">
                {w}
              </span>
            ))}
          </FormAlert>
        ) : null}
        {result.recovery_code && !kept ? (
          <RecoveryCode code={result.recovery_code} onDone={() => setKept(true)} />
        ) : (
          <div className="pg-actions">
            <Button type="primary" size="large" block onClick={async () => {
              await refresh();
              nav(`/${result.org_id}`, { replace: true });
            }}>
              ورود به {APP_NAME}
            </Button>
            <Button size="large" block icon={<ShieldCheck {...ICON} />} onClick={async () => {
              await refresh();
              nav(directory, { replace: true });
            }}>
              فهرست کاربران (LDAP و SCIM)
            </Button>
            <Button size="large" block icon={<Lock {...ICON} />} onClick={async () => {
              await refresh();
              nav(security, { replace: true });
            }}>
              امنیت ورود و نشست‌ها
            </Button>
          </div>
        )}
      </AuthLayout>
    );
  }

  const next = async () => {
    setErr(null);
    const fields: (keyof Values)[][] = [["org_name", "full_name", "email", "password"], ["public_url"], ["smtp_host", "smtp_port", "smtp_from"], ["backup_dir"]];
    try {
      await form.validateFields(fields[step]);
      setStep((x) => x + 1);
    } catch {
      /* the form shows what is missing */
    }
  };

  const uploadCert = async () => {
    setErr(null);
    if (!certFiles.pfx && !(certFiles.cert && certFiles.key)) return setErr("فایل ‎.pfx‎ یا جفت گواهی و کلید را انتخاب کنید");
    setBusy(true);
    try {
      const fd = new FormData();
      if (certFiles.pfx) fd.set("pfx", certFiles.pfx);
      if (certFiles.cert) fd.set("cert", certFiles.cert);
      if (certFiles.key) fd.set("key", certFiles.key);
      fd.set("passphrase", certFiles.passphrase ?? "");
      // the token goes in a header: the server checks it before it reads the upload
      const res = await fetch("/api/setup/certificate", { method: "POST", body: fd, headers: { "x-setup-token": token }, credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? `خطای ${res.status}`);
      setCert({ info: data.cert, warning: data.warning ?? null });
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setErr(null);
    setBusy(true);
    try {
      const v = { ...form.getFieldsValue(true) } as Values;
      const smtp = v.smtp_host?.trim()
        ? { host: v.smtp_host.trim(), port: v.smtp_port ?? 25, security: v.smtp_security ?? "starttls", user: v.smtp_user || undefined, password: v.smtp_password || undefined, from_address: v.smtp_from ?? "" }
        : null;
      const r = await api.post<{ org_id: string; recovery_code: string | null; warnings: string[]; directory_path: string; security_path?: string }>("/setup/complete", {
        token,
        org: { name: v.org_name },
        admin: { full_name: v.full_name, email: v.email, password: v.password },
        public_url: v.public_url,
        smtp,
        ai: (v.ai ?? []).filter((a) => a?.base_url?.trim()),
        allow: (v.allow ?? "").split(/[\s,،;]+/).map((h) => h.trim()).filter(Boolean),
        backup_dir: v.backup_dir?.trim() || null,
      });
      setResult(r);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const shownCert = cert?.info ?? s.cert ?? null;
  return (
    <AuthLayout title="راه‌اندازی سرور" subtitle={`${APP_NAME} روی این سرور نصب شد؛ چند گام تا آماده شدن.`} steps={{ labels: STEPS, current: step }} wide swapKey={step}>
      {err ? <FormAlert>{err}</FormAlert> : null}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        validateTrigger="onBlur"
        className="pg-form"
        initialValues={{ public_url: s.public_url, smtp_port: 25, smtp_security: "starttls", ai: [], allow: "", backup_dir: s.backup_dir }}
        onValuesChange={(c) => {
          if (err) setErr(null);
          onChange(c);
        }}
      >
        <div hidden={step !== 0}>
          <Section icon={<Building2 {...ICON} aria-hidden />} title="سازمان">
            <Form.Item name="org_name" label="نام سازمان" rules={[{ required: true, message: "نام سازمان را وارد کنید." }]}>
              <Input size="large" autoFocus placeholder="مثلاً بانک …" />
            </Form.Item>
          </Section>
          <Section icon={<User {...ICON} aria-hidden />} title="مدیر سامانه (نخستین حساب)">
            <Form.Item name="full_name" label="نام و نام خانوادگی" rules={[{ required: true, message: "نام را وارد کنید." }]}>
              <Input size="large" autoComplete="name" />
            </Form.Item>
            <Form.Item name="email" label="ایمیل" rules={[{ required: true, message: "ایمیل را وارد کنید." }, { type: "email", message: "این ایمیل درست نیست." }]}>
              <Input size="large" classNames={LTR} prefix={<Mail {...ICON} aria-hidden />} inputMode="email" autoComplete="username" spellCheck={false} />
            </Form.Item>
            <Form.Item name="password" label="رمز عبور" rules={newPasswordRules("رمز عبور را وارد کنید.")}>
              <Input.Password size="large" classNames={LTR} prefix={<Lock {...ICON} aria-hidden />} autoComplete="new-password" iconRender={passwordIcon} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(a, b) => a.password !== b.password}>{() => <PasswordRules value={form.getFieldValue("password")} />}</Form.Item>
          </Section>
        </div>

        <div hidden={step !== 1}>
          <Section icon={<Link2 {...ICON} aria-hidden />} title="نشانی سامانه">
            <Form.Item name="public_url" label="نشانی‌ای که کارکنان در مرورگر می‌زنند" rules={[{ required: true, message: "نشانی را وارد کنید." }, { type: "url", message: "نشانی کامل، مثلاً https://kariz.bank.local" }]}>
              <Input size="large" classNames={LTR} spellCheck={false} inputMode="url" />
            </Form.Item>
          </Section>
          <Section icon={<KeyRound {...ICON} aria-hidden />} title="گواهی HTTPS">
            {shownCert ? (
              <p className="mb-3 text-[13px] text-ink-2">
                {shownCert.self_signed ? "اکنون گواهی خودامضای موقت به کار می‌رود؛ مرورگرها تا نصب گواهی بانک هشدار می‌دهند." : `گواهی کنونی: ${shownCert.subject} — ${fa(shownCert.days_left)} روز تا انقضا`}
              </p>
            ) : (
              <p className="mb-3 text-[13px] text-ink-2">اکنون گواهی خودامضای موقت به کار می‌رود. گواهی صادرشده از CA بانک را برای این نشانی نصب کنید (یا بعداً با karizctl rotate-cert).</p>
            )}
            <div className="grid gap-3">
              <Upload maxCount={1} accept=".pfx,.p12" beforeUpload={(f) => (setCertFiles((x) => ({ ...x, pfx: f as unknown as File, cert: undefined, key: undefined })), false)} onRemove={() => setCertFiles((x) => ({ ...x, pfx: undefined }))}>
                <Button icon={<KeyRound {...ICON} />}>فایل ‎.pfx‎ گواهی</Button>
              </Upload>
              <Input.Password placeholder="گذرواژهٔ فایل ‎.pfx‎" classNames={LTR} value={certFiles.passphrase} onChange={(e) => setCertFiles((x) => ({ ...x, passphrase: e.target.value }))} iconRender={passwordIcon} />
              <div className="flex flex-wrap gap-2 text-[13px] text-ink-3">یا جفت PEM:</div>
              <div className="flex flex-wrap gap-2">
                <Upload maxCount={1} accept=".crt,.pem,.cer" beforeUpload={(f) => (setCertFiles((x) => ({ ...x, cert: f as unknown as File, pfx: undefined })), false)}>
                  <Button>گواهی (‎.crt‎)</Button>
                </Upload>
                <Upload maxCount={1} accept=".key,.pem" beforeUpload={(f) => (setCertFiles((x) => ({ ...x, key: f as unknown as File, pfx: undefined })), false)}>
                  <Button>کلید (‎.key‎)</Button>
                </Upload>
              </div>
              <Button onClick={uploadCert} loading={busy} disabled={!certFiles.pfx && !(certFiles.cert && certFiles.key)}>
                نصب گواهی
              </Button>
              {cert ? (
                <FormAlert tone={cert.warning ? "warning" : "info"}>
                  گواهی نصب شد: {cert.info.subject} (تا {cert.info.valid_to.slice(0, 10)}). سرور با گواهی تازه دوباره راه‌اندازی می‌شود؛ اگر صفحه پاسخ نداد، آن را دوباره باز کنید.
                  {cert.warning ? <span className="block">{cert.warning}</span> : null}
                </FormAlert>
              ) : null}
            </div>
          </Section>
        </div>

        <div hidden={step !== 2}>
          <Section icon={<Mail {...ICON} aria-hidden />} title="سرور ایمیل سازمان (Exchange) — اختیاری">
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Form.Item name="smtp_host" label="سرور SMTP">
                <Input classNames={LTR} spellCheck={false} placeholder="mail.bank.local" />
              </Form.Item>
              <Form.Item name="smtp_port" label="درگاه">
                <InputNumber min={1} max={65535} className="w-full" />
              </Form.Item>
            </div>
            <Form.Item name="smtp_security" label="رمزنگاری">
              <Select options={[{ value: "starttls", label: "STARTTLS" }, { value: "tls", label: "TLS/SSL" }, { value: "none", label: "بدون رمزنگاری" }]} />
            </Form.Item>
            <div className="grid grid-cols-2 gap-3">
              <Form.Item name="smtp_user" label="نام کاربری">
                <Input classNames={LTR} spellCheck={false} autoComplete="off" />
              </Form.Item>
              <Form.Item name="smtp_password" label="رمز">
                <Input.Password classNames={LTR} autoComplete="new-password" iconRender={passwordIcon} />
              </Form.Item>
            </div>
            <Form.Item noStyle shouldUpdate={(a, b) => a.smtp_host !== b.smtp_host}>
              {() => (
                <Form.Item name="smtp_from" label="نشانی فرستنده" rules={form.getFieldValue("smtp_host") ? [{ required: true, message: "نشانی فرستنده را وارد کنید." }, { type: "email", message: "این ایمیل درست نیست." }] : []}>
                  <Input classNames={LTR} spellCheck={false} placeholder="itsm@bank.local" />
                </Form.Item>
              )}
            </Form.Item>
          </Section>
          <Section icon={<Bot {...ICON} aria-hidden />} title="هوش مصنوعی محلی (شبکهٔ سازمان) — اختیاری">
            <Form.List name="ai">
              {(items, { add, remove }) => (
                <>
                  {items.map((it) => (
                    <div key={it.key} className="grid grid-cols-[1fr_8rem_auto] items-start gap-2">
                      <Form.Item name={[it.name, "base_url"]} rules={[{ type: "url", message: "نشانی کامل، مثلاً http://ollama.bank.local:11434/v1" }]}>
                        <Input classNames={LTR} spellCheck={false} placeholder="http://ollama.bank.local:11434/v1" />
                      </Form.Item>
                      <Form.Item name={[it.name, "kind"]} initialValue="ollama">
                        <Select options={[{ value: "ollama", label: "Ollama" }, { value: "openai", label: "سازگار با OpenAI (vLLM…)" }]} />
                      </Form.Item>
                      <Button aria-label="حذف" icon={<Trash2 {...ICON} />} onClick={() => remove(it.name)} />
                    </div>
                  ))}
                  <Button icon={<Plus {...ICON} />} onClick={() => add({ kind: "ollama", base_url: "" })}>
                    سرور مدل
                  </Button>
                </>
              )}
            </Form.List>
            <Form.Item name="allow" label="میزبان‌های مجاز دیگر (شبکهٔ بسته)" className="!mt-4" help="نام میزبان، ‎*.دامنه‎، IP یا بازهٔ CIDR؛ با فاصله یا ویرگول جدا کنید. سرورهای بالا خودکار افزوده می‌شوند.">
              <Input classNames={LTR} spellCheck={false} placeholder="ldap.bank.local 10.20.0.0/16" />
            </Form.Item>
          </Section>
        </div>

        <div hidden={step !== 3}>
          <Section icon={<HardDrive {...ICON} aria-hidden />} title="پشتیبان‌گیری">
            <Form.Item name="backup_dir" label="پوشهٔ پشتیبان‌ها" help="هر شب پشتیبان پایگاه داده و پیوست‌ها این‌جا گرفته می‌شود؛ بهتر است پوشه‌ای روی دیسک یا سرور دیگر (مسیر UNC) باشد.">
              <Input classNames={LTR} spellCheck={false} />
            </Form.Item>
          </Section>
          <Section icon={<Server {...ICON} aria-hidden />} title="پس از راه‌اندازی">
            <p className="text-[13px] leading-6 text-ink-2">ورود کارکنان با حساب Active Directory و همگام‌سازی فهرست کاربران را از «یکپارچه‌سازی ← فهرست کاربران (LDAP و SCIM)» تنظیم کنید؛ پیوند آن پس از پایان نشان داده می‌شود.</p>
          </Section>
        </div>

        <div className="pg-actions">
          {step < STEPS.length - 1 ? (
            <Button type="primary" size="large" block onClick={next}>
              ادامه
            </Button>
          ) : (
            <Button type="primary" size="large" block loading={busy} onClick={finish}>
              {busy ? "در حال راه‌اندازی…" : "پایان راه‌اندازی"}
            </Button>
          )}
          {step > 0 ? (
            <Button size="large" block onClick={() => setStep((x) => x - 1)} disabled={busy}>
              بازگشت
            </Button>
          ) : null}
        </div>
      </Form>
    </AuthLayout>
  );
}

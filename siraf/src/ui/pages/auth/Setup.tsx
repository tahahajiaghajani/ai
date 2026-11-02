// First start of the Windows app: start fresh on this computer, or connect to an existing
// cloud account (and download its data), or use another computer of the office as server.
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Form, Input, Result } from "antd";
import { Monitor, CloudDownload, Network, ArrowRight, Link2, Mail, Lock, ChevronLeft, Loader2 } from "lucide-react";
import { Navigate, useNavigate } from "react-router";
import { api, errorText } from "../../lib/api";
import { useSession } from "../../lib/session";
import { AuthLayout } from "./AuthLayout";
import { SignupForm } from "./Signup";
import { RecoveryCode } from "./RecoveryCode";
import { passwordIcon } from "./Login";
import { FormAlert, ICON, initials, useBlurValidation, LTR } from "../kit";

declare global {
  interface Window {
    taraz?: {
      isDesktop: true;
      version: string;
      setServer?: (url: string | null) => Promise<void>;
      print?: (opts?: { silent?: boolean; printer?: string; landscape?: boolean; pageSize?: string }) => Promise<void>;
      printers?: () => Promise<{ name: string; isDefault: boolean }[]>;
      openPath?: (p: string) => Promise<void>;
      savePdf?: (name: string) => Promise<string | null>;
      relaunch?: () => Promise<void>;
    };
  }
}

type Mode = "local" | "cloud" | "client";

interface Option {
  v: Mode;
  icon: ReactNode;
  t: string;
  d: string;
}

/** A radio group of cards: arrow keys move the choice, Enter continues (components.md §5: ink, never Dusk). */
function ChoiceCards({ options, value, onChange, onEnter }: { options: Option[]; value: Mode; onChange: (v: Mode) => void; onEnter: () => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === "ArrowDown" || e.key === "ArrowLeft" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowRight" ? i - 1 : null;
    if (next !== null) {
      e.preventDefault();
      const j = (next + options.length) % options.length;
      onChange(options[j].v);
      refs.current[j]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onEnter();
    }
  };
  return (
    <div className="pg-choices" role="radiogroup" aria-label="روش شروع">
      {options.map((o, i) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className="pg-choice"
            onClick={() => onChange(o.v)}
            onDoubleClick={onEnter}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="pg-choice-ic">{o.icon}</span>
            <span className="pg-choice-tx">
              <span className="pg-choice-t">{o.t}</span>
              <span className="pg-choice-d">{o.d}</span>
            </span>
            <span className="pg-radio" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="text" size="large" icon={<ArrowRight {...ICON} />} onClick={onClick}>
      قبلی
    </Button>
  );
}

export default function Setup() {
  const { meta, refresh, me } = useSession();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("local");
  const [step, setStep] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [cloud, setCloud] = useState<{ url: string; email: string; password: string } | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [cloudForm] = Form.useForm();
  const [clientForm] = Form.useForm();
  const onCloudChange = useBlurValidation(cloudForm);
  const onClientChange = useBlurValidation(clientForm);
  if (meta && !meta.first_run && !code) return <Navigate to={me ? "/" : "/login"} replace />;
  if (meta && meta.mode !== "desktop") return <Navigate to="/signup" replace />;

  const options: Option[] = [
    { v: "local", icon: <Monitor {...ICON} />, t: "شروع روی همین رایانه", d: "کسب‌وکار تازه می‌سازید و داده‌ها روی همین ویندوز می‌مانند؛ هر وقت خواستید به نسخهٔ وب وصلش می‌کنید." },
    { v: "cloud", icon: <CloudDownload {...ICON} />, t: "اتصال به حساب ابری", d: "در نسخهٔ وب حساب و کسب‌وکار دارید؟ داده‌ها دریافت می‌شوند و از این به بعد دو طرف هم‌گام می‌مانند." },
    ...(window.taraz?.setServer
      ? [{ v: "client" as const, icon: <Network {...ICON} />, t: "اتصال به سرور شبکهٔ فروشگاه", d: "سیراف روی رایانهٔ دیگری از شبکهٔ داخلی با «حالت شبکه» روشن است؛ این رایانه فقط به آن وصل می‌شود." }]
      : []),
  ];

  const second = mode === "cloud" ? "حساب ابری" : mode === "client" ? "سرور شبکه" : "حساب مدیر";
  const steps = { labels: ["روش شروع", second, "کسب‌وکار"], current: code ? 2 : step };
  const back = () => {
    setErr(null);
    setStep(0);
  };

  let title: ReactNode = "خوش آمدید";
  let subtitle: ReactNode = "سیراف روی این رایانه نصب شد. چطور شروع می‌کنید؟";
  let body: ReactNode = (
    <>
      <ChoiceCards options={options} value={mode} onChange={setMode} onEnter={() => setStep(1)} />
      <div className="pg-actions !mt-6">
        <Button type="primary" size="large" block onClick={() => setStep(1)}>
          ادامه
        </Button>
      </div>
    </>
  );

  if (step === 1 && mode === "local") {
    if (code) {
      title = "حساب مدیر ساخته شد";
      subtitle = "پیش از ساختن کسب‌وکار، کد بازیابی را جای امنی نگه دارید.";
      body = (
        <RecoveryCode
          code={code}
          onDone={async () => {
            await refresh();
            nav("/orgs/new", { replace: true });
          }}
        />
      );
    } else {
      title = "حساب مدیر";
      subtitle = "با همین ایمیل و رمز وارد برنامه می‌شوید. همکاران را بعداً از «تنظیمات ← کاربران» اضافه می‌کنید.";
      body = <SignupForm onDone={setCode} submitText="ساخت حساب مدیر" busyText="در حال ساخت…" extraActions={<BackButton onClick={back} />} />;
    }
  } else if (step === 1 && mode === "cloud") {
    if (!orgs.length) {
      title = "ورود به حساب ابری";
      subtitle = "نشانی نسخهٔ وب و حسابی را که در آن دارید وارد کنید.";
      body = (
        <>
          {err ? <FormAlert>{err}</FormAlert> : null}
          <Form
            form={cloudForm}
            layout="vertical"
            requiredMark={false}
            validateTrigger="onBlur"
            className="pg-form"
            initialValues={cloud ?? { url: "https://" }}
            onValuesChange={(c) => {
              if (err) setErr(null);
              onCloudChange(c);
            }}
            onFinish={async (v) => {
              setBusy(true);
              setErr(null);
              try {
                const r = await api.post<{ orgs: { id: string; name: string }[] }>("/local/cloud/orgs", v);
                if (!r.orgs.length) throw new Error("در این حساب ابری هنوز کسب‌وکاری ساخته نشده است");
                setCloud(v);
                setOrgs(r.orgs);
              } catch (e) {
                setErr(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Form.Item
              name="url"
              label="نشانی نسخهٔ وب"
              rules={[
                { required: true, message: "نشانی نسخهٔ وب را وارد کنید." },
                { type: "url", message: "نشانی کامل را وارد کنید، مثلاً https://siraf.example.com" },
              ]}
            >
              <Input size="large" classNames={LTR} spellCheck={false} prefix={<Link2 {...ICON} aria-hidden />} autoFocus inputMode="url" />
            </Form.Item>
            <Form.Item
              name="email"
              label="ایمیل حساب ابری"
              rules={[
                { required: true, message: "ایمیل را وارد کنید." },
                { type: "email", message: "این ایمیل درست نیست." },
              ]}
            >
              <Input size="large" classNames={LTR} spellCheck={false} prefix={<Mail {...ICON} aria-hidden />} inputMode="email" autoComplete="username" placeholder="name@example.com" />
            </Form.Item>
            <Form.Item name="password" label="رمز عبور" rules={[{ required: true, message: "رمز عبور را وارد کنید." }]}>
              <Input.Password size="large" classNames={LTR} prefix={<Lock {...ICON} aria-hidden />} autoComplete="current-password" iconRender={passwordIcon} />
            </Form.Item>
            <div className="pg-actions">
              <Button type="primary" size="large" htmlType="submit" block loading={busy === true}>
                {busy === true ? "در حال ورود…" : "ورود به حساب ابری"}
              </Button>
              <BackButton onClick={back} />
            </div>
          </Form>
        </>
      );
    } else {
      title = "کدام کسب‌وکار؟";
      subtitle = "کسب‌وکاری را که می‌خواهید روی این رایانه دریافت شود انتخاب کنید.";
      body = (
        <>
          {err ? <FormAlert>{err}</FormAlert> : null}
          <div className="pg-choices">
            {orgs.map((o) => (
              <button
                key={o.id}
                type="button"
                className="pg-choice items-center"
                disabled={!!busy}
                aria-busy={busy === o.id}
                onClick={async () => {
                  setBusy(o.id);
                  setErr(null);
                  try {
                    await api.post("/local/cloud/link", { ...cloud, org_id: o.id, direction: "download" });
                    await api.post("/auth/login", { email: cloud!.email, password: cloud!.password });
                    await refresh();
                    nav(`/${o.id}`, { replace: true });
                  } catch (e) {
                    setErr(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <span className="pg-org-logo !h-9 !w-9 !text-base" aria-hidden>
                  {initials(o.name).slice(0, 1)}
                </span>
                <span className="pg-choice-tx">
                  <span className="pg-choice-t">{o.name}</span>
                  {busy === o.id ? <span className="pg-choice-d">در حال دریافت داده‌ها…</span> : null}
                </span>
                {busy === o.id ? <Loader2 {...ICON} className="animate-spin text-ink-3" aria-hidden /> : <ChevronLeft {...ICON} className="text-ink-3" aria-hidden />}
              </button>
            ))}
          </div>
          <div className="pg-actions !mt-5">
            <BackButton
              onClick={() => {
                setErr(null);
                setOrgs([]);
              }}
            />
          </div>
        </>
      );
    }
  } else if (step === 1 && mode === "client") {
    title = "اتصال به سرور شبکه";
    subtitle = "نشانی سرور را در رایانهٔ سرور از «تنظیمات ← نسخهٔ ویندوز ← حالت شبکه» ببینید.";
    body = (
      <Form
        form={clientForm}
        layout="vertical"
        requiredMark={false}
        validateTrigger="onBlur"
        className="pg-form"
        onValuesChange={onClientChange}
        onFinish={async (v) => {
          setBusy(true);
          try {
            await window.taraz?.setServer?.(String(v.url).replace(/\/+$/, ""));
          } finally {
            setBusy(false);
          }
        }}
        initialValues={{ url: "http://192.168.1.10:3939" }}
      >
        <Form.Item
          name="url"
          label="نشانی سرور در شبکه"
          extra="مثلاً http://192.168.1.10:3939"
          rules={[
            { required: true, message: "نشانی سرور را وارد کنید." },
            { pattern: /^https?:\/\/\S+$/i, message: "نشانی با http:// شروع می‌شود." },
          ]}
        >
          <Input size="large" classNames={LTR} spellCheck={false} prefix={<Network {...ICON} aria-hidden />} autoFocus inputMode="url" />
        </Form.Item>
        <div className="pg-actions">
          <Button type="primary" size="large" htmlType="submit" block loading={busy === true}>
            {busy === true ? "در حال اتصال…" : "اتصال"}
          </Button>
          <BackButton onClick={back} />
        </div>
      </Form>
    );
  }

  return (
    <AuthLayout title={title} subtitle={subtitle} steps={steps} swapKey={`${step}-${step ? mode : ""}-${orgs.length ? "orgs" : ""}-${code ? "code" : ""}`}>
      {body}
    </AuthLayout>
  );
}

export { Result };

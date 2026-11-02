// First start of the Windows app: start fresh on this computer, or connect to an existing
// cloud account (and download its data), or use another computer of the office as server.
import { useState } from "react";
import { Button, Form, Input, Alert, Radio, Steps, Result } from "antd";
import { DesktopOutlined, CloudDownloadOutlined, ClusterOutlined } from "@ant-design/icons";
import { Navigate, useNavigate } from "react-router";
import { api, errorText } from "../../lib/api";
import { useSession } from "../../lib/session";
import { AuthLayout } from "./AuthLayout";
import { SignupForm } from "./Signup";
import { RecoveryCode } from "./RecoveryCode";

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

export default function Setup() {
  const { meta, refresh, me } = useSession();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("local");
  const [step, setStep] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cloud, setCloud] = useState<{ url: string; email: string; password: string } | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  if (meta && !meta.first_run && !code) return <Navigate to={me ? "/" : "/login"} replace />;
  if (meta && meta.mode !== "desktop") return <Navigate to="/signup" replace />;

  const choose = (
    <div className="space-y-3">
      <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} className="!flex !flex-col !gap-3">
        {[
          { v: "local", icon: <DesktopOutlined />, t: "شروع روی همین رایانه", d: "کسب‌وکار تازه می‌سازید؛ داده‌ها روی همین ویندوز ذخیره می‌شوند و بعداً هر وقت خواستید به نسخه‌ی وب وصلش می‌کنید." },
          { v: "cloud", icon: <CloudDownloadOutlined />, t: "اتصال به حساب ابری (نسخه‌ی وب)", d: "اگر در نسخه‌ی وب حساب و کسب‌وکار دارید، اطلاعات دریافت می‌شود و از این به بعد دو طرف هم‌گام می‌مانند." },
          ...(window.taraz?.setServer ? [{ v: "client", icon: <ClusterOutlined />, t: "اتصال به سرور شبکه‌ی فروشگاه", d: "سیراف روی رایانه‌ی دیگری از شبکه‌ی داخلی نصب و «حالت شبکه» آن روشن است؛ این رایانه فقط به آن وصل می‌شود." }] : []),
        ].map((o) => (
          <Radio key={o.v} value={o.v} className="tz-soft !m-0 !flex !items-start !p-3">
            <div className="ms-1">
              <div className="flex items-center gap-2 font-bold">
                {o.icon} {o.t}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted">{o.d}</div>
            </div>
          </Radio>
        ))}
      </Radio.Group>
      <Button type="primary" size="large" block onClick={() => setStep(1)}>
        ادامه
      </Button>
    </div>
  );

  let body = choose;
  if (step === 1 && mode === "local") {
    body = code ? (
      <RecoveryCode
        code={code}
        onDone={async () => {
          await refresh();
          nav("/orgs/new", { replace: true });
        }}
      />
    ) : (
      <>
        <Alert type="info" showIcon className="!mb-4" title="ابتدا حساب مدیر این برنامه را بسازید" description="با همین ایمیل و رمز وارد برنامه می‌شوید. کاربران دیگر را بعداً از «تنظیمات ← کاربران» اضافه می‌کنید." />
        <SignupForm onDone={setCode} submitText="ساخت حساب مدیر" />
        <Button type="link" block className="!mt-2" onClick={() => setStep(0)}>
          بازگشت
        </Button>
      </>
    );
  } else if (step === 1 && mode === "cloud") {
    body = (
      <>
        {err ? <Alert type="error" showIcon className="!mb-4" title={err} /> : null}
        {!orgs.length ? (
          <Form
            layout="vertical"
            requiredMark={false}
            initialValues={{ url: "https://" }}
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
            <Form.Item name="url" label="نشانی نسخه‌ی وب" rules={[{ required: true, type: "url", message: "نشانی کامل، مثلاً https://taraz.example.com" }]}>
              <Input size="large" dir="ltr" />
            </Form.Item>
            <Form.Item name="email" label="ایمیل حساب ابری" rules={[{ required: true, type: "email" }]}>
              <Input size="large" dir="ltr" />
            </Form.Item>
            <Form.Item name="password" label="رمز عبور" rules={[{ required: true }]}>
              <Input.Password size="large" dir="ltr" />
            </Form.Item>
            <Button type="primary" size="large" htmlType="submit" block loading={busy}>
              ورود به حساب ابری
            </Button>
            <Button type="link" block className="!mt-2" onClick={() => setStep(0)}>
              بازگشت
            </Button>
          </Form>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-muted">کدام کسب‌وکار روی این رایانه دریافت شود؟</div>
            {orgs.map((o) => (
              <Button
                key={o.id}
                size="large"
                block
                loading={busy}
                onClick={async () => {
                  setBusy(true);
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
                {o.name}
              </Button>
            ))}
          </div>
        )}
      </>
    );
  } else if (step === 1 && mode === "client") {
    body = (
      <Form
        layout="vertical"
        onFinish={async (v) => {
          await window.taraz?.setServer?.(String(v.url).replace(/\/+$/, ""));
        }}
        initialValues={{ url: "http://192.168.1.10:3939" }}
      >
        <Alert type="info" showIcon className="!mb-4" title="نشانی را از رایانه‌ی سرور ببینید" description="در رایانه‌ی سرور: تنظیمات ← نسخه‌ی ویندوز ← حالت شبکه. نشانی‌ای مثل http://192.168.1.10:3939 نمایش داده می‌شود." />
        <Form.Item name="url" label="نشانی سرور در شبکه" rules={[{ required: true }]}>
          <Input size="large" dir="ltr" />
        </Form.Item>
        <Button type="primary" size="large" htmlType="submit" block>
          اتصال
        </Button>
        <Button type="link" block className="!mt-2" onClick={() => setStep(0)}>
          بازگشت
        </Button>
      </Form>
    );
  }

  return (
    <AuthLayout title="خوش آمدید" subtitle="سیراف روی این رایانه نصب شد. چطور شروع می‌کنید؟">
      <Steps size="small" current={step} className="!mb-6" items={[{ title: "روش شروع" }, { title: mode === "cloud" ? "حساب ابری" : mode === "client" ? "سرور شبکه" : "حساب مدیر" }, { title: "کسب‌وکار" }]} />
      {body}
    </AuthLayout>
  );
}

export { Result };

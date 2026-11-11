import { Form, Input, Button, Segmented } from "antd";
import { Mail, Lock, Eye, EyeOff, UserRound, MonitorCheck } from "lucide-react";
import { Link, useSearchParams, Navigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText, ApiError } from "../../lib/api";
import { useSession } from "../../lib/session";
import { AuthLayout } from "./AuthLayout";
import { FormAlert, ICON, useBlurValidation, LTR } from "../kit";
import { APP_NAME } from "@shared/constants";
import { preloadApp } from "../../lib/preload";

// antd wraps this in its own focusable span.ant-input-password-icon (role=button, aria-label), styled in pages.css
export const passwordIcon = (visible: boolean) => (visible ? <EyeOff {...ICON} aria-hidden /> : <Eye {...ICON} aria-hidden />);

/** The ways in the server offers (GET /api/auth/options): a domain account, Windows single sign-on, e-mail and password. */
interface AuthOptions {
  local: boolean;
  directory: { sources: { id: string; name: string; domains: string[] }[] } | null;
  sso: { source_id: string; mode: "negotiate" | "proxy"; auto: boolean } | null;
}

/** Automatic Windows sign-in is tried once per tab (signing out does not start it again). */
const AUTO_KEY = "itsm.sso.auto";
const triedAuto = () => {
  try {
    return sessionStorage.getItem(AUTO_KEY) === "1";
  } catch {
    return true;
  }
};
const markAuto = () => {
  try {
    sessionStorage.setItem(AUTO_KEY, "1");
  } catch {
    /* private mode */
  }
};

/** «ورود خودکار با حساب ویندوز»: the browser does the Negotiate handshake (or the IIS proxy does) on this request. */
async function windowsSignIn(sourceId: string | null): Promise<{ ok: boolean; message: string | null }> {
  try {
    const res = await fetch(`/api/auth/sso${sourceId ? `?source=${encodeURIComponent(sourceId)}` : ""}`, { credentials: "same-origin" });
    if (res.ok) return { ok: true, message: null };
    const data = await res.json().catch(() => null);
    return { ok: false, message: data?.error?.code === "negotiate" ? "این رایانه با حساب ویندوز شناخته نشد؛ با نام کاربری و گذرواژهٔ سازمانی وارد شوید." : data?.error?.message ?? null };
  } catch {
    return { ok: false, message: "ارتباط با سرور برقرار نشد؛ اتصال را بررسی کنید" };
  }
}

export default function Login() {
  const { refresh, meta, me } = useSession();
  const [sp] = useSearchParams();
  const dir = sp.get("dir");
  const next = sp.get("next") || "/";
  // the signed-in app's chunk loads while the form is filled in, so the first screen after sign-in does not wait for it
  useEffect(() => {
    const t = window.setTimeout(preloadApp, 300);
    return () => window.clearTimeout(t);
  }, []);
  const options = useQuery({ queryKey: ["auth-options", dir], queryFn: () => api.get<AuthOptions>("/auth/options", { dir }), retry: false, staleTime: 60_000 });
  const directory = options.data?.directory ?? null;
  const sso = options.data?.sso ?? null;
  const [way, setWay] = useState<"directory" | "local" | null>(null);
  const current = way ?? (directory ? "directory" : "local");
  const [err, setErr] = useState<string | null>(null);
  const [windows, setWindows] = useState<"idle" | "trying">("idle");
  const auto = useRef(false);

  // signed in: the session's `me` makes this page render <Navigate to={next}> below — one navigation only. A second,
  // imperative nav(next) right after it replaced the location again while «/» was already sending the person on to
  // their organisation (whose chunk loads lazily, src/ui/OrgArea.tsx): the app stayed on an empty «/» (desktop-e2e: a
  // member signing in after «خروج»)
  const finish = async () => {
    await refresh();
  };
  const tryWindows = async (silent: boolean) => {
    setWindows("trying");
    setErr(null);
    const r = await windowsSignIn(sso?.source_id ?? dir);
    setWindows("idle");
    if (r.ok) return finish();
    if (!silent && r.message) setErr(r.message);
  };
  useEffect(() => {
    if (!sso?.auto || auto.current || me || triedAuto()) return;
    auto.current = true;
    markAuto();
    void tryWindows(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sso?.auto, me]);

  if (meta?.first_run) return <Navigate to="/setup" replace />;
  if (me) return <Navigate to={next} replace />;
  const canSignup = !!meta?.allow_signup && meta.mode === "cloud" && !directory;
  const sources = directory?.sources ?? [];
  const example = sources[0]?.domains.find((d) => !d.includes(".")) ?? "CORP";
  return (
    <AuthLayout title={`ورود به ${APP_NAME}`} subtitle={directory ? "با حساب سازمانی خود وارد شوید." : "با ایمیل و رمز عبورتان وارد شوید."}>
      {err ? <FormAlert>{err}</FormAlert> : null}
      {sso ? (
        <Button size="large" block icon={<MonitorCheck {...ICON} aria-hidden />} loading={windows === "trying"} onClick={() => tryWindows(false)} className="mb-4">
          {windows === "trying" ? "در حال ورود با حساب ویندوز…" : "ورود خودکار با حساب ویندوز"}
        </Button>
      ) : null}
      {directory ? (
        <Segmented
          block
          className="mb-4"
          value={current}
          onChange={(v) => {
            setWay(v as "directory" | "local");
            setErr(null);
          }}
          options={[
            { value: "directory", label: "حساب سازمانی" },
            { value: "local", label: "ایمیل و رمز عبور" },
          ]}
        />
      ) : null}
      {current === "directory" && directory ? (
        <DirectoryForm sourceId={dir ?? (sources.length === 1 ? sources[0].id : null)} example={example} onDone={finish} onError={setErr} />
      ) : (
        <LocalForm onDone={finish} onError={setErr} breakGlass={!!directory} />
      )}
      {canSignup ? (
        <p className="pg-alt">
          سازمان تازه دارید؟{" "}
          <Link to="/signup" className="ds-link">
            ساخت حساب
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  );
}

/** «ورود با حساب سازمانی»: ali, CORP\ali or ali@corp.example and the domain password. */
function DirectoryForm({ sourceId, example, onDone, onError }: { sourceId: string | null; example: string; onDone: () => Promise<void>; onError: (m: string | null) => void }) {
  const [form] = Form.useForm();
  const onValuesChange = useBlurValidation(form);
  const [busy, setBusy] = useState(false);
  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      validateTrigger="onBlur"
      className="pg-form"
      onValuesChange={(c) => {
        onError(null);
        onValuesChange(c);
      }}
      onFinish={async (v) => {
        setBusy(true);
        onError(null);
        try {
          await api.post("/auth/directory", { login: v.login, password: v.password, ...(sourceId ? { source: sourceId } : {}) });
          await onDone();
        } catch (e) {
          // a refused sign-in under the password field (never naming which part was wrong); the server's state above the form
          if (e instanceof ApiError && [400, 401, 403, 429].includes(e.status)) form.setFields([{ name: "password", errors: [errorText(e)] }]);
          else onError(errorText(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Form.Item name="login" label="نام کاربری" rules={[{ required: true, message: "نام کاربری را وارد کنید." }]} extra={<bdi dir="ltr" className="ds-latin">{`ali · ${example}\\ali · ali@${example.toLowerCase()}.example`}</bdi>}>
        <Input size="large" classNames={LTR} prefix={<UserRound {...ICON} aria-hidden />} autoComplete="username" autoFocus spellCheck={false} placeholder={`${example}\\ali`} />
      </Form.Item>
      <Form.Item name="password" label="گذرواژهٔ سازمانی" rules={[{ required: true, message: "گذرواژه را وارد کنید." }]}>
        <Input.Password size="large" classNames={LTR} prefix={<Lock {...ICON} aria-hidden />} autoComplete="current-password" iconRender={passwordIcon} />
      </Form.Item>
      <div className="pg-actions">
        <Button type="primary" size="large" htmlType="submit" block loading={busy}>
          {busy ? "در حال ورود…" : "ورود"}
        </Button>
      </div>
    </Form>
  );
}

/** E-mail and password: everyone, or only break-glass accounts once the organisation closed local sign-in. */
function LocalForm({ onDone, onError, breakGlass }: { onDone: () => Promise<void>; onError: (m: string | null) => void; breakGlass: boolean }) {
  const [form] = Form.useForm();
  const onValuesChange = useBlurValidation(form);
  const [busy, setBusy] = useState(false);
  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      validateTrigger="onBlur"
      className="pg-form"
      onValuesChange={(c) => {
        onError(null);
        onValuesChange(c);
      }}
      onFinish={async (v) => {
        setBusy(true);
        onError(null);
        try {
          await api.post("/auth/login", v);
          await onDone();
        } catch (e) {
          // wrong credentials, a disabled account or too many tries: under the password field, never naming which part was wrong
          if (e instanceof ApiError && [400, 401, 403, 429].includes(e.status)) form.setFields([{ name: "password", errors: [errorText(e)] }]);
          else onError(errorText(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Form.Item
        name="email"
        label="ایمیل"
        extra={breakGlass ? "برای حساب‌های محلی و ورود اضطراری مدیران" : undefined}
        rules={[
          { required: true, message: "ایمیل را وارد کنید." },
          { type: "email", message: "این ایمیل درست نیست." },
        ]}
      >
        <Input size="large" classNames={LTR} inputMode="email" prefix={<Mail {...ICON} aria-hidden />} autoComplete="username" autoFocus={!breakGlass} spellCheck={false} placeholder="name@example.com" />
      </Form.Item>
      <Form.Item
        name="password"
        label={
          <span className="pg-lbl">
            <span>رمز عبور</span>
            <Link to="/recover" className="ds-link">
              فراموش کرده‌اید؟
            </Link>
          </span>
        }
        rules={[{ required: true, message: "رمز عبور را وارد کنید." }]}
      >
        <Input.Password size="large" classNames={LTR} prefix={<Lock {...ICON} aria-hidden />} autoComplete="current-password" iconRender={passwordIcon} />
      </Form.Item>
      <div className="pg-actions">
        <Button type="primary" size="large" htmlType="submit" block loading={busy}>
          {busy ? "در حال ورود…" : "ورود"}
        </Button>
      </div>
    </Form>
  );
}

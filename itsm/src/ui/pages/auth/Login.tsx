import { Form, Input, Button } from "antd";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { Link, useNavigate, useSearchParams, Navigate } from "react-router";
import { useState } from "react";
import { api, errorText, ApiError } from "../../lib/api";
import { useSession } from "../../lib/session";
import { AuthLayout } from "./AuthLayout";
import { FormAlert, ICON, useBlurValidation, LTR } from "../kit";
import { APP_NAME } from "@shared/constants";

// antd wraps this in its own focusable span.ant-input-password-icon (role=button, aria-label), styled in pages.css
export const passwordIcon = (visible: boolean) => (visible ? <EyeOff {...ICON} aria-hidden /> : <Eye {...ICON} aria-hidden />);

export default function Login() {
  const { refresh, meta, me } = useSession();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [form] = Form.useForm();
  const onValuesChange = useBlurValidation(form);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (meta?.first_run) return <Navigate to="/setup" replace />;
  if (me) return <Navigate to={sp.get("next") || "/"} replace />;
  const canSignup = !!meta?.allow_signup && meta.mode === "cloud";
  return (
    <AuthLayout title={`ورود به ${APP_NAME}`} subtitle="با ایمیل و رمز عبورتان وارد شوید.">
      {err ? <FormAlert>{err}</FormAlert> : null}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        validateTrigger="onBlur"
        className="pg-form"
        onValuesChange={(c) => {
          if (err) setErr(null);
          onValuesChange(c);
        }}
        onFinish={async (v) => {
          setBusy(true);
          setErr(null);
          try {
            await api.post("/auth/login", v);
            await refresh();
            nav(sp.get("next") || "/", { replace: true });
          } catch (e) {
            // wrong credentials, a disabled account or too many tries: under the password field, never naming which part was wrong
            if (e instanceof ApiError && [400, 401, 403, 429].includes(e.status)) form.setFields([{ name: "password", errors: [errorText(e)] }]);
            else setErr(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Item
          name="email"
          label="ایمیل"
          rules={[
            { required: true, message: "ایمیل را وارد کنید." },
            { type: "email", message: "این ایمیل درست نیست." },
          ]}
        >
          <Input size="large" classNames={LTR} inputMode="email" prefix={<Mail {...ICON} aria-hidden />} autoComplete="username" autoFocus spellCheck={false} placeholder="name@example.com" />
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

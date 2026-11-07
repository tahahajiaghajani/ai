import { Form, Input, Button } from "antd";
import { Mail, Lock, UserRound, Smartphone } from "lucide-react";
import { Link, useNavigate, Navigate } from "react-router";
import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { useSession } from "../../lib/session";
import { AuthLayout } from "./AuthLayout";
import { RecoveryCode } from "./RecoveryCode";
import { passwordIcon } from "./Login";
import { FormAlert, ICON, PasswordRules, newPasswordRules, useBlurValidation, LTR } from "../kit";

/** The account form (sign-up on the web, the first admin on Windows). Calls onDone with the recovery code. */
export function SignupForm({ onDone, submitText = "ساخت حساب", busyText = "در حال ساخت حساب…", extraActions }: { onDone: (code: string) => void; submitText?: string; busyText?: string; extraActions?: React.ReactNode }) {
  const [form] = Form.useForm();
  const onValuesChange = useBlurValidation(form);
  const password = Form.useWatch("password", form) as string | undefined;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {err ? <FormAlert>{err}</FormAlert> : null}
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
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
            const r = await api.post<{ recovery_code: string }>("/auth/signup", v);
            onDone(r.recovery_code);
          } catch (e) {
            setErr(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Item
          name="full_name"
          label="نام و نام خانوادگی"
          rules={[
            { required: true, whitespace: true, message: "نام را وارد کنید." },
            { min: 2, message: "نام را کامل وارد کنید." },
          ]}
        >
          <Input size="large" prefix={<UserRound {...ICON} aria-hidden />} autoComplete="name" autoFocus />
        </Form.Item>
        <Form.Item
          name="email"
          label="ایمیل"
          rules={[
            { required: true, message: "ایمیل را وارد کنید." },
            { type: "email", message: "این ایمیل درست نیست." },
          ]}
        >
          <Input size="large" classNames={LTR} inputMode="email" spellCheck={false} prefix={<Mail {...ICON} aria-hidden />} autoComplete="username" placeholder="name@example.com" />
        </Form.Item>
        <Form.Item name="mobile" label="شمارهٔ همراه" rules={[{ pattern: /^[+۰-۹0-9\s-]{7,20}$/, message: "شمارهٔ همراه درست نیست." }]}>
          <Input size="large" classNames={LTR} inputMode="tel" prefix={<Smartphone {...ICON} aria-hidden />} autoComplete="tel" placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹" />
        </Form.Item>
        <Form.Item
          name="password"
          label="رمز عبور"
          rules={newPasswordRules("رمز عبور را وارد کنید.")}
          extra={<PasswordRules value={password} />}
        >
          <Input.Password size="large" classNames={LTR} prefix={<Lock {...ICON} aria-hidden />} autoComplete="new-password" iconRender={passwordIcon} />
        </Form.Item>
        <div className="pg-actions">
          <Button type="primary" size="large" htmlType="submit" block loading={busy}>
            {busy ? busyText : submitText}
          </Button>
          {extraActions}
        </div>
      </Form>
    </>
  );
}

export default function Signup() {
  const { refresh, meta, me } = useSession();
  const nav = useNavigate();
  const [code, setCode] = useState<string | null>(null);
  if (me && !code) return <Navigate to="/" replace />;
  if (meta && !meta.allow_signup) return <Navigate to="/login" replace />;
  return (
    <AuthLayout
      swapKey={code ? "code" : "form"}
      title={code ? "حساب ساخته شد" : "ساخت حساب سیراف"}
      subtitle={code ? "پیش از ادامه، کد بازیابی را جای امنی نگه دارید." : "چند ثانیه بیشتر طول نمی‌کشد؛ بعد کسب‌وکارتان را تعریف می‌کنید."}
    >
      {code ? (
        <RecoveryCode
          code={code}
          onDone={async () => {
            await refresh();
            nav("/orgs/new", { replace: true });
          }}
        />
      ) : (
        <>
          <SignupForm onDone={setCode} />
          <p className="pg-alt">
            حساب دارید؟{" "}
            <Link to="/login" className="ds-link">
              وارد شوید
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}

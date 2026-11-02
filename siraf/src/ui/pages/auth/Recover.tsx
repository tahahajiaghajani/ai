import { Form, Input, Button } from "antd";
import { Link, useNavigate } from "react-router";
import { useState } from "react";
import { Mail, KeyRound, Lock, ArrowRight } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { toLatinDigits } from "../../lib/fa";
import { AuthLayout } from "./AuthLayout";
import { RecoveryCode } from "./RecoveryCode";
import { passwordIcon } from "./Login";
import { FormAlert, ICON, PasswordRules, newPasswordRules, useBlurValidation, LTR } from "../kit";

/** XXXX-XXXX-XXXX-XXXX as you type: Latin letters and digits only, upper case, grouped in fours. */
function formatCode(raw: string): string {
  const s = toLatinDigits(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
  return s.match(/.{1,4}/g)?.join("-") ?? "";
}

export default function Recover() {
  const nav = useNavigate();
  const [form] = Form.useForm();
  const onValuesChange = useBlurValidation(form);
  const password = Form.useWatch("next", form) as string | undefined;
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthLayout
      swapKey={code ? "code" : "form"}
      title={code ? "رمز تازه ثبت شد" : "بازیابی رمز عبور"}
      subtitle={code ? "این کد بازیابی تازهٔ شماست؛ کد قبلی دیگر کار نمی‌کند." : "با کد بازیابی‌ای که هنگام ساخت حساب گرفتید، رمز تازه بگذارید."}
      back={
        code ? null : (
          <Link to="/login" className="pg-back">
            <ArrowRight {...ICON} aria-hidden />
            بازگشت به ورود
          </Link>
        )
      }
    >
      {code ? (
        <RecoveryCode code={code} onDone={() => nav("/login")} />
      ) : (
        <>
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
                const r = await api.post<{ recovery_code: string }>("/auth/recover", v);
                setCode(r.recovery_code);
              } catch (e) {
                setErr(errorText(e));
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
              <Input size="large" classNames={LTR} inputMode="email" spellCheck={false} prefix={<Mail {...ICON} aria-hidden />} autoComplete="username" autoFocus placeholder="name@example.com" />
            </Form.Item>
            <Form.Item
              name="code"
              label="کد بازیابی"
              getValueFromEvent={(e: React.ChangeEvent<HTMLInputElement>) => formatCode(e.target.value)}
              rules={[
                { required: true, message: "کد بازیابی را وارد کنید." },
                { pattern: /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/, message: "کد بازیابی ۱۶ نویسه است." },
              ]}
            >
              <Input size="large" className="sf-code" prefix={<KeyRound {...ICON} aria-hidden />} autoComplete="one-time-code" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX" maxLength={19} />
            </Form.Item>
            <Form.Item
              name="next"
              label="رمز عبور تازه"
              rules={newPasswordRules("رمز تازه را وارد کنید.")}
              extra={<PasswordRules value={password} />}
            >
              <Input.Password size="large" classNames={LTR} prefix={<Lock {...ICON} aria-hidden />} autoComplete="new-password" iconRender={passwordIcon} />
            </Form.Item>
            <div className="pg-actions">
              <Button type="primary" size="large" htmlType="submit" block loading={busy}>
                {busy ? "در حال ثبت…" : "ثبت رمز تازه"}
              </Button>
            </div>
          </Form>
          <p className="pg-note">کاربرِ یک کسب‌وکار هستید و کد را ندارید؟ مدیر می‌تواند رمزتان را از «تنظیمات ← کاربران» تازه کند.</p>
        </>
      )}
    </AuthLayout>
  );
}

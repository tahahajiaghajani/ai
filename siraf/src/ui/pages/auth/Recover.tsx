import { Form, Input, Button, Alert } from "antd";
import { Link, useNavigate } from "react-router";
import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { AuthLayout } from "./AuthLayout";
import { RecoveryCode } from "./RecoveryCode";

export default function Recover() {
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthLayout title="بازیابی رمز عبور" subtitle={code ? undefined : "کد بازیابی‌ای که هنگام ساخت حساب گرفتید را وارد کنید. کاربرانِ یک کسب‌وکار می‌توانند از مدیر بخواهند رمزشان را از «تنظیمات ← کاربران» تازه کند."}>
      {code ? (
        <>
          <Alert type="success" showIcon className="!mb-4" title="رمز تازه ثبت شد. این کد بازیابی جدید شماست:" />
          <RecoveryCode code={code} onDone={() => nav("/login")} />
        </>
      ) : (
        <>
          {err ? <Alert type="error" showIcon className="!mb-4" title={err} /> : null}
          <Form
            layout="vertical"
            requiredMark={false}
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
            <Form.Item name="email" label="ایمیل" rules={[{ required: true, type: "email", message: "ایمیل معتبر وارد کنید" }]}>
              <Input size="large" dir="ltr" />
            </Form.Item>
            <Form.Item name="code" label="کد بازیابی" rules={[{ required: true, message: "کد را وارد کنید" }]}>
              <Input size="large" dir="ltr" className="font-mono" placeholder="XXXX-XXXX-XXXX-XXXX" />
            </Form.Item>
            <Form.Item name="next" label="رمز عبور تازه" rules={[{ required: true, min: 8, message: "دست‌کم ۸ نویسه" }]}>
              <Input.Password size="large" dir="ltr" />
            </Form.Item>
            <Button type="primary" size="large" htmlType="submit" block loading={busy}>
              ثبت رمز تازه
            </Button>
          </Form>
          <div className="mt-5 text-center text-sm">
            <Link to="/login">بازگشت به ورود</Link>
          </div>
        </>
      )}
    </AuthLayout>
  );
}

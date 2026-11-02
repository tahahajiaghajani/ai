import { Form, Input, Button, Alert } from "antd";
import { Link, useNavigate, Navigate } from "react-router";
import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { useSession } from "../../lib/session";
import { AuthLayout } from "./AuthLayout";
import { RecoveryCode } from "./RecoveryCode";

export function SignupForm({ onDone, submitText = "ساخت حساب" }: { onDone: (code: string) => void; submitText?: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {err ? <Alert type="error" showIcon className="!mb-4" title={err} /> : null}
      <Form
        layout="vertical"
        requiredMark={false}
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
        <Form.Item name="full_name" label="نام و نام خانوادگی" rules={[{ required: true, message: "نام را وارد کنید" }]}>
          <Input size="large" autoFocus />
        </Form.Item>
        <Form.Item name="email" label="ایمیل" rules={[{ required: true, type: "email", message: "ایمیل معتبر وارد کنید" }]}>
          <Input size="large" dir="ltr" autoComplete="username" />
        </Form.Item>
        <Form.Item name="mobile" label="موبایل (اختیاری)">
          <Input size="large" dir="ltr" />
        </Form.Item>
        <Form.Item name="password" label="رمز عبور" rules={[{ required: true, min: 8, message: "رمز دست‌کم ۸ نویسه" }]} extra="دست‌کم ۸ نویسه، ترکیبی از حرف و عدد">
          <Input.Password size="large" dir="ltr" autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" size="large" htmlType="submit" block loading={busy}>
          {submitText}
        </Button>
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
    <AuthLayout title={code ? "حساب ساخته شد" : "ساخت حساب سیراف"} subtitle={code ? undefined : "چند ثانیه بیشتر طول نمی‌کشد. بعد از آن کسب‌وکارتان را تعریف می‌کنید."}>
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
          <div className="mt-5 text-center text-sm">
            حساب دارید؟ <Link to="/login">وارد شوید</Link>
          </div>
        </>
      )}
    </AuthLayout>
  );
}

import { Form, Input, Button, Alert } from "antd";
import { MailOutlined, LockOutlined } from "@ant-design/icons";
import { Link, useNavigate, useSearchParams, Navigate } from "react-router";
import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { useSession } from "../../lib/session";
import { AuthLayout } from "./AuthLayout";

export default function Login() {
  const { refresh, meta, me } = useSession();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (meta?.first_run) return <Navigate to="/setup" replace />;
  if (me) return <Navigate to={sp.get("next") || "/"} replace />;
  return (
    <AuthLayout title="ورود به سیراف" subtitle="با ایمیل و رمز عبور حساب خود وارد شوید.">
      {err ? <Alert type="error" showIcon className="!mb-4" title={err} /> : null}
      <Form
        layout="vertical"
        requiredMark={false}
        onFinish={async (v) => {
          setBusy(true);
          setErr(null);
          try {
            await api.post("/auth/login", v);
            await refresh();
            nav(sp.get("next") || "/", { replace: true });
          } catch (e) {
            setErr(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Item name="email" label="ایمیل" rules={[{ required: true, message: "ایمیل را وارد کنید" }]}>
          <Input size="large" dir="ltr" prefix={<MailOutlined className="text-muted" />} autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item name="password" label="رمز عبور" rules={[{ required: true, message: "رمز عبور را وارد کنید" }]}>
          <Input.Password size="large" dir="ltr" prefix={<LockOutlined className="text-muted" />} autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" size="large" htmlType="submit" block loading={busy}>
          ورود
        </Button>
      </Form>
      <div className="mt-5 flex justify-between text-sm">
        <Link to="/recover">رمز را فراموش کرده‌ام</Link>
        {meta?.allow_signup && meta.mode === "cloud" ? <Link to="/signup">ساخت حساب تازه</Link> : null}
      </div>
    </AuthLayout>
  );
}

// «تأیید دوبارهٔ هویت»: sensitive administration (the sign-in policy, directory sign-in settings, roles, other people's
// sessions, passwords) asks for the password again once the sign-in is older than the organisation allows. The API
// client hands the refused request here (setReauthHandler); a confirmed identity sends it once more. A session opened
// with Windows may confirm with Windows again.
import { useEffect, useRef, useState } from "react";
import { Button, Form, Input, Modal } from "antd";
import { Lock, MonitorCheck, ShieldCheck } from "lucide-react";
import { api, errorText, setReauthHandler } from "../../lib/api";
import { FormAlert, ICON, LTR } from "../kit";
import { passwordIcon } from "./Login";

interface Pending {
  method: string;
  resolve: (ok: boolean) => void;
}

export function ReauthGate() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form] = Form.useForm();
  const current = useRef<Pending | null>(null);

  useEffect(() => {
    setReauthHandler(
      (details) =>
        new Promise<boolean>((resolve) => {
          // one dialog at a time: a second refused request waits for the same answer
          if (current.current) {
            const prev = current.current.resolve;
            current.current.resolve = (ok) => {
              prev(ok);
              resolve(ok);
            };
            return;
          }
          const method = String((details as { method?: string } | null)?.method ?? "password");
          const p: Pending = { method, resolve };
          current.current = p;
          setErr(null);
          form.resetFields();
          setPending(p);
        }),
    );
    return () => setReauthHandler(null);
  }, [form]);

  const close = (ok: boolean) => {
    const p = current.current;
    current.current = null;
    setPending(null);
    setBusy(false);
    p?.resolve(ok);
  };

  const confirm = async (password: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/auth/reauth", { password });
      close(true);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  };

  const windows = async () => {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/auth/sso?reauth=1", { credentials: "same-origin", headers: { "x-itsm-reauth": "1" } }).catch(() => null);
    if (res?.ok) return close(true);
    const data = res ? await res.json().catch(() => null) : null;
    setErr(data?.error?.message ?? "تأیید با حساب ویندوز انجام نشد؛ گذرواژه را وارد کنید");
    setBusy(false);
  };

  const directory = pending?.method === "ldap" || pending?.method === "sso" || pending?.method === "proxy";
  return (
    <Modal
      open={!!pending}
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck {...ICON} aria-hidden />
          تأیید دوبارهٔ هویت
        </span>
      }
      onCancel={() => close(false)}
      footer={null}
      destroyOnHidden
      width={420}
    >
      <p className="mb-3">برای این کار مدیریتی، {directory ? "گذرواژهٔ حساب سازمانی" : "رمز عبور"} خود را دوباره وارد کنید.</p>
      {err ? <FormAlert>{err}</FormAlert> : null}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => confirm(v.password)}>
        <Form.Item name="password" label={directory ? "گذرواژهٔ سازمانی" : "رمز عبور"} rules={[{ required: true, message: "گذرواژه را وارد کنید." }]}>
          <Input.Password classNames={LTR} prefix={<Lock {...ICON} aria-hidden />} autoComplete="current-password" autoFocus iconRender={passwordIcon} />
        </Form.Item>
        <div className="flex flex-wrap justify-end gap-2">
          {pending?.method === "sso" || pending?.method === "proxy" ? (
            <Button icon={<MonitorCheck {...ICON} aria-hidden />} onClick={windows} disabled={busy}>
              تأیید با حساب ویندوز
            </Button>
          ) : null}
          <Button onClick={() => close(false)}>انصراف</Button>
          <Button type="primary" htmlType="submit" loading={busy}>
            تأیید
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

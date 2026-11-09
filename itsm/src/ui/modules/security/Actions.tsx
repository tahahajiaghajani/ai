// Header actions of the security module's record pages: on a security incident «نشانگرها», «ساعت الزامی» and
// «دستورالعمل»; on an IT incident «ارتقا به رخداد امنیتی» (or the link to it, for those who read it); on incidents and
// requested items «احراز هویت تماس‌گیرنده» (a one-time code to the person, read back on the phone); on a remediation
// group «ثبت تغییر رفع». Each shows only to those the server would let do it.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Dropdown, Input, Modal, Popconfirm, Select, Space } from "antd";
import { FingerprintPattern, AlarmClock, BookOpenCheck, ShieldAlert, BadgeCheck, GitPullRequestArrow, WandSparkles } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { ICON14 } from "../../components/blocks";
import { recordsApi, recordPath, UserSelect, DateTimeInput, type RecordContext } from "../../records";
import { SEC_KEYS, securityApi } from "./api";

export function SirActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, timezone } = useOrg();
  const [obs, setObs] = useState(false);
  const [clock, setClock] = useState(false);
  const [values, setValues] = useState("");
  const [ioc, setIoc] = useState(false);
  const [regime, setRegime] = useState<string | null>(null);
  const [aware, setAware] = useState<string | null>(null);
  const done = () => ctx.refresh();
  const regimes = useQuery({ queryKey: SEC_KEYS.regimes(orgId, ctx.row.id), queryFn: () => securityApi.regimes(api, ctx.row.id), enabled: clock });
  const playbooks = useQuery({ queryKey: ["security", orgId, "playbooks"], queryFn: () => recordsApi.list(api, "sec_playbook", { filter: { f: "active", op: "eq", v: true }, size: 50, fields: ["name", "category"] }), staleTime: 300_000 });
  const add = useAction(() => securityApi.addObservables(api, ctx.row.id, values.split(/[\n,،\s]+/).map((v) => v.trim()).filter(Boolean), { is_ioc: ioc }), {
    success: (d) => `${d.added.toLocaleString("fa-IR")} نشانگر افزوده شد.`,
    onSuccess: () => {
      setObs(false);
      setValues("");
      done();
    },
  });
  const extract = useAction(() => securityApi.extractObservables(api, ctx.row.id), { success: (d) => (d.added ? `${d.added.toLocaleString("fa-IR")} نشانگر از شرح پیدا شد.` : "نشانگری در شرح پیدا نشد."), onSuccess: done });
  const start = useAction(() => securityApi.startClock(api, ctx.row.id, regime!, aware), {
    success: "ساعت اطلاع‌رسانی الزامی شروع شد.",
    onSuccess: () => {
      setClock(false);
      done();
    },
  });
  const playbook = useAction((id: string) => securityApi.playbook(api, ctx.row.id, id), { success: "کارهای دستورالعمل افزوده شد.", onSuccess: done });
  if (!ctx.meta.canWrite || ctx.meta.locked) return null;
  return (
    <>
      <Dropdown
        menu={{
          items: [
            { key: "add", icon: <FingerprintPattern {...ICON14} />, label: "افزودن نشانگر", onClick: () => setObs(true) },
            { key: "extract", icon: <WandSparkles {...ICON14} />, label: "استخراج نشانگر از شرح", onClick: () => extract.mutate(undefined) },
            { key: "clock", icon: <AlarmClock {...ICON14} />, label: "شروع ساعت اطلاع‌رسانی الزامی", onClick: () => setClock(true) },
            ...(playbooks.data?.rows.length
              ? [{ key: "pb", icon: <BookOpenCheck {...ICON14} />, label: "افزودن دستورالعمل", children: playbooks.data.rows.map((p) => ({ key: `pb:${p.id}`, label: String(p.name), onClick: () => playbook.mutate(String(p.id)) })) }]
              : []),
          ],
        }}
      >
        <Button icon={<ShieldAlert {...ICON14} />} loading={extract.isPending || playbook.isPending}>
          پاسخ
        </Button>
      </Dropdown>
      <Modal title="افزودن نشانگر" open={obs} onCancel={() => setObs(false)} onOk={() => add.mutate(undefined)} okText="افزودن" cancelText="انصراف" confirmLoading={add.isPending} okButtonProps={{ disabled: !values.trim() }} destroyOnHidden>
        <Space direction="vertical" className="w-full">
          <Input.TextArea dir="ltr" rows={5} value={values} onChange={(e) => setValues(e.target.value)} placeholder={"203.0.113.7\nhxxp://evil[.]example/login\n44d88612fea8a8f36de82e1278abb02f"} aria-label="نشانگرها، هر کدام در یک سطر" />
          <Checkbox checked={ioc} onChange={(e) => setIoc(e.target.checked)}>
            نشانگر تهدید (IOC) هم هست
          </Checkbox>
        </Space>
      </Modal>
      <Modal title="شروع ساعت اطلاع‌رسانی الزامی" open={clock} onCancel={() => setClock(false)} onOk={() => start.mutate(undefined)} okText="شروع" cancelText="انصراف" confirmLoading={start.isPending} okButtonProps={{ disabled: !regime }} destroyOnHidden>
        <Space direction="vertical" className="w-full">
          <Select
            className="w-full"
            placeholder="مقررات"
            loading={regimes.isLoading}
            value={regime ?? undefined}
            onChange={setRegime}
            options={(regimes.data?.regimes ?? []).map((r) => ({ value: r.id, label: `${r.name}${r.placeholder ? " (نیازمند تطبیق)" : ""} — ${r.stages.map((s) => `${s.label} ${s.hours.toLocaleString("fa-IR")} ساعت`).join("، ")}` }))}
          />
          <div>
            <div className="mb-1 text-[13px] text-ink-2">لحظهٔ آگاهی (خالی: زمان کشف)</div>
            <DateTimeInput value={aware} onChange={(v: string | null) => setAware(v)} tz={timezone} allowClear />
          </div>
        </Space>
      </Modal>
    </>
  );
}

export function PromoteAction({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: SEC_KEYS.promoted(orgId, ctx.row.id), queryFn: () => securityApi.promoted(api, ctx.row.id), staleTime: 60_000 });
  const promote = useAction(() => securityApi.promote(api, ctx.row.id), { success: (d) => `رخداد امنیتی ${d.number ?? ""} ${d.created ? "ساخته شد" : "پیش‌تر ساخته شده بود"}.`, onSuccess: (d) => nav(`/${orgId}/${recordPath("sec_incident", d.id)}`) });
  if (q.data?.sir) {
    return (
      <Button icon={<ShieldAlert {...ICON14} />} onClick={() => nav(`/${orgId}/${recordPath("sec_incident", q.data!.sir!.id)}`)}>
        <bdi className="ds-num">{q.data.sir.number}</bdi>
      </Button>
    );
  }
  if (!q.data?.can_promote) return null;
  return (
    <Popconfirm title="یک رخداد امنیتی از این رخداد ساخته و به تیم امنیت سپرده شود؟" okText="ارتقا" cancelText="انصراف" onConfirm={() => promote.mutate(undefined)}>
      <Button icon={<ShieldAlert {...ICON14} />} loading={promote.isPending}>
        ارتقا به رخداد امنیتی
      </Button>
    </Popconfirm>
  );
}

export function VerifyAction({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [channel, setChannel] = useState("in_app");
  const [code, setCode] = useState("");
  const [vid, setVid] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const person = (ctx.row.requested_for || ctx.row.caller_id || ctx.row.requested_by || null) as string | null;
  const send = useAction(() => securityApi.startVerify(api, { table: ctx.table, id: ctx.row.id, user_id: (user ?? person)!, channel }), {
    success: "رمز یک‌بارمصرف فرستاده شد؛ آن را از فرد بپرسید.",
    onSuccess: (d) => {
      setVid(d.id);
      setStatus(d.status);
    },
  });
  const check = useAction(() => securityApi.checkVerify(api, vid!, code), {
    success: (d) => (d.status === "verified" ? "هویت فرد تأیید شد." : d.status === "pending" ? "رمز درست نیست؛ دوباره بپرسید." : "هویت تأیید نشد."),
    onSuccess: (d) => {
      setStatus(d.status);
      if (d.status !== "pending") ctx.refresh();
    },
  });
  if (!ctx.meta.canWrite || ctx.meta.locked) return null;
  const close = () => {
    setOpen(false);
    setVid(null);
    setStatus(null);
    setCode("");
  };
  return (
    <>
      <Button icon={<BadgeCheck {...ICON14} />} onClick={() => setOpen(true)}>
        احراز هویت
      </Button>
      <Modal title="احراز هویت تماس‌گیرنده" open={open} onCancel={close} footer={null} destroyOnHidden>
        {!vid ? (
          <Space direction="vertical" className="w-full">
            <UserSelect value={user ?? person} onChange={(v) => setUser(typeof v === "string" ? v : null)} display={ctx.display} />
            <Select className="w-full" value={channel} onChange={setChannel} options={[{ value: "in_app", label: "اعلان درون‌برنامه" }, { value: "email", label: "رایانامه" }, { value: "sms", label: "پیامک" }]} />
            <Button type="primary" block onClick={() => send.mutate(undefined)} loading={send.isPending} disabled={!(user ?? person)}>
              فرستادن رمز یک‌بارمصرف
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" className="w-full">
            <Input dir="ltr" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="۶ رقم" aria-label="رمزی که فرد خواند" disabled={status !== "pending"} />
            <Button type="primary" block onClick={() => check.mutate(undefined)} loading={check.isPending} disabled={status !== "pending" || code.replace(/\D/g, "").length < 6}>
              بررسی رمز
            </Button>
            {status && status !== "pending" ? <div className="text-[13px] text-ink-2">{status === "verified" ? "هویت تأیید شد و در یادداشت‌های رکورد ثبت شد." : "هویت تأیید نشد؛ این نتیجه هم ثبت شد."}</div> : null}
          </Space>
        )}
      </Modal>
    </>
  );
}

export function RemediationActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const change = useAction(() => securityApi.remediationChange(api, ctx.row.id), { success: (d) => `تغییر ${d.number ?? ""} ثبت شد.`, onSuccess: (d) => nav(`/${orgId}/${recordPath("change_request", d.change_id)}`) });
  if (!ctx.meta.canWrite || ctx.row.change_id || ctx.meta.locked) return null;
  return (
    <Popconfirm title="برای این گروه رفع یک درخواست تغییر ثبت شود؟" okText="ثبت تغییر" cancelText="انصراف" onConfirm={() => change.mutate(undefined)}>
      <Button icon={<GitPullRequestArrow {...ICON14} />} loading={change.isPending}>
        ثبت تغییر رفع
      </Button>
    </Popconfirm>
  );
}

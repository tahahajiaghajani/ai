// Record-page parts of DevOps:
//   ConnectionActions   on a connection: its webhook and gate URLs, «ساخت راز» (the secret shown once, then never
//                       again), a new URL key, and a signed test delivery
//   GateActions         on a pending gate: approve, reject or approve with an exception (release managers)
//   EventRetry          on a failed or ignored event: process it again
//   DevelopmentPanel    side panel «توسعه» on changes, releases, incidents, problems and known errors: commits, pull
//                       requests and builds that mention the record's number, and its deployments (DEV-004)
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Modal, Space, Typography } from "antd";
import { KeyRound, Link2, PlugZap, RotateCcw, Check, X, ShieldAlert } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Chip, JDateTime, Loader } from "../../components/display";
import { ICON, Note } from "../../components/blocks";
import { Link } from "react-router";
import { recordPath, type RecordContext } from "../../records";
import { DEVOPS_KEYS, devopsApi } from "./api";
import { DEPLOY_STATE_LABELS, deployTone, gateUrl, hookUrl, type Row } from "./model";

const origin = () => (typeof window !== "undefined" ? window.location.origin : "");

export function ConnectionActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const r = ctx.row as Row;
  const [secret, setSecret] = useState<string | null>(null);
  const make = useAction(() => devopsApi.secret(api, r.id), { onSuccess: (d) => { setSecret(d.secret); ctx.refresh(); } });
  const rotate = useAction(() => devopsApi.rotateKey(api, r.id), { success: "نشانی تازه ساخته شد؛ آن را در ابزار به‌روز کنید", onSuccess: () => ctx.refresh() });
  const test = useAction(() => devopsApi.test(api, r.id), { success: (d) => (d.ok ? "اتصال سالم است: رویداد آزمایشی پردازش شد" : `آزمایش ناموفق: ${d.message ?? d.status ?? ""}`), onSuccess: () => ctx.refresh() });
  const hasSecret = !!(r.secret && typeof r.secret === "object");
  return (
    <Space wrap>
      <Button icon={<KeyRound {...ICON} />} onClick={() => make.mutate(undefined)} loading={make.isPending}>
        {hasSecret ? "چرخش راز" : "ساخت راز"}
      </Button>
      <Button icon={<Link2 {...ICON} />} onClick={() => rotate.mutate(undefined)} loading={rotate.isPending}>
        نشانی تازه
      </Button>
      <Button icon={<PlugZap {...ICON} />} onClick={() => test.mutate(undefined)} loading={test.isPending} disabled={!hasSecret}>
        آزمایش اتصال
      </Button>
      <Modal open={!!secret} title="راز امضای اتصال" onCancel={() => setSecret(null)} footer={<Button type="primary" onClick={() => setSecret(null)}>رونوشت گرفتم</Button>} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <Note tone="warning">این راز فقط همین یک بار نمایش داده می‌شود؛ آن را در تنظیمات وب‌هوک ابزار وارد کنید.</Note>
          <Typography.Paragraph copyable={{ text: secret ?? "" }} className="ltr ds-mono m-0 break-all">{secret}</Typography.Paragraph>
          <div className="text-[13px] text-ink-2">نشانی وب‌هوک:</div>
          <Typography.Paragraph copyable className="ltr ds-mono m-0 break-all text-[12px]">{hookUrl(origin(), String(r.hook_key ?? ""))}</Typography.Paragraph>
          <div className="text-[13px] text-ink-2">نشانی دروازهٔ استقرار:</div>
          <Typography.Paragraph copyable className="ltr ds-mono m-0 break-all text-[12px]">{gateUrl(origin(), String(r.hook_key ?? ""))}</Typography.Paragraph>
        </div>
      </Modal>
    </Space>
  );
}

/** The connection's URLs as a side panel (copyable). */
export function ConnectionUrls({ ctx }: { ctx: RecordContext }) {
  const r = ctx.row as Row;
  if (!r.hook_key) return null;
  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <span className="text-ink-2">وب‌هوک (امضا با HMAC-SHA256 در سرآیند X-Hub-Signature-256 یا X-Signature-256):</span>
      <Typography.Paragraph copyable className="ltr ds-mono m-0 break-all">{hookUrl(origin(), String(r.hook_key))}</Typography.Paragraph>
      <span className="text-ink-2">دروازهٔ استقرار:</span>
      <Typography.Paragraph copyable className="ltr ds-mono m-0 break-all">{gateUrl(origin(), String(r.hook_key))}</Typography.Paragraph>
      {!(r.secret && typeof r.secret === "object") ? <Note tone="warning">هنوز رازی ساخته نشده است؛ رویدادها پذیرفته نمی‌شوند.</Note> : null}
    </div>
  );
}

export function GateActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const r = ctx.row as Row;
  const meta = (ctx.meta.deployment ?? ctx.meta.release ?? {}) as { manages?: boolean };
  const [mode, setMode] = useState<"rejected" | "overridden" | null>(null);
  const [reason, setReason] = useState("");
  const decide = useAction((v: { decision: string; reason?: string }) => devopsApi.decideGate(api, r.id, v.decision, v.reason), { success: "تصمیم دروازه ثبت شد", onSuccess: () => { setMode(null); setReason(""); ctx.refresh(); } });
  if (!["pending", "rejected"].includes(String(r.state)) || meta.manages === false) return null;
  return (
    <Space wrap>
      {r.state === "pending" ? (
        <>
          <Button type="primary" icon={<Check {...ICON} />} onClick={() => decide.mutate({ decision: "approved" })} loading={decide.isPending}>مجاز است</Button>
          <Button icon={<X {...ICON} />} onClick={() => setMode("rejected")}>رد</Button>
        </>
      ) : null}
      <Button icon={<ShieldAlert {...ICON} />} onClick={() => setMode("overridden")}>مجاز با استثنا</Button>
      <Modal open={!!mode} title={mode === "rejected" ? "رد استقرار" : "مجوز با استثنا"} okText="ثبت" cancelText="انصراف" okButtonProps={{ disabled: reason.trim().length < 3, loading: decide.isPending, danger: mode === "rejected" }} onOk={() => mode && decide.mutate({ decision: mode, reason })} onCancel={() => setMode(null)} destroyOnHidden>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل" maxLength={2000} autoFocus aria-label="دلیل" />
      </Modal>
    </Space>
  );
}

export function EventRetry({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const r = ctx.row as Row;
  const retry = useAction(() => devopsApi.retry(api, r.id), { success: (d) => (d.status === "processed" ? "رویداد دوباره پردازش شد" : `نتیجه: ${d.message ?? d.status}`), onSuccess: () => ctx.refresh() });
  if (!["failed", "ignored"].includes(String(r.status))) return null;
  return <Button icon={<RotateCcw {...ICON} />} onClick={() => retry.mutate(undefined)} loading={retry.isPending}>پردازش دوباره</Button>;
}

export function DevelopmentPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: DEVOPS_KEYS.dev(orgId, ctx.table, ctx.row.id), queryFn: () => devopsApi.development(api, ctx.table, ctx.row.id) });
  if (q.isLoading) return <Loader />;
  const d = q.data;
  if (!d || (!d.commits.length && !d.pull_requests.length && !d.builds.length && !d.deployments.length)) {
    return <p className="text-[12px] text-ink-3">کامیت، درخواست ادغام یا استقراری با شمارهٔ {d?.number ?? "این رکورد"} پیدا نشد.</p>;
  }
  return (
    <div className="flex flex-col gap-3 text-[12px]">
      {d.pull_requests.length ? (
        <section aria-label="درخواست‌های ادغام">
          <h4 className="mb-1 text-ink-2">درخواست‌های ادغام</h4>
          <ul className="flex flex-col gap-1">
            {d.pull_requests.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5">
                <Chip tone={p.state === "merged" ? "accent" : p.state === "open" ? "in" : "neutral"}>{p.state === "merged" ? "ادغام‌شده" : p.state === "open" ? "باز" : "بسته"}</Chip>
                {p.url ? <a className="ds-link truncate" href={p.url} target="_blank" rel="noreferrer">#{p.pr_number} {p.title}</a> : <span className="truncate">#{p.pr_number} {p.title}</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {d.commits.length ? (
        <section aria-label="کامیت‌ها">
          <h4 className="mb-1 text-ink-2">کامیت‌ها</h4>
          <ul className="flex flex-col gap-1">
            {d.commits.slice(0, 8).map((c) => (
              <li key={c.id} className="flex flex-col">
                <span className="truncate">{c.url ? <a className="ds-link ltr ds-mono" href={c.url} target="_blank" rel="noreferrer">{String(c.sha).slice(0, 8)}</a> : <span className="ltr ds-mono">{String(c.sha).slice(0, 8)}</span>} {String(c.message ?? "").split("\n")[0]}</span>
                <span className="text-ink-3">{c.author_name ?? ""} {c.committed_at ? <JDateTime v={c.committed_at} /> : null}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {d.builds.length ? (
        <section aria-label="اجراهای خط لوله">
          <h4 className="mb-1 text-ink-2">اجراهای خط لوله</h4>
          <ul className="flex flex-col gap-1">
            {d.builds.slice(0, 6).map((b) => (
              <li key={b.id} className="flex items-center gap-1.5">
                <Chip tone={b.status === "succeeded" ? "in" : b.status === "failed" ? "danger" : "neutral"}>{b.status}</Chip>
                <span className="ltr">{b.run_number}</span>
                {b.branch ? <span className="ltr text-ink-3">{b.branch}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {d.deployments.length ? (
        <section aria-label="استقرارها">
          <h4 className="mb-1 text-ink-2">استقرارها</h4>
          <ul className="flex flex-col gap-1">
            {d.deployments.map((x) => (
              <li key={x.id} className="flex items-center gap-1.5">
                <Link className="ds-link" to={`/${orgId}/${recordPath("deployment", String(x.id))}`}>{x.number}</Link>
                <span>{d.display[String(x.environment_id)] ?? ""}</span>
                <Chip tone={deployTone(x.state)}>{DEPLOY_STATE_LABELS[String(x.state)] ?? String(x.state)}</Chip>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// Record-page parts and pages of customer service:
//   CaseActions      header actions of a customer case: «نمای ۳۶۰ مشتری», «ثبت رخداد داخلی» / «ثبت مشکل», and on a
//                    major case «پیام به همهٔ پرونده‌های وابسته»
//   AccountActions   «نمای ۳۶۰» on an account
//   NoticeSend       «ارسال» of an approved customer notice (with the evidence of who was told)
//   ReviewPack       «ساخت بستهٔ بازبینی» of a service review
//   ProactiveCases   «پرونده‌های پیش‌دستانه» on an incident (the accounts its CI serves)
//   NextCase         «پروندهٔ بعدی» on the case queues (assigns the best next case to the caller)
//   Dashboard        «داشبورد خدمات مشتریان»
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Dropdown, Input, Modal } from "antd";
import { AlertOctagon, ArrowLeftRight, BellRing, Megaphone, PackageOpen, Radar, ScanEye, Send } from "lucide-react";
import { toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader, StatCard } from "../../components/display";
import { Card, ICON } from "../../components/blocks";
import { recordPath, type RecordContext } from "../../records";
import { CSM_KEYS, csmApi } from "./api";
import type { Row } from "./model";

const csmMeta = (ctx: RecordContext) => ((ctx.meta as Row).csm ?? {}) as { can_work?: boolean; manages?: boolean };

export function CaseActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, allows } = useOrg();
  const nav = useNavigate();
  const r = ctx.row as Row;
  const [text, setText] = useState<string | null>(null);
  const raise = useAction((table: "incident" | "problem") => csmApi.raise(api, r.id, table), {
    success: (d) => `${d.number ?? ""} ثبت و به این پرونده پیوند شد`,
    onSuccess: () => ctx.refresh(),
  });
  const send = useAction(() => csmApi.broadcast(api, r.id, String(text ?? "")), { success: (d) => `پیام به ${toFa(d.sent)} پروندهٔ وابسته فرستاده شد`, onSuccess: () => { setText(null); ctx.refresh(); } });
  const work = !!csmMeta(ctx).can_work && !!r.active;
  return (
    <>
      {r.account_id ? <Button icon={<ScanEye {...ICON} />} onClick={() => nav(`/${orgId}/customers/accounts/${r.account_id}/360`)}>نمای ۳۶۰ مشتری</Button> : null}
      {work ? (
        <Dropdown
          menu={{
            items: [
              ...(allows({ area: "incident", op: "create" }) ? [{ key: "incident", label: "ثبت رخداد داخلی", icon: <AlertOctagon {...ICON} /> }] : []),
              ...(allows({ area: "problem", op: "create" }) ? [{ key: "problem", label: "ثبت مشکل", icon: <Radar {...ICON} /> }] : []),
            ],
            onClick: ({ key }) => raise.mutate(key as "incident" | "problem"),
          }}
          disabled={!allows({ area: "incident", op: "create" }) && !allows({ area: "problem", op: "create" })}
        >
          <Button icon={<ArrowLeftRight {...ICON} />} loading={raise.isPending}>ارجاع داخلی</Button>
        </Dropdown>
      ) : null}
      {work && r.is_major ? <Button icon={<Megaphone {...ICON} />} onClick={() => setText("")}>پیام به پرونده‌های وابسته</Button> : null}
      <Modal open={text !== null} title="یک پیام برای همهٔ پرونده‌های وابسته" okText="فرستادن" cancelText="انصراف" onCancel={() => setText(null)} onOk={() => send.mutate(undefined)} okButtonProps={{ disabled: !String(text ?? "").trim(), loading: send.isPending }} destroyOnHidden>
        <p className="mb-2 text-[12px] text-ink-3">این پیام به‌عنوان یادداشت عمومی در همین پرونده و هر پروندهٔ وابسته ثبت می‌شود و مشتریان آن را می‌بینند.</p>
        <Input.TextArea autoFocus autoSize={{ minRows: 3, maxRows: 10 }} value={text ?? ""} onChange={(e) => setText(e.target.value)} maxLength={20_000} aria-label="متن پیام" />
      </Modal>
    </>
  );
}

export function AccountActions({ ctx }: { ctx: RecordContext }) {
  const { orgId } = useOrg();
  const nav = useNavigate();
  return <Button icon={<ScanEye {...ICON} />} onClick={() => nav(`/${orgId}/customers/accounts/${ctx.row.id}/360`)}>نمای ۳۶۰</Button>;
}

export function NoticeSend({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const n = useNotify();
  const send = useAction(() => csmApi.sendNotice(api, ctx.row.id), { onSuccess: (d) => { n.ok(`اطلاع‌رسانی برای ${toFa(d.sent)} مخاطب فرستاده شد`); ctx.refresh(); } });
  if (ctx.row.state !== "approved") return null;
  return <Button type="primary" icon={<Send {...ICON} />} onClick={() => send.mutate(undefined)} loading={send.isPending}>ارسال</Button>;
}

export function ReviewPack({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const pack = useAction(() => csmApi.reviewPack(api, ctx.row.id), { success: "بستهٔ بازبینی ساخته شد", onSuccess: () => ctx.refresh() });
  if (["closed", "cancelled"].includes(String(ctx.row.state))) return null;
  return <Button icon={<PackageOpen {...ICON} />} onClick={() => pack.mutate(undefined)} loading={pack.isPending}>ساخت بستهٔ بازبینی</Button>;
}

export function ProactiveCases({ ctx }: { ctx: RecordContext }) {
  const { api, allows } = useOrg();
  const go = useAction(() => csmApi.proactive(api, ctx.row.id), {
    success: (d) => (d.created ? `${toFa(d.created)} پروندهٔ پیش‌دستانه برای ${toFa(d.accounts)} حساب ساخته شد` : d.accounts ? "همهٔ حساب‌های اثرپذیر پرونده دارند" : "حسابی از پیکربندی این رخداد استفاده نمی‌کند"),
    onSuccess: () => ctx.refresh(),
  });
  if (!allows({ area: "csm", op: "create" }) || !ctx.row.ci_id || !ctx.row.active) return null;
  return <Button icon={<BellRing {...ICON} />} onClick={() => go.mutate(undefined)} loading={go.isPending}>پرونده‌های پیش‌دستانه</Button>;
}

export function NextCase() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const next = useAction(() => csmApi.next(api), {
    onSuccess: (d) => {
      if (d.case) nav(`/${orgId}/${recordPath("customer_case", d.case.id)}`);
      else n.ok("پروندهٔ بی‌کارشناسی در گروه‌های شما نمانده است");
    },
  });
  return <Button type="primary" onClick={() => next.mutate(undefined)} loading={next.isPending}>پروندهٔ بعدی</Button>;
}

export function Dashboard() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: CSM_KEYS.dashboard(orgId), queryFn: () => csmApi.dashboard(api) });
  const meta = useQuery({ queryKey: CSM_KEYS.meta(orgId), queryFn: () => csmApi.meta(api) });
  const health = useAction(() => csmApi.refreshHealth(api), { success: (d) => `سلامت ${toFa(d.accounts)} حساب دوباره محاسبه شد` });
  const seed = useAction(() => csmApi.seed(api), { success: "نقش‌ها، گروه، توافق‌ها، اعلان‌ها و شاخص‌های خدمات مشتریان افزوده شد", invalidate: [CSM_KEYS.meta(orgId)] });
  const d = q.data;
  const bars = (rows: { key: string; label: string; count: number }[], display?: Record<string, string>) => {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows.length ? (
      <ul className="flex flex-col gap-1 text-[13px]">
        {rows.slice(0, 8).map((r) => (
          <li key={String(r.key)} className="grid grid-cols-[minmax(7rem,40%)_1fr_auto] items-center gap-2">
            <span className="truncate">{display?.[String(r.key)] ?? r.label ?? "—"}</span>
            <span className="h-2 rounded bg-accent-tint" style={{ inlineSize: `${(r.count / max) * 100}%` }} aria-hidden />
            <span className="ds-num">{toFa(r.count)}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-[13px] text-ink-3">داده‌ای نیست.</p>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="داشبورد خدمات مشتریان"
        actions={
          meta.data?.manages ? (
            <div className="flex flex-wrap gap-2">
              {!meta.data.seeded ? <Button onClick={() => seed.mutate(undefined)} loading={seed.isPending}>افزودن پیش‌فرض‌ها</Button> : null}
              <Button onClick={() => health.mutate(undefined)} loading={health.isPending}>محاسبهٔ دوبارهٔ سلامت حساب‌ها</Button>
            </div>
          ) : null
        }
      />
      {q.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="داشبورد در دسترس نیست" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard title="ثبت‌شده (۳۰ روز)" value={toFa(d.created_30d)} />
            <StatCard title="حل‌شده (۳۰ روز)" value={toFa(d.resolved_30d)} />
            <StatCard title="پذیرش راه‌حل" value={d.acceptance === null ? "—" : `${toFa(d.acceptance)}٪`} />
            <StatCard title="شکایت (۳۰ روز)" value={toFa(d.complaints_30d)} />
            <StatCard title="باز با موعد گذشته" value={toFa(d.breached_open)} />
            <StatCard title="رضایت" value={d.csat === null ? "—" : `${toFa(Math.round(d.csat * 10) / 10)} از ۵`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="پرونده‌های باز بر پایهٔ وضعیت">{bars(d.open)}</Card>
            <Card title="نوع پرونده (۳۰ روز)">{bars(d.by_type)}</Card>
            <Card title="مجرا (۳۰ روز)">{bars(d.by_channel)}</Card>
            <Card title="حساب‌های پرکار (۳۰ روز)">{bars(d.by_account)}</Card>
          </div>
        </>
      )}
    </div>
  );
}

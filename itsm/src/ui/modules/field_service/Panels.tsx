// Record-page parts and pages of field service:
//   TaskAssign      header action of a visit: «پیشنهاد تکنسین» (the ranked technicians and assignment; dispatchers)
//   WorkOrderFrom   «ساخت دستور کار» on incidents, customer cases, facility requests and requested items
//   SlotsPanel      side panel of a work order: free appointment slots (capacity only, no names) and booking
//   Dashboard       «داشبورد خدمات میدانی»: first-time fix, on-time arrival, schedule adherence, dispatch speed, travel share
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { CalendarClock, HardHat, UserPlus, Wrench } from "lucide-react";
import { formatJalali, todayISO, toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { Card, ICON } from "../../components/blocks";
import { recordPath, type RecordContext } from "../../records";
import { FIELD_KEYS, fieldApi } from "./api";
import { AssignDialog } from "./AssignDialog";
import { clock, kpiTone, minutesText, type Row } from "./model";

const fieldMeta = (ctx: RecordContext) => ((ctx.meta as Row).field ?? {}) as { can_work?: boolean; can_book?: boolean; mine?: boolean; dispatches?: boolean };

export function TaskAssign({ ctx }: { ctx: RecordContext }) {
  const { timezone } = useOrg();
  const [open, setOpen] = useState(false);
  const r = ctx.row as Row;
  if (!fieldMeta(ctx).dispatches || !["pending_dispatch", "assigned"].includes(String(r.state))) return null;
  const day = String(r.scheduled_start ?? r.window_start ?? "").slice(0, 10) || todayISO(timezone);
  return (
    <>
      <Button icon={<UserPlus {...ICON} />} onClick={() => setOpen(true)}>پیشنهاد تکنسین</Button>
      <AssignDialog target={open ? { task: r, day } : null} dispatcher onClose={() => setOpen(false)} onDone={() => { setOpen(false); ctx.refresh(); }} />
    </>
  );
}

export function WorkOrderFrom({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, allows } = useOrg();
  const nav = useNavigate();
  const make = useAction(() => fieldApi.from(api, ctx.table, ctx.row.id), { success: (w) => `دستور کار ${w.number ?? ""} ساخته شد`, onSuccess: (w) => nav(`/${orgId}/${recordPath("work_order", w.id)}`) });
  if (!allows({ area: "field_service", op: "create" })) return null;
  return <Button icon={<HardHat {...ICON} />} onClick={() => make.mutate(undefined)} loading={make.isPending}>ساخت دستور کار</Button>;
}

export function SlotsPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, timezone } = useOrg();
  const qc = useQueryClient();
  const r = ctx.row as Row;
  const meta = fieldMeta(ctx);
  const open = !["work_complete", "closed_complete", "closed_incomplete", "cancelled"].includes(String(r.state));
  const q = useQuery({ queryKey: FIELD_KEYS.slots(orgId, r.id), queryFn: () => fieldApi.slots(api, r.id, null, 7), enabled: open && !!(meta.can_book ?? meta.can_work) });
  const book = useAction((start: string) => fieldApi.book(api, r.id, start), {
    success: (d) => `نوبت ${formatJalali(d.window_start)} ${clock(d.window_start, timezone)} ثبت شد`,
    onSuccess: () => { ctx.refresh(); qc.invalidateQueries({ queryKey: FIELD_KEYS.slots(orgId, r.id) }); },
  });
  if (!open || !(meta.can_book ?? meta.can_work)) return <p className="text-[12px] text-ink-3">نوبت‌دهی برای دستور کار باز است.</p>;
  if (q.isLoading) return <Loader />;
  const slots = q.data?.slots ?? [];
  if (!slots.length) return <p className="text-[12px] text-ink-3">در هفت روز آینده بازهٔ آزادی نیست.</p>;
  const byDay = new Map<string, typeof slots>();
  for (const s of slots) byDay.set(s.start.slice(0, 10), [...(byDay.get(s.start.slice(0, 10)) ?? []), s]);
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {[...byDay.entries()].slice(0, 4).map(([day, xs]) => (
        <div key={day} className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">{formatJalali(day, { style: "long" })}</span>
          <div className="flex flex-wrap gap-1">
            {xs.slice(0, 6).map((s) => (
              <Button key={s.start} size="small" icon={<CalendarClock size={12} />} onClick={() => book.mutate(s.start)} loading={book.isPending && book.variables === s.start}>
                {clock(s.start, timezone)}
              </Button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-ink-3">بازه‌ها از ظرفیت تکنسین‌های شایسته ساخته می‌شوند؛ نام کسی نشان داده نمی‌شود.</p>
    </div>
  );
}

export function Dashboard() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: FIELD_KEYS.dashboard(orgId), queryFn: () => fieldApi.dashboard(api) });
  const meta = useQuery({ queryKey: FIELD_KEYS.meta(orgId), queryFn: () => fieldApi.meta(api) });
  const run = useAction(() => fieldApi.runMaintenance(api), { success: (d) => (d.generated ? `${toFa(d.generated)} دستور کار نگهداری ساخته شد` : "نگهداری سررسیده‌ای نبود"), invalidate: [FIELD_KEYS.dashboard(orgId)] });
  const seed = useAction(() => fieldApi.seed(api), { success: "نقش‌ها، گروه، الگوها، توافق‌ها و شاخص‌های خدمات میدانی افزوده شد", invalidate: [FIELD_KEYS.meta(orgId)] });
  const d = q.data;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${toFa(v)}٪`);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="داشبورد خدمات میدانی"
        actions={
          meta.data?.dispatches ? (
            <div className="flex flex-wrap gap-2">
              {!meta.data.seeded ? <Button onClick={() => seed.mutate(undefined)} loading={seed.isPending}>افزودن پیش‌فرض‌ها</Button> : null}
              <Button icon={<Wrench {...ICON} />} onClick={() => run.mutate(undefined)} loading={run.isPending}>ساخت نگهداری‌های سررسیده</Button>
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard title="حل در نخستین بازدید" value={<Chip tone={kpiTone(d.first_time_fix, 85, 75)}>{pct(d.first_time_fix)}</Chip>} hint="هدف ۸۵٪" />
            <StatCard title="رسیدن به‌موقع" value={<Chip tone={kpiTone(d.on_time_arrival, 90, 80)}>{pct(d.on_time_arrival)}</Chip>} hint="پیش از موعد توافق" />
            <StatCard title="پایبندی به بازهٔ مشتری" value={<Chip tone={kpiTone(d.schedule_adherence, 90, 80)}>{pct(d.schedule_adherence)}</Chip>} />
            <StatCard title="میانگین زمان توزیع" value={minutesText(d.mean_dispatch_minutes)} hint="از ثبت تا واگذاری" />
            <StatCard title="سهم سفر از زمان کار" value={pct(d.travel_ratio)} />
            <StatCard title="منتظر توزیع" value={toFa(d.unassigned)} />
          </div>
          <Card title="دربارهٔ این ارقام">
            <p className="text-[13px] text-ink-2">
              از {toFa(d.sample)} بازدید سی روز گذشته که می‌توانید ببینید، {toFa(d.completed)} بازدید انجام شده است. شاخص‌ها هر ماه در «شاخص‌ها» نیز با هدف و روند ثبت می‌شوند.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

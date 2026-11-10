// What the flows module adds to record pages (loaded lazily): «طراحی» and «اجرا» on a flow, its runs as a tab, and on
// a schedule the «تکرار» panel — the schedule in words, its next and last occurrence and last error, and an editor
// of the schedule and of the record template with clock pills ({{jalali.month_name}}, {{today + 3d}}…).
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Modal } from "antd";
import { CalendarClock, Play, Workflow } from "lucide-react";
import { formatJalaliDateTime } from "@shared/jalali";
import type { ScheduleSpec } from "@shared/flows";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { ICON, Note } from "../../components/blocks";
import { useSchema, type RecordContext } from "../../records";
import { ScheduleEditor } from "./ScheduleEditor";
import { ValuesEditor } from "./editors";
import { RunsTable } from "./Runs";
import { flowsApi } from "./api";
import type { Pill } from "./model";

export function FlowActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const run = useAction(() => flowsApi.run(api, ctx.row.id, {}), { success: "گردش‌کار اجرا شد", onSuccess: (d) => nav(`/${orgId}/flows/runs/${d.run.id}`) });
  const manual = ctx.row.trigger === "manual" && !!ctx.row.active && !!ctx.row.version_no;
  return (
    <>
      {manual ? (
        <Button icon={<Play {...ICON} />} loading={run.isPending} onClick={() => run.mutate(undefined)}>
          اجرا
        </Button>
      ) : null}
      <Button type="primary" icon={<Workflow {...ICON} />} onClick={() => nav(`/${orgId}/flows/${ctx.row.id}/design`)}>
        طراحی
      </Button>
    </>
  );
}

export function FlowRunsTab({ ctx }: { ctx: RecordContext }) {
  return <RunsTable flow={ctx.row.id} size={20} compact />;
}

const CLOCK_PILLS: Pill[] = [
  { path: "today", label: "امروز", group: "زمان" },
  { path: "now", label: "اکنون", group: "زمان" },
  { path: "today + 3d", label: "سه روز بعد", group: "زمان" },
  { path: "today + 1w", label: "یک هفته بعد", group: "زمان" },
  { path: "jalali", label: "تاریخ شمسی", group: "زمان" },
  { path: "jalali.month_name", label: "نام ماه شمسی", group: "زمان" },
  { path: "jalali.year", label: "سال شمسی", group: "زمان" },
  { path: "schedule.name", label: "نام زمان‌بندی", group: "زمان‌بندی" },
];

export function ScheduleSide({ ctx }: { ctx: RecordContext }) {
  const { timezone } = useOrg();
  const { schema } = useSchema();
  const [open, setOpen] = useState(false);
  const [spec, setSpec] = useState<ScheduleSpec | null>(null);
  const [template, setTemplate] = useState<Record<string, unknown>>({});
  const m = (ctx.meta as { schedule?: { description: string; next_at: string | null; last_at: string | null; last_error: string | null } }).schedule;
  const table = String(ctx.row.table_key ?? "");
  const fields = schema?.def(table)?.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, readonly: f.readonly, system: f.system, hidden: f.hidden }));
  const save = useAction(async () => {
    const ok = await ctx.save({ spec, template });
    if (ok) setOpen(false);
  });
  return (
    <div className="fl-rows">
      <div>{m?.description ?? "—"}</div>
      <div className="fl-step-meta">نوبت بعد: {m?.next_at && ctx.row.active ? formatJalaliDateTime(m.next_at, timezone) : "—"}</div>
      <div className="fl-step-meta">آخرین اجرا: {m?.last_at ? formatJalaliDateTime(m.last_at, timezone) : "—"}</div>
      {m?.last_error ? <Note tone="danger">{m.last_error}</Note> : null}
      {ctx.meta.canWrite ? (
        <Button
          size="small"
          icon={<CalendarClock {...ICON} />}
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            setSpec((ctx.row.spec as ScheduleSpec) ?? null);
            setTemplate((ctx.row.template as Record<string, unknown>) ?? {});
            setOpen(true);
          }}
        >
          ویرایش تکرار و مقدارها
        </Button>
      ) : null}
      <Modal open={open} onCancel={() => setOpen(false)} title="تکرار و مقدارهای رکورد" okText="ذخیره" cancelText="انصراف" onOk={() => save.mutate(undefined)} confirmLoading={save.isPending} width={620} destroyOnHidden>
        <div className="fl-rows">
          <div className="fl-field-label">تکرار</div>
          <ScheduleEditor value={spec} onChange={setSpec} />
          <div className="fl-field-label">مقدارهای رکورد</div>
          <ValuesEditor value={template} onChange={setTemplate} fields={fields} pills={CLOCK_PILLS} />
        </div>
      </Modal>
    </div>
  );
}

// Record-page parts of project management:
//   ProjectActions   header actions of a project: baseline, recalculation, the status report draft (AI summary when
//                    available), «رونوشت به‌عنوان الگو»
//   HealthPanel      side panel «سلامت»: health with its reasons, progress, variance, overdue work, open risks
//   GanttTab         tab «برنامهٔ زمانی»: the light Gantt
//   DemandScore      side panel of a demand: WSJF, RICE and the weighted score; «تبدیل به پروژه» for managers
//   ProjectFrom      «ساخت پروژه» on problems, changes and requested items (the record is linked «برخاسته از»)
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Progress, Space } from "antd";
import { Camera, Copy, FileText, FolderPlus, RefreshCw } from "lucide-react";
import { toFa, todayISO } from "@shared/jalali";
import { earnedValue } from "@shared/project/logic";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Chip } from "../../components/display";
import { ICON } from "../../components/blocks";
import { DateInput } from "../../components/inputs";
import { recordPath, type RecordContext } from "../../records";
import { PROJECT_KEYS, projectApi } from "./api";
import { GanttChart } from "./Gantt";
import { healthLabel, healthTone, type Row } from "./model";

export function ProjectActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const r = ctx.row as Row;
  const meta = (ctx.meta.project ?? {}) as { can_work?: boolean; manages?: boolean };
  const [copying, setCopying] = useState(false);
  const [name, setName] = useState(`${r.name ?? ""} (رونوشت)`);
  const [start, setStart] = useState<string | null>(todayISO(timezone));
  const refresh = () => {
    ctx.refresh();
    qc.invalidateQueries({ queryKey: PROJECT_KEYS.gantt(orgId, r.id) });
  };
  const baseline = useAction(() => projectApi.baseline(api, r.id), { success: (d) => `خط مبنا برای ${toFa(d.tasks)} کار ثبت شد`, onSuccess: refresh });
  const recalc = useAction(() => projectApi.recalc(api, r.id), { success: "برنامه و سلامت پروژه دوباره محاسبه شد", onSuccess: refresh });
  const status = useAction(() => projectApi.draftStatus(api, r.id, true), {
    success: (d) => (d.ai ? "پیش‌نویس گزارش وضعیت با خلاصهٔ هوش مصنوعی ساخته شد" : "پیش‌نویس گزارش وضعیت ساخته شد"),
    onSuccess: (d) => d.report && nav(`/${orgId}/${recordPath("status_report", d.report.id)}`),
  });
  const copy = useAction(() => projectApi.copy(api, r.id, name, start ?? todayISO(timezone)), { success: "پروژهٔ تازه از روی این برنامه ساخته شد", onSuccess: (p) => { setCopying(false); nav(`/${orgId}/${recordPath("project", p.id)}`); } });
  if (!meta.can_work) return null;
  return (
    <Space wrap>
      <Button icon={<FileText {...ICON} />} onClick={() => status.mutate(undefined)} loading={status.isPending}>گزارش وضعیت</Button>
      <Button icon={<Camera {...ICON} />} onClick={() => baseline.mutate(undefined)} loading={baseline.isPending}>ثبت خط مبنا</Button>
      <Button icon={<RefreshCw {...ICON} />} onClick={() => recalc.mutate(undefined)} loading={recalc.isPending}>محاسبهٔ دوباره</Button>
      <Button icon={<Copy {...ICON} />} onClick={() => setCopying(true)}>رونوشت به‌عنوان الگو</Button>
      <Modal open={copying} title="پروژهٔ تازه از روی این برنامه" okText="ساخت" cancelText="انصراف" onOk={() => copy.mutate(undefined)} onCancel={() => setCopying(false)} okButtonProps={{ disabled: name.trim().length < 2 || !start, loading: copy.isPending }} destroyOnHidden>
        <Form layout="vertical">
          <Form.Item label="نام پروژهٔ تازه" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></Form.Item>
          <Form.Item label="شروع" required><DateInput value={start} onChange={(v: string | null) => setStart(v)} /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

export function HealthPanel({ ctx }: { ctx: RecordContext }) {
  const { timezone } = useOrg();
  const r = ctx.row as Row;
  const reasons = Array.isArray(r.health_reasons) ? (r.health_reasons as Row[]) : [];
  // earned value from the budget the person may read (financial fields; absent → no EVM)
  const ev = typeof r.budget === "string" || typeof r.budget === "number" ? earnedValue({ budget: r.budget, actual_cost: r.actual_cost, pct: r.pct_complete, planned_start: r.planned_start, planned_end: r.planned_end, today: todayISO(timezone) }) : null;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex items-center gap-2">
        <Chip tone={healthTone(r.health)}>{healthLabel(r.health)}</Chip>
        {r.health_override ? <span className="text-[12px] text-ink-3">(تعیین‌شده توسط مدیر)</span> : null}
      </div>
      <Progress percent={Number(r.pct_complete ?? 0)} size="small" format={(v) => `${toFa(v ?? 0)}٪`} aria-label="پیشرفت" />
      {reasons.length ? (
        <ul className="list-disc ps-4 text-[12px] text-ink-2">{reasons.map((x) => <li key={String(x.key)}>{String(x.label)}</li>)}</ul>
      ) : (
        <p className="text-[12px] text-ink-3">نشانه‌ای از خطر دیده نشد.</p>
      )}
      <ul className="flex flex-col gap-0.5 text-[12px] text-ink-2">
        <li>کارهای دیرکرد: <span className="ds-num">{toFa(r.tasks_overdue ?? 0)}</span></li>
        <li>نقطه‌های عطف دیرکرد: <span className="ds-num">{toFa(r.milestones_overdue ?? 0)}</span></li>
        <li>ریسک‌های مهم باز: <span className="ds-num">{toFa(r.open_risks ?? 0)}</span></li>
        {r.schedule_variance_days !== null && r.schedule_variance_days !== undefined ? <li>انحراف زمان: <span className="ds-num">{toFa(r.schedule_variance_days)}</span> روز</li> : null}
      </ul>
      {ev ? (
        <ul className="flex flex-col gap-0.5 border-t border-line pt-2 text-[12px] text-ink-2" aria-label="ارزش کسب‌شده">
          <li>شاخص عملکرد زمان (SPI): <span className="ds-num">{ev.spi === null ? "—" : toFa(ev.spi)}</span></li>
          <li>شاخص عملکرد هزینه (CPI): <span className="ds-num">{ev.cpi === null ? "—" : toFa(ev.cpi)}</span></li>
          {ev.eac !== null ? <li>برآورد هزینهٔ پایان (EAC): <span className="ds-num">{ev.eac.toLocaleString("fa-IR")}</span> ریال</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

export function GanttTab({ ctx }: { ctx: RecordContext }) {
  return <GanttChart projectId={ctx.row.id} />;
}

export function DemandScore({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const r = ctx.row as Row;
  const meta = useQuery({ queryKey: PROJECT_KEYS.meta(orgId), queryFn: () => projectApi.meta(api) });
  const convert = useAction(() => projectApi.convert(api, r.id), { success: (p) => `پروژهٔ ${p.number ?? ""} ساخته شد`, onSuccess: (p) => nav(`/${orgId}/${recordPath("project", p.id)}`) });
  const row = (label: string, v: unknown, active: boolean) => (
    <li className={`flex justify-between ${active ? "text-ink" : "text-ink-3"}`}><span>{label}</span><span className="ds-num">{v === null || v === undefined ? "—" : toFa(Number(v))}</span></li>
  );
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <ul className="flex flex-col gap-1">
        {row("WSJF", r.score_wsjf, (r.scoring_model ?? "wsjf") === "wsjf")}
        {row("RICE", r.score_rice, r.scoring_model === "rice")}
        {row("امتیاز وزنی", r.score_weighted, r.scoring_model === "weighted")}
      </ul>
      {["approved", "qualified"].includes(String(r.state)) && meta.data?.manages ? (
        <Button size="small" icon={<FolderPlus {...ICON} />} loading={convert.isPending} onClick={() => convert.mutate(undefined)}>
          تبدیل به پروژه
        </Button>
      ) : null}
    </div>
  );
}

export function ProjectFrom({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, allows } = useOrg();
  const nav = useNavigate();
  const make = useAction(() => projectApi.from(api, ctx.table, ctx.row.id), { success: (p) => `پروژهٔ ${p.number ?? ""} ساخته شد`, onSuccess: (p) => nav(`/${orgId}/${recordPath("project", p.id)}`) });
  if (!allows({ area: "project", op: "create" })) return null;
  return <Button icon={<FolderPlus {...ICON} />} onClick={() => make.mutate(undefined)} loading={make.isPending}>ساخت پروژه</Button>;
}

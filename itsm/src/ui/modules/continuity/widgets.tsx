// Pages and record widgets of the continuity module (loaded with their page):
//   Dashboard         «داشبورد تداوم» — BIA coverage of critical services, plan currency, plans tested in a year,
//                     exercise results, RTO/RPO achievement, capacity risks, open outages, reviews due (CON-037)
//   BiaMatrix         the BIA's impact matrix (categories × time buckets, ratings 0–4) with the worst rating per bucket
//                     and the proposed RTO; edited in place when the person may change the record
//   BiaFromTemplate   «تحلیل اثر تازه از الگو» on the BIA list
//   ExerciseRun       the exercise's step sheet: start, mark steps done against their target minutes, finish with
//                     the result (RTO/RPO met is computed by the server)
//   ServiceAvailability  the availability of a service this month (the service page)
//   OutageFromIncident   «ثبت قطعی» on an incident page
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, InputNumber, Modal, Select, Space, Tooltip } from "antd";
import { Check, Play, Flag, Plus, PowerOff } from "lucide-react";
import type { Impacts, StepTiming } from "@shared/continuity/logic";
import { EXERCISE_RESULTS } from "@shared/tables/continuity";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { ICON14 } from "../../components/blocks";
import { EmptyState, Loader, StatCard } from "../../components/display";
import { recordPath, type RecordContext } from "../../records/extensions";
import { CONTINUITY_KEYS, continuityApi } from "./api";
import { BUCKETS, CATEGORIES, RATINGS, availabilityText, matrixSummary, minutesText, secondsText, setCell, stepProgress } from "./model";
import "../event/event.css";

const pctText = (v: number | null) => (v === null ? "—" : `${fa(v, 1)}٪`);

export function Dashboard() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: CONTINUITY_KEYS.dashboard(orgId), queryFn: () => continuityApi.dashboard(api), staleTime: 60_000 });
  const d = q.data;
  const go = (path: string) => () => nav(`/${orgId}/${path}`);
  return (
    <div className="ev-page">
      <PageHeader title="داشبورد تداوم" />
      {q.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="داشبورد در دسترس نیست" description="به تداوم کسب‌وکار دسترسی ندارید." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="پوشش تحلیل اثر" value={pctText(d.bia_coverage)} hint={`${fa(d.critical_services)} خدمت حیاتی`} onClick={go("continuity/bia")} />
          <StatCard title="طرح‌های به‌روز" value={pctText(d.plan_currency)} hint={`${fa(d.plans_current)} از ${fa(d.plans)} طرح`} onClick={go("continuity/plans")} />
          <StatCard title="طرح‌های آزموده در یک سال" value={pctText(d.tested_share)} hint={`${fa(d.tested_12m)} طرح`} />
          <StatCard title="مانورهای یک سال" value={fa(d.exercises_12m)} hint={`${fa(d.results.passed)} موفق · ${fa(d.results.partial)} با کاستی · ${fa(d.results.failed)} ناموفق`} onClick={go("continuity/exercises")} />
          <StatCard title="رعایت RTO در مانورها" value={pctText(d.rto_achievement)} />
          <StatCard title="رعایت RPO در مانورها" value={pctText(d.rpo_achievement)} />
          <StatCard title="ریسک ظرفیت" value={`${fa(d.capacity.critical)} بحرانی`} hint={`${fa(d.capacity.warning)} نزدیک آستانه · ${fa(d.capacity.exhausting)} پیش از زمان تأمین پر می‌شود`} onClick={go("continuity/capacity")} />
          <StatCard title="قطعی‌های باز" value={fa(d.open_outages)} hint={d.reviews_due ? `${fa(d.reviews_due)} بازبینی سررسیده` : undefined} onClick={go("continuity/outages")} />
        </div>
      )}
    </div>
  );
}

export function BiaMatrix({ ctx }: { ctx: RecordContext }) {
  const row = ctx.row as Record<string, any>;
  const [m, setM] = useState<Impacts>((row.impacts ?? {}) as Impacts);
  const [dirty, setDirty] = useState(false);
  const editable = !!ctx.meta.canWrite && !ctx.meta.locked;
  const tol = Number(row.tolerance) || 3;
  const sum = matrixSummary(m, tol);
  const save = async () => {
    if (await ctx.save({ impacts: m })) setDirty(false);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]" aria-label="ماتریس اثر کسب‌وکار">
          <thead>
            <tr>
              <th className="p-2 text-start font-medium text-ink-2">دسته ↓ / پس از ←</th>
              {BUCKETS.map((b) => (
                <th key={b.value} className="p-2 text-center font-medium text-ink-2">
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => (
              <tr key={c.value} className="border-t border-line">
                <th scope="row" className="p-2 text-start font-normal">
                  {c.label}
                </th>
                {BUCKETS.map((b) => {
                  const v = m[c.value]?.[b.value];
                  return (
                    <td key={b.value} className="p-1 text-center">
                      {editable ? (
                        <Select
                          size="small"
                          value={v === undefined ? undefined : String(v)}
                          placeholder="—"
                          style={{ minWidth: 92 }}
                          allowClear
                          aria-label={`${c.label}، ${b.label}`}
                          onChange={(x) => {
                            setM(setCell(m, c.value, b.value, x === undefined || x === null ? null : Number(x)));
                            setDirty(true);
                          }}
                          options={RATINGS.map((r) => ({ value: r.value, label: `${fa(Number(r.value))} — ${r.label}` }))}
                        />
                      ) : (
                        <span className="ds-num">{v === undefined ? "—" : `${fa(v)} — ${RATINGS.find((r) => r.value === String(v))?.label ?? ""}`}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t border-line">
              <th scope="row" className="p-2 text-start font-medium">
                بدترین اثر
              </th>
              {sum.worst.map((w, i) => (
                <td key={i} className={`p-2 text-center ds-num ${w >= tol ? "text-danger" : ""}`}>
                  {fa(w)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="m-0 text-[13px]">
        RTO پیشنهادی (نخستین بازه‌ای که اثر به آستانهٔ {fa(tol)} می‌رسد): <b>{sum.rto === null ? "اثری به آستانه نمی‌رسد" : secondsText(sum.rto)}</b>
        {row.rto ? ` · RTO ثبت‌شده: ${secondsText(Number(row.rto))}` : ""}
        {row.mtpd ? ` · MTPD: ${secondsText(Number(row.mtpd))}` : ""}
      </p>
      {editable ? (
        <Space>
          <Button type="primary" disabled={!dirty} onClick={save}>
            ذخیرهٔ ماتریس
          </Button>
          {sum.rto !== null && Number(row.rto) !== sum.rto ? <Button onClick={() => ctx.save({ rto: sum.rto, impacts: m })}>RTO پیشنهادی را بگذار</Button> : null}
        </Space>
      ) : null}
    </div>
  );
}

export function BiaFromTemplate() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const make = async () => {
    try {
      const r = await continuityApi.biaFromTemplate(api, { title: title.trim() });
      setOpen(false);
      nav(`/${orgId}/${recordPath("bia", r.row.id)}`);
    } catch (e) {
      n.error(errorText(e));
    }
  };
  return (
    <>
      <Button icon={<Plus {...ICON14} />} onClick={() => setOpen(true)}>
        تحلیل تازه از الگو
      </Button>
      <Modal open={open} title="تحلیل اثر تازه از الگو" okText="ساخت" cancelText="انصراف" okButtonProps={{ disabled: !title.trim() }} onOk={make} onCancel={() => setOpen(false)} destroyOnHidden>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان، مانند «تحلیل اثر سامانهٔ پرداخت»" aria-label="عنوان" />
      </Modal>
    </>
  );
}

export function ExerciseRun({ ctx }: { ctx: RecordContext }) {
  const { api, timezone } = useOrg();
  const n = useNotify();
  const row = ctx.row as Record<string, any>;
  const log = (Array.isArray(row.step_log) ? row.step_log : []) as StepTiming[];
  const [finishing, setFinishing] = useState(false);
  const [result, setResult] = useState("passed");
  const [loss, setLoss] = useState<number | null>(null);
  const can = !!ctx.meta.canWrite;
  const p = stepProgress(log, row.started_at ?? null);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      ctx.refresh();
    } catch (e) {
      n.error(errorText(e));
    }
  };
  if (row.state === "planned") {
    return can ? (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-[13px] text-ink-2">با آغاز مانور، گام‌های طرح با زمان هدفشان در این برگه کپی می‌شوند و ساعت مانور به کار می‌افتد.</p>
        <Button type="primary" icon={<Play {...ICON14} />} onClick={() => run(() => continuityApi.startExercise(api, row.id))}>
          آغاز مانور
        </Button>
      </div>
    ) : (
      <p className="m-0 text-[13px] text-ink-3">مانور هنوز آغاز نشده است.</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[13px] text-ink-2">
        {fa(p.done)} از {fa(p.total)} گام انجام شد{p.late ? ` · ${fa(p.late)} گام دیرتر از هدف` : ""}
        {p.elapsed_min !== null && row.state === "in_progress" ? ` · ${fa(p.elapsed_min)} دقیقه از آغاز` : ""}
      </div>
      <ol className="flex flex-col gap-1.5 text-[13px]">
        {log.map((s) => (
          <li key={s.seq} className="flex flex-wrap items-center gap-2">
            <span className="ds-num w-6 text-ink-3">{fa(s.seq)}</span>
            <span className="min-w-0 flex-1">{s.title}{s.role ? <span className="text-ink-3"> · {s.role}</span> : null}</span>
            <span className="ds-num text-[12px] text-ink-3">هدف: {fa(s.target_min)} دقیقه</span>
            {s.done_at ? (
              <Tooltip title="لغو انجام">
                <Button size="small" type="text" disabled={!can || row.state !== "in_progress"} onClick={() => run(() => continuityApi.step(api, row.id, s.seq, false))}>
                  <Check {...ICON14} className="text-in" /> {formatJalaliDateTime(s.done_at, timezone)}
                </Button>
              </Tooltip>
            ) : (
              <Button size="small" disabled={!can || row.state !== "in_progress"} onClick={() => run(() => continuityApi.step(api, row.id, s.seq, true))}>
                انجام شد
              </Button>
            )}
          </li>
        ))}
      </ol>
      {row.state === "in_progress" && can ? (
        <Button type="primary" icon={<Flag {...ICON14} />} onClick={() => setFinishing(true)}>
          پایان مانور
        </Button>
      ) : null}
      {row.state !== "in_progress" && row.actual_recovery ? (
        <p className="m-0 text-[13px]">
          بازیابی واقعی: {minutesText(Number(row.actual_recovery) * 1000)} {row.rto_target ? `(هدف ${minutesText(Number(row.rto_target) * 1000)} — ${row.rto_met ? "رعایت شد" : "رعایت نشد"})` : ""}
        </p>
      ) : null}
      <Modal open={finishing} title="پایان مانور" okText="ثبت نتیجه" cancelText="انصراف" onCancel={() => setFinishing(false)} onOk={() => run(() => continuityApi.finish(api, row.id, { result, actual_data_loss: loss })).then(() => setFinishing(false))} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <Select value={result} onChange={setResult} options={EXERCISE_RESULTS.map((o) => ({ value: o.value, label: o.label }))} aria-label="نتیجه" />
          <label className="flex flex-col gap-1 text-[13px]">
            دادهٔ ازدست‌رفته (دقیقه، برای سنجش RPO)
            <InputNumber min={0} value={loss === null ? null : Math.round(loss / 60)} onChange={(v) => setLoss(v === null ? null : Number(v) * 60)} />
          </label>
          <p className="m-0 text-[12.5px] text-ink-3">زمان واقعی بازیابی از زمان انجام آخرین گام حساب می‌شود؛ اگر همهٔ گام‌ها انجام نشده‌اند، آن را بعداً در فرم ثبت کنید.</p>
        </div>
      </Modal>
    </div>
  );
}

export function ServiceAvailability({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: CONTINUITY_KEYS.trend(orgId, id, "month"), queryFn: () => continuityApi.trend(api, id, "month"), staleTime: 60_000 });
  if (q.isLoading) return <Loader />;
  const last = q.data?.periods[q.data.periods.length - 1];
  if (!last) return <p className="m-0 text-[13px] text-ink-3">داده‌ای نیست.</p>;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[13px]">
      <dt className="text-ink-2">این ماه</dt>
      <dd className="ds-num m-0">{availabilityText(last.availability, 3)}</dd>
      <dt className="text-ink-2">هدف</dt>
      <dd className="ds-num m-0">{last.target === null ? "—" : availabilityText(last.target, 2)}</dd>
      <dt className="text-ink-2">مانده از بودجه</dt>
      <dd className="ds-num m-0">{last.budget_left_ms === null ? "—" : minutesText(last.budget_left_ms)}</dd>
      <dt className="text-ink-2">خرابی / MTRS</dt>
      <dd className="ds-num m-0">
        {fa(last.failures)} / {last.mtrs_ms === null ? "—" : minutesText(last.mtrs_ms)}
      </dd>
    </dl>
  );
}

export function OutageFromIncident({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, allows } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if ((!ctx.row.service_id && !ctx.row.ci_id) || !allows({ area: "continuity", op: "create" })) return null;
  const go = async () => {
    setBusy(true);
    try {
      const r = await continuityApi.outageFromIncident(api, String(ctx.row.id));
      n.ok(`قطعی ${r.row.number} پیشنهاد شد`);
      await qc.invalidateQueries({ queryKey: CONTINUITY_KEYS.all(orgId) });
      nav(`/${orgId}/${recordPath("outage", r.row.id)}`);
    } catch (e) {
      n.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button icon={<PowerOff {...ICON14} />} loading={busy} onClick={go}>
      ثبت قطعی
    </Button>
  );
}

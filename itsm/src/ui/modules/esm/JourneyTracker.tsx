// «ردیاب سفر» (ESM-020…027, signature screen): one employee journey — who, the anchor day, progress and day-one
// readiness — and its activities by phase: each with its kind, state, who does it, its planned dates, the approval it
// waits for, and the work it created elsewhere (a catalogue order, a case in another department) with that record's
// state as the caller may read it («(محدود)» when they may not). The person's own HR tasks follow.
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "antd";
import { formatJalali, todayISO, toFa } from "@shared/jalali";
import { ACTIVITY_KINDS, HR_TASK_STATES, HR_TASK_TYPES, JOURNEY_TYPES } from "@shared/tables/esm";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { Card } from "../../components/blocks";
import { ChoiceTag, UserChip, recordPath } from "../../records";
import { ESM_KEYS, esmApi } from "./api";
import { activityState, activityTone, byPhase, journeyState, readiness, type Row } from "./model";
import "./esm.css";

export default function TrackerPage() {
  const { id = "" } = useParams();
  return <JourneyTracker id={id} />;
}

const stateOpt = (st: { value: string; label: string; color?: string } | undefined) => (st ? { value: st.value, label: st.label, color: st.color as never } : undefined);

export function JourneyTracker({ id, inline }: { id: string; inline?: boolean }) {
  const { api, orgId, timezone } = useOrg();
  const q = useQuery({ queryKey: ESM_KEYS.tracker(orgId, id), queryFn: () => esmApi.tracker(api, id), enabled: !!id, refetchInterval: 60_000 });
  const d = q.data;
  if (q.isLoading) return <Loader />;
  if (!d) return <EmptyState title="این سفر در دسترس شما نیست" />;
  const j = d.journey;
  const today = todayISO(timezone);
  const st = journeyState(j.state);
  const ready = readiness(j);
  const phases = byPhase(d.activities);
  const who = (uid: unknown) => (uid ? <UserChip id={String(uid)} display={d.display} compact /> : <span className="text-ink-3">—</span>);
  return (
    <div className="flex flex-col gap-4">
      {inline ? null : <PageHeader title={String(j.name ?? j.number)} back={`/${orgId}/${recordPath("journey", j.id)}`} />}
      <Card>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <ChoiceTag option={JOURNEY_TYPES.find((t) => t.value === j.type)} value={String(j.type ?? "")} />
          <ChoiceTag option={stateOpt(st)} value={String(j.state)} />
          <span>کارمند: {j.subject_person_id ? who(j.subject_person_id) : (j.subject_name ?? "—")}</span>
          <span>مدیر: {who(j.manager_id)}</span>
          <span>مسئول منابع انسانی: {who(j.hr_owner_id)}</span>
          <span>روز مبنا: <b>{formatJalali(j.anchor_date, { style: "long" })}</b></span>
          {j.type === "onboarding" ? <Chip tone={ready.ready ? "in" : "warning"}>{ready.text}</Chip> : null}
          {Number(j.activities_overdue ?? 0) > 0 ? <Chip tone="danger">{toFa(j.activities_overdue)} فعالیت دیرکرد</Chip> : null}
        </div>
        <Progress className="mt-3" percent={Number(j.progress ?? 0)} format={(v) => `${toFa(v ?? 0)}٪`} aria-label="پیشرفت سفر" />
        <p className="text-[12px] text-ink-3">{toFa(j.activities_done ?? 0)} از {toFa(j.activities_total ?? 0)} فعالیت انجام شده است{j.next_due ? `؛ موعد بعدی ${formatJalali(j.next_due)}` : ""}.</p>
      </Card>
      {phases.length ? (
        <div className="esm-phases">
          {phases.map((p) => (
            <section key={p.key} className="esm-phase" aria-label={p.label}>
              <h2 className="flex items-center justify-between text-[13px]">
                <span className="font-medium">{p.label}</span>
                <span className="ds-num text-ink-3">{toFa(p.done)}/{toFa(p.activities.length)}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {p.activities.map((a: Row) => {
                  const ast = activityState(a.state);
                  const rec = d.records[String(a.id)];
                  return (
                    <li key={a.id} className="esm-act" data-tone={activityTone(a, today)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link className="ds-link text-[13px]" to={`/${orgId}/${recordPath("journey_activity", a.id)}`}>{a.name}</Link>
                        {a.day_one ? <Chip tone="accent">روز نخست</Chip> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                        <ChoiceTag option={ACTIVITY_KINDS.find((k) => k.value === a.kind)} value={String(a.kind)} />
                        <ChoiceTag option={stateOpt(ast)} value={String(a.state)} />
                        {a.approval === "requested" ? <Chip tone="warning">منتظر تأیید</Chip> : a.approval === "rejected" ? <Chip tone="danger">رد شد</Chip> : null}
                        {a.assignee_id ? who(a.assignee_id) : a.group_id ? <span>{d.display[String(a.group_id)] ?? "گروه"}</span> : null}
                        {a.due_date ? <span className={a.overdue ? "text-danger" : ""}>تا {formatJalali(a.due_date)}</span> : null}
                      </div>
                      {a.record_table && a.record_id ? (
                        <div className="text-[12px]">
                          کار ایجادشده:{" "}
                          {rec?.readable ? (
                            <Link className="ds-link" to={`/${orgId}/${recordPath(String(a.record_table), String(a.record_id))}`}>{rec.number ?? a.record_number}</Link>
                          ) : (
                            <span>{a.record_number ?? ""} (محدود)</span>
                          )}
                          {rec?.state_label ? <span className="text-ink-3"> — {rec.state_label}</span> : null}
                        </div>
                      ) : null}
                      {a.outcome ? <div className="text-[12px] text-ink-3">{a.outcome}</div> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState compact title="این سفر فعالیتی ندارد" />
      )}
      {d.tasks.length ? (
        <Card title="کارهای کارمند و مدیر">
          <ul className="flex flex-col gap-1 text-[13px]">
            {d.tasks.map((t) => {
              const ts = HR_TASK_STATES.states.find((s) => s.value === t.state);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2">
                  <Link className="ds-link" to={`/${orgId}/${recordPath("hr_task", t.id)}`}>{t.number}</Link>
                  <span className="min-w-0 flex-1 truncate">{t.short_description}</span>
                  <ChoiceTag option={HR_TASK_TYPES.find((x) => x.value === t.type)} value={String(t.type)} />
                  <ChoiceTag option={stateOpt(ts)} value={String(t.state)} />
                  {who(t.assigned_to)}
                  {t.due_date ? <span className="text-[12px] text-ink-3">تا {formatJalali(t.due_date)}</span> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

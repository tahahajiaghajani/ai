// The light Gantt of a project (PRJ-019/020/022): one row per phase, task or milestone in WBS order (indented), bars
// placed by date from the inline start (right in Persian), the critical path in the danger colour, progress inside
// each bar, the baseline as a thin line under it, milestones as diamonds and today's line. The left column names each
// row with its predecessors («پس از ۱٫۲»). Rows open their task. Dates come from the server's critical-path schedule.
import { Fragment } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Tooltip } from "antd";
import { formatJalali, toFa, addDays } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { EmptyState, Loader } from "../../components/display";
import { recordPath } from "../../records";
import { PROJECT_KEYS, projectApi } from "./api";
import { barOf, depthOf, ganttRange, type Row } from "./model";
import "./project.css";

export function GanttChart({ projectId }: { projectId: string }) {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: PROJECT_KEYS.gantt(orgId, projectId), queryFn: () => projectApi.gantt(api, projectId) });
  if (q.isLoading) return <Loader />;
  if (!q.data) return <EmptyState title="برنامهٔ پروژه بارگذاری نشد" />;
  const { tasks, today } = q.data;
  if (!tasks.length) return <EmptyState title="هنوز کاری برای این پروژه تعریف نشده است" />;
  const range = ganttRange(tasks, today);
  const wbsOf = new Map(tasks.map((t) => [String(t.id), String(t.wbs ?? "")]));
  // a tick every week (or every 4 weeks on long plans)
  const step = range.days > 120 ? 28 : 7;
  const ticks = Array.from({ length: Math.floor(range.days / step) + 1 }, (_, i) => addDays(range.from, i * step));
  const todayBar = barOf(today, today, range);
  return (
    <div className="flex flex-col gap-2">
      <div className="pj-gantt" role="table" aria-label="برنامهٔ زمانی پروژه">
        <div className="pj-gantt-head" role="row">
          <div role="columnheader">کار</div>
          <div role="columnheader" className="pj-gantt-scale" aria-hidden>
            {ticks.map((d) => {
              const b = barOf(d, d, range);
              return b ? <span key={d} style={{ insetInlineStart: `${b.start}%` }}>{formatJalali(d, { style: "short" })}</span> : null;
            })}
          </div>
        </div>
        {tasks.map((t: Row) => {
          const b = barOf(t.planned_start, t.planned_end, range);
          const base = barOf(t.baseline_start, t.baseline_end, range);
          const deps = (Array.isArray(t.depends_on) ? t.depends_on : []).map((d: string) => wbsOf.get(String(d))).filter(Boolean) as string[];
          const done = t.state === "done";
          const title = [
            `${t.wbs ?? ""} ${t.short_description}`,
            t.planned_start ? `${formatJalali(t.planned_start)} تا ${formatJalali(t.planned_end ?? t.planned_start)}` : "بی‌تاریخ",
            t.is_critical ? "در مسیر بحرانی" : t.float_days !== null && t.float_days !== undefined ? `شناوری ${toFa(t.float_days)} روز` : "",
            t.variance?.end ? `انحراف از خط مبنا: ${toFa(t.variance.end)} روز` : "",
          ].filter(Boolean).join("\n");
          return (
            <Fragment key={t.id}>
              <div className="pj-row" role="row">
                <div role="cell" className={`pj-name ${t.kind === "phase" ? "is-phase" : ""}`} style={{ paddingInlineStart: 10 + depthOf(t.wbs) * 16 }}>
                  <span className="pj-wbs ds-num">{toFa(String(t.wbs ?? ""))}</span>
                  <Link to={`/${orgId}/${recordPath("project_task", t.id)}`} className="pj-title ds-link" title={t.short_description}>{t.short_description}</Link>
                  {deps.length ? <span className="text-[11px] text-ink-3">پس از {toFa(deps.join("، "))}</span> : null}
                </div>
                <div role="cell" className="pj-track">
                  {todayBar ? <span className="pj-today" style={{ insetInlineStart: `${todayBar.start}%` }} aria-hidden /> : null}
                  {base && t.kind !== "milestone" ? <span className="pj-baseline" style={{ insetInlineStart: `${base.start}%`, inlineSize: `${base.size}%` }} aria-hidden /> : null}
                  {b ? (
                    <Tooltip title={<span style={{ whiteSpace: "pre-line" }}>{title}</span>}>
                      {t.kind === "milestone" ? (
                        <span className={`pj-milestone ${t.is_critical ? "is-critical" : ""} ${done ? "is-done" : ""}`} style={{ insetInlineStart: `${b.start}%` }} aria-label={title} role="img" />
                      ) : (
                        <span className={`pj-bar ${t.kind === "phase" ? "is-phase" : ""} ${t.is_critical ? "is-critical" : ""} ${done ? "is-done" : ""}`} style={{ insetInlineStart: `${b.start}%`, inlineSize: `${b.size}%` }} aria-label={title} role="img">
                          {t.kind !== "phase" && !done ? <span className="pj-progress" style={{ inlineSize: `${Math.min(100, Number(t.pct_complete ?? 0))}%` }} /> : null}
                        </span>
                      )}
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      <div className="pj-legend" aria-hidden>
        <span><i style={{ background: "color-mix(in oklab, var(--ds-accent) 40%, transparent)" }} />کار</span>
        <span><i style={{ background: "color-mix(in oklab, var(--ds-danger) 35%, transparent)" }} />مسیر بحرانی</span>
        <span><i style={{ background: "var(--ds-line-3)", blockSize: 3 }} />خط مبنا</span>
        <span><i style={{ background: "transparent", borderInlineStart: "1.5px dashed var(--ds-danger)", inlineSize: 1 }} />امروز</span>
      </div>
    </div>
  );
}

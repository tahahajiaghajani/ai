// The step statuses of a case's diagram (design F §3.6.7, §8.6): the legend under the diagram, the badge a step shows
// («نوبت شما»، «انجام‌شده · تأیید شد»), and the phone's diagram — the steps as a numbered list. Every status is an
// icon and a word, never a colour alone; «نوبت شما» carries the accent outline.
import type { ReactNode } from "react";
import type { NodeStatus, NodeStatusView, ProcessGraph } from "@shared/process";
import { faDigits } from "@shared/format";
import { cx } from "../../../components/blocks";
import { LEGEND_ORDER, STEP_STATUS, listSteps, nodeSummary, nodeTitle, statusLine } from "./model";
import { ProcessNodeIcon, StepStatusIcon } from "./icons";
import "./kit.css";

/** One status: its icon and word. */
export function StepStatusBadge({ status, children, className }: { status: NodeStatus; children?: ReactNode; className?: string }) {
  const meta = STEP_STATUS[status];
  return (
    <span className={cx("wfk-st", `is-${meta.tone}`, className)}>
      <StepStatusIcon status={status} />
      <span>{children ?? meta.label}</span>
    </span>
  );
}

/** The legend: the statuses a diagram uses (all of them unless `only`). */
export function StepLegend({ only, className }: { only?: readonly NodeStatus[]; className?: string }) {
  const shown = LEGEND_ORDER.filter((s) => !only || only.includes(s));
  return (
    <ul className={cx("wfk-legend", className)} aria-label="راهنمای وضعیت مرحله‌ها">
      {shown.map((s) => (
        <li key={s}>
          <StepStatusBadge status={s} />
        </li>
      ))}
    </ul>
  );
}

/** The statuses a diagram shows (for a legend limited to them). */
export const usedStatuses = (statuses: Record<string, NodeStatusView> | null | undefined): NodeStatus[] => [...new Set(Object.values(statuses ?? {}).map((v) => v.status))];

export interface StepListProps {
  graph: ProcessGraph;
  statuses?: Record<string, NodeStatusView> | null;
  /** extra line per node (the preview's people) */
  notes?: Record<string, string>;
  /** a step opens (its form, its settings) */
  onOpen?: (id: string) => void;
  selected?: string | null;
  className?: string;
  label?: string;
}

/** The diagram on a phone and the designer's read-only list: the steps in order, numbered, each with its status. */
export function StepList({ graph, statuses, notes, onOpen, selected, className, label = "مرحله‌های گردش‌کار" }: StepListProps) {
  const steps = listSteps(graph);
  return (
    <ol className={cx("wfk-list", className)} aria-label={label}>
      {steps.map((n, i) => {
        const st = statuses?.[n.id];
        const title = nodeTitle(n);
        const body = (
          <>
            <span className="wfk-list-n ds-num" aria-hidden>
              {faDigits(i + 1)}
            </span>
            <span className="wfk-list-ic" aria-hidden>
              <ProcessNodeIcon type={n.type} size={14} />
            </span>
            <span className="wfk-list-b">
              <span className="wfk-list-t">{title}</span>
              <span className="wfk-list-s">{notes?.[n.id] ?? nodeSummary(n)}</span>
              {st ? <StepStatusBadge status={st.status}>{statusLine(st, n.type)}</StepStatusBadge> : null}
            </span>
          </>
        );
        return (
          <li key={n.id} className={cx("wfk-list-i", st && `is-${STEP_STATUS[st.status].tone}`, selected === n.id && "is-sel")}>
            {onOpen ? (
              <button type="button" className="wfk-list-btn" onClick={() => onOpen(n.id)} aria-current={selected === n.id ? "step" : undefined}>
                {body}
              </button>
            ) : (
              <div className="wfk-list-btn">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

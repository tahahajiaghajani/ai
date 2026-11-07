// A run step by step: each step's status, the path it took, its duration and error, and its input and output when
// the caller may see the run's data; what the run waits for, with «تأیید» / «رد» for approvers of the built-in
// approval. Used on a run's page and in the designer's test drawer.
import { useState } from "react";
import { Button, Input, Space } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { RUN_STATES, STEP_STATUSES, nodeDef, type FlowRunDetail, type FlowStepView, type RunState, type StepStatus } from "@shared/flows";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Chip, type ChipTone } from "../../components/display";
import { ICON, Note } from "../../components/blocks";
import { NodeIcon } from "./icons";
import { flowKeys, flowsApi } from "./api";

const TONE: Record<string, ChipTone> = { blue: "accent", gold: "warning", green: "in", red: "danger", gray: "neutral" };

export function RunStateChip({ state }: { state: RunState }) {
  const s = RUN_STATES[state];
  return <Chip tone={TONE[s.color] ?? "neutral"}>{s.label}</Chip>;
}

export function StepChip({ status }: { status: StepStatus }) {
  const s = STEP_STATUSES[status];
  return <Chip tone={TONE[s.color] ?? "neutral"}>{s.label}</Chip>;
}

const TRIGGER_LABEL: Record<string, string> = { record: "رویداد رکورد", schedule: "زمان‌بندی", webhook: "وب‌هوک", manual: "اجرای دستی", catalog: "سفارش کاتالوگ", test: "اجرای آزمایشی", subflow: "زیرگردش‌کار" };
export const triggerLabel = (k: string) => TRIGGER_LABEL[k] ?? k;

/** «۲ ثانیه»، «۳ دقیقه»… */
export function durationText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  if (ms < 1000) return "کمتر از یک ثانیه";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${faDigits(s)} ثانیه`;
  const m = Math.round(s / 60);
  if (m < 60) return `${faDigits(m)} دقیقه`;
  const h = Math.round(m / 60);
  return h < 48 ? `${faDigits(h)} ساعت` : `${faDigits(Math.round(h / 24))} روز`;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

function StepRow({ s, graphLabel }: { s: FlowStepView; graphLabel?: string }) {
  const [open, setOpen] = useState(false);
  const port = nodeDef(s.node_type)?.ports.find((p) => p.key === s.port);
  const logs = s.output && typeof s.output === "object" && Array.isArray((s.output as { $log?: unknown }).$log) ? ((s.output as { $log: string[] }).$log) : [];
  const has = s.input !== null || s.output !== null;
  return (
    <div className="fl-step">
      <span className="fl-node-ic">
        <NodeIcon type={s.node_type} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div>
          {graphLabel || s.label}
          {port && (nodeDef(s.node_type)?.ports.length ?? 0) > 1 ? <span className="fl-step-meta"> ← {port.label}</span> : null}
        </div>
        <div className="fl-step-meta">
          <bdi className="ds-num">{formatJalaliDateTime(s.started_at)}</bdi>
          {s.duration_ms !== null ? <> · <bdi>{durationText(s.duration_ms)}</bdi></> : null}
        </div>
        {s.error ? <div className="text-danger" style={{ fontSize: 12.5, marginTop: 4 }}>{s.error}</div> : null}
        {logs.map((l, i) => (
          <div key={i} className="fl-step-meta">
            {l}
          </div>
        ))}
        {has ? (
          <Button size="small" type="link" style={{ paddingInline: 0 }} onClick={() => setOpen(!open)}>
            {open ? "بستن جزئیات" : "جزئیات"}
          </Button>
        ) : null}
        {open ? (
          <>
            {s.input !== null ? <pre aria-label="ورودی">{json(s.input)}</pre> : null}
            {s.output !== null ? <pre aria-label="خروجی">{json(s.output)}</pre> : null}
          </>
        ) : null}
      </div>
      <StepChip status={s.status} />
    </div>
  );
}

/** The built-in approval's decision buttons. */
function Decide({ waitId }: { waitId: string }) {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const decide = useAction((d: "approve" | "reject") => flowsApi.decide(api, waitId, d, comment), {
    success: (r) => (r.final ? "تصمیم ثبت شد و گردش‌کار ادامه می‌یابد" : "تصمیم شما ثبت شد"),
    onSuccess: () => qc.invalidateQueries({ queryKey: flowKeys.all(orgId) }),
  });
  return (
    <Space.Compact style={{ width: "100%", marginTop: 6 }}>
      <Input placeholder="توضیح (اختیاری)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <Button type="primary" icon={<Check {...ICON} />} loading={decide.isPending && decide.variables === "approve"} onClick={() => decide.mutate("approve")}>
        تأیید
      </Button>
      <Button danger icon={<X {...ICON} />} loading={decide.isPending && decide.variables === "reject"} onClick={() => decide.mutate("reject")}>
        رد
      </Button>
    </Space.Compact>
  );
}

export function RunSteps({ detail }: { detail: FlowRunDetail }) {
  const labels = new Map((detail.graph?.nodes ?? []).map((n) => [n.id, n.label || ""]));
  return (
    <div className="fl-rows">
      {detail.run.error ? <Note tone="danger">{detail.run.error}</Note> : null}
      {detail.waits.map((w) => (
        <Note key={w.id} tone="warning">
          <div>
            {w.kind === "approval" ? `در انتظار تأیید: ${String(w.data?.title ?? "")}` : w.kind === "timer" ? "در انتظار زمان" : w.kind === "condition" ? "در انتظار برقرار شدن شرط" : w.kind === "subflow" ? "در انتظار پایان زیرگردش‌کار" : "در انتظار"}
            {w.due_at ? ` — تا ${formatJalaliDateTime(w.due_at)}` : ""}
          </div>
          {w.can_decide ? <Decide waitId={w.id} /> : null}
        </Note>
      ))}
      <div className="fl-steps">
        {detail.steps.map((s) => (
          <StepRow key={s.id} s={s} graphLabel={labels.get(s.node_id)} />
        ))}
      </div>
      {detail.context === null ? <div className="fl-step-meta">داده‌های این اجرا برای شما پنهان است.</div> : null}
    </div>
  );
}

/** Last status per node (the canvas overlay of a run). */
export function statusesOf(detail: FlowRunDetail | undefined): Record<string, StepStatus> {
  const out: Record<string, StepStatus> = {};
  for (const s of detail?.steps ?? []) out[s.node_id] = s.status;
  return out;
}

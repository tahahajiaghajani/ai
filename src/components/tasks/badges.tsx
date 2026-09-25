import { Badge, type Tone } from "@/components/ui/primitives";
import { PRIORITY_META, RELATION_META, STATUS_META, stageOf } from "@/lib/status";
import type { Priority, RelationType, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, requester, className }: { status: TaskStatus; requester?: boolean; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone as Tone} dot className={className}>
      {requester ? meta.requesterLabel : meta.label}
    </Badge>
  );
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const meta = PRIORITY_META[priority];
  return (
    <Badge tone={meta.tone as Tone} className={className}>
      اولویت {meta.label}
    </Badge>
  );
}

export function PriorityDot({ priority }: { priority: Priority }) {
  const color = { low: "bg-slate-400", medium: "bg-sky-500", high: "bg-amber-500", critical: "bg-rose-500" }[priority];
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", color, priority === "critical" && "animate-pulse-soft")} title={`اولویت ${PRIORITY_META[priority].label}`} />;
}

export function RelationBadge({ relation }: { relation: RelationType | null }) {
  if (!relation) return null;
  return <Badge tone="pink">{RELATION_META[relation]}</Badge>;
}

export function StageChip({ status }: { status: TaskStatus }) {
  const stage = stageOf(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: stage.color }}>
      <span className="size-2 rounded-full" style={{ background: stage.color }} />
      {stage.label}
    </span>
  );
}

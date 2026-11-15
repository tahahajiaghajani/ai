// Icons of the workflows kit: the process node types (lucide names in @shared/process PROCESS_NODE_TYPES) and the step
// statuses of a case's diagram (./model.ts STEP_STATUS). Light: lists and the phone's step list use them without the
// canvas. Decorative: the word beside each icon carries the meaning (aria-hidden).
import {
  Bell, CircleCheck, CircleDashed, CircleDot, CircleMinus, FilePen, Flag, GitBranch, Hand, Merge, PencilLine, Play, Signpost, Split, Timer, UserCheck,
  UserRoundSearch, Workflow, type LucideIcon,
} from "lucide-react";
import { PROCESS_NODE_TYPES, isProcessNodeType, type NodeStatus } from "@shared/process";
import { STEP_STATUS } from "./model";

const NODE_ICONS: Record<string, LucideIcon> = {
  play: Play,
  "file-pen": FilePen,
  "git-branch": GitBranch,
  signpost: Signpost,
  split: Split,
  merge: Merge,
  timer: Timer,
  bell: Bell,
  workflow: Workflow,
  "pencil-line": PencilLine,
  flag: Flag,
};

const STATUS_ICONS: Record<string, LucideIcon> = {
  "circle-check": CircleCheck,
  "circle-dot": CircleDot,
  hand: Hand,
  "user-check": UserCheck,
  "user-round-search": UserRoundSearch,
  "circle-minus": CircleMinus,
  "circle-dashed": CircleDashed,
};

const STROKE = { strokeWidth: 1.5, absoluteStrokeWidth: true } as const;

export function ProcessNodeIcon({ type, size = 15 }: { type: string; size?: number }) {
  const Icon = (isProcessNodeType(type) ? NODE_ICONS[PROCESS_NODE_TYPES[type].icon] : undefined) ?? Workflow;
  return <Icon size={size} {...STROKE} aria-hidden />;
}

export function StepStatusIcon({ status, size = 14 }: { status: NodeStatus; size?: number }) {
  const Icon = STATUS_ICONS[STEP_STATUS[status]?.icon ?? ""] ?? CircleDashed;
  return <Icon size={size} {...STROKE} aria-hidden />;
}

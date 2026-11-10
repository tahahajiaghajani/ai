// Icons of the node types (lucide names in @shared/flows/nodes → components). Light: the run list and record pages use
// it without loading the canvas.
import {
  BadgeCheck, Bell, FilePlus, Flag, GitBranch, Globe, Hourglass, Merge, MessageSquareText, PencilLine, Repeat, Sparkles, Split, Timer,
  Variable, Workflow, Zap, type LucideIcon,
} from "lucide-react";
import { nodeDef } from "@shared/flows";

export const NODE_ICONS: Record<string, LucideIcon> = {
  zap: Zap,
  "pencil-line": PencilLine,
  "file-plus": FilePlus,
  "message-square-text": MessageSquareText,
  bell: Bell,
  "badge-check": BadgeCheck,
  hourglass: Hourglass,
  timer: Timer,
  "git-branch": GitBranch,
  split: Split,
  merge: Merge,
  repeat: Repeat,
  globe: Globe,
  variable: Variable,
  workflow: Workflow,
  sparkles: Sparkles,
  flag: Flag,
};

export function NodeIcon({ type, size = 15 }: { type: string; size?: number }) {
  const Icon = NODE_ICONS[nodeDef(type)?.icon ?? ""] ?? Workflow;
  return <Icon size={size} strokeWidth={1.5} absoluteStrokeWidth aria-hidden />;
}

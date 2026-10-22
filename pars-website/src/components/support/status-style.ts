import type { TicketPriority, TicketStatus } from "@/lib/ticket-meta";

export const STATUS_STYLE: Record<TicketStatus, string> = {
  new: "border-violet/40 bg-violet/10 text-violet",
  in_progress: "border-warning/40 bg-warning/10 text-warning",
  answered: "border-pink/40 bg-pink/10 text-pink",
  resolved: "border-success/40 bg-success/10 text-success",
  closed: "border-line-strong bg-white/5 text-muted",
};

export const PRIORITY_STYLE: Record<TicketPriority, string> = {
  low: "text-faint",
  normal: "text-muted",
  high: "text-warning",
  urgent: "text-danger",
};

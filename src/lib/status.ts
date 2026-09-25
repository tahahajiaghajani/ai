import type { Priority, RelationType, TaskStatus } from "./types";

export type StageKey =
  | "approval"
  | "prework_queue"
  | "prework_running"
  | "main_queue"
  | "main_running"
  | "closure"
  | "closed";

export interface StageDef {
  key: StageKey;
  label: string;
  short: string;
  description: string;
  statuses: TaskStatus[];
  /** CSS color token used across graph & badges */
  color: string;
  icon: string;
}

/** The 7 nodes of the general live workflow, in order. */
export const STAGES: StageDef[] = [
  {
    key: "approval",
    label: "در انتظار تایید",
    short: "تایید",
    description: "تسک‌های تازه و برگشت‌خورده که منتظر بررسی شما هستند",
    statuses: ["pending_approval", "returned"],
    color: "var(--stage-approval)",
    icon: "inbox",
  },
  {
    key: "prework_queue",
    label: "در صف پیش‌کار",
    short: "صف پیش‌کار",
    description: "تایید شده؛ منتظر انتخاب و پرامپت شما یا نوبت Gemini",
    statuses: ["approved", "prework_queued"],
    color: "var(--stage-prework-queue)",
    icon: "list-ordered",
  },
  {
    key: "prework_running",
    label: "در حال انجام پیش‌کار",
    short: "پیش‌کار",
    description: "ایجنت‌های Gemini در حال تحقیق، WBS و انجام کارهای ساده",
    statuses: ["prework_running"],
    color: "var(--stage-prework)",
    icon: "sparkles",
  },
  {
    key: "main_queue",
    label: "در صف انجام کار اصلی",
    short: "صف کار اصلی",
    description: "پیش‌کار تمام شده؛ منتظر ارسال به Claude",
    statuses: ["prework_done", "main_queued"],
    color: "var(--stage-main-queue)",
    icon: "layers",
  },
  {
    key: "main_running",
    label: "در حال انجام کار اصلی",
    short: "کار اصلی",
    description: "Claude Code در حال انجام و تکمیل تسک",
    statuses: ["main_running", "main_done"],
    color: "var(--stage-main)",
    icon: "bot",
  },
  {
    key: "closure",
    label: "در صف تایید برای خاتمه",
    short: "تایید خاتمه",
    description: "منتظر تایید خاتمه توسط تسک‌دهنده",
    statuses: ["closure_pending", "closure_rejected"],
    color: "var(--stage-closure)",
    icon: "flag",
  },
  {
    key: "closed",
    label: "خاتمه یافته‌ها",
    short: "خاتمه",
    description: "تسک‌های بسته‌شده",
    statuses: ["closed", "cancelled"],
    color: "var(--stage-closed)",
    icon: "check-circle",
  },
];

export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s])) as Record<StageKey, StageDef>;

export function stageOf(status: TaskStatus): StageDef {
  return STAGES.find((s) => s.statuses.includes(status)) ?? STAGES[0];
}

export interface StatusMeta {
  label: string;
  requesterLabel: string;
  tone: "neutral" | "info" | "warning" | "success" | "danger" | "violet" | "cyan";
  progress: number;
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  pending_approval: { label: "در انتظار تایید", requesterLabel: "ارسال شد — در انتظار تایید", tone: "warning", progress: 0 },
  returned: { label: "برگشت‌خورده", requesterLabel: "برگشت خورد — نیاز به اصلاح", tone: "danger", progress: 0 },
  approved: { label: "تایید شده", requesterLabel: "تایید شد — در صف انجام", tone: "info", progress: 10 },
  prework_queued: { label: "در صف اجرای پیش‌کار", requesterLabel: "در صف انجام", tone: "info", progress: 15 },
  prework_running: { label: "در حال پیش‌کار", requesterLabel: "در حال انجام", tone: "violet", progress: 20 },
  prework_done: { label: "پیش‌کار تمام شد", requesterLabel: "در حال انجام", tone: "cyan", progress: 50 },
  main_queued: { label: "در صف Claude", requesterLabel: "در حال انجام", tone: "cyan", progress: 55 },
  main_running: { label: "در حال انجام کار اصلی", requesterLabel: "در حال انجام", tone: "violet", progress: 60 },
  main_done: { label: "کار اصلی انجام شد", requesterLabel: "در حال نهایی‌سازی", tone: "success", progress: 90 },
  closure_pending: { label: "منتظر تایید خاتمه", requesterLabel: "انجام شد — لطفاً خاتمه را تایید کنید", tone: "warning", progress: 95 },
  closure_rejected: { label: "خاتمه رد شد", requesterLabel: "خاتمه را رد کردید — در حال بررسی", tone: "danger", progress: 90 },
  closed: { label: "خاتمه یافته", requesterLabel: "خاتمه یافته", tone: "success", progress: 100 },
  cancelled: { label: "لغو شده", requesterLabel: "لغو شده", tone: "neutral", progress: 0 },
};

export const PRIORITY_META: Record<Priority, { label: string; tone: StatusMeta["tone"]; weight: number }> = {
  low: { label: "کم", tone: "neutral", weight: 30 },
  medium: { label: "متوسط", tone: "info", weight: 50 },
  high: { label: "زیاد", tone: "warning", weight: 70 },
  critical: { label: "بحرانی", tone: "danger", weight: 90 },
};

export const RELATION_META: Record<RelationType, string> = {
  continuation: "ادامه‌ی تسک",
  rejection: "توضیحات رد خاتمه",
  clarification: "توضیح تکمیلی",
  revision: "اصلاحیه",
  other: "مرتبط",
};

/** Statuses from which the admin may close (request closure) at any point. */
export const CLOSABLE: TaskStatus[] = [
  "approved",
  "prework_queued",
  "prework_running",
  "prework_done",
  "main_queued",
  "main_running",
  "main_done",
  "closure_rejected",
  "pending_approval",
];

/** Requester may edit & resubmit only in these statuses. */
export const REQUESTER_EDITABLE: TaskStatus[] = ["pending_approval", "returned"];

/** Prework graph nodes shown in the mini-workflow inside the "prework running" node. */
export const PREWORK_NODES: { key: string; label: string; agent: string }[] = [
  { key: "prepare", label: "آماده‌سازی و بازیابی دانش", agent: "RAG" },
  { key: "research", label: "تحقیق و راهکار", agent: "ایجنت ۱" },
  { key: "wbs", label: "شکست کار (WBS)", agent: "ایجنت ۲" },
  { key: "methods", label: "روش انجام زیرفعالیت‌ها", agent: "ایجنت ۳" },
  { key: "execute", label: "انجام کارهای ساده و آماده‌سازی", agent: "ایجنت ۴" },
  { key: "report", label: "گزارش پیش‌کار", agent: "گزارش" },
  { key: "knowledge", label: "استخراج دانش", agent: "دانش" },
  { key: "publish", label: "انتشار در GitHub", agent: "GitHub" },
];

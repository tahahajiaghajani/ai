// Pure helpers of the DevOps screens (tested in tests/devops-ui.test.ts): durations, DORA bands, pipeline cells.
import { DORA_BANDS, deploymentOutcome, type DoraBand } from "@shared/devops/logic";
import type { ChipTone } from "../../components/display";

export type Row = Record<string, any>;

const fa = (n: number) => n.toLocaleString("fa-IR", { maximumFractionDigits: 1 });

/** A duration in seconds as Persian words: «۴۵ دقیقه»، «۳٫۵ ساعت»، «۲ روز». */
export function humanDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 3600) return `${fa(Math.max(1, Math.round(seconds / 60)))} دقیقه`;
  if (seconds < 86_400) return `${fa(Math.round((seconds / 3600) * 10) / 10)} ساعت`;
  return `${fa(Math.round((seconds / 86_400) * 10) / 10)} روز`;
}

/** Deployments per day as words: «۲ بار در روز»، «۳ بار در هفته»، «۱ بار در ماه». */
export function frequencyText(perDay: number | null | undefined): string {
  if (!perDay) return "بدون استقرار";
  if (perDay >= 1) return `${fa(Math.round(perDay * 10) / 10)} بار در روز`;
  if (perDay * 7 >= 1) return `${fa(Math.round(perDay * 7 * 10) / 10)} بار در هفته`;
  return `${fa(Math.round(perDay * 30 * 10) / 10)} بار در ماه`;
}

export const bandLabel = (b: DoraBand) => DORA_BANDS[b]?.label ?? b;
export const bandTone = (b: DoraBand): ChipTone => (b === "elite" || b === "high" ? "in" : b === "medium" ? "warning" : b === "low" ? "danger" : "neutral");

/** The tone of a deployment state in the pipeline view (a closed deployment by the outcome it was closed with). */
export function deployTone(state: unknown, closeCode?: unknown): ChipTone {
  const s = String(state ?? "");
  const outcome = deploymentOutcome({ state: s, close_code: closeCode });
  if (outcome === "ok") return "in";
  if (outcome === "failed") return "danger";
  if (s === "in_progress") return "accent";
  if (s === "pending_approval") return "warning";
  return "neutral";
}

export const DEPLOY_STATE_LABELS: Record<string, string> = {
  planned: "برنامه‌ریزی‌شده", pending_approval: "در انتظار تأیید", in_progress: "در حال استقرار", succeeded: "موفق", failed: "ناموفق", rolled_back: "بازگردانده", closed: "بسته", canceled: "لغوشده",
};

/** Is a promotion waiting into this environment (a version reached the previous one and not this)? */
export function waitingInto(row: { waiting?: { to: string; version: string }[] }, envId: string): string | null {
  return row.waiting?.find((w) => w.to === envId)?.version ?? null;
}

/** The webhook URL of a connection on this origin. */
export const hookUrl = (origin: string, key: string) => `${origin.replace(/\/$/, "")}/api/public/devops/hooks/${key}`;
export const gateUrl = (origin: string, key: string) => `${origin.replace(/\/$/, "")}/api/public/devops/gates/${key}`;

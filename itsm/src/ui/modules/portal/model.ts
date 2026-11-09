// Pure helpers of the portal's screens (tests: tests/portal-ui.test.ts): paths inside the portal, tones of stages, the
// answer scales of survey questions, the greeting of the hour, relative times in Persian, the accent of a portal.
import { COLOR_KEYS } from "@shared/model/types";
import type { Stage } from "@shared/portal/logic";
import type { QuestionKind } from "@shared/portal/logic";
import type { ChipTone } from "../../components/display";

/** An app path inside the portal: `p(orgId, "t/incident/…")` → `/<org>/portal/t/incident/…`. */
export const portalPath = (orgId: string, rel = ""): string => `/${orgId}/portal${rel ? `/${rel.replace(/^\/+/, "")}` : ""}`;

/** An organisation-relative path the server gave (`portal/kb/<id>`, `r/incident/<id>`) as an app path. */
export const appPath = (orgId: string, rel: string): string => `/${orgId}/${rel.replace(/^\/+/, "")}`;

/** The ticket page of a record. */
export const ticketPath = (orgId: string, table: string, id: string): string => portalPath(orgId, `t/${table}/${id}`);

export const STAGE_CHIP: Record<Stage, ChipTone> = {
  received: "neutral",
  working: "accent",
  waiting_you: "warning",
  waiting: "neutral",
  done: "in",
  closed: "neutral",
  canceled: "neutral",
};

/** The accent of a portal as one of the named colours (anything else: indigo). */
export const accentOf = (v: string | null | undefined): string => (COLOR_KEYS as readonly string[]).includes(String(v)) ? String(v) : "indigo";

/** The options of a numeric survey question (value and label), in reading order. */
export function scaleOf(kind: QuestionKind): { value: number; label: string }[] {
  const fa = (n: number) => n.toLocaleString("fa-IR");
  switch (kind) {
    case "rating":
      return [1, 2, 3, 4, 5].map((v) => ({ value: v, label: fa(v) }));
    case "faces":
      return [
        { value: 1, label: "خیلی بد" },
        { value: 2, label: "بد" },
        { value: 3, label: "معمولی" },
        { value: 4, label: "خوب" },
        { value: 5, label: "عالی" },
      ];
    case "ces":
      return [1, 2, 3, 4, 5, 6, 7].map((v) => ({ value: v, label: fa(v) }));
    case "nps":
    case "scale10":
      return Array.from({ length: 11 }, (_, v) => ({ value: v, label: fa(v) }));
    default:
      return [];
  }
}

/** The words at the two ends of a scale («خیلی کم … خیلی زیاد»). */
export function scaleEnds(kind: QuestionKind): [string, string] | null {
  switch (kind) {
    case "nps":
      return ["اصلاً", "حتماً"];
    case "ces":
      return ["خیلی سخت", "خیلی آسان"];
    case "scale10":
      return ["خیلی کم", "خیلی زیاد"];
    case "rating":
      return ["ناراضی", "خیلی راضی"];
    default:
      return null;
  }
}

/** «صبح بخیر» by the hour of the day. */
export function greeting(hour: number): string {
  if (hour < 5) return "شب بخیر";
  if (hour < 12) return "صبح بخیر";
  if (hour < 17) return "روز بخیر";
  if (hour < 21) return "عصر بخیر";
  return "شب بخیر";
}

const rtf = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl ? new Intl.RelativeTimeFormat("fa", { numeric: "auto" }) : null;

/** «۳ ساعت پیش» — how long ago an instant was (null for an empty value). */
export function ago(iso: string | null | undefined, now = Date.now()): string | null {
  const t = Date.parse(String(iso ?? ""));
  if (Number.isNaN(t)) return null;
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  const fmt = (v: number, u: Intl.RelativeTimeFormatUnit) => (rtf ? rtf.format(v, u) : `${Math.abs(v).toLocaleString("fa-IR")}`);
  if (abs < 60) return "هم‌اکنون";
  if (abs < 3600) return fmt(Math.round(s / 60), "minute");
  if (abs < 86_400) return fmt(Math.round(s / 3600), "hour");
  if (abs < 30 * 86_400) return fmt(Math.round(s / 86_400), "day");
  if (abs < 365 * 86_400) return fmt(Math.round(s / (30 * 86_400)), "month");
  return fmt(Math.round(s / (365 * 86_400)), "year");
}

/** A file size in Persian («۲٫۴ مگابایت»). */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString("fa-IR")} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 0 })} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت`;
}

/** The label of a search hit's kind. */
export const HIT_KINDS: Record<string, string> = { article: "دانش", item: "خدمت", record: "درخواست من", link: "پیوند", topic: "موضوع", announcement: "اطلاعیه" };

/** The order of the hit groups on the results page. */
export const HIT_ORDER = ["record", "article", "item", "topic", "link", "announcement"] as const;

/** Hits grouped by kind, in the page's order (empty groups left out). */
export function groupHits<T extends { kind: string }>(hits: T[]): { kind: string; label: string; hits: T[] }[] {
  return HIT_ORDER.map((kind) => ({ kind, label: HIT_KINDS[kind], hits: hits.filter((h) => h.kind === kind) })).filter((g) => g.hits.length);
}

/** Which items a requester may still need from a list of cards: those waiting on them first, then the newest. */
export function sortForRequester<T extends { stage: Stage; updated_at: string | null }>(items: T[]): T[] {
  const rank = (s: Stage) => (s === "waiting_you" ? 0 : s === "done" ? 1 : 2);
  return [...items].sort((a, b) => rank(a.stage) - rank(b.stage) || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
}

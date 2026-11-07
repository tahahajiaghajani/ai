// Shared parts of «مدیریت سامانه»: titles of statuses and events, small display helpers and the data hooks.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { fa, jDate, jTime } from "../../lib/fa";
import { Chip, type ChipTone } from "../../components/display";
import { BUSINESS_KINDS, MODULES } from "@shared/constants";

export const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
export const ICON14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export type OrgStatus = "active" | "read_only" | "suspended";
export const ORG_STATUS: Record<OrgStatus, [string, ChipTone]> = { active: ["فعال", "in"], read_only: ["فقط‌خواندنی", "warning"], suspended: ["معلق", "danger"] };

export function StatusChip({ s }: { s: OrgStatus | null | undefined }) {
  const [t, tone] = ORG_STATUS[s ?? "active"];
  return <Chip tone={tone}>{t}</Chip>;
}

/** Persian titles of security events (sm_security_events.kind). */
export const EVENT_KIND: Record<string, string> = {
  sign_in: "ورود",
  sign_up: "ساخت حساب",
  password_change: "تغییر رمز",
  password_reset: "رمز موقت",
  password_recover: "بازیابی رمز",
  sessions_revoked: "خروج از همهٔ دستگاه‌ها",
  member_added: "افزودن عضو",
  member_changed: "تغییر نقش یا دسترسی",
  platform_admin: "دسترسی مدیر سامانه",
  user_disabled: "غیرفعال شدن حساب",
  user_enabled: "فعال شدن حساب",
  support_start: "آغاز حالت پشتیبانی",
  support_end: "پایان حالت پشتیبانی",
  org_status: "وضعیت سازمان",
  ai_key: "کلید هوش مصنوعی",
  price_key: "کلید منبع قیمت",
};

const REASON: Record<string, string> = {
  unknown_account: "حساب ناشناخته",
  wrong_password: "رمز نادرست",
  disabled: "حساب غیرفعال",
  rate_limited: "تلاش‌های پیاپی",
  wrong_code: "کد بازیابی نادرست",
  destination_changed: "سرویس یا نشانی عوض شد",
};

const KEY_ACTION: Record<string, string> = { added: "افزوده شد", replaced: "عوض شد", removed: "حذف شد" };

export interface SecurityEvent {
  id: string;
  at: string;
  kind: string;
  ok: boolean;
  user_id: string | null;
  email: string | null;
  org_id: string | null;
  ip: string | null;
  user_agent: string | null;
  data: Record<string, any> | null;
  user_name: string | null;
  org_name: string | null;
}

/** One line about an event: «رمز نادرست»، «حسابدار ← ناظر»، «۲ ساعت؛ دلیل…». */
export function eventDetail(e: SecurityEvent): string {
  const d = e.data ?? {};
  const parts: string[] = [];
  const reason = d.reason && REASON[d.reason] ? REASON[d.reason] : typeof d.reason === "string" ? `دلیل: ${d.reason}` : null;
  if (reason && e.kind !== "ai_key" && e.kind !== "price_key") parts.push(reason);
  if (e.kind === "platform_admin") parts.push(d.granted ? "داده شد" : "گرفته شد");
  if (e.kind === "support_start" && d.level) parts.push(d.level === "edit" ? "مشاهده و اصلاح" : "فقط مشاهده");
  if (e.kind === "org_status" && d.to) parts.push(ORG_STATUS[d.to as OrgStatus]?.[0] ?? d.to);
  if (e.kind === "member_changed" && d.changes?.role) parts.push(`نقش: ${d.changes.role.join(" ← ")}`);
  if (e.kind === "member_changed" && d.changes?.overrides) parts.push("دسترسی ویژه");
  if (e.kind === "member_changed" && d.changes?.is_active) parts.push(d.changes.is_active[1] ? "فعال شد" : "غیرفعال شد");
  if (e.kind === "price_key") {
    if (d.board_title) parts.push(d.board_title);
    if (typeof d.origin === "string") parts.push(d.origin.replace(/^https?:\/\//, ""));
    if (d.runtime) parts.push(d.runtime === "desktop" ? "نسخهٔ ویندوز" : "نسخهٔ وب");
  }
  if (e.kind === "ai_key" || e.kind === "price_key") {
    if (d.label) parts.push(`«${d.label}»`);
    if (d.action && KEY_ACTION[d.action]) parts.push(KEY_ACTION[d.action]);
    if (typeof d.key_hint === "string") parts.push(d.key_hint);
    if (reason) parts.push(reason);
    if (d.support) parts.push("در حالت پشتیبانی");
  }
  if (d.by_name) parts.push(`به دست ${d.by_name}`);
  return parts.join("، ");
}

export function When({ v, block }: { v: string | null | undefined; block?: boolean }) {
  if (!v) return <span className="text-ink-3">—</span>;
  const d = new Date(v);
  return (
    <span className={`${block ? "flex flex-col" : "inline-flex items-baseline gap-2"} whitespace-nowrap`}>
      <span className="ds-num">{jDate(d)}</span>
      <span className="ds-num text-ink-3">{jTime(d)}</span>
    </span>
  );
}

/** «۳ روز پیش» for recent dates; a Jalali date otherwise. */
export function ago(v: string | null | undefined): string {
  if (!v) return "هرگز";
  const ms = Date.now() - new Date(v).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 2) return "همین حالا";
  if (min < 60) return `${fa(min)} دقیقه پیش`;
  const h = Math.round(min / 60);
  if (h < 24) return `${fa(h)} ساعت پیش`;
  const d = Math.round(h / 24);
  if (d < 31) return `${fa(d)} روز پیش`;
  return jDate(new Date(v));
}

export const bytes = (b: number | null | undefined) => {
  const n = Number(b ?? 0);
  if (n >= 1024 * 1024 * 1024) return `${fa(n / 1024 / 1024 / 1024, 1)} گیگابایت`;
  if (n >= 1024 * 1024) return `${fa(n / 1024 / 1024, n >= 100 * 1024 * 1024 ? 0 : 1)} مگابایت`;
  return `${fa(Math.max(1, Math.round(n / 1024)))} کیلوبایت`;
};

export const kindTitle = (v: string) => BUSINESS_KINDS.find((b) => b.key === v)?.title.replace(/\s*\(.*\)$/, "") ?? v;
export const moduleTitle = (m: string) => MODULES.find((x) => x.key === m)?.title ?? m;

export function Mods({ list }: { list: string[] | null | undefined }) {
  if (!list?.length) return <span className="text-ink-3">—</span>;
  return (
    <span className="ad-mods">
      {list.map((m) => (
        <span key={m} className="pg-chip">
          {moduleTitle(m)}
        </span>
      ))}
    </span>
  );
}

/** «$12.40» — AI cost, always in US dollars as the providers bill it. */
export const usd = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function Empty({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="ds-empty ds-fade">
      <div className="ds-empty-tile" aria-hidden>
        {icon}
      </div>
      <div className="ds-empty-title">{title}</div>
      {action ? <div className="ds-empty-act">{action}</div> : null}
    </div>
  );
}

export function useAdminQuery<T>(key: unknown[], path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  return useQuery({ queryKey: ["admin", ...key], queryFn: () => api.get<T>(path, query as never), placeholderData: (p) => p });
}

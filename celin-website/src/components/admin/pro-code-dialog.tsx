"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, Dialog, copyText } from "@/components/admin/ui";
import { Icon, type IconName } from "@/components/ui/icons";
import { formatPhone, num } from "@/lib/format";

/**
 * The Pro code, shown big after it is issued or revealed, with ready-made ways to send it to the member.
 * One dialog per page (ProCodeProvider), opened from any button with useProCode().show(...): the button
 * that issued a code may disappear when the page refreshes (e.g. an approved request), the dialog stays.
 */

export interface ShownCode {
  code: string;
  name?: string;
  phone?: string;
  /** how it was delivered (SMS, e-mail, inbox) */
  note?: string;
  /** link to the member's page */
  href?: string;
  /** a freshly issued code (vs. a stored one shown again) */
  fresh?: boolean;
}

const Ctx = createContext<{ show: (c: ShownCode) => void; siteUrl: string } | null>(null);

export function useProCode() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useProCode outside ProCodeProvider");
  return c;
}

export function ProCodeProvider({ siteUrl, children }: { siteUrl: string; children: ReactNode }) {
  const [shown, setShown] = useState<ShownCode | null>(null);
  const show = useCallback((c: ShownCode) => setShown(c), []);
  const value = useMemo(() => ({ show, siteUrl }), [show, siteUrl]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <CodeDialog value={shown} siteUrl={siteUrl} onClose={() => setShown(null)} />
    </Ctx.Provider>
  );
}

/** The text for the member. The LRM before the code keeps its digit groups in order inside Persian text. */
export function codeMessage(code: string, siteUrl: string): string {
  return `سلین | کد اشتراک Pro شما: \u200e${code}\nورود: ${siteUrl}/pro`;
}

function ShareLink({ href, icon, children }: { href: string; icon: IconName; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-line-strong bg-white px-3 text-sm font-medium text-ink transition-colors hover:border-ink"
    >
      <Icon name={icon} className="size-4" />
      {children}
    </a>
  );
}

export function CodeDialog({ value, siteUrl, onClose }: { value: ShownCode | null; siteUrl: string; onClose: () => void }) {
  const v = value;
  const msg = v ? codeMessage(v.code, siteUrl) : "";
  const phone = v?.phone && /^09\d{9}$/.test(v.phone) ? v.phone : "";
  return (
    <Dialog open={Boolean(v)} onClose={onClose} title={v?.fresh ? "کد اشتراک Pro صادر شد" : "کد اشتراک Pro"}>
      {v && (
        <div className="space-y-5">
          {(v.name || phone) && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{v.name || "—"}</span>
              {phone && <span className="ltr text-muted">{formatPhone(phone, "fa")}</span>}
            </div>
          )}
          <div className="border border-gold/40 bg-white px-4 py-6 text-center">
            <div className="ltr font-mono text-[1.625rem] font-medium tracking-[0.1em] whitespace-nowrap text-ink tabular-nums select-all sm:text-3xl">{v.code}</div>
            <Button size="sm" variant="ghost" icon="copy" className="mt-3" onClick={() => void copyText(v.code, "کد کپی شد.")}>
              کپی کد
            </Button>
          </div>
          {v.note && (
            <p className="flex items-start gap-2 text-xs leading-6 text-ink-2">
              <Icon name="check" className="mt-1 size-3.5 shrink-0 text-success" />
              {v.note}
            </p>
          )}
          <div>
            <div className="mb-2 text-xs font-medium text-ink-2">فرستادن برای عضو</div>
            <pre className="mb-3 border border-line bg-bone px-3 py-2.5 font-sans text-xs leading-6 whitespace-pre-wrap text-ink-2">{msg}</pre>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button variant="secondary" icon="copy" onClick={() => void copyText(msg, "متن پیام کپی شد.")}>
                کپی پیام
              </Button>
              {phone && (
                <ShareLink href={`https://wa.me/98${phone.slice(1)}?text=${encodeURIComponent(msg)}`} icon="whatsapp">
                  واتس‌اپ
                </ShareLink>
              )}
              {phone && (
                <ShareLink href={`sms:${phone}?body=${encodeURIComponent(msg)}`} icon="sms">
                  پیامک
                </ShareLink>
              )}
              <ShareLink href={`https://t.me/share/url?url=${encodeURIComponent(`${siteUrl}/pro`)}&text=${encodeURIComponent(`سلین | کد اشتراک Pro شما: \u200e${v.code}`)}`} icon="telegram">
                تلگرام
              </ShareLink>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-xs leading-6 text-muted">این کد فقط برای همین عضو است.</p>
            <div className="flex gap-2">
              {v.href && (
                <Link href={v.href} onClick={onClose} className="inline-flex h-10 items-center rounded-sm px-3 text-sm text-ink-2 hover:text-ink">
                  صفحه‌ی کاربر
                </Link>
              )}
              <Button onClick={onClose}>بستن</Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ validity

export const DAY_CHOICES = [30, 90, 180, 365, 0];

export function daysLabel(d: number): string {
  return d ? `${num(d, "fa")} روز` : "بدون انقضا";
}

/** Validity chips: ۳۰ / ۹۰ / ۱۸۰ / ۳۶۵ روز / بدون انقضا (plus the settings default when it is another number). */
export function DaysPicker({ value, onChange, defaultDays }: { value: number; onChange: (d: number) => void; defaultDays: number }) {
  const choices = DAY_CHOICES.includes(defaultDays) ? DAY_CHOICES : [...DAY_CHOICES.slice(0, -1), defaultDays, 0].sort((a, b) => (a || 1e9) - (b || 1e9));
  return (
    <div role="radiogroup" aria-label="مدت اعتبار" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {choices.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          onClick={() => onChange(d)}
          className={`h-10 rounded-sm border px-2 text-sm transition-colors ${value === d ? "border-ink bg-ink text-bone" : "border-line-strong bg-white text-ink hover:border-ink"}`}
        >
          {daysLabel(d)}
        </button>
      ))}
    </div>
  );
}

/** Dialog that asks for a validity and runs `onConfirm(days)`. */
export function DaysDialog({
  open,
  onClose,
  title,
  confirmLabel,
  defaultDays,
  pending,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  confirmLabel: string;
  defaultDays: number;
  pending?: boolean;
  onConfirm: (days: number) => void;
  children?: ReactNode;
}) {
  const [days, setDays] = useState(defaultDays);
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="space-y-5">
        {children}
        <div>
          <div className="mb-2 text-xs font-medium text-ink-2">مدت اعتبار از امروز</div>
          <DaysPicker value={days} onChange={setDays} defaultDays={defaultDays} />
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>
            انصراف
          </Button>
          <Button variant="gold" pending={pending} onClick={() => onConfirm(days)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { resetSettingsGroup, saveAnnouncement, saveContact, saveEmail, saveNotify, savePro, saveSale, saveSeo, saveShop, saveSms, testEmail, testNotify, testSms } from "@/app/actions/admin";
import { DaysPicker } from "@/components/admin/pro-code-dialog";
import { Badge, Button, ConfirmButton, Field, Input, MoneyInput, Select, Textarea, Toggle } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import type { Result } from "@/lib/action";
import { common } from "@/content/copy/common";
import { formatDate, formatPct, latinDigits, num } from "@/lib/format";
import { formatJalaliDay, parseJalali, tehranDayEnd, tehranDayStart, toJalali } from "@/lib/jalali";
import { offPct } from "@/lib/pricing";
import { CUSTOM_START, HEX, inkFor, saleLook, saleState, TONE_CLASS, TONE_LABEL } from "@/lib/sale";
import { SALE_TONES, type AnnouncementSettings, type ContactSettings, type NotifyChannel, type ProSettings, type SaleSettings, type SeoSettings, type ShopSettings, type SmsProvider } from "@/lib/settings-types";
import { SaleBarView } from "@/components/site/sale-bar";

/** Client-safe view of the secret groups: never the encrypted values, only whether one is stored. */
export interface NotifyView {
  channel: NotifyChannel;
  hasToken: boolean;
  chatId: string;
  onOrder: boolean;
  onRequest: boolean;
}
export interface SmsView {
  provider: SmsProvider;
  hasKey: boolean;
  sender: string;
  codeTemplate: string;
  statusTemplate: string;
  onCode: boolean;
  onStatus: boolean;
}
export interface EmailView {
  hasKey: boolean;
  mailFrom: string;
  /** RESEND_API_KEY / MAIL_FROM are set in Vercel (used when the panel fields are empty) */
  envKey: boolean;
  envFrom: string;
}

export function Section({ id, title, children, footer }: { id: string; title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border border-line bg-white">
      <header className="border-b border-line px-5 py-4">
        <h2 className="text-base font-medium">{title}</h2>
      </header>
      <div className="space-y-4 p-5">{children}</div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-ground/60 px-5 py-3">{footer}</footer>
    </section>
  );
}

function SaveButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <Button pending={pending} onClick={onClick}>
      ذخیره
    </Button>
  );
}

function ResetButton({ group }: { group: "contact" | "announcement" | "sale" | "shop" | "pro" | "seo" }) {
  const { pending, run } = useAction();
  return (
    <ConfirmButton variant="ghost" icon="refresh" pending={pending} size="md" confirmLabel="بازنشانی؟ دوباره بزنید" onConfirm={() => run(() => resetSettingsGroup({ key: group }))}>
      پیش‌فرض
    </ConfirmButton>
  );
}

/** A secret input: empty keeps the stored value; the placeholder says one is stored. */
function SecretField({
  label,
  hint,
  has,
  value,
  onChange,
  clear,
  onClear,
  placeholder,
}: {
  label: string;
  hint: ReactNode;
  has: boolean;
  value: string;
  onChange: (v: string) => void;
  clear: boolean;
  onClear: (v: boolean) => void;
  placeholder: string;
}) {
  return (
    <div>
      <Field label={label} hint={hint}>
        <Input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          className="text-start"
          disabled={clear}
          placeholder={has ? "ذخیره شده — برای تغییر، مقدار تازه را بگذارید" : placeholder}
        />
      </Field>
      {has && (
        <label className="mt-2 inline-flex min-h-8 cursor-pointer items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" checked={clear} onChange={(e) => onClear(e.target.checked)} className="size-4 accent-danger" />
          حذف مقدار ذخیره‌شده
        </label>
      )}
    </div>
  );
}

function useForm<T extends object>(initial: T) {
  const [f, setF] = useState(initial);
  const set =
    <K extends keyof T>(k: K) =>
    (v: T[K]) =>
      setF((x) => ({ ...x, [k]: v }));
  const input = (k: { [K in keyof T]: T[K] extends string ? K : never }[keyof T]) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return { f, set, input };
}

// ------------------------------------------------------------------ contact

export function ContactForm({ initial }: { initial: ContactSettings }) {
  const { f, input } = useForm(initial);
  const { pending, run } = useAction();
  return (
    <Section
      id="contact"
      title="اطلاعات تماس"
      footer={
        <>
          <ResetButton group="contact" />
          <SaveButton pending={pending} onClick={() => run(() => saveContact({ ...f }))} />
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="تلفن">
          <Input value={f.phone} onChange={input("phone")} dir="ltr" inputMode="tel" className="text-start" placeholder="021 1234 5678" />
        </Field>
        <Field label="واتس‌اپ" hint="شماره‌ی موبایل؛ دکمه‌ی واتس‌اپ سایت به آن وصل می‌شود.">
          <Input value={f.whatsapp} onChange={input("whatsapp")} dir="ltr" inputMode="tel" className="text-start" placeholder="0912 345 6789" />
        </Field>
        <Field label="اینستاگرام" hint="فقط نام کاربری، بدون @.">
          <Input value={f.instagram} onChange={input("instagram")} dir="ltr" className="text-start" placeholder="celin.gallery" />
        </Field>
        <Field label="تلگرام" hint="نام کاربری کانال یا حساب.">
          <Input value={f.telegram} onChange={input("telegram")} dir="ltr" className="text-start" />
        </Field>
        <Field label="ایمیل">
          <Input value={f.email} onChange={input("email")} type="email" dir="ltr" className="text-start" />
        </Field>
        <Field label="لینک نقشه" hint="لینک Google Maps یا نشان، با https://">
          <Input value={f.mapUrl} onChange={input("mapUrl")} dir="ltr" className="text-start" placeholder="https://…" />
        </Field>
        <Field label="نشانی (فارسی)">
          <Textarea rows={2} value={f.address_fa} onChange={input("address_fa")} />
        </Field>
        <Field label="نشانی (انگلیسی)">
          <Textarea rows={2} value={f.address_en} onChange={input("address_en")} dir="ltr" className="text-start" />
        </Field>
        <Field label="ساعت کاری (فارسی)">
          <Input value={f.hours_fa} onChange={input("hours_fa")} />
        </Field>
        <Field label="ساعت کاری (انگلیسی)">
          <Input value={f.hours_en} onChange={input("hours_en")} dir="ltr" className="text-start" />
        </Field>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ announcement

export function AnnouncementForm({ initial }: { initial: AnnouncementSettings }) {
  const { f, set, input } = useForm(initial);
  const { pending, run } = useAction();
  return (
    <Section
      id="announcement"
      title="نوار اطلاعیه"
      footer={
        <>
          <ResetButton group="announcement" />
          <SaveButton pending={pending} onClick={() => run(() => saveAnnouncement({ ...f }))} />
        </>
      }
    >
      <Toggle checked={f.enabled} onChange={set("enabled")} label="نمایش نوار اطلاعیه" hint="یک خط کوتاه بالای همه‌ی صفحه‌های سایت." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="متن (فارسی)">
          <Input value={f.text_fa} onChange={input("text_fa")} maxLength={200} placeholder="مثلاً: مجموعه‌ی تازه‌ی پاییز رسید" />
        </Field>
        <Field label="متن (انگلیسی)">
          <Input value={f.text_en} onChange={input("text_en")} maxLength={200} dir="ltr" className="text-start" />
        </Field>
      </div>
      <Field label="لینک (اختیاری)" hint="نشانی داخل سایت مثل /shop یا لینک کامل با https.">
        <Input value={f.link} onChange={input("link")} dir="ltr" className="text-start" placeholder="/collections/…" />
      </Field>
    </Section>
  );
}

// ------------------------------------------------------------------ special-day discount

/** A stored instant as the form's day: the day it starts, or (for the end, which is exclusive) the last day. */
const dayOf = (iso: string, end: boolean) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? formatJalaliDay(toJalali(end ? t - 1 : t), "fa") : "";
};

/** The form's day → the instant (start of the day, or the first moment after it); null = empty; NaN = not a day. */
function dayTime(v: string, end: boolean): number | null {
  if (!v.trim()) return null;
  const d = parseJalali(v);
  const t = d ? (end ? tehranDayEnd(d.jy, d.jm, d.jd) : tehranDayStart(d.jy, d.jm, d.jd)) : null;
  return t ?? Number.NaN;
}

export function SaleForm({ initial }: { initial: SaleSettings }) {
  const { f, set, input } = useForm({ ...initial, pct: String(initial.pct), from: dayOf(initial.from, false), until: dayOf(initial.until, true) });
  const { pending, run } = useAction();
  // the state badge reads the clock after mounting (the page is rendered on the server first)
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const pct = Math.floor(Number(latinDigits(f.pct))) || 0;
  const from = dayTime(f.from, false);
  const until = dayTime(f.until, true);
  const draft: SaleSettings = {
    ...f,
    pct,
    color: f.tone === "custom" ? f.color : "",
    from: from && Number.isFinite(from) ? new Date(from).toISOString() : "",
    until: until && Number.isFinite(until) ? new Date(until).toISOString() : "",
  };
  const state = now === null ? null : saleState(draft, now);
  const custom = f.tone === "custom";
  const ink = custom && HEX.test(f.color) ? inkFor(f.color) : null;
  const when = (t: number | null, end: boolean) =>
    t === null ? undefined : Number.isNaN(t) ? undefined : end ? `تا پایان ${formatDate(new Date(t - 1).toISOString(), "fa")} (به وقت تهران)` : `از آغاز ${formatDate(new Date(t).toISOString(), "fa")} (به وقت تهران)`;
  const badge =
    state === "live" ? <Badge tone="success">در حال اجرا</Badge>
    : state === "soon" ? <Badge tone="gold">{`شروع: ${formatDate(draft.from, "fa")}`}</Badge>
    : state === "over" ? <Badge tone="warning">پایان یافته</Badge>
    : state === "off" ? <Badge>خاموش</Badge>
    : null;
  return (
    <Section
      id="sale"
      title="نوار تخفیف روزهای خاص"
      footer={
        <>
          <ResetButton group="sale" />
          <SaveButton pending={pending} onClick={() => run(() => saveSale({ ...f, pct }))} />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>با این تنظیمات:</span>
        {badge}
      </div>
      <Toggle
        checked={f.enabled}
        onChange={set("enabled")}
        label="نمایش نوار و اعمال تخفیف"
        hint="تا روشن است و در بازه‌ی تاریخ، نوار جای نوار اطلاعیه را می‌گیرد و درصد تخفیف روی قیمت هر قطعه، پس از تخفیف تعداد، در سبد و فاکتور اعمال می‌شود."
      />
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="درصد تخفیف" hint="۱ تا ۹۰؛ روی قیمت هر قطعه، پس از تخفیف تعداد.">
          <Input value={num(f.pct, "fa")} onChange={(e) => set("pct")(latinDigits(e.target.value).replace(/\D/g, "").slice(0, 2))} inputMode="numeric" dir="ltr" className="max-w-24 text-start" aria-label="درصد تخفیف" />
        </Field>
        <Toggle checked={f.pro} onChange={set("pro")} label="حساب‌های Pro هم این تخفیف را بگیرند" hint="روشن باشد، حساب‌های Pro هم زیر قیمت عمده خرید می‌کنند." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="عنوان (فارسی)" hint="مثلاً «جشن یلدا»؛ خالی بماند، «تخفیف روزهای خاص» نوشته می‌شود.">
          <Input value={f.title_fa} onChange={input("title_fa")} maxLength={60} />
        </Field>
        <Field label="عنوان (انگلیسی)">
          <Input value={f.title_en} onChange={input("title_en")} maxLength={60} dir="ltr" className="text-start" />
        </Field>
        <Field label="توضیح (فارسی)" hint="یک خط کوتاه؛ روی گوشی دیده نمی‌شود.">
          <Input value={f.text_fa} onChange={input("text_fa")} maxLength={160} />
        </Field>
        <Field label="توضیح (انگلیسی)">
          <Input value={f.text_en} onChange={input("text_en")} maxLength={160} dir="ltr" className="text-start" />
        </Field>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium text-ink-2">رنگ نوار</div>
        <div role="radiogroup" aria-label="رنگ نوار" className="flex flex-wrap items-center gap-2">
          {SALE_TONES.filter((t) => t !== "custom").map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={f.tone === t}
              onClick={() => set("tone")(t)}
              className={`h-9 rounded-sm border px-3 text-xs ${TONE_CLASS[t as Exclude<typeof t, "custom">]} ${f.tone === t ? "outline outline-2 outline-offset-2 outline-ink" : ""}`}
            >
              {TONE_LABEL[t]}
            </button>
          ))}
          <label
            className={`relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-line-strong bg-white px-3 text-xs text-ink-2 focus-within:outline focus-within:outline-1 focus-within:outline-gold ${custom ? "outline outline-2 outline-offset-2 outline-ink" : ""}`}
          >
            {/* the admin's own colour (the only raw colour here is the picker's starting point) */}
            <input
              type="color"
              value={HEX.test(f.color) ? f.color : CUSTOM_START}
              onChange={(e) => {
                set("color")(e.target.value.toLowerCase());
                set("tone")("custom");
              }}
              onClick={() => set("tone")("custom")}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              aria-label={TONE_LABEL.custom}
            />
            <span aria-hidden className="size-4 rounded-full border border-line-strong bg-[var(--sale-bg)]" style={{ "--sale-bg": HEX.test(f.color) ? f.color : CUSTOM_START } as CSSProperties} />
            {TONE_LABEL.custom}
            {custom && HEX.test(f.color) && <span className="ltr font-mono text-muted">{f.color}</span>}
          </label>
        </div>
        {ink && (
          <p className={`mt-2 text-xs leading-5 ${ink.ratio < 4.5 ? "text-danger" : "text-muted"}`}>
            {ink.ratio < 4.5
              ? `کنتراست نوشته روی این رنگ ${num(ink.ratio.toFixed(1), "fa")} به ۱ است و خوانا نیست (دست‌کم ۴٫۵ لازم است)؛ رنگی تیره‌تر یا روشن‌تر انتخاب کنید.`
              : `نوشته ${ink.ink === "dark" ? "تیره" : "روشن"} روی این رنگ؛ کنتراست ${num(ink.ratio.toFixed(1), "fa")} به ۱.`}
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="از روز (اختیاری)" error={Number.isNaN(from) ? "این روز در تقویم نیست؛ مثل ۱۴۰۵/۰۹/۳۰ بنویسید." : undefined} hint={when(from, false) ?? "خالی: از همین حالا."}>
          <Input value={f.from} onChange={input("from")} dir="ltr" inputMode="numeric" className="text-start" placeholder="۱۴۰۵/۰۹/۳۰" maxLength={12} />
        </Field>
        <Field
          label="تا پایان روز (اختیاری)"
          error={Number.isNaN(until) ? "این روز در تقویم نیست؛ مثل ۱۴۰۵/۱۰/۰۲ بنویسید." : from !== null && until !== null && until <= from ? "روز پایان نباید پیش از روز شروع باشد." : undefined}
          hint={when(until, true) ?? "خالی: تا وقتی خاموشش کنید."}
        >
          <Input value={f.until} onChange={input("until")} dir="ltr" inputMode="numeric" className="text-start" placeholder="۱۴۰۵/۱۰/۰۲" maxLength={12} />
        </Field>
      </div>
      <Field label="لینک (اختیاری)" hint="نشانی داخل سایت مثل /shop یا لینک کامل با https.">
        <Input value={f.link} onChange={input("link")} dir="ltr" className="text-start" placeholder="/shop" />
      </Field>
      <div>
        <div className="mb-2 text-xs font-medium text-ink-2">پیش‌نمایش</div>
        <div className="space-y-2 border border-line bg-ground p-2">
          <SaleBarView lang="fa" bar={saleLook(draft, "fa", common.fa.sale)} preview />
          <div dir="ltr">
            <SaleBarView lang="en" bar={saleLook(draft, "en", common.en.sale)} preview />
          </div>
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ shop

export function ShopForm({ initial }: { initial: ShopSettings }) {
  const { f, set, input } = useForm(initial);
  const { pending, run } = useAction();
  return (
    <Section
      id="shop"
      title="سفارش"
      footer={
        <>
          <ResetButton group="shop" />
          <SaveButton pending={pending} onClick={() => run(() => saveShop({ ...f }))} />
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="حداقل مبلغ سفارش" hint="خالی یا صفر یعنی بدون حداقل.">
          <MoneyInput value={f.minOrder || null} onChange={(v) => set("minOrder")(v ?? 0)} placeholder="بدون حداقل" />
        </Field>
        <Field label="نمایش موجودی به حساب‌های Pro" hint={f.stockDisplay === "level" ? "عدد دقیق فقط زیر آستانه‌ی «رو به اتمام» دیده می‌شود." : undefined}>
          <Select value={f.stockDisplay} onChange={(e) => set("stockDisplay")(e.target.value === "level" ? "level" : "exact")}>
            <option value="exact">عدد دقیق (مثلاً ۴ عدد)</option>
            <option value="level">سطح (موجود / رو به اتمام / ناموجود)</option>
          </Select>
        </Field>
        <Field label="آستانه‌ی «رو به اتمام»" hint="موجودی برابر یا کمتر از این عدد.">
          <Input type="number" min={0} max={1000} value={f.lowStock} onChange={(e) => set("lowStock")(Math.max(0, Math.round(Number(e.target.value) || 0)))} dir="ltr" className="text-start" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="توضیح بالای دکمه‌ی سفارش (فارسی)">
          <Textarea rows={3} value={f.orderNote_fa} onChange={input("orderNote_fa")} maxLength={600} />
        </Field>
        <Field label="توضیح بالای دکمه‌ی سفارش (انگلیسی)">
          <Textarea rows={3} value={f.orderNote_en} onChange={input("orderNote_en")} maxLength={600} dir="ltr" className="text-start" />
        </Field>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ membership and Pro

export function ProForm({ initial }: { initial: ProSettings }) {
  const { f, set } = useForm(initial);
  const { pending, run } = useAction();
  return (
    <Section
      id="pro"
      title="عضویت و Pro"
      footer={
        <>
          <ResetButton group="pro" />
          <SaveButton pending={pending} onClick={() => run(() => savePro({ ...f }))} />
        </>
      }
    >
      <Toggle checked={f.codeInInbox} onChange={set("codeInInbox")} label="نمایش کد در پیام‌های حساب عضو" hint="خاموش باشد، کد فقط با پیامک، ایمیل یا دکمه‌های اشتراک‌گذاری به عضو می‌رسد و در پیام‌های قبلی هم نمایش داده نمی‌شود." />
      <div>
        <div className="mb-2 text-xs font-medium text-ink-2">اعتبار پیش‌فرض کد عضویت تازه</div>
        <DaysPicker value={f.defaultDays} onChange={set("defaultDays")} defaultDays={initial.defaultDays} />
      </div>
      <PriceLadder f={f} set={set} />
    </Section>
  );
}

/**
 * The members' prices in percent of the admin's (wholesale) price: the list price of one piece, then the steps by
 * pieces in one order (the invoice shows the difference as «تخفیف تعداد»); and when an account becomes Pro.
 */
function PriceLadder({ f, set }: { f: ProSettings; set: <K extends keyof ProSettings>(k: K) => (v: ProSettings[K]) => void }) {
  const pct = (v: string) => Math.max(0, Math.min(1000, Math.round(Number(v.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[^\d]/g, "")) || 0)));
  const step = (i: number, k: "min" | "pct", v: string) => set("steps")(f.steps.map((s, j) => (j === i ? { ...s, [k]: pct(v) } : s)));
  return (
    <div className="space-y-4 border-t border-line pt-4">
      <div className="text-sm font-medium text-ink">قیمت اعضا (درصدی از قیمتی که در محصولات ثبت می‌کنید)</div>
      <Field label="قیمت هر قطعه برای اعضا" hint="۲۰۰ یعنی دو برابر قیمت ثبت‌شده. اعضای Pro همیشه همان قیمت ثبت‌شده را می‌بینند.">
        <Input value={String(f.memberPct)} onChange={(e) => set("memberPct")(pct(e.target.value))} inputMode="numeric" dir="ltr" className="max-w-32" aria-label="درصد قیمت اعضا" />
      </Field>
      <div>
        <div className="mb-2 text-xs font-medium text-ink-2">پله‌های فاکتور بر اساس تعداد قطعه‌های یک سفارش</div>
        <div className="space-y-2">
          {f.steps.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <span>از</span>
              <Input value={String(s.min)} onChange={(e) => step(i, "min", e.target.value)} inputMode="numeric" dir="ltr" className="w-20" aria-label={`پله‌ی ${num(i + 1, "fa")}: از چند قطعه`} />
              <span>قطعه:</span>
              <Input value={String(s.pct)} onChange={(e) => step(i, "pct", e.target.value)} inputMode="numeric" dir="ltr" className="w-20" aria-label={`پله‌ی ${num(i + 1, "fa")}: درصد`} />
              <span>درصد</span>
              {offPct(f.memberPct, s.pct) > 0 && <span className="text-xs text-muted">(برای عضو {formatPct(offPct(f.memberPct, s.pct), "fa")} تخفیف روی کل فاکتور)</span>}
              <Button variant="ghost" size="sm" icon="trash" onClick={() => set("steps")(f.steps.filter((_, j) => j !== i))} aria-label={`حذف پله‌ی ${num(i + 1, "fa")}`} />
            </div>
          ))}
        </div>
        {f.steps.length < 8 && (
          <Button variant="secondary" size="sm" icon="plus" className="mt-2" onClick={() => set("steps")([...f.steps, { min: (f.steps[f.steps.length - 1]?.min ?? 1) + 5, pct: 100 }])}>
            پله‌ی تازه
          </Button>
        )}
        <p className="mt-2 text-xs leading-5 text-muted">هر پله درصد کمتری از پله‌ی قبل دارد و ۱۰۰ یعنی همان قیمت ثبت‌شده (قیمت عمده).</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pro شدن خودکار با خرید (تومان)" hint="جمع سفارش‌های تأییدشده‌ی یک حساب در بازه‌ی روبه‌رو؛ ۰ یعنی خاموش.">
          <MoneyInput value={f.proThreshold} onChange={(v) => set("proThreshold")(v ?? 0)} aria-label="مبلغ Pro شدن" />
        </Field>
        <Field label="در چند روز" hint="مثلاً ۳۰ یعنی خریدهای ۳۰ روز گذشته.">
          <Input value={String(f.proDays)} onChange={(e) => set("proDays")(pct(e.target.value) || 30)} inputMode="numeric" dir="ltr" className="max-w-32" aria-label="بازه‌ی روزها" />
        </Field>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ notify

export function NotifyForm({ initial }: { initial: NotifyView }) {
  const [f, setF] = useState({ channel: initial.channel, botToken: "", clearToken: false, chatId: initial.chatId, onOrder: initial.onOrder, onRequest: initial.onRequest });
  const { pending, run } = useAction();
  const test = useAction();
  const off = f.channel === "none";
  const save = () => saveNotify({ ...f });
  const saved = { onOk: () => setF((x) => ({ ...x, botToken: "", clearToken: false })) };
  return (
    <Section
      id="notify"
      title="اعلان به مدیر"
      footer={
        <>
          <Button
            variant="secondary"
            icon="telegram"
            pending={test.pending}
            disabled={off}
            onClick={() =>
              test.run(async (): Promise<Result> => {
                const r = await save();
                return r.ok ? testNotify() : r;
              }, saved)
            }
          >
            ذخیره و پیام آزمایشی
          </Button>
          <SaveButton pending={pending} onClick={() => run(save, saved)} />
        </>
      }
    >
      <Field label="کانال" hint="سفارش و درخواست عضویت تازه به این گفتگو فرستاده می‌شود.">
        <Select value={f.channel} onChange={(e) => setF((x) => ({ ...x, channel: e.target.value as NotifyChannel }))}>
          <option value="none">خاموش</option>
          <option value="telegram">تلگرام</option>
          <option value="bale">بله</option>
        </Select>
      </Field>
      {!off && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SecretField
              label="توکن ربات"
              has={initial.hasToken}
              value={f.botToken}
              onChange={(v) => setF((x) => ({ ...x, botToken: v }))}
              clear={f.clearToken}
              onClear={(v) => setF((x) => ({ ...x, clearToken: v }))}
              placeholder="123456:ABC…"
              hint={
                f.channel === "bale" ? (
                  <>
                    در بله به <span className="ltr">@botfather</span> پیام دهید، یک «بازو» بسازید و توکنش را این‌جا بگذارید.
                  </>
                ) : (
                  <>
                    در تلگرام به <span className="ltr">@BotFather</span> پیام دهید، <span className="ltr">/newbot</span> را بزنید و توکن را این‌جا بگذارید.
                  </>
                )
              }
            />
            <Field
              label="شناسه‌ی گفتگو (chat id)"
              hint={
                <>
                  ربات را به گروه مدیران اضافه کنید و شناسه را از <span className="ltr">@userinfobot</span> بگیرید.
                </>
              }
            >
              <Input value={f.chatId} onChange={(e) => setF((x) => ({ ...x, chatId: e.target.value }))} dir="ltr" className="text-start" placeholder="-1001234567890" />
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle checked={f.onOrder} onChange={(v) => setF((x) => ({ ...x, onOrder: v }))} label="سفارش تازه" />
            <Toggle checked={f.onRequest} onChange={(v) => setF((x) => ({ ...x, onRequest: v }))} label="درخواست عضویت تازه" />
          </div>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ sms

export function SmsForm({ initial }: { initial: SmsView }) {
  const [f, setF] = useState({
    provider: initial.provider,
    apiKey: "",
    clearKey: false,
    sender: initial.sender,
    codeTemplate: initial.codeTemplate,
    statusTemplate: initial.statusTemplate,
    onCode: initial.onCode,
    onStatus: initial.onStatus,
  });
  const [phone, setPhone] = useState("");
  const { pending, run } = useAction();
  const test = useAction();
  const off = f.provider === "none";
  const smsir = f.provider === "smsir";
  const save = () => saveSms({ ...f });
  const saved = { onOk: () => setF((x) => ({ ...x, apiKey: "", clearKey: false })) };
  const digits = (v: string) => v.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\D/g, "");
  return (
    <Section id="sms" title="پیامک" footer={<SaveButton pending={pending} onClick={() => run(save, saved)} />}>
      <Field label="سرویس پیامک" hint="SMS.ir پیشنهاد می‌شود؛ کاوه‌نگار معمولاً از سرورهای خارج از ایران (Vercel) پاسخ نمی‌دهد.">
        <Select value={f.provider} onChange={(e) => setF((x) => ({ ...x, provider: e.target.value as SmsProvider }))}>
          <option value="none">خاموش</option>
          <option value="smsir">SMS.ir (پیشنهادی)</option>
          <option value="kavenegar">کاوه‌نگار</option>
        </Select>
      </Field>
      {!off && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SecretField
              label="کلید API"
              has={initial.hasKey}
              value={f.apiKey}
              onChange={(v) => setF((x) => ({ ...x, apiKey: v }))}
              clear={f.clearKey}
              onClear={(v) => setF((x) => ({ ...x, clearKey: v }))}
              placeholder="API key"
              hint={smsir ? "پنل SMS.ir ← برنامه‌نویسان ← کلید API (لایو)." : "پنل کاوه‌نگار ← تنظیمات ← کلید API."}
            />
            <Field label="شماره‌ی خط فرستنده" hint={smsir ? "فقط برای متن آزاد بدون قالب؛ به خط اختصاصی نیاز دارد." : "اختیاری؛ خالی بماند از خط پیش‌فرض حساب فرستاده می‌شود."}>
              <Input value={f.sender} onChange={(e) => setF((x) => ({ ...x, sender: e.target.value }))} dir="ltr" inputMode="numeric" className="text-start" placeholder="3000…" />
            </Field>
          </div>
          {smsir && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="شناسه‌ی قالب کد عضویت و Pro"
                hint={
                  <>
                    متن قالب باید <span className="ltr">#CODE#</span> داشته باشد؛ مثلاً «سلین | کد اختصاصی شما: <span className="ltr">#CODE#</span>».
                  </>
                }
              >
                <Input
                  value={f.codeTemplate}
                  onChange={(e) => setF((x) => ({ ...x, codeTemplate: digits(e.target.value) }))}
                  dir="ltr"
                  inputMode="numeric"
                  className="text-start"
                  placeholder="123456"
                  maxLength={20}
                />
              </Field>
              <Field
                label="شناسه‌ی قالب وضعیت سفارش"
                hint={
                  <>
                    متن قالب باید <span className="ltr">#ORDER#</span> و <span className="ltr">#STATUS#</span> داشته باشد.
                  </>
                }
              >
                <Input
                  value={f.statusTemplate}
                  onChange={(e) => setF((x) => ({ ...x, statusTemplate: digits(e.target.value) }))}
                  dir="ltr"
                  inputMode="numeric"
                  className="text-start"
                  placeholder="654321"
                  maxLength={20}
                />
              </Field>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle checked={f.onCode} onChange={(v) => setF((x) => ({ ...x, onCode: v }))} label="ارسال کد عضویت و Pro" />
            <Toggle checked={f.onStatus} onChange={(v) => setF((x) => ({ ...x, onStatus: v }))} label="ارسال تغییر وضعیت سفارش" />
          </div>
          <div className="border-t border-line pt-4">
            <Field label="پیامک آزمایشی" hint="تنظیمات بالا ذخیره و یک پیامک کوتاه به این شماره فرستاده می‌شود.">
              <div className="flex gap-2">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" className="min-w-0 flex-1 text-start" placeholder="09123456789" />
                <Button
                  variant="secondary"
                  icon="sms"
                  pending={test.pending}
                  disabled={!phone.trim()}
                  onClick={() =>
                    test.run(async (): Promise<Result> => {
                      const r = await save();
                      return r.ok ? testSms({ phone }) : r;
                    }, saved)
                  }
                >
                  ارسال
                </Button>
              </div>
            </Field>
          </div>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ email

export function EmailForm({ initial }: { initial: EmailView }) {
  const [f, setF] = useState({ resendKey: "", clearKey: false, mailFrom: initial.mailFrom });
  const [to, setTo] = useState("");
  const { pending, run } = useAction();
  const test = useAction();
  const save = () => saveEmail({ ...f });
  const saved = { onOk: () => setF((x) => ({ ...x, resendKey: "", clearKey: false })) };
  return (
    <Section id="email" title="ایمیل" footer={<SaveButton pending={pending} onClick={() => run(save, saved)} />}>
      {(initial.envKey || initial.envFrom) && (
        <p className="text-xs leading-6 text-muted">
          <Badge tone="neutral">Vercel</Badge> مقدارهای <span className="ltr font-mono">RESEND_API_KEY</span> / <span className="ltr font-mono">MAIL_FROM</span> تنظیم شده‌اند؛ مقدار این‌جا بر آن‌ها
          مقدم است.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <SecretField
          label="کلید Resend"
          has={initial.hasKey}
          value={f.resendKey}
          onChange={(v) => setF((x) => ({ ...x, resendKey: v }))}
          clear={f.clearKey}
          onClear={(v) => setF((x) => ({ ...x, clearKey: v }))}
          placeholder="re_…"
          hint="در resend.com حساب رایگان بسازید (۳٬۰۰۰ ایمیل در ماه)، دامنه را تأیید و کلید API بسازید."
        />
        <Field label="فرستنده" hint="با دامنه‌ی تأییدشده در Resend.">
          <Input value={f.mailFrom} onChange={(e) => setF((x) => ({ ...x, mailFrom: e.target.value }))} dir="ltr" className="text-start" placeholder={initial.envFrom || "CELIN <shop@domain.com>"} />
        </Field>
      </div>
      <div className="border-t border-line pt-4">
        <Field label="ایمیل آزمایشی" hint="تنظیمات بالا ذخیره و یک ایمیل کوتاه به این نشانی فرستاده می‌شود.">
          <div className="flex gap-2">
            <Input value={to} onChange={(e) => setTo(e.target.value)} type="email" dir="ltr" className="min-w-0 flex-1 text-start" placeholder="you@example.com" />
            <Button
              variant="secondary"
              icon="mail"
              pending={test.pending}
              disabled={!to.trim()}
              onClick={() =>
                test.run(async (): Promise<Result> => {
                  const r = await save();
                  return r.ok ? testEmail({ to }) : r;
                }, saved)
              }
            >
              ارسال
            </Button>
          </div>
        </Field>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ seo

export function SeoForm({ initial }: { initial: SeoSettings }) {
  const { f, input } = useForm(initial);
  const { pending, run } = useAction();
  return (
    <Section
      id="seo"
      title="سئو"
      footer={
        <>
          <ResetButton group="seo" />
          <SaveButton pending={pending} onClick={() => run(() => saveSeo({ ...f }))} />
        </>
      }
    >
      <Field label="توضیح سایت در گوگل (فارسی)" hint={`${new Intl.NumberFormat("fa-IR").format(f.description_fa.length)} از ۳۰۰ نویسه؛ خالی بماند، متن پیش‌فرض استفاده می‌شود.`}>
        <Textarea rows={3} value={f.description_fa} onChange={input("description_fa")} maxLength={300} />
      </Field>
      <Field label="توضیح سایت در گوگل (انگلیسی)" hint={`${new Intl.NumberFormat("fa-IR").format(f.description_en.length)} از ۳۰۰ نویسه`}>
        <Textarea rows={3} value={f.description_en} onChange={input("description_en")} maxLength={300} dir="ltr" className="text-start" />
      </Field>
    </Section>
  );
}

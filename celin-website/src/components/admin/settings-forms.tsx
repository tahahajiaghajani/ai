"use client";

import { useState, type ReactNode } from "react";
import { resetSettingsGroup, saveAnnouncement, saveContact, saveEmail, saveNotify, savePro, saveSeo, saveShop, saveSms, testEmail, testNotify, testSms } from "@/app/actions/admin";
import { DaysPicker } from "@/components/admin/pro-code-dialog";
import { Badge, Button, ConfirmButton, Field, Input, MoneyInput, Select, Textarea, Toggle } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import type { Result } from "@/lib/action";
import type { AnnouncementSettings, ContactSettings, NotifyChannel, ProSettings, SeoSettings, ShopSettings, SmsProvider } from "@/lib/settings-types";

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

function Section({ id, title, children, footer }: { id: string; title: string; children: ReactNode; footer: ReactNode }) {
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

function ResetButton({ group }: { group: "contact" | "announcement" | "shop" | "pro" | "seo" }) {
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
        <Field label="نمایش موجودی به اعضای Pro" hint={f.stockDisplay === "level" ? "عدد دقیق فقط زیر آستانه‌ی «رو به اتمام» دیده می‌شود." : undefined}>
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

// ------------------------------------------------------------------ pro

export function ProForm({ initial }: { initial: ProSettings }) {
  const { f, set } = useForm(initial);
  const { pending, run } = useAction();
  return (
    <Section
      id="pro"
      title="اشتراک Pro"
      footer={
        <>
          <ResetButton group="pro" />
          <SaveButton pending={pending} onClick={() => run(() => savePro({ ...f }))} />
        </>
      }
    >
      <Toggle checked={f.codeInInbox} onChange={set("codeInInbox")} label="نمایش کد در پیام‌های حساب عضو" hint="خاموش باشد، کد فقط با پیامک، ایمیل یا دکمه‌های اشتراک‌گذاری به عضو می‌رسد و در پیام‌های قبلی هم نمایش داده نمی‌شود." />
      <div>
        <div className="mb-2 text-xs font-medium text-ink-2">اعتبار پیش‌فرض کد تازه</div>
        <DaysPicker value={f.defaultDays} onChange={set("defaultDays")} defaultDays={initial.defaultDays} />
      </div>
    </Section>
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
      <Field label="کانال" hint="سفارش و درخواست Pro تازه به این گفتگو فرستاده می‌شود.">
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
            <Toggle checked={f.onRequest} onChange={(v) => setF((x) => ({ ...x, onRequest: v }))} label="درخواست Pro تازه" />
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
                label="شناسه‌ی قالب کد Pro"
                hint={
                  <>
                    متن قالب باید <span className="ltr">#CODE#</span> داشته باشد؛ مثلاً «سلین | کد اشتراک Pro شما: <span className="ltr">#CODE#</span>».
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
            <Toggle checked={f.onCode} onChange={(v) => setF((x) => ({ ...x, onCode: v }))} label="ارسال کد Pro" />
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

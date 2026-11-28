import { requireAdminPage } from "@/lib/admin-auth";
import { optionUsage } from "@/lib/admin-catalog";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { paletteOf } from "@/lib/options";
import { getSettingsFresh } from "@/lib/settings";
import { DbMissing, Empty, PageHeader } from "@/components/admin/ui";
import { AnnouncementForm, ContactForm, EmailForm, NotifyForm, ProForm, SaleForm, SeoForm, ShopForm, SmsForm } from "@/components/admin/settings-forms";
import { OptionPaletteForm } from "@/components/admin/option-palette";

const NAV = [
  ["contact", "تماس"],
  ["announcement", "اطلاعیه"],
  ["sale", "تخفیف روزهای خاص"],
  ["shop", "سفارش"],
  ["options", "رنگ‌های گزینه‌ها"],
  ["pro", "عضویت و Pro"],
  ["notify", "اعلان مدیر"],
  ["sms", "پیامک"],
  ["email", "ایمیل"],
  ["seo", "سئو"],
] as const;

export default async function SettingsPage() {
  await requireAdminPage();
  if (!db()) {
    return (
      <>
        <PageHeader title="تنظیمات" />
        <DbMissing />
      </>
    );
  }
  let s;
  let usage: Record<string, number>;
  try {
    [s, usage] = await Promise.all([getSettingsFresh(), optionUsage()]);
  } catch (e) {
    return (
      <>
        <PageHeader title="تنظیمات" />
        <Empty title="تنظیمات خوانده نشد">{e instanceof Error ? e.message : String(e)}</Empty>
      </>
    );
  }
  // secrets never leave the server: the forms only learn whether one is stored
  const notify = {
    channel: s.notify.channel,
    hasToken: Boolean(s.notify.botTokenEnc && decrypt(s.notify.botTokenEnc)),
    chatId: s.notify.chatId,
    onOrder: s.notify.onOrder,
    onRequest: s.notify.onRequest,
  };
  const sms = {
    provider: s.sms.provider,
    hasKey: Boolean(s.sms.apiKeyEnc && decrypt(s.sms.apiKeyEnc)),
    sender: s.sms.sender,
    codeTemplate: s.sms.codeTemplate ?? "",
    statusTemplate: s.sms.statusTemplate ?? "",
    onCode: s.sms.onCode,
    onStatus: s.sms.onStatus,
  };
  const email = { hasKey: Boolean(s.email.resendKeyEnc && decrypt(s.email.resendKeyEnc)), mailFrom: s.email.mailFrom, envKey: Boolean(env.resendKey), envFrom: env.mailFrom };
  // a form remounts with the stored values after each save (keys change with the data)
  const k = (v: unknown) => JSON.stringify(v);

  return (
    <>
      <PageHeader title="تنظیمات" />
      <nav aria-label="بخش‌های تنظیمات" className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {NAV.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="inline-flex h-9 shrink-0 items-center rounded-sm border border-line bg-white px-3 text-sm text-ink-2 transition-colors hover:border-ink hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="space-y-6">
        <ContactForm key={k(s.contact)} initial={s.contact} />
        <AnnouncementForm key={k(s.announcement)} initial={s.announcement} />
        <SaleForm key={k(s.sale)} initial={s.sale} />
        <ShopForm key={k(s.shop)} initial={s.shop} />
        <OptionPaletteForm key={k(s.options)} initial={paletteOf(s.options)} usage={usage} />
        <ProForm key={k(s.pro)} initial={s.pro} />
        <NotifyForm key={k(notify)} initial={notify} />
        <SmsForm key={k(sms)} initial={sms} />
        <EmailForm key={k(email)} initial={email} />
        <SeoForm key={k(s.seo)} initial={s.seo} />
      </div>
    </>
  );
}

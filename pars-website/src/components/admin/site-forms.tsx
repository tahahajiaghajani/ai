"use client";

import { useState } from "react";
import { saveNotify, saveSite, testNotify } from "@/app/actions/admin";
import type { NotifySettings, SiteContent } from "@/lib/settings-types";
import { num } from "@/lib/digits";
import { Button, Field, Input, Select, Spinner, Textarea } from "@/components/ui/field";
import { Panel, Toggle } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";

export function SiteForm({ initial }: { initial: SiteContent }) {
  const [s, setS] = useState(initial);
  const { pending, run } = useAction();
  const ceo = (k: keyof SiteContent["ceo"]) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...s, ceo: { ...s.ceo, [k]: e.target.value } });
  const lines = (k: "highlightsFa" | "highlightsEn") => (e: React.ChangeEvent<HTMLTextAreaElement>) => setS({ ...s, ceo: { ...s.ceo, [k]: e.target.value.split("\n") } });
  const contact = (k: keyof SiteContent["contact"]) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, contact: { ...s.contact, [k]: e.target.value } });
  const social = (k: keyof SiteContent["social"]) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, social: { ...s.social, [k]: e.target.value } });

  return (
    <div className="space-y-6">
      <Panel title="مدیرعامل" sub="عکس از فایل پروژه خوانده می‌شود (src/assets/ceo.webp). نام، سمت و پیام را اینجا تنظیم کنید.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام (فارسی)">
            <Input value={s.ceo.nameFa} onChange={ceo("nameFa")} placeholder="مثلاً: دکتر …" />
          </Field>
          <Field label="Name (English)">
            <Input value={s.ceo.nameEn} onChange={ceo("nameEn")} dir="ltr" />
          </Field>
          <Field label="سمت">
            <Input value={s.ceo.titleFa} onChange={ceo("titleFa")} />
          </Field>
          <Field label="Title">
            <Input value={s.ceo.titleEn} onChange={ceo("titleEn")} dir="ltr" />
          </Field>
        </div>
        <div className="mt-4 space-y-4">
          <Field label="پیام مدیرعامل">
            <Textarea value={s.ceo.quoteFa} onChange={ceo("quoteFa")} rows={4} />
          </Field>
          <Field label="CEO message">
            <Textarea value={s.ceo.quoteEn} onChange={ceo("quoteEn")} rows={4} dir="ltr" />
          </Field>
          <Field label="معرفی کوتاه">
            <Textarea value={s.ceo.bioFa} onChange={ceo("bioFa")} rows={3} />
          </Field>
          <Field label="Short bio">
            <Textarea value={s.ceo.bioEn} onChange={ceo("bioEn")} rows={3} dir="ltr" />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[8rem_1fr_1fr]">
          <Field label="سال تجربه" hint="خالی = پنهان">
            <Input value={s.ceo.years} onChange={ceo("years")} dir="ltr" placeholder="20+" />
          </Field>
          <Field label="مدارک و افتخارات" hint="هر خط یک مورد">
            <Textarea value={s.ceo.highlightsFa.join("\n")} onChange={lines("highlightsFa")} rows={3} />
          </Field>
          <Field label="Credentials" hint="one per line">
            <Textarea value={s.ceo.highlightsEn.join("\n")} onChange={lines("highlightsEn")} rows={3} dir="ltr" />
          </Field>
        </div>
      </Panel>

      <Panel title="تماس و شبکه‌های اجتماعی">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تلفن‌ها" hint="با ویرگول جدا کنید">
            <Input value={s.contact.phones.join(", ")} onChange={(e) => setS({ ...s, contact: { ...s.contact, phones: e.target.value.split(/[,،]/).map((x) => x.trim()) } })} dir="ltr" />
          </Field>
          <Field label="ایمیل">
            <Input value={s.contact.email} onChange={contact("email")} dir="ltr" />
          </Field>
          <Field label="نشانی">
            <Input value={s.contact.addressFa} onChange={contact("addressFa")} />
          </Field>
          <Field label="Address">
            <Input value={s.contact.addressEn} onChange={contact("addressEn")} dir="ltr" />
          </Field>
          <Field label="ساعات کاری">
            <Input value={s.contact.hoursFa} onChange={contact("hoursFa")} />
          </Field>
          <Field label="Hours">
            <Input value={s.contact.hoursEn} onChange={contact("hoursEn")} dir="ltr" />
          </Field>
          <Field label="پیوند نقشه" hint="Google Maps یا نشان" className="sm:col-span-2">
            <Input value={s.contact.mapUrl} onChange={contact("mapUrl")} dir="ltr" />
          </Field>
          {(["linkedin", "telegram", "instagram", "bale", "aparat"] as const).map((k) => (
            <Field key={k} label={{ linkedin: "LinkedIn", telegram: "Telegram", instagram: "Instagram", bale: "بله", aparat: "آپارات" }[k]}>
              <Input value={s.social[k]} onChange={social(k)} placeholder="https://" dir="ltr" />
            </Field>
          ))}
        </div>
      </Panel>

      <Panel title="آمار صفحه‌ی اول" sub="مقدار عددی (مثل 15+ یا 90%) با انیمیشن شمارش نمایش داده می‌شود.">
        <div className="space-y-3">
          {s.stats.map((st, i) => (
            <div key={i} className="grid grid-cols-[90px_1fr_1fr] gap-2">
              <Input value={st.value} onChange={(e) => setS({ ...s, stats: s.stats.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} dir="ltr" aria-label={`آمار ${num(i + 1, "fa")}: مقدار`} />
              <Input value={st.labelFa} onChange={(e) => setS({ ...s, stats: s.stats.map((x, j) => (j === i ? { ...x, labelFa: e.target.value } : x)) })} aria-label={`آمار ${num(i + 1, "fa")}: عنوان فارسی`} />
              <Input value={st.labelEn} onChange={(e) => setS({ ...s, stats: s.stats.map((x, j) => (j === i ? { ...x, labelEn: e.target.value } : x)) })} dir="ltr" aria-label={`آمار ${num(i + 1, "fa")}: عنوان انگلیسی`} />
            </div>
          ))}
        </div>
      </Panel>

      <Button disabled={pending} onClick={() => run(() => saveSite(s))}>
        {pending && <Spinner />}
        ذخیره‌ی محتوای سایت
      </Button>
    </div>
  );
}

export function NotifyForm({ initial }: { initial: Omit<NotifySettings, "botTokenEnc"> & { hasToken: boolean } }) {
  const [n, setN] = useState(initial);
  const [token, setToken] = useState("");
  const { pending, run } = useAction();
  return (
    <Panel title="اعلان تیکت‌ها" sub="با هر درخواست یا پاسخ تازه‌ی مشتری، پیامی به گروه یا گفتگوی تیم در تلگرام یا بله ارسال می‌شود." className="xl:sticky xl:top-8 xl:self-start">
      <div className="space-y-4">
        <Field label="کانال">
          <Select value={n.channel} onChange={(e) => setN({ ...n, channel: e.target.value as NotifySettings["channel"] })}>
            <option value="none">خاموش</option>
            <option value="telegram">تلگرام</option>
            <option value="bale">بله</option>
          </Select>
        </Field>
        <Field label="توکن ربات" hint={n.hasToken ? `ذخیره‌شده ${n.botTokenHint ?? ""}` : ""}>
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={n.hasToken ? "برای تغییر وارد کنید" : "123456:ABC…"} dir="ltr" autoComplete="off" />
          <p className="mt-2 text-xs leading-6 text-muted">ربات را با BotFather (تلگرام) یا «بازوی» بله بسازید و به گروه تیم اضافه کنید.</p>
        </Field>
        <Field label="شناسه‌ی گفتگو (chat_id)">
          <Input value={n.chatId} onChange={(e) => setN({ ...n, chatId: e.target.value })} dir="ltr" placeholder="-100…" />
        </Field>
        <Toggle checked={n.emailCustomers} onChange={(v) => setN({ ...n, emailCustomers: v })} label="ایمیل به مشتری هنگام پاسخ تیم" hint="نیازمند کلید Resend و نشانی فرستنده (پنل → اتصالات)." />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              run(() => saveNotify({ channel: n.channel, chatId: n.chatId, emailCustomers: n.emailCustomers, botToken: token }), {
                onOk: () => {
                  if (token) setN({ ...n, hasToken: true, botTokenHint: `…${token.slice(-4)}` });
                  setToken("");
                },
              })
            }
          >
            ذخیره
          </Button>
          <Button variant="soft" disabled={pending} onClick={() => run(() => testNotify())}>
            ارسال پیام آزمایشی
          </Button>
        </div>
      </div>
    </Panel>
  );
}

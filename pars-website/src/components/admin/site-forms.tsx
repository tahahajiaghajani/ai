"use client";

import { useState } from "react";
import { saveNotify, saveSite, testNotify } from "@/app/actions/admin";
import type { NotifySettings, SiteContent } from "@/lib/settings-types";
import { Button, Input, Label, Select, Spinner, Textarea } from "@/components/ui/field";
import { Panel, Toggle } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";

export function SiteForm({ initial }: { initial: SiteContent }) {
  const [s, setS] = useState(initial);
  const { pending, run } = useAction();
  const ceo = (k: keyof SiteContent["ceo"]) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...s, ceo: { ...s.ceo, [k]: e.target.value } });
  const contact = (k: keyof SiteContent["contact"]) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, contact: { ...s.contact, [k]: e.target.value } });
  const social = (k: keyof SiteContent["social"]) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, social: { ...s.social, [k]: e.target.value } });

  return (
    <div className="space-y-6">
      <Panel title="مدیرعامل" sub="عکس از فایل پروژه خوانده می‌شود (src/assets/ceo.webp). نام، سمت و پیام را اینجا تنظیم کنید.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>نام (فارسی)</Label>
            <Input value={s.ceo.nameFa} onChange={ceo("nameFa")} placeholder="مثلاً: دکتر …" />
          </div>
          <div>
            <Label>Name (English)</Label>
            <Input value={s.ceo.nameEn} onChange={ceo("nameEn")} dir="ltr" />
          </div>
          <div>
            <Label>سمت</Label>
            <Input value={s.ceo.titleFa} onChange={ceo("titleFa")} />
          </div>
          <div>
            <Label>Title</Label>
            <Input value={s.ceo.titleEn} onChange={ceo("titleEn")} dir="ltr" />
          </div>
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <Label>پیام مدیرعامل</Label>
            <Textarea value={s.ceo.quoteFa} onChange={ceo("quoteFa")} rows={4} />
          </div>
          <div>
            <Label>CEO message</Label>
            <Textarea value={s.ceo.quoteEn} onChange={ceo("quoteEn")} rows={4} dir="ltr" />
          </div>
          <div>
            <Label>معرفی کوتاه</Label>
            <Textarea value={s.ceo.bioFa} onChange={ceo("bioFa")} rows={3} />
          </div>
          <div>
            <Label>Short bio</Label>
            <Textarea value={s.ceo.bioEn} onChange={ceo("bioEn")} rows={3} dir="ltr" />
          </div>
        </div>
      </Panel>

      <Panel title="تماس و شبکه‌های اجتماعی">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label hint="با ویرگول جدا کنید">تلفن‌ها</Label>
            <Input value={s.contact.phones.join(", ")} onChange={(e) => setS({ ...s, contact: { ...s.contact, phones: e.target.value.split(/[,،]/).map((x) => x.trim()) } })} dir="ltr" />
          </div>
          <div>
            <Label>ایمیل</Label>
            <Input value={s.contact.email} onChange={contact("email")} dir="ltr" />
          </div>
          <div>
            <Label>نشانی</Label>
            <Input value={s.contact.addressFa} onChange={contact("addressFa")} />
          </div>
          <div>
            <Label>Address</Label>
            <Input value={s.contact.addressEn} onChange={contact("addressEn")} dir="ltr" />
          </div>
          <div>
            <Label>ساعات کاری</Label>
            <Input value={s.contact.hoursFa} onChange={contact("hoursFa")} />
          </div>
          <div>
            <Label>Hours</Label>
            <Input value={s.contact.hoursEn} onChange={contact("hoursEn")} dir="ltr" />
          </div>
          <div className="sm:col-span-2">
            <Label hint="Google Maps یا نشان">پیوند نقشه</Label>
            <Input value={s.contact.mapUrl} onChange={contact("mapUrl")} dir="ltr" />
          </div>
          {(["linkedin", "telegram", "instagram", "bale", "aparat"] as const).map((k) => (
            <div key={k}>
              <Label>{{ linkedin: "LinkedIn", telegram: "Telegram", instagram: "Instagram", bale: "بله", aparat: "آپارات" }[k]}</Label>
              <Input value={s.social[k]} onChange={social(k)} placeholder="https://" dir="ltr" />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="آمار صفحه‌ی اول" sub="مقدار عددی (مثل 15+ یا 90%) با انیمیشن شمارش نمایش داده می‌شود.">
        <div className="space-y-3">
          {s.stats.map((st, i) => (
            <div key={i} className="grid grid-cols-[90px_1fr_1fr] gap-2">
              <Input value={st.value} onChange={(e) => setS({ ...s, stats: s.stats.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} dir="ltr" />
              <Input value={st.labelFa} onChange={(e) => setS({ ...s, stats: s.stats.map((x, j) => (j === i ? { ...x, labelFa: e.target.value } : x)) })} />
              <Input value={st.labelEn} onChange={(e) => setS({ ...s, stats: s.stats.map((x, j) => (j === i ? { ...x, labelEn: e.target.value } : x)) })} dir="ltr" />
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
        <div>
          <Label>کانال</Label>
          <Select value={n.channel} onChange={(e) => setN({ ...n, channel: e.target.value as NotifySettings["channel"] })}>
            <option value="none">خاموش</option>
            <option value="telegram">تلگرام</option>
            <option value="bale">بله</option>
          </Select>
        </div>
        <div>
          <Label hint={n.hasToken ? `ذخیره‌شده ${n.botTokenHint ?? ""}` : ""}>توکن ربات</Label>
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={n.hasToken ? "برای تغییر وارد کنید" : "123456:ABC…"} dir="ltr" autoComplete="off" />
          <p className="mt-2 text-xs leading-6 text-muted">ربات را با BotFather (تلگرام) یا «بازوی» بله بسازید و به گروه تیم اضافه کنید.</p>
        </div>
        <div>
          <Label>شناسه‌ی گفتگو (chat_id)</Label>
          <Input value={n.chatId} onChange={(e) => setN({ ...n, chatId: e.target.value })} dir="ltr" placeholder="-100…" />
        </div>
        <Toggle checked={n.emailCustomers} onChange={(v) => setN({ ...n, emailCustomers: v })} label="ایمیل به مشتری هنگام پاسخ تیم" hint="نیازمند RESEND_API_KEY و MAIL_FROM در Vercel." />
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

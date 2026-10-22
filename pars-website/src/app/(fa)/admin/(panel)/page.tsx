import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { chatCounts, health, listChats, listTickets, ticketCounts } from "@/lib/admin-data";
import { formatDate } from "@/lib/i18n";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/ticket-meta";
import { Empty, PageTitle, Panel, Stat } from "@/components/admin/ui";
import { STATUS_STYLE } from "@/components/support/status-style";

function Check({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-1 size-2.5 shrink-0 rounded-full ${ok ? "bg-success" : warn ? "bg-warning" : "bg-danger"}`} />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs leading-6 text-muted">{detail}</span>
      </span>
    </li>
  );
}

export default async function Dashboard() {
  await requireAdminPage();
  const [h, t, c, tickets, chats] = await Promise.all([health(), ticketCounts(), chatCounts(), listTickets({ status: "open", limit: 6 }), listChats("unreviewed", 40)]);
  const problems = chats.filter((x) => x.unknown || x.rating === -1).slice(0, 6);
  return (
    <>
      <PageTitle title="پیشخوان" sub="وضعیت سایت، درخواست‌ها و دستیار هوشمند در یک نگاه." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="درخواست‌های جدید" value={t.byStatus.new} tone="pink" />
        <Stat label="در حال بررسی" value={t.byStatus.in_progress} tone="warning" />
        <Stat label="عبور از مهلت پاسخ (SLA)" value={t.overdue} tone={t.overdue ? "danger" : "success"} />
        <Stat label="رضایت مشتریان" value={t.avgRating ? `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(t.avgRating)} از ۵` : "—"} tone="violet" />
        <Stat label="پرسش از دستیار (۲۴ ساعت)" value={c.today} />
        <Stat label="گفتگوها (۷ روز)" value={c.sessions} hint={`${new Intl.NumberFormat("fa-IR").format(c.week)} پرسش`} />
        <Stat label="پرسش‌های بی‌پاسخ" value={c.unknown} tone={c.unknown ? "warning" : "success"} hint="برای تکمیل دانش بررسی کنید" />
        <Stat label="بازخورد منفی" value={c.negative} tone={c.negative ? "danger" : "success"} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="درخواست‌های باز">
          {tickets.length === 0 ? (
            <Empty>درخواست بازی وجود ندارد.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {tickets.map((x) => (
                <li key={x.id}>
                  <Link href={`/admin/tickets/${x.code}`} className="flex items-center gap-4 py-3.5 hover:opacity-90">
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] ${STATUS_STYLE[x.status]}`}>{STATUS_LABEL[x.status].fa}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{x.subject}</span>
                      <span className="block truncate text-xs text-muted">
                        {x.name} · {PRIORITY_LABEL[x.priority].fa} · {formatDate(x.updated_at, "fa")}
                      </span>
                    </span>
                    <span className="ltr shrink-0 font-brand text-xs text-faint">{x.code}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="سلامت سامانه">
          <ul className="divide-y divide-line">
            <Check ok={h.db === "ok"} label="پایگاه داده (Supabase)" detail={h.db === "ok" ? "متصل است." : h.db === "no_tables" ? "متصل است اما جدول‌ها ساخته نشده‌اند؛ فایل SQL را اجرا کنید." : "تنظیم نشده است (SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY)."} />
            <Check ok={h.ai === "settings" || h.ai === "env"} warn={h.ai === "disabled"} label="دستیار هوش مصنوعی" detail={{ settings: "کلید API از تنظیمات همین پنل.", env: "از کلید GEMINI_API_KEY محیط استفاده می‌شود.", missing: "کلید API تنظیم نشده؛ دستیار پیام «در دسترس نیست» نشان می‌دهد.", disabled: "دستیار غیرفعال است." }[h.ai]} />
            <Check ok={h.explicitSecret} warn={h.secret && !h.explicitSecret} label="کلید رمزنگاری (APP_SECRET)" detail={h.explicitSecret ? "تنظیم شده است. برای تعویض، مقدار فعلی را در APP_SECRET_PREVIOUS بگذارید تا داده‌های قبلی خوانا بمانند." : h.secret ? "از کلید Supabase استفاده می‌شود؛ بهتر است APP_SECRET جداگانه تنظیم شود (داده‌های قبلی خوانا می‌مانند). اگر کلید Supabase را عوض کردید، مقدار قبلی‌اش را در APP_SECRET_PREVIOUS بگذارید." : "تنظیم نشده است."} />
            <Check ok={h.notify} warn label="اعلان تیکت‌ها (تلگرام / بله)" detail={h.notify ? "فعال است." : "اختیاری — از «محتوای سایت» تنظیم کنید."} />
            <Check ok={h.email} warn label="ایمیل به مشتری" detail={h.email ? "فعال است (Resend)." : "اختیاری — RESEND_API_KEY و MAIL_FROM."} />
            <Check ok={!h.siteUrl.includes("localhost")} warn label="آدرس سایت" detail={h.siteUrl} />
          </ul>
          <Link href="/admin/connections" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-violet hover:text-fg">
            جزئیات، ثبت کلیدها و آزمایش در «اتصالات» <span aria-hidden>←</span>
          </Link>
        </Panel>
      </div>

      <Panel title="پرسش‌هایی که نیاز به بررسی دارند" sub="پرسش‌هایی که دستیار برایشان دانش کافی نداشت یا کاربر پاسخ را نادرست دانست. با تکمیل دانش، پاسخ‌های بعدی دقیق می‌شوند." className="mt-6">
        {problems.length === 0 ? (
          <Empty>موردی برای بررسی نیست.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {problems.map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-3 text-sm">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${x.rating === -1 ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning"}`}>{x.rating === -1 ? "بازخورد منفی" : "بی‌پاسخ"}</span>
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {x.question}
                </span>
                <span className="shrink-0 text-xs text-faint">{formatDate(x.created_at, "fa")}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <Link href="/admin/chats" className="text-sm text-violet hover:text-pink">
            همه‌ی گفتگوها ←
          </Link>
        </div>
      </Panel>
    </>
  );
}

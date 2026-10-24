import { requireAdminPage } from "@/lib/admin-auth";
import { healthReport, migrationFiles, type Health } from "@/lib/admin-data";
import { num } from "@/lib/format";
import { Badge, Card, CopyButton, LinkButton, PageHeader } from "@/components/admin/ui";
import { Icon } from "@/components/ui/icons";

const DOT: Record<Health, string> = { ok: "bg-success", warn: "bg-warning", error: "bg-danger" };
const STATE: Record<Health, string> = { ok: "آماده", warn: "توجه", error: "خطا" };

/** What each Vercel variable is for; values are never shown, only whether they are set. */
const VARS: { names: string[]; need: "required" | "recommended" | "optional"; what: string }[] = [
  { names: ["SUPABASE_URL"], need: "required", what: "نشانی پروژه‌ی Supabase (Project URL)." },
  { names: ["SUPABASE_SERVICE_ROLE_KEY"], need: "required", what: "کلید service_role؛ فقط روی سرور خوانده می‌شود." },
  { names: ["ADMIN_PASSWORD"], need: "required", what: "رمز مدیریت: یک بار در ‎/admin/login روی حساب شما وارد می‌شود تا حساب مدیر شود؛ ورود اضطراری بدون حساب هم هست." },
  { names: ["APP_SECRET"], need: "recommended", what: "رشته‌ی تصادفی ۳۲ نویسه‌ای برای امضای نشست‌ها و رمزگذاری کدها و کلیدها." },
  { names: ["ADMIN_PHONES"], need: "optional", what: "فهرست مجاز: اگر باشد، فقط حساب‌هایی با این شماره‌ها با رمز مدیریت مدیر می‌شوند (جدا با ویرگول)." },
  { names: ["NEXT_PUBLIC_SITE_URL"], need: "recommended", what: "نشانی اصلی سایت (برای لینک‌ها، پیامک و ایمیل)." },
  { names: ["APP_SECRET_PREVIOUS"], need: "optional", what: "فقط هنگام عوض کردن APP_SECRET: مقدار قبلی تا کدهای قدیمی خوانده شوند." },
  { names: ["RESEND_API_KEY", "MAIL_FROM"], need: "optional", what: "ایمیل از طریق Resend (یا در «تنظیمات ← ایمیل»)." },
  { names: ["CRON_SECRET"], need: "optional", what: "از فراخوانی بیرونی ‎/api/keepalive جلوگیری می‌کند." },
  { names: ["TRUSTED_IP_HEADER"], need: "optional", what: "فقط روی سرور خودتان (نه Vercel): سرآیندی که پراکسی IP بازدیدکننده را در آن می‌گذارد، مثلاً ar-real-ip برای ابرآروان." },
];

const NEED = { required: "لازم", recommended: "پیشنهادی", optional: "اختیاری" } as const;

function isSet(name: string): boolean {
  if (name === "SUPABASE_URL") return Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  return Boolean(process.env[name]);
}

export default async function ConnectionsPage() {
  await requireAdminPage();
  const { items, missingTables, supabaseProject } = await healthReport();
  const dbItem = items.find((i) => i.key === "db");
  const needSql = missingTables.length > 0 || (dbItem?.state === "error" && !dbItem.detail.includes("SUPABASE_URL"));
  const files = needSql ? migrationFiles() : [];
  const sql = files.map((f) => `-- ${f.name}\n${f.sql.trim()}\n`).join("\n");
  const editor = supabaseProject ? `https://supabase.com/dashboard/project/${supabaseProject}/sql/new` : "https://supabase.com/dashboard";
  const problems = items.filter((i) => i.state === "error").length;

  return (
    <>
      <PageHeader title="اتصالات" sub={problems ? `${num(problems, "fa")} مورد نیاز به رسیدگی دارد` : "همه‌ی بخش‌های اصلی وصل‌اند"} />

      <div className="space-y-6">
        <Card title="وضعیت سرویس‌ها" padded={false}>
          <ul className="divide-y divide-line">
            {items.map((it) => (
              <li key={it.key} className="flex items-start gap-3 px-5 py-3.5">
                <span className={`mt-2 size-2 shrink-0 rounded-full ${DOT[it.state]}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{it.title}</span>
                    <span className="sr-only">{STATE[it.state]}</span>
                  </div>
                  <p className="mt-0.5 text-xs leading-6 break-words text-muted">{it.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {needSql && (
          <Card title="ساخت جدول‌های پایگاه داده" sub={missingTables.length ? `${num(missingTables.length, "fa")} جدول ساخته نشده است.` : undefined}>
            <ol className="mb-4 list-inside list-[persian] space-y-1 text-sm leading-7 text-ink-2">
              <li>دکمه‌ی «کپی SQL» را بزنید.</li>
              <li>SQL Editor پروژه را باز کنید، متن را بچسبانید و Run را بزنید.</li>
              <li>این صفحه را دوباره باز کنید.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              {sql ? <CopyButton text={sql} label="کپی SQL" size="md" variant="primary" /> : <Badge tone="danger">فایل‌های SQL پیدا نشد</Badge>}
              <LinkButton href={editor} external icon="external">
                باز کردن SQL Editor
              </LinkButton>
            </div>
            {files.length > 0 && (
              <p className="mt-3 text-xs text-muted">
                <span className="ltr font-mono">{files.map((f) => f.name).join(" · ")}</span>
              </p>
            )}
          </Card>
        )}

        <Card title="متغیرهای Vercel" sub="Vercel ← Project ← Settings ← Environment Variables؛ پس از تغییر، دوباره Deploy کنید." padded={false}>
          <ul className="divide-y divide-line">
            {VARS.map((v) => {
              const set = v.names.every(isSet);
              const some = v.names.some(isSet);
              return (
                <li key={v.names[0]} className="grid gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] sm:items-center">
                  <span className="min-w-0 text-xs">
                    <span className="ltr font-mono break-all">{v.names.join(" / ")}</span>
                    <span className={`ms-2 text-[11px] ${v.need === "required" ? "text-ink-2" : "text-faint"}`}>{NEED[v.need]}</span>
                  </span>
                  <span className="text-xs leading-6 text-muted">{v.what}</span>
                  <span className="sm:text-end">
                    {set ? (
                      <Badge tone="success">تنظیم شده</Badge>
                    ) : some ? (
                      <Badge tone="warning">ناقص</Badge>
                    ) : (
                      <Badge tone={v.need === "required" ? "danger" : v.need === "recommended" ? "warning" : "neutral"}>تنظیم نشده</Badge>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        <p className="flex items-start gap-2 text-xs leading-6 text-muted">
          <Icon name="clock" className="mt-1 size-4 shrink-0" />
          <span>
            هر روز یک بار <span className="ltr font-mono">/api/keepalive</span> اجرا می‌شود (<span className="ltr font-mono">vercel.json</span>) تا پروژه‌ی رایگان Supabase به خاطر بی‌کاری متوقف نشود.
          </span>
        </p>
      </div>
    </>
  );
}

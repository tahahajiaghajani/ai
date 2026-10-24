import { redirect } from "next/navigation";
import { logout } from "@/app/actions/admin";
import { adminSetup, isAdmin } from "@/lib/admin-auth";
import { isAdminRow, sessionState } from "@/lib/auth";
import { formatPhone } from "@/lib/format";
import { AccountSignIn } from "@/components/admin/account-sign-in";
import { LoginForm } from "@/components/admin/login-form";
import { Button } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const WHAT: Record<string, string> = {
  SUPABASE_URL: "نشانی پروژه‌ی Supabase (Project URL)",
  SUPABASE_SERVICE_ROLE_KEY: "کلید service_role پروژه‌ی Supabase",
  ADMIN_PHONES: "شماره‌ی موبایل خودتان، مثلاً 09121234567",
};

/**
 * The way into the panel, for the owner. Usually: sign in with an admin account (its phone is in
 * ADMIN_PHONES, or it was made admin in Users). ADMIN_PASSWORD, when set, is a second way in.
 */
export default async function AdminLogin() {
  if (await isAdmin()) redirect("/admin");
  const setup = adminSetup();
  const s = await sessionState();
  const me = s.state === "ok" ? s.user : null;
  const none = !setup.accounts && !setup.password;

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-bone px-4 py-10">
      <div className="w-full max-w-sm border border-line bg-white px-7 py-10 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/celin-wordmark.svg" alt="CELIN" className="mx-auto h-12 w-auto" />
        <h1 className="mt-6 text-lg font-medium">ورود به پنل مدیریت</h1>

        {me && isAdminRow(me) ? (
          <>
            <p className="mt-4 text-sm leading-7 text-ink-2">برای باز شدن پنل، یک بار با رمز عبور همین حساب وارد شوید.</p>
            <AccountSignIn phone={me.phone} />
          </>
        ) : me ? (
          <div className="mt-6 space-y-4">
            <p className="border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm leading-7 text-danger">این حساب دسترسی مدیریت ندارد.</p>
            <p className="text-xs leading-6 text-muted">
              {me.name || "—"} · <span className="ltr">{formatPhone(me.phone, "fa")}</span>
            </p>
            <form action={logout}>
              <Button type="submit" variant="secondary" className="w-full">
                خروج از این حساب
              </Button>
            </form>
          </div>
        ) : setup.accounts ? (
          <AccountSignIn />
        ) : null}

        {setup.password &&
          (me || setup.accounts ? (
            <details className="mt-6 border-t border-line pt-4 text-start">
              <summary className="cursor-pointer text-xs text-muted">ورود با رمز مدیر (ADMIN_PASSWORD)</summary>
              <LoginForm />
            </details>
          ) : (
            <LoginForm />
          ))}

        {none && (
          <div className="mt-5 text-start text-sm leading-7 text-ink-2">
            <p>
              پنل مدیریت هنوز فعال نیست. این متغیرها را در <span className="ltr">Vercel → Settings → Environment Variables</span> بگذارید و دوباره Deploy کنید:
            </p>
            <ul className="mt-3 space-y-2">
              {setup.missing.map((name) => (
                <li key={name} className="border-s-2 border-danger ps-3">
                  <span className="ltr inline-block font-mono text-xs text-ink">{name}</span>
                  <span className="block text-xs text-muted">{WHAT[name] ?? ""}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-6 text-muted">سپس در سایت با همان شماره‌ی موبایل ثبت‌نام کنید (یا وارد شوید)؛ پنل برای آن حساب باز می‌شود. راهنمای کامل: docs/SETUP_FA.md</p>
          </div>
        )}
        {setup.accounts && !setup.phones && !me && (
          <p className="mt-6 text-start text-xs leading-6 text-muted">
            <span className="ltr font-mono">ADMIN_PHONES</span> تنظیم نشده است: فقط حساب‌هایی که پیش‌تر در «کاربران» مدیر شده‌اند وارد می‌شوند. شماره‌ی موبایل خودتان را در این متغیر بگذارید و دوباره Deploy کنید.
          </p>
        )}
      </div>
    </main>
  );
}

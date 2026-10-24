import { redirect } from "next/navigation";
import { logout } from "@/app/actions/admin";
import { adminSetup, canActivateAdmin, isAdmin } from "@/lib/admin-auth";
import { isAdminRow, sessionState } from "@/lib/auth";
import { formatPhone } from "@/lib/format";
import { AccountSignIn } from "@/components/admin/account-sign-in";
import { ActivateForm } from "@/components/admin/activate-form";
import { LoginForm } from "@/components/admin/login-form";
import { Button } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const WHAT: Record<string, string> = {
  SUPABASE_URL: "نشانی پروژه‌ی Supabase (Project URL)",
  SUPABASE_SERVICE_ROLE_KEY: "کلید service_role پروژه‌ی Supabase",
  ADMIN_PASSWORD: "رمز مدیریت: یک بار برای فعال کردن پنل روی حساب خودتان",
};

function SignOut({ label = "خروج از این حساب" }: { label?: string }) {
  return (
    <form action={logout}>
      <Button type="submit" variant="ghost" className="w-full">
        {label}
      </Button>
    </form>
  );
}

/**
 * The way into the panel, for the owner. An admin account signs in with its password. An account that is not
 * admin yet is asked once for the admin password (ADMIN_PASSWORD) — only when that is set and, with the
 * optional ADMIN_PHONES allow-list, only for a listed number — and is an admin from then on. ADMIN_PASSWORD
 * alone (no account) also opens the panel in this browser.
 */
export default async function AdminLogin() {
  if (await isAdmin()) redirect("/admin");
  const setup = adminSetup();
  const s = await sessionState();
  const me = s.state === "ok" ? s.user : null;
  const viaPassword = s.state === "ok" && s.via === "pw";
  const who = me && (
    <p className="text-xs leading-6 text-muted">
      {me.name || "—"} · <span className="ltr">{formatPhone(me.phone, "fa")}</span>
    </p>
  );

  let body: React.ReactNode = null;
  if (me && (isAdminRow(me) || (canActivateAdmin(me) && !viaPassword))) {
    // an admin (or an account to be made admin) signed in another way: the password first
    body = (
      <>
        <p className="mt-4 text-sm leading-7 text-ink-2">برای باز شدن پنل، با رمز عبور همین حساب وارد شوید.</p>
        <AccountSignIn phone={me.phone} />
      </>
    );
  } else if (me && canActivateAdmin(me)) {
    body = (
      <div className="mt-4 space-y-3">
        <p className="text-sm leading-7 text-ink-2">این حساب هنوز مدیر نیست. برای فعال کردن پنل روی آن، رمز مدیریت را یک بار وارد کنید؛ از آن پس با ورود معمولی به سایت، پنل باز است.</p>
        {who}
        <ActivateForm />
        <SignOut />
      </div>
    );
  } else if (me) {
    body = (
      <div className="mt-6 space-y-4">
        <p className="border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm leading-7 text-danger">این حساب دسترسی مدیریت ندارد.</p>
        {who}
        {!setup.password && (
          <p className="text-start text-xs leading-6 text-muted">
            برای فعال کردن پنل روی حساب خودتان، متغیر <span className="ltr font-mono">ADMIN_PASSWORD</span> را در Vercel بگذارید و دوباره Deploy کنید.
          </p>
        )}
        <SignOut />
      </div>
    );
  } else if (setup.accounts) {
    body = <AccountSignIn />;
  }

  const none = !setup.accounts && !setup.password;
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-bone px-4 py-10">
      <div className="w-full max-w-sm border border-line bg-white px-7 py-10 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/celin-wordmark.svg" alt="CELIN" className="mx-auto h-12 w-auto" />
        <h1 className="mt-6 text-lg font-medium">ورود به پنل مدیریت</h1>

        {body}

        {/* break-glass: the admin password alone opens the panel in this browser (it never changes an account) */}
        {setup.password &&
          (body ? (
            <details className="mt-6 border-t border-line pt-4 text-start">
              <summary className="cursor-pointer text-xs text-muted">ورود فقط با رمز مدیریت (بدون حساب)</summary>
              <LoginForm />
            </details>
          ) : (
            <LoginForm />
          ))}

        {(none || (setup.accounts && !setup.password && !me)) && setup.missing.length > 0 && (
          <div className="mt-5 text-start text-sm leading-7 text-ink-2">
            <p>
              {none ? "پنل مدیریت هنوز فعال نیست." : "حسابی که از قبل مدیر است وارد می‌شود؛ برای فعال کردن پنل روی حساب خودتان:"} این متغیرها را در <span className="ltr">Vercel → Settings → Environment Variables</span> بگذارید و دوباره Deploy کنید:
            </p>
            <ul className="mt-3 space-y-2">
              {setup.missing.map((name) => (
                <li key={name} className="border-s-2 border-danger ps-3">
                  <span className="ltr inline-block font-mono text-xs text-ink">{name}</span>
                  <span className="block text-xs text-muted">{WHAT[name] ?? ""}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-6 text-muted">سپس در سایت با شماره‌ی موبایل خودتان ثبت‌نام کنید، به همین صفحه بیایید و رمز مدیریت را یک بار وارد کنید. راهنمای کامل: docs/SETUP_FA.md</p>
          </div>
        )}
      </div>
    </main>
  );
}

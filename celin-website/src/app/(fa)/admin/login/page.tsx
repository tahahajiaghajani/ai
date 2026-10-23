import { redirect } from "next/navigation";
import { adminConfigured, isAdmin } from "@/lib/admin-auth";
import { LoginForm } from "@/components/admin/login-form";

export const dynamic = "force-dynamic";

export default async function AdminLogin() {
  if (await isAdmin()) redirect("/admin");
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-bone px-4">
      <div className="w-full max-w-sm border border-line bg-white px-7 py-10 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/celin-wordmark.svg" alt="CELIN" className="mx-auto h-12 w-auto" />
        <h1 className="mt-6 text-lg font-medium">ورود به پنل مدیریت</h1>
        {adminConfigured() ? (
          <LoginForm />
        ) : (
          <p className="mt-5 text-sm leading-7 text-muted">
            پنل مدیریت هنوز فعال نیست. متغیرهای <span className="ltr font-mono text-xs">ADMIN_PASSWORD</span> و <span className="ltr font-mono text-xs">APP_SECRET</span> را در Vercel تنظیم و دوباره Deploy کنید.
          </p>
        )}
        <p className="mt-6 text-xs leading-6 text-muted">اگر حساب کاربری شما مدیر است، کافی است در سایت وارد حساب خود شوید.</p>
      </div>
    </main>
  );
}

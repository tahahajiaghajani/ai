import { redirect } from "next/navigation";
import { adminConfigured, isAdmin } from "@/lib/admin-auth";
import { currentUser } from "@/lib/auth";
import { LoginForm } from "@/components/admin/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  const configured = adminConfigured();
  const me = await currentUser();
  return (
    <main className="grain relative grid min-h-[100dvh] place-items-center overflow-hidden px-5">
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(50%_50%_at_50%_100%,rgb(223_17_115/0.2),transparent_70%),radial-gradient(40%_40%_at_50%_0%,rgb(143_134_255/0.15),transparent_70%)]" />
      <div className="card w-full max-w-sm p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/pars-mark-reverse.svg" alt="" className="h-12 w-auto" />
        <h1 className="mt-6 text-xl font-extrabold">ورود مدیر</h1>
        {me ? (
          <p className="mt-2 text-sm leading-7 text-muted">
            با حساب <span className="ltr text-fg">{me.email}</span> وارد شده‌اید که هنوز مدیر نیست. با رمز مدیر، همین حساب برای همیشه مدیر می‌شود.
          </p>
        ) : (
          <p className="mt-2 text-sm leading-7 text-muted">
            با حساب کاربری مدیر{" "}
            <a href="/account/login?next=%2Fadmin" className="text-violet hover:text-fg">
              وارد شوید
            </a>
            ، یا با رمز مدیر.
          </p>
        )}
        {configured ? (
          <LoginForm />
        ) : (
          <p className="mt-6 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm leading-7">
            ورود هنوز فعال نیست. در Vercel متغیر <span className="ltr font-mono">ADMIN_PASSWORD</span> (و ترجیحاً <span className="ltr font-mono">APP_SECRET</span>) را تنظیم و دوباره Deploy کنید.
          </p>
        )}
      </div>
    </main>
  );
}

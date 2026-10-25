import { LoginForm } from "@/components/admin/login-form";
import { adminConfigured } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default function Login() {
  return (
    <main className="grid min-h-[100dvh] place-items-center px-6">
      <div className="w-full max-w-sm">
        <p className="eyebrow eyebrow-fa mb-4">صندوق درخواست‌ها</p>
        <h1 className="mb-8 text-3xl font-bold">ورود</h1>
        {adminConfigured() ? <LoginForm /> : <p className="leading-relaxed text-fg-2">برای فعال شدن، ADMIN_PASSWORD و APP_SECRET را در متغیرهای محیطی Vercel تنظیم کنید.</p>}
      </div>
    </main>
  );
}

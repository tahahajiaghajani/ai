import { LoginForm } from "@/components/admin/login-form";
import { adminConfigured } from "@/lib/admin-auth";
import { MIN_SECRET, secretState } from "@/lib/crypto";
import { env } from "@/lib/env";
import { num } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** What is missing, in plain words: a short APP_SECRET is refused, so it is named rather than called "not set". */
function setupNote(): string {
  const missing = [!env.adminPassword && "ADMIN_PASSWORD", secretState() === "missing" && "APP_SECRET"].filter(Boolean).join(" و ");
  const short = secretState() === "short" ? `APP_SECRET کوتاه‌تر از ${num("fa", String(MIN_SECRET))} نویسه است و پذیرفته نمی‌شود: یک رشته‌ی تصادفی بلندتر بگذارید (مثلاً خروجی openssl rand -hex 32).` : "";
  return [missing && `${missing} را در متغیرهای محیطی Vercel تنظیم کنید.`, short, "سپس Redeploy کنید."].filter(Boolean).join(" ");
}

export default function Login() {
  return (
    <main className="grid min-h-[100dvh] place-items-center px-6">
      <div className="w-full max-w-sm">
        <p className="eyebrow eyebrow-fa mb-4">صندوق درخواست‌ها</p>
        <h1 className="mb-8 text-3xl font-bold">ورود</h1>
        {adminConfigured() ? <LoginForm /> : <p className="text-start leading-relaxed text-fg-2">{setupNote()}</p>}
      </div>
    </main>
  );
}

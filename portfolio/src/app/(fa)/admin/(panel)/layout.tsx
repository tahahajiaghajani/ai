import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { logout } from "@/app/actions/admin";
import { Mark } from "@/components/brand/logo";

export const dynamic = "force-dynamic";

export default async function Panel({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-[1300px] px-5 pb-24 md:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-5">
        <Link href="/admin" className="flex items-center gap-3">
          <Mark className="size-7" />
          <span className="font-bold">پنل سایت</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link href="/admin" className="link-draw">درخواست‌ها</Link>
          <Link href="/admin/unanswered" className="link-draw">پرسش‌های بی‌پاسخ</Link>
          <Link href="/admin/knowledge" className="link-draw">دانش دستیار</Link>
          <Link href="/admin/connections" className="link-draw">اتصالات</Link>
          <Link href="/" className="text-muted">سایت</Link>
          <form action={logout}>
            <button className="text-muted hover:text-fg">خروج</button>
          </form>
        </nav>
      </header>
      <main className="pt-10">{children}</main>
    </div>
  );
}

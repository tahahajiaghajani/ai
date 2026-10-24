import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { adminCounts } from "@/lib/admin-data";
import { logout } from "@/app/actions/admin";
import { AdminNav } from "@/components/admin/nav";
import { Toaster } from "@/components/admin/toast";
import { Icon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // every page checks again: an RSC request can render a page without re-running this layout
  await requireAdminPage();
  const c = await adminCounts();
  const badges = { "/admin/orders": c.orders.pending ?? 0, "/admin/pro": c.requests_pending };
  const footer = (
    <>
      <a href="/" target="_blank" className="flex items-center gap-3 px-3 py-2.5 text-sm text-ink-2 hover:text-ink">
        <Icon name="external" className="size-[18px] text-muted" />
        مشاهده‌ی سایت
      </a>
      <form action={logout}>
        <button className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-ink-2 hover:text-ink" title="خروج از پنل و حساب، در همه‌ی دستگاه‌ها">
          <Icon name="logout" className="size-[18px] text-muted" />
          خروج
        </button>
      </form>
    </>
  );
  return (
    <div className="min-h-[100dvh] bg-ground lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 z-30 border-b border-line bg-bone lg:h-[100dvh] lg:border-b-0 lg:border-e">
        <div className="relative flex h-16 items-center justify-between gap-3 px-4 lg:h-full lg:flex-col lg:items-stretch lg:justify-start lg:gap-2 lg:overflow-y-auto lg:px-4 lg:py-6">
          <Link href="/admin" className="flex items-center gap-3 lg:mb-4 lg:px-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/celin-mark.svg" alt="" className="h-9 w-auto" />
            <span className="leading-tight">
              <span className="block text-sm font-medium">مدیریت سلین</span>
              <span className="block font-label text-[10px] tracking-[0.2em] text-muted ltr">CELIN ADMIN</span>
            </span>
          </Link>
          <AdminNav badges={badges} footer={footer} />
          <div className="mt-auto hidden space-y-0.5 pt-6 lg:block">{footer}</div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-7 sm:px-8 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
      <Toaster />
    </div>
  );
}

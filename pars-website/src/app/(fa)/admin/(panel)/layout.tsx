import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { chatCounts, ticketCounts } from "@/lib/admin-data";
import { logout } from "@/app/actions/admin";
import { AdminNav } from "@/components/admin/nav";
import { Toaster } from "@/components/admin/toast";
import { Icon } from "@/components/site/icons";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // every page checks again: an RSC request can render a page without re-running this layout
  await requireAdminPage();
  const [t, c] = await Promise.all([ticketCounts(), chatCounts()]);
  const badges = { "/admin/tickets": t.byStatus.new + t.byStatus.in_progress, "/admin/chats": c.unknown + c.negative };
  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 z-30 border-b border-line bg-ink-2/90 backdrop-blur-xl lg:h-[100dvh] lg:border-b-0 lg:border-e">
        <div className="flex h-full flex-col gap-4 p-3 lg:p-5">
          <div className="flex items-center justify-between gap-3 px-1">
            <Link href="/admin" className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/pars-mark-reverse.svg" alt="" className="h-8 w-auto" />
              <span className="leading-tight">
                <span className="block text-sm font-extrabold">مدیریت سایت</span>
                <span className="block text-[11px] text-faint">Pars Project</span>
              </span>
            </Link>
            <a href="/" target="_blank" className="grid size-9 place-items-center rounded-full border border-line text-muted hover:text-fg lg:hidden" aria-label="مشاهده‌ی سایت">
              <Icon name="external" className="size-4" />
            </a>
          </div>
          <AdminNav badges={badges} />
          <div className="mt-auto hidden space-y-1 lg:block">
            <a href="/" target="_blank" className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm text-muted hover:bg-white/[0.04] hover:text-fg">
              <Icon name="external" className="size-[18px]" />
              مشاهده‌ی سایت
            </a>
            <form action={logout}>
              <button className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm text-muted hover:bg-white/[0.04] hover:text-fg">
                <Icon name="close" className="size-[18px]" />
                خروج
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-8 sm:px-8 lg:px-10">{children}</main>
      <Toaster />
    </div>
  );
}

import Link from "next/link";
import { Blocks, BookOpenText, Brain, Cpu, Inbox, Plus, Rocket, Settings, Users, Workflow, Network } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { RtlProvider } from "@/components/ui/overlays";
import { Brand, Logo } from "@/components/shell/logo";
import { BottomNavLink, NavLink, NotificationBell, ProviderPills, ThemeToggle, UserMenu } from "@/components/shell/shell-parts";
import { Button } from "@/components/ui/primitives";
import type { NotificationRow, ProviderState } from "@/lib/types";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdmin();
  const [notifs, providers, pending, users] = await Promise.all([
    db().from("notifications").select("*").eq("user_id", me.id).order("id", { ascending: false }).limit(40),
    db().from("provider_state").select("*"),
    db().from("tasks").select("id", { count: "exact", head: true }).eq("status", "pending_approval"),
    db().from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const name = me.profile.full_name || me.email;

  return (
    <RtlProvider>
      <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-l border-line bg-surface/60 px-4 py-5 backdrop-blur-xl lg:flex">
          <Link href="/dashboard" className="px-2">
            <Brand />
          </Link>
          <nav className="mt-8 flex-1 space-y-1">
            <NavLink href="/dashboard" icon={<Workflow className="size-[18px]" />} label="ورکفلو زنده" />
            <NavLink href="/inbox" icon={<Inbox className="size-[18px]" />} label="کارتابل" badge={pending.count ?? 0} />
            <NavLink href="/queue" icon={<Cpu className="size-[18px]" />} label="صف و اجرا" />
            <NavLink href="/agents" icon={<Blocks className="size-[18px]" />} label="ایجنت‌ها و ورکفلوها" />
            <NavLink href="/knowledge" icon={<BookOpenText className="size-[18px]" />} label="پایگاه دانش" />
            <NavLink href="/graph" icon={<Network className="size-[18px]" />} label="گراف دانش" />
            <NavLink href="/learning" icon={<Brain className="size-[18px]" />} label="یادگیری و پرامپت‌ها" />
            <NavLink href="/upgrade" icon={<Rocket className="size-[18px]" />} label="ارتقای اپلیکیشن" />
            <NavLink href="/users" icon={<Users className="size-[18px]" />} label="کاربران" badge={users.count ?? 0} />
          </nav>
          <div className="space-y-1 border-t border-line pt-3">
            <NavLink href="/settings" icon={<Settings className="size-[18px]" />} label="تنظیمات و اتصال‌ها" />
          </div>
        </aside>

        <div className="min-w-0">
          <header className="safe-top sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_78%,transparent)] backdrop-blur-xl">
            <div className="flex h-16 items-center gap-2 px-4 lg:px-8">
              <Link href="/dashboard" className="lg:hidden">
                <Logo className="size-8" />
              </Link>
              <ProviderPills initial={(providers.data ?? []) as ProviderState[]} />
              <div className="ms-auto flex items-center gap-1">
                <Link href="/portal/new" className="hidden sm:block">
                  <Button size="sm" variant="secondary">
                    <Plus className="size-4" /> ثبت تسک
                  </Button>
                </Link>
                <NotificationBell userId={me.id} initial={(notifs.data ?? []) as NotificationRow[]} />
                <ThemeToggle />
                <UserMenu name={name} email={me.email} role="admin" avatarUrl={me.profile.avatar_url} />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1600px] px-4 pb-28 pt-5 lg:px-8 lg:pb-12">{children}</main>
        </div>

        <nav className="safe-bottom glass fixed inset-x-2 bottom-2 z-40 flex rounded-2xl px-1 pt-1 lg:hidden">
          <BottomNavLink href="/dashboard" icon={<Workflow className="size-5" />} label="ورکفلو" />
          <BottomNavLink href="/inbox" icon={<Inbox className="size-5" />} label="کارتابل" />
          <BottomNavLink href="/queue" icon={<Cpu className="size-5" />} label="صف" />
          <BottomNavLink href="/knowledge" icon={<BookOpenText className="size-5" />} label="دانش" />
          <BottomNavLink href="/more" icon={<Settings className="size-5" />} label="بیشتر" />
        </nav>
      </div>
    </RtlProvider>
  );
}

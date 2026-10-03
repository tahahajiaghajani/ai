import Link from "next/link";
import { Blocks, Brain, Cpu, FolderGit2, Inbox, Plus, Rocket, Send, Server, Settings, Users, Workflow, Network } from "lucide-react";
import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { background } from "@/lib/events";
import { capabilities } from "@/lib/capabilities";
import { listConnections } from "@/lib/connections";
import { RtlProvider } from "@/components/ui/overlays";
import { Brand, Logo } from "@/components/shell/logo";
import { BottomNavLink, ConnectionPills, NavLink, NotificationBell, ThemeToggle, UserMenu } from "@/components/shell/shell-parts";
import { Button } from "@/components/ui/primitives";
import type { ConnectionStateRow, NotificationRow } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireFull();
  const [notifs, pending, users, conns, states, caps] = await Promise.all([
    db().from("notifications").select("*").eq("user_id", me.id).order("id", { ascending: false }).limit(40),
    db().from("tasks").select("id", { count: "exact", head: true }).eq("assignee_id", me.id).eq("status", "pending_approval"),
    me.isOwner ? db().from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending") : Promise.resolve({ count: 0 }),
    listConnections(me.id),
    db().from("connection_state").select("*").eq("user_id", me.id),
    capabilities(me),
  ]);
  background(async () => {
    await db().from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", me.id);
  });
  const name = me.profile.full_name || me.email;
  const ai = conns.filter((c) => c.kind === "ai").map((c) => ({ id: c.id, label: c.label, provider: c.provider, status: c.status }));

  return (
    <RtlProvider>
      <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-l border-line bg-surface/60 px-4 py-5 backdrop-blur-xl lg:flex">
          <Link href="/dashboard" className="px-2">
            <Brand />
          </Link>
          <nav className="mt-8 flex-1 space-y-1">
            <NavLink href="/dashboard" icon={<Workflow className="size-[18px]" />} label="ورکفلو زنده" />
            <NavLink href="/inbox" icon={<Inbox className="size-[18px]" />} label="کارتابل من" badge={pending.count ?? 0} />
            <NavLink href="/given" icon={<Send className="size-[18px]" />} label="تسک‌های داده‌شده" />
            <NavLink href="/queue" icon={<Cpu className="size-[18px]" />} label="صف و اجرا" />
            <NavLink href="/projects" icon={<FolderGit2 className="size-[18px]" />} label="پروژه‌ها و دانش" muted={!caps.github} />
            <NavLink href="/graph" icon={<Network className="size-[18px]" />} label="گراف دانش" muted={!caps.github} />
            <NavLink href="/agents" icon={<Blocks className="size-[18px]" />} label="ایجنت‌ها و ورکفلوها" />
            <NavLink href="/learning" icon={<Brain className="size-[18px]" />} label="یادگیری و پرامپت‌ها" />
            {me.isOwner ? (
              <>
                <p className="px-3 pb-1 pt-4 text-[11px] font-bold text-faint">مدیریت اپ (فقط مالک)</p>
                <NavLink href="/system" icon={<Server className="size-[18px]" />} label="سیستم و سرویس‌ها" />
                <NavLink href="/users" icon={<Users className="size-[18px]" />} label="کاربران" badge={users.count ?? 0} />
                <NavLink href="/upgrade" icon={<Rocket className="size-[18px]" />} label="ارتقای اپلیکیشن" />
              </>
            ) : null}
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
              <ConnectionPills userId={me.id} connections={ai} initial={(states.data ?? []) as ConnectionStateRow[]} />
              <div className="ms-auto flex items-center gap-1">
                <Link href="/portal/new" className="hidden sm:block">
                  <Button size="sm" variant="secondary">
                    <Plus className="size-4" /> ثبت تسک
                  </Button>
                </Link>
                <NotificationBell userId={me.id} initial={(notifs.data ?? []) as NotificationRow[]} />
                <ThemeToggle />
                <UserMenu name={name} email={me.email} role={me.isOwner ? "owner" : "member"} avatarUrl={me.profile.avatar_url} mode="full" />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1600px] px-4 pb-28 pt-5 lg:px-8 lg:pb-12">{children}</main>
        </div>

        <nav className="safe-bottom glass fixed inset-x-2 bottom-2 z-40 flex rounded-2xl px-1 pt-1 lg:hidden">
          <BottomNavLink href="/dashboard" icon={<Workflow className="size-5" />} label="ورکفلو" />
          <BottomNavLink href="/inbox" icon={<Inbox className="size-5" />} label="کارتابل" />
          <BottomNavLink href="/projects" icon={<FolderGit2 className="size-5" />} label="پروژه‌ها" />
          <BottomNavLink href="/given" icon={<Send className="size-5" />} label="داده‌شده" />
          <BottomNavLink href="/more" icon={<Settings className="size-5" />} label="بیشتر" />
        </nav>
      </div>
    </RtlProvider>
  );
}

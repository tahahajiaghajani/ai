import Link from "next/link";
import { Blocks, Cpu, FolderGit2, House, LifeBuoy, ListChecks, Menu as MenuIcon, Plus, Settings, ShieldCheck } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { background } from "@/lib/events";
import { activeBanner } from "@/lib/banner";
import { capabilities } from "@/lib/capabilities";
import { listConnections } from "@/lib/connections";
import { RtlProvider } from "@/components/ui/overlays";
import { Brand, Logo } from "@/components/shell/logo";
import { AnnouncementBanner, BottomNavLink, ConnectionAlert, FullExperienceButton, NavLink, NotificationBell, UserMenu } from "@/components/shell/shell-parts";
import { Button } from "@/components/ui/primitives";
import type { ConnectionStateRow, NotificationRow } from "@/lib/types";

const TASK_PATHS = ["/given", "/tasks", "/portal/tasks", "/portal/new"];

function NewTaskButton() {
  return (
    <Link href="/portal/new" aria-label="تسک جدید">
      <Button size="sm" className="h-9 max-sm:w-9 max-sm:px-0">
        <Plus className="size-4" />
        <span className="max-sm:hidden">تسک جدید</span>
      </Button>
    </Link>
  );
}

/**
 * The one frame around every signed-in page. Full mode: side menu with five sections (plus «مدیریت»
 * for the owner) and a bottom bar on phones. Simple mode: just the header — give, track, done.
 */
export async function AppShell({ me, children }: { me: SessionUser; children: React.ReactNode }) {
  const full = me.mode === "full";
  const [notifs, pending, users, conns, states, caps, banner] = await Promise.all([
    db().from("notifications").select("*").eq("user_id", me.id).order("id", { ascending: false }).limit(40),
    full ? db().from("tasks").select("id", { count: "exact", head: true }).eq("assignee_id", me.id).eq("status", "pending_approval") : Promise.resolve({ count: 0 }),
    full && me.isOwner ? db().from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending") : Promise.resolve({ count: 0 }),
    full ? listConnections(me.id) : Promise.resolve([]),
    full ? db().from("connection_state").select("*").eq("user_id", me.id) : Promise.resolve({ data: [] }),
    full ? capabilities(me) : Promise.resolve(null),
    activeBanner(),
  ]);
  background(async () => {
    await db().from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", me.id);
  });
  const name = me.profile.full_name || me.email;
  const ai = conns.filter((c) => c.kind === "ai").map((c) => ({ id: c.id, label: c.label, provider: c.provider, status: c.status }));
  const bannerEl = banner ? <AnnouncementBanner text={banner.text} link={banner.link} tone={banner.tone} version={banner.updated_at} /> : null;
  const account = (
    <>
      <NotificationBell userId={me.id} initial={(notifs.data ?? []) as NotificationRow[]} />
      <UserMenu name={name} email={me.email} avatarUrl={me.profile.avatar_url} mode={me.mode} isOwner={me.isOwner} />
    </>
  );

  if (!full) {
    return (
      <RtlProvider>
        <header className="safe-top sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_80%,transparent)] backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-4">
            <Link href="/portal" aria-label="خانه">
              <Brand className="max-sm:hidden" />
              <Logo className="size-8 sm:hidden" />
            </Link>
            <div className="ms-auto flex items-center gap-1.5">
              {!me.isOwner ? <FullExperienceButton /> : null}
              <NewTaskButton />
              {account}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">
          {bannerEl}
          {children}
        </main>
      </RtlProvider>
    );
  }

  const icon = "size-[18px]";
  return (
    <RtlProvider>
      <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-l border-line bg-surface-strong/70 px-3 py-5 backdrop-blur-xl lg:flex">
          <Link href="/dashboard" className="px-3" aria-label="خانه">
            <Brand signature />
          </Link>
          <nav className="mt-8 flex-1 space-y-1 overflow-y-auto">
            <NavLink href="/dashboard" icon={<House className={icon} />} label="خانه" />
            <NavLink href="/inbox" match={TASK_PATHS} icon={<ListChecks className={icon} />} label="کارها" badge={pending.count ?? 0} />
            <NavLink href="/projects" match={["/graph"]} icon={<FolderGit2 className={icon} />} label="پروژه‌ها" muted={!caps?.github} />
            <NavLink href="/agents" match={["/learning"]} icon={<Blocks className={icon} />} label="ایجنت‌ها" />
            <NavLink href="/queue" icon={<Cpu className={icon} />} label="صف اجرا" />
            {me.isOwner ? <NavLink href="/system" match={["/users", "/banner", "/upgrade"]} icon={<ShieldCheck className={icon} />} label="مدیریت" badge={users.count ?? 0} /> : null}
          </nav>
          <div className="space-y-1 border-t border-line pt-3">
            <NavLink href="/help" icon={<LifeBuoy className={icon} />} label="راهنما" dot="release" />
            <NavLink href="/settings" icon={<Settings className={icon} />} label="تنظیمات" />
          </div>
        </aside>

        <div className="min-w-0">
          <header className="safe-top sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_80%,transparent)] backdrop-blur-xl">
            <div className="flex h-16 items-center gap-2 px-4 lg:px-8">
              <Link href="/dashboard" className="lg:hidden" aria-label="خانه">
                <Logo className="size-8" />
              </Link>
              <ConnectionAlert userId={me.id} connections={ai} initial={(states.data ?? []) as ConnectionStateRow[]} />
              <div className="ms-auto flex items-center gap-1.5">
                <NewTaskButton />
                {account}
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1600px] px-4 pb-28 pt-5 lg:px-8 lg:pb-12">
            {bannerEl}
            {children}
          </main>
        </div>

        <nav className="safe-bottom fixed inset-x-2 bottom-2 z-40 flex rounded-2xl border border-line bg-[color-mix(in_oklab,var(--surface-strong)_88%,transparent)] px-1 pt-1 shadow-pop backdrop-blur-xl lg:hidden">
          <BottomNavLink href="/dashboard" icon={<House className="size-5" />} label="خانه" />
          <BottomNavLink href="/inbox" match={TASK_PATHS} icon={<ListChecks className="size-5" />} label="کارها" badge={pending.count ?? 0} />
          <BottomNavLink href="/projects" match={["/graph"]} icon={<FolderGit2 className="size-5" />} label="پروژه‌ها" />
          <BottomNavLink href="/queue" icon={<Cpu className="size-5" />} label="صف" />
          <BottomNavLink
            href="/more"
            match={["/agents", "/learning", "/settings", "/help", "/system", "/users", "/banner", "/upgrade"]}
            icon={<MenuIcon className="size-5" />}
            label="بیشتر"
            badge={users.count ?? 0}
          />
        </nav>
      </div>
    </RtlProvider>
  );
}

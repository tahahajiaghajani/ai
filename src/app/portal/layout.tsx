import Link from "next/link";
import { LayoutDashboard, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { RtlProvider } from "@/components/ui/overlays";
import { Brand, Logo } from "@/components/shell/logo";
import { NotificationBell, ThemeToggle, UserMenu } from "@/components/shell/shell-parts";
import { Button } from "@/components/ui/primitives";
import type { NotificationRow } from "@/lib/types";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const { data: notifs } = await db().from("notifications").select("*").eq("user_id", me.id).order("id", { ascending: false }).limit(40);
  await db().from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", me.id);
  return (
    <RtlProvider>
      <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_78%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-4">
          <Link href="/portal" className="hidden sm:block">
            <Brand />
          </Link>
          <Link href="/portal" className="sm:hidden">
            <Logo className="size-8" />
          </Link>
          <div className="ms-auto flex items-center gap-1">
            {me.isAdmin ? (
              <Link href="/dashboard">
                <Button size="sm" variant="ghost">
                  <LayoutDashboard className="size-4" /> اپ اصلی
                </Button>
              </Link>
            ) : null}
            <Link href="/portal/new">
              <Button size="sm">
                <Plus className="size-4" /> تسک جدید
              </Button>
            </Link>
            <NotificationBell userId={me.id} initial={(notifs ?? []) as NotificationRow[]} />
            <ThemeToggle />
            <UserMenu name={me.profile.full_name || me.email} email={me.email} role={me.profile.role} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">{children}</main>
    </RtlProvider>
  );
}

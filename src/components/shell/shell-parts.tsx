"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Bot, LogOut, Moon, PauseCircle, Sparkles, Sun, Zap } from "lucide-react";
import { useRealtimeRows, useNow } from "@/hooks/use-realtime";
import { Pop, Menu } from "@/components/ui/overlays";
import { Avatar, Button } from "@/components/ui/primitives";
import { markNotificationsReadAction } from "@/app/actions/tasks";
import { signOutAction } from "@/app/actions/auth";
import { timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import type { NotificationRow, ProviderState } from "@/lib/types";

export function ThemeToggle() {
  const [dark, setDark] = React.useState<boolean | null>(null);
  React.useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("tf-theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="تغییر تم">
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}

export function NotificationBell({ userId, initial }: { userId: string; initial: NotificationRow[] }) {
  useNow(30_000);
  const router = useRouter();
  const [items, setItems] = useRealtimeRows<NotificationRow & Record<string, unknown>>("notifications", initial as (NotificationRow & Record<string, unknown>)[], {
    filter: `user_id=eq.${userId}`,
    sort: (a, b) => Number(b.id) - Number(a.id),
  });
  const unread = items.filter((n) => !n.read_at).length;
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (unread && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      const latest = items.find((n) => !n.read_at);
      if (latest) new Notification(latest.title, { body: latest.body ?? undefined, dir: "rtl", lang: "fa" });
    }
  }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Pop
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
      }}
      className="w-[min(92vw,380px)] p-0"
      trigger={
        <Button variant="ghost" size="icon" aria-label="اعلان‌ها" className="relative">
          <Bell className="size-5" />
          {unread ? <span className="absolute -top-0.5 -left-0.5 grid min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{faNum(unread)}</span> : null}
        </Button>
      }
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-sm font-bold">اعلان‌ها</p>
        {unread ? (
          <button
            className="text-xs font-semibold text-primary"
            onClick={async () => {
              await markNotificationsReadAction();
              setItems((s) => s.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
            }}
          >
            همه خوانده شد
          </button>
        ) : null}
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-1.5">
        {items.length === 0 ? <p className="py-8 text-center text-sm text-muted">اعلانی ندارید</p> : null}
        {items.slice(0, 40).map((n) => (
          <button
            key={n.id}
            onClick={() => {
              setOpen(false);
              if (n.link) router.push(n.link);
            }}
            className={cn("block w-full rounded-xl px-3 py-2.5 text-start hover:bg-surface-muted", !n.read_at && "bg-primary-soft")}
          >
            <p className="text-[13px] font-semibold">{n.title}</p>
            {n.body ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p> : null}
            <p className="mt-1 text-[10.5px] text-faint">{timeAgo(n.created_at)}</p>
          </button>
        ))}
      </div>
    </Pop>
  );
}

export function ProviderPills({ initial }: { initial: ProviderState[] }) {
  useNow(20_000);
  const [rows] = useRealtimeRows<ProviderState & Record<string, unknown>>("provider_state", initial as (ProviderState & Record<string, unknown>)[], { idKey: "provider" });
  const show = rows.filter((r) => r.provider !== "system");
  return (
    <div className="flex items-center gap-1.5">
      {show.map((p) => {
        const paused = p.manual_pause || (p.paused_until && new Date(p.paused_until).getTime() > Date.now());
        const Icon = p.provider === "gemini" ? Sparkles : Bot;
        return (
          <Link
            key={p.provider}
            href="/queue"
            title={paused ? `${p.pause_reason ?? "متوقف"} — ${p.paused_until ? timeAgo(p.paused_until) : ""}` : "فعال"}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition hover:brightness-110",
              paused ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{p.provider === "gemini" ? "Gemini" : "Claude"}</span>
            {paused ? <PauseCircle className="size-3.5" /> : <Zap className="size-3.5" />}
          </Link>
        );
      })}
    </div>
  );
}

export function UserMenu({ name, email, role }: { name: string; email: string; role: string }) {
  return (
    <Menu
      trigger={
        <button className="flex items-center gap-2 rounded-full p-0.5 hover:bg-surface-muted" aria-label="حساب کاربری">
          <Avatar name={name} size={32} />
        </button>
      }
      items={[
        { label: <span className="flex flex-col"><b>{name}</b><span className="ltr text-xs text-muted">{email}</span></span>, onSelect: () => undefined, disabled: true },
        { label: role === "admin" ? "مدیر سیستم" : "تسک‌دهنده", onSelect: () => undefined, disabled: true },
        "sep",
        { label: "خروج", icon: <LogOut className="size-4" />, danger: true, onSelect: () => void signOutAction() },
      ]}
    />
  );
}

export function NavLink({ href, icon, label, exact, badge }: { href: string; icon: React.ReactNode; label: string; exact?: boolean; badge?: number }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
        active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-muted hover:text-fg",
      )}
    >
      {active ? <span className="absolute inset-y-2 right-0 w-1 rounded-l-full bg-gradient-brand" /> : null}
      <span className={cn("transition", active && "scale-110")}>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge ? <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{faNum(badge)}</span> : null}
    </Link>
  );
}

export function BottomNavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} className={cn("flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-semibold", active ? "text-primary" : "text-muted")}>
      <span className={cn("grid h-7 w-12 place-items-center rounded-full transition", active && "bg-primary-soft")}>{icon}</span>
      {label}
    </Link>
  );
}

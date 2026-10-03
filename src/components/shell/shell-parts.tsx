"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Bell, Camera, LifeBuoy, LogOut, Moon, PauseCircle, Rocket, Sparkles, Sun, X } from "lucide-react";
import { useRealtimeRows, useNow } from "@/hooks/use-realtime";
import { Pop, Menu, Modal } from "@/components/ui/overlays";
import { AvatarPicker } from "@/components/ui/avatar-picker";
import { Avatar, Button } from "@/components/ui/primitives";
import { markNotificationsReadAction } from "@/app/actions/tasks";
import { signOutAction } from "@/app/actions/auth";
import { removeAvatarAction, setAvatarAction } from "@/app/actions/profile";
import { timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import { LATEST_RELEASE, SEEN_RELEASE_KEY } from "@/lib/changelog";
import type { ConnectionStateRow, NotificationRow } from "@/lib/types";
import type { BannerTone } from "@/lib/banner";

function setTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("tf-theme", dark ? "dark" : "light");
  } catch {}
}

function useDark() {
  const [dark, setDark] = React.useState<boolean | null>(null);
  React.useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    setTheme(next);
    setDark(next);
  };
  return [dark, toggle] as const;
}

/** Only where there is no user menu (sign-in pages). */
export function ThemeToggle() {
  const [dark, toggle] = useDark();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="تغییر تم">
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}

/** True while the newest «تازه‌ها» entry has not been opened on this device. */
export function useNewRelease() {
  const [fresh, setFresh] = React.useState(false);
  React.useEffect(() => {
    try {
      setFresh(localStorage.getItem(SEEN_RELEASE_KEY) !== LATEST_RELEASE);
    } catch {}
  }, []);
  return fresh;
}

export function markReleaseSeen() {
  try {
    localStorage.setItem(SEEN_RELEASE_KEY, LATEST_RELEASE);
  } catch {}
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

/** Shown only when something needs attention: no AI key yet, or a key paused on a limit / invalid. */
export function ConnectionAlert({ userId, connections, initial }: { userId: string; connections: { id: string; label: string; provider: string; status: string }[]; initial: ConnectionStateRow[] }) {
  useNow(20_000);
  const [rows] = useRealtimeRows<ConnectionStateRow & Record<string, unknown>>("connection_state", initial as (ConnectionStateRow & Record<string, unknown>)[], {
    idKey: "connection_id",
    filter: `user_id=eq.${userId}`,
  });
  const pill = "flex min-w-0 items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[11.5px] font-bold text-amber-700 transition hover:bg-amber-500/15 dark:text-amber-300";
  if (!connections.length) {
    return (
      <Link href="/settings#connections" className={pill}>
        <Sparkles className="size-3.5 shrink-0" /> <span className="truncate">اتصال هوش مصنوعی</span>
      </Link>
    );
  }
  const paused = connections.filter((c) => {
    const st = rows.find((r) => r.connection_id === c.id);
    return c.status === "error" || st?.manual_pause || (st?.paused_until && new Date(st.paused_until).getTime() > Date.now());
  });
  if (!paused.length) return null;
  const first = paused[0];
  const st = rows.find((r) => r.connection_id === first.id);
  return (
    <Link
      href={first.status === "error" ? "/settings#connections" : "/queue"}
      title={first.status === "error" ? "کلید نامعتبر" : `${st?.pause_reason ?? "متوقف"}${st?.paused_until ? ` — ${timeAgo(st.paused_until)}` : ""}`}
      className={pill}
    >
      <PauseCircle className="size-3.5 shrink-0" />
      <span className="max-w-32 truncate">{first.label}</span>
      {paused.length > 1 ? <span>+{faNum(paused.length - 1)}</span> : null}
    </Link>
  );
}

/** «آیا تجربه کامل اپلیکیشن را می‌خواهید؟» — for users in simple mode (never for the owner). */
export function FullExperienceButton() {
  return (
    <Link
      href="/portal/setup"
      title="آیا تجربه کامل اپلیکیشن را می‌خواهید؟"
      aria-label="تجربه‌ی کامل"
      className="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold text-primary transition hover:bg-primary-soft"
    >
      <Rocket className="size-[18px]" />
      <span className="hidden sm:inline">تجربه‌ی کامل</span>
    </Link>
  );
}

export function UserMenu({ name, email, avatarUrl, mode, isOwner }: { name: string; email: string; avatarUrl?: string | null; mode: "simple" | "full"; isOwner: boolean }) {
  const [editing, setEditing] = React.useState(false);
  const [dark, toggleDark] = useDark();
  const fresh = useNewRelease();
  const router = useRouter();
  // full mode keeps help and settings in the side menu («بیشتر» on phones)
  const simple = mode === "simple";
  return (
    <>
      <Menu
        trigger={
          <button className="relative flex items-center rounded-full p-0.5 transition hover:ring-4 hover:ring-[var(--ring)]" aria-label="حساب کاربری">
            <Avatar name={name} src={avatarUrl} size={32} />
            {simple && fresh ? <span className="absolute -top-0.5 -left-0.5 size-2.5 rounded-full bg-flow ring-2 ring-[var(--bg)]" /> : null}
          </button>
        }
        items={[
          { label: <span className="flex flex-col"><b>{name}</b><span className="ltr text-xs text-muted">{email}</span></span>, onSelect: () => undefined, disabled: true },
          "sep",
          { label: "تصویر پروفایل", icon: <Camera className="size-4" />, onSelect: () => setEditing(true) },
          { label: dark ? "تم روشن" : "تم تیره", icon: dark ? <Sun className="size-4" /> : <Moon className="size-4" />, onSelect: toggleDark },
          ...(simple
            ? [
                { label: <span className="flex items-center gap-2">راهنما{fresh ? <span className="size-2 rounded-full bg-flow" /> : null}</span>, icon: <LifeBuoy className="size-4" />, onSelect: () => router.push("/help") },
                ...(isOwner ? [] : [{ label: "تجربه‌ی کامل", icon: <Rocket className="size-4" />, onSelect: () => router.push("/portal/setup") }]),
              ]
            : []),
          "sep",
          { label: "خروج", icon: <LogOut className="size-4" />, danger: true, onSelect: () => void signOutAction() },
        ]}
      />
      <ProfilePictureDialog open={editing} onOpenChange={setEditing} name={name} current={avatarUrl ?? null} />
    </>
  );
}

/** Change or remove the signed-in user's own profile picture. */
export function ProfilePictureDialog({ open, onOpenChange, name, current }: { open: boolean; onOpenChange: (o: boolean) => void; name: string; current: string | null }) {
  const router = useRouter();
  const [value, setValue] = React.useState<string | null>(current);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) setValue(current);
  }, [open, current]);
  const changed = value !== current;

  const save = async () => {
    setBusy(true);
    const r = value ? await setAvatarAction(value) : await removeAvatarAction();
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(value ? "تصویر پروفایل ذخیره شد" : "تصویر پروفایل حذف شد");
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="تصویر پروفایل"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button onClick={save} loading={busy} disabled={!changed}>
            ذخیره
          </Button>
        </>
      }
    >
      <AvatarPicker name={name} value={value} onChange={setValue} onError={(m) => toast.error(m)} disabled={busy} />
    </Modal>
  );
}

function useActive(href: string, match?: string[]) {
  const path = usePathname();
  return [href, ...(match ?? [])].some((m) => path === m || path.startsWith(`${m}/`));
}

export function NavLink({ href, icon, label, match, badge, muted, dot }: { href: string; icon: React.ReactNode; label: string; match?: string[]; badge?: number; muted?: boolean; dot?: "release" }) {
  const active = useActive(href, match);
  const fresh = useNewRelease();
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
        active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-muted hover:text-fg",
        muted && !active && "opacity-55",
      )}
      title={muted ? "برای این بخش GitHub را در تنظیمات وصل کنید" : undefined}
    >
      {active ? <span className="absolute inset-y-2.5 right-0 w-[3px] rounded-l-full bg-flow" /> : null}
      {icon}
      <span className="flex-1">{label}</span>
      {badge ? <span className="grid min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[10.5px] font-bold text-white">{faNum(badge)}</span> : null}
      {dot === "release" && fresh ? <span className="size-2 rounded-full bg-flow" /> : null}
    </Link>
  );
}

export function BottomNavLink({ href, icon, label, match, badge }: { href: string; icon: React.ReactNode; label: string; match?: string[]; badge?: number }) {
  const active = useActive(href, match);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-semibold", active ? "text-primary" : "text-muted")}>
      <span className={cn("relative grid h-7 w-12 place-items-center rounded-full transition", active && "bg-primary-soft")}>
        {icon}
        {badge ? <span className="absolute -top-1 left-1.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[9.5px] font-bold text-white">{faNum(badge)}</span> : null}
      </span>
      {label}
    </Link>
  );
}

const BANNER_TONES: Record<BannerTone, string> = {
  brand: "from-[color-mix(in_oklab,var(--brand)_14%,transparent)] to-[color-mix(in_oklab,var(--flow)_10%,transparent)] border-[color-mix(in_oklab,var(--brand)_28%,transparent)]",
  gold: "from-[color-mix(in_oklab,var(--gold)_16%,transparent)] to-[color-mix(in_oklab,var(--gold)_6%,transparent)] border-[color-mix(in_oklab,var(--gold)_34%,transparent)]",
  success: "from-emerald-500/14 to-emerald-500/5 border-emerald-500/30",
  warning: "from-amber-500/16 to-amber-500/5 border-amber-500/35",
};
const BANNER_DOT: Record<BannerTone, string> = { brand: "bg-flow", gold: "bg-gold", success: "bg-success", warning: "bg-warning" };

/**
 * The owner's message for everyone. Closing it hides this version on this device; a new message
 * shows again. Hidden before paint through a <html data-banner> flag set in the root layout.
 */
export function AnnouncementBanner({ text, link, tone, version, preview }: { text: string; link: string | null; tone: BannerTone; version: string; preview?: boolean }) {
  const v = version.replace(/[^0-9A-Za-z:.-]/g, "");
  const close = () => {
    try {
      localStorage.setItem("tf-banner", v);
    } catch {}
    document.documentElement.dataset.banner = v;
  };
  const body = (
    <>
      <span className={cn("size-2 shrink-0 rounded-full", BANNER_DOT[tone])} />
      <span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-6">{text}</span>
      {link ? <ArrowLeft className="size-4 shrink-0 opacity-60" /> : null}
    </>
  );
  return (
    <div id={preview ? undefined : "tf-banner"} className={cn("flex items-center gap-1 rounded-2xl border bg-gradient-to-l ps-4 pe-1.5", !preview && "mb-5 animate-float-in", BANNER_TONES[tone])}>
      {preview ? null : <style>{`html[data-banner="${v}"] #tf-banner{display:none}`}</style>}
      {link ? (
        link.startsWith("/") ? (
          <Link href={link} className="flex min-w-0 flex-1 items-center gap-3 py-2.5">
            {body}
          </Link>
        ) : (
          <a href={link} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-3 py-2.5">
            {body}
          </a>
        )
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-2.5">{body}</div>
      )}
      <button onClick={preview ? undefined : close} aria-label="بستن" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-[color-mix(in_oklab,var(--text)_6%,transparent)] hover:text-fg">
        <X className="size-4" />
      </button>
    </div>
  );
}

import Link from "next/link";
import { Blocks, Brain, ChevronLeft, Cpu, Home, Network, Plus, Rocket, Server, Settings, Users } from "lucide-react";
import { requireFull } from "@/lib/auth";
import { Card } from "@/components/ui/primitives";

export const metadata = { title: "بیشتر" };

const LINKS = [
  { href: "/portal/new", label: "ثبت تسک جدید", icon: Plus },
  { href: "/queue", label: "صف و اجرا", icon: Cpu },
  { href: "/graph", label: "گراف دانش (graphify)", icon: Network },
  { href: "/agents", label: "ایجنت‌ها و ورکفلوها", icon: Blocks },
  { href: "/learning", label: "یادگیری و پرامپت‌ها", icon: Brain },
  { href: "/settings", label: "تنظیمات و اتصال‌ها", icon: Settings },
  { href: "/portal", label: "نمای ساده‌ی تسک‌ها", icon: Home },
];

const OWNER_LINKS = [
  { href: "/system", label: "سیستم و سرویس‌ها", icon: Server },
  { href: "/users", label: "کاربران", icon: Users },
  { href: "/upgrade", label: "ارتقای اپلیکیشن", icon: Rocket },
];

function Item({ href, label, icon: Icon }: (typeof LINKS)[number]) {
  return (
    <Link href={href}>
      <Card className="mb-3 flex items-center gap-3 px-4 py-4 transition hover:-translate-y-px">
        <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
          <Icon className="size-5" />
        </span>
        <span className="flex-1 font-bold">{label}</span>
        <ChevronLeft className="size-5 text-muted" />
      </Card>
    </Link>
  );
}

export default async function MorePage() {
  const me = await requireFull();
  return (
    <div className="mx-auto max-w-lg space-y-3">
      <h1 className="mb-4 text-xl font-black">بخش‌های دیگر</h1>
      {LINKS.map((l) => (
        <Item key={l.href} {...l} />
      ))}
      {me.isOwner ? (
        <>
          <p className="px-1 pt-3 text-xs font-bold text-faint">مدیریت اپ (فقط مالک)</p>
          {OWNER_LINKS.map((l) => (
            <Item key={l.href} {...l} />
          ))}
        </>
      ) : null}
    </div>
  );
}

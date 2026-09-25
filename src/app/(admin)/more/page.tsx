import Link from "next/link";
import { Brain, ChevronLeft, Network, Plus, Rocket, Settings, Users } from "lucide-react";
import { Card } from "@/components/ui/primitives";

export const metadata = { title: "بیشتر" };

const LINKS = [
  { href: "/portal/new", label: "ثبت تسک جدید", icon: Plus },
  { href: "/graph", label: "گراف دانش (graphify)", icon: Network },
  { href: "/learning", label: "یادگیری و پرامپت‌ها", icon: Brain },
  { href: "/upgrade", label: "ارتقای اپلیکیشن", icon: Rocket },
  { href: "/users", label: "کاربران", icon: Users },
  { href: "/settings", label: "تنظیمات و اتصال‌ها", icon: Settings },
];

export default function MorePage() {
  return (
    <div className="mx-auto max-w-lg space-y-3">
      <h1 className="mb-4 text-xl font-black">بخش‌های دیگر</h1>
      {LINKS.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href}>
          <Card className="mb-3 flex items-center gap-3 px-4 py-4 transition hover:-translate-y-px">
            <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
              <Icon className="size-5" />
            </span>
            <span className="flex-1 font-bold">{label}</span>
            <ChevronLeft className="size-5 text-muted" />
          </Card>
        </Link>
      ))}
    </div>
  );
}

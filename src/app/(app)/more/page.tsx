import Link from "next/link";
import { Blocks, ChevronLeft, LifeBuoy, Settings, ShieldCheck } from "lucide-react";
import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { faNum } from "@/lib/utils";
import { Card } from "@/components/ui/primitives";
import { Signature } from "@/components/shell/logo";

export const metadata = { title: "بیشتر" };

/** Phones: the menu items that do not fit in the bottom bar. */
export default async function MorePage() {
  const me = await requireFull();
  const pending = me.isOwner ? ((await db().from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending")).count ?? 0) : 0;
  const links = [
    { href: "/agents", label: "ایجنت‌ها", icon: Blocks },
    ...(me.isOwner ? [{ href: "/system", label: "مدیریت", icon: ShieldCheck, badge: pending }] : []),
    { href: "/settings", label: "تنظیمات", icon: Settings },
    { href: "/help", label: "راهنما", icon: LifeBuoy },
  ];
  return (
    <div className="mx-auto max-w-lg">
      <Card className="divide-y divide-line overflow-hidden">
        {links.map(({ href, label, icon: Icon, ...l }) => (
          <Link key={href} href={href} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-muted">
            <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary">
              <Icon className="size-[18px]" />
            </span>
            <span className="flex-1 font-bold">{label}</span>
            {"badge" in l && l.badge ? <span className="grid min-w-5 place-items-center rounded-full bg-danger-fill px-1.5 text-[11px] font-bold text-white">{faNum(l.badge)}</span> : null}
            <ChevronLeft className="size-5 text-faint" />
          </Link>
        ))}
      </Card>
      <p className="mt-8 text-center">
        <Signature />
      </p>
    </div>
  );
}

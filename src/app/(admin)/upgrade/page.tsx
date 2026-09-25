import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { UpgradeClient } from "./upgrade-client";
import type { Upgrade } from "@/lib/types";

export const metadata = { title: "ارتقای اپلیکیشن" };

export default async function UpgradePage() {
  const me = await requireAdmin();
  const { data } = await db().from("upgrades").select("*").order("created_at", { ascending: false }).limit(50);
  return <UpgradeClient userId={me.id} initial={(data ?? []) as Upgrade[]} />;
}

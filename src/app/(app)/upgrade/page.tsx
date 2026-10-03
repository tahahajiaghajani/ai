import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getSystemSettings } from "@/lib/settings";
import { UpgradeClient } from "./upgrade-client";
import type { Upgrade } from "@/lib/types";

export const metadata = { title: "ارتقا" };

export default async function UpgradePage() {
  const me = await requireOwner();
  const [{ data }, settings] = await Promise.all([db().from("upgrades").select("*").order("created_at", { ascending: false }).limit(50), getSystemSettings()]);
  return <UpgradeClient userId={me.id} initial={(data ?? []) as Upgrade[]} autoMergeDefault={settings.upgrade.autoMerge} />;
}

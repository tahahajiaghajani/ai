import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { SettingsClient } from "./settings-client";

export const metadata = { title: "تنظیمات و اتصال‌ها" };

export default async function SettingsPage() {
  await requireAdmin();
  const settings = await getSettings(true);
  return (
    <SettingsClient
      settings={settings}
      info={{
        appUrl: env.appUrl,
        workspaceRepo: env.githubWorkspaceRepo,
        appRepo: env.githubAppRepo,
        owner: env.githubOwner,
        budget: env.workerBudgetMs / 1000,
      }}
    />
  );
}

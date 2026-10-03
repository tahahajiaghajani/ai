import { requireFull } from "@/lib/auth";
import { getUserConfig } from "@/lib/settings";
import { listConnections } from "@/lib/connections";
import { TEMPLATE_VERSION } from "@/lib/github/bootstrap";
import { SettingsClient, type SettingsConnection } from "./settings-client";

export const metadata = { title: "تنظیمات" };

/** Each user's own settings: AI keys, GitHub, the model of each stage, defaults and app mode. */
export default async function SettingsPage() {
  const me = await requireFull();
  const [cfg, conns] = await Promise.all([getUserConfig(me.id, true), listConnections(me.id)]);
  const connections: SettingsConnection[] = conns.map((c) => ({
    id: c.id,
    kind: c.kind,
    provider: c.provider,
    label: c.label,
    baseUrl: c.base_url,
    hint: c.secret_hint,
    status: c.status,
    lastError: c.last_error,
    checkedAt: c.checked_at,
    config: c.config,
  }));
  return <SettingsClient config={cfg} connections={connections} isOwner={me.isOwner} templateVersion={TEMPLATE_VERSION} />;
}

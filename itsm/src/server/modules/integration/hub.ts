// «مرکز اتصال‌ها» (catalogue INT-008, INT-010, INT-017): every way the organisation connects to other systems on one
// page — the record API and its integration users, outbound and inbound webhooks, LDAP/AD and SCIM, Jira and GitHub,
// scheduled exports, and the notification connectors of the notification service (Slack, Microsoft Teams, Telegram,
// Bale, Mattermost, webhooks, SMS) — each with its count, its health and its activity of the last day (counts only).
import type { Ctx } from "../../context";
import { CHANNEL_KINDS } from "@shared/notify";
import { featureStates } from "../admin/common";
import { needIntegrations } from "./common";

export interface ConnectorCard {
  key: string;
  label: string;
  group: "api" | "events" | "identity" | "tools" | "messaging" | "data";
  count: number;
  failing: number;
  calls_24h: number;
  errors_24h: number;
  /** org-relative path of its page */
  path: string;
  feature: { on: boolean; reason: string } | null;
}

const one = async (ctx: Ctx, sql: string, params: unknown[] = []) => Number((await ctx.db.one<{ n: number }>(sql, [ctx.org.id, ...params]))?.n ?? 0);

export async function hubOverview(ctx: Ctx): Promise<{ connectors: ConnectorCard[]; channels: { kind: string; label: string; count: number }[] }> {
  needIntegrations(ctx, "view");
  const features = await featureStates(ctx.db, ctx.org.id, ctx.cfg.mode);
  const feat = (key: string) => {
    const f = features.find((x) => x.key === key);
    return f ? { on: f.on, reason: f.reason } : null;
  };
  const log = async (kind: string) => {
    const r = await ctx.db.one<{ calls: number; errors: number }>(
      `select count(*)::int as calls, count(*) filter (where not ok)::int as errors from sm_int_log where org_id = $1 and kind = $2 and at > now() - interval '24 hours'`,
      [ctx.org.id, kind],
    );
    return { calls_24h: r?.calls ?? 0, errors_24h: r?.errors ?? 0 };
  };
  const live = (table: string, extra = "") => `select count(*)::int as n from ${table} where org_id = $1 and deleted_at is null ${extra}`;
  const connectors: ConnectorCard[] = [
    { key: "api", label: "API رکوردها و کاربران یکپارچه‌سازی", group: "api", count: await one(ctx, live("sm_integration_users")), failing: 0, ...(await log("api")), path: "integrations/users", feature: feat("public_api") },
    { key: "webhooks", label: "وب‌هوک‌های خروجی", group: "events", count: await one(ctx, live("sm_webhook_subscriptions")), failing: await one(ctx, live("sm_webhook_subscriptions", "and health in ('failing', 'paused')")), ...(await log("webhook")), path: "integrations/webhooks", feature: feat("webhooks") },
    { key: "inbound", label: "نقطه‌های دریافت", group: "events", count: await one(ctx, live("sm_inbound_endpoints")), failing: 0, ...(await log("inbound")), path: "integrations/inbound", feature: feat("webhooks") },
    { key: "ldap", label: "LDAP و Active Directory", group: "identity", count: await one(ctx, live("sm_directory_sources", "and kind = 'ldap'")), failing: await one(ctx, live("sm_directory_sources", "and kind = 'ldap' and health = 'failing'")), ...(await log("directory")), path: "integrations/directory", feature: feat("directory_sync") },
    { key: "scim", label: "SCIM (Microsoft Entra ID)", group: "identity", count: await one(ctx, live("sm_directory_sources", "and kind = 'scim'")), failing: 0, ...(await log("scim")), path: "integrations/directory", feature: feat("scim") },
    { key: "issues", label: "Jira و GitHub", group: "tools", count: await one(ctx, live("sm_issue_connections")), failing: await one(ctx, live("sm_issue_connections", "and health = 'failing'")), ...(await log("issue")), path: "integrations/issues", feature: feat("issue_sync") },
    { key: "exports", label: "خروجی‌های زمان‌بندی‌شده", group: "data", count: await one(ctx, live("sm_export_schedules")), failing: await one(ctx, live("sm_export_schedules", "and health = 'failing'")), ...(await log("export")), path: "integrations/exports", feature: feat("scheduled_exports") },
    { key: "legacy_hooks", label: "وب‌هوک‌های دریافتی پیشین", group: "events", count: await one(ctx, `select count(*)::int as n from sm_integrations where org_id = $1 and deleted_at is null`), failing: 0, calls_24h: await one(ctx, `select count(*)::int as n from sm_integration_events where org_id = $1 and topic <> 'inbound' and received_at > now() - interval '24 hours'`), errors_24h: 0, path: "settings/integrations", feature: null },
  ];
  const kinds = await ctx.db.query<{ kind: string; n: number }>(`select kind, count(*)::int as n from sm_notification_channels where org_id = $1 and deleted_at is null group by kind`, [ctx.org.id]);
  const channels = Object.entries(CHANNEL_KINDS).map(([kind, info]) => ({ kind, label: info.label, count: kinds.find((k) => k.kind === kind)?.n ?? 0 }));
  return { connectors, channels };
}

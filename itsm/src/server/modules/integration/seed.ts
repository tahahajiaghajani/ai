// Day-one defaults of the integration hub (Persian, idempotent — each item is created only when missing):
//   · notification rules for its own moments: a webhook paused after repeated failures; a directory synchronisation
//     failed — to the record's creator (and the source's approver) and the organisation's administrators
//   · an inactive sample inbound endpoint is NOT seeded: an endpoint needs an integration user with roles an owner chose
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn } from "../../engine";
import { liveRows, sysOf } from "./common";

export async function seedIntegrationDefaultsIn(tx: Tx, ctx: Ctx): Promise<Record<string, number>> {
  const sys = sysOf(ctx);
  const out: Record<string, number> = {};
  const ensureRule = async (name: string, values: Record<string, unknown>) => {
    const [found] = await liveRows(tx, sys, "notification_rule", { f: "name", op: "eq", v: name }, { limit: 1 });
    if (found) return;
    await createIn(tx, sys, "notification_rule", { name, ...values }, { trusted: true });
    out.notification_rule = (out.notification_rule ?? 0) + 1;
  };
  await ensureRule("وب‌هوک پس از خطاهای پیاپی متوقف شد", {
    table_key: "webhook_subscription",
    event: "custom",
    custom_event: "webhook_paused",
    recipients: { event_users: true, roles: ["tenant_admin"] },
    channels: ["in_app", "email"],
    active: true,
    description: "اشتراک وب‌هوک پس از چند ارسال ناموفق پیاپی متوقف شده است؛ پس از رفع مشکل گیرنده آن را از سر بگیرید",
  });
  await ensureRule("همگام‌سازی فهرست کاربران ناموفق بود", {
    table_key: "directory_source",
    event: "custom",
    custom_event: "directory_failed",
    recipients: { event_users: true, roles: ["tenant_admin"] },
    channels: ["in_app", "email"],
    active: true,
    description: "خواندن یا اعمال LDAP / Active Directory انجام نشد",
  });
  return out;
}

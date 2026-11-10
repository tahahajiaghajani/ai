// Day-one defaults of the administration console (Persian, idempotent; `seeded` on admin_config):
//   · the console's settings row
//   · seat pools: «کارشناسان» (25) and «مدیران سامانه» (5) — edited in «مجوزها و صندلی‌ها»
//   · a transform map for importing incidents from an older service desk's spreadsheet (number, subject, description,
//     requester's e-mail, priority with value mapping), as an example to copy
//   · notification rules for the console's moments: an export is ready; a scheduled import failed
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { tableDef } from "@shared/tables";
import { createIn, savepoint, updateIn } from "../../engine";
import { configRow, liveRows, sysOf, type Row } from "./common";

export const ADMIN_SEED_VERSION = 1;

export interface AdminSeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

async function ensure(tx: Tx, sys: Ctx, out: AdminSeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, { and: Object.entries(key).map(([f, v]) => ({ f, op: "eq" as const, v })) }, { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

export async function seedAdminDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<AdminSeedCounts> {
  const sys = sysOf(ctx);
  const out: AdminSeedCounts = { skipped: false, created: {} };
  const cfg = await configRow(tx, sys);
  if (Number(cfg.seeded ?? 0) >= ADMIN_SEED_VERSION && !opts.force) return { ...out, skipped: true };

  await ensure(tx, sys, out, "licence_pool", { kind: "agent", name: "کارشناسان" }, { quantity: 25, active: true, note: "صندلی کارشناسان و سرپرستان؛ درخواست‌دهندگان و تأییدکنندگان صندلی مصرف نمی‌کنند" });
  await ensure(tx, sys, out, "licence_pool", { kind: "admin", name: "مدیران سامانه" }, { quantity: 5, active: true });

  // optional: only where the incident module's table exists (savepoint: a refusal never aborts the seed)
  if (tableDef("incident")) await savepoint(tx, () => ensure(tx, sys, out, "transform_map", { name: "رخدادها از سامانهٔ پیشین (نمونه)" }, {
    target_table: "incident",
    key_field: "number",
    active: true,
    description: "نمونه‌ای برای رونوشت: ستون‌های رایج خروجی اکسل سامانه‌های دیگر (شماره، موضوع، شرح، ایمیل درخواست‌کننده، اولویت) با جایگزینی مقدار اولویت",
    rules: [
      { source: "موضوع", target: "short_description", transform: "trim" },
      { source: "شرح", target: "description", transform: "copy" },
      { source: "ایمیل درخواست‌کننده", target: "caller_id", transform: "lower" },
      { source: "اولویت", target: "priority", transform: "map", map: { "بحرانی": "1", "بالا": "2", "متوسط": "3", "پایین": "4", "critical": "1", "high": "2", "medium": "3", "low": "4" } },
    ],
  })).catch(() => null);

  await ensure(tx, sys, out, "notification_rule", { name: "خروجی داده آماده است" }, {
    table_key: "data_export",
    event: "custom",
    custom_event: "export_ready",
    recipients: { event_users: true },
    channels: ["in_app"],
    active: true,
    description: "به درخواست‌کنندهٔ خروجی (و مالک برنامهٔ زمان‌بندی‌شده) خبر می‌دهد که فایل‌ها آماده‌اند",
  });
  await savepoint(tx, () => ensure(tx, sys, out, "notification_rule", { name: "ورود زمان‌بندی‌شده ناموفق" }, {
    table_key: "import_set",
    event: "updated",
    condition: { f: "status", op: "eq", v: "failed" },
    recipients: { fields: ["created_by"], roles: ["tenant_admin"] },
    channels: ["in_app", "email"],
    active: true,
    description: "وقتی اجرای یک مجموعهٔ ورود داده ناموفق می‌شود",
  })).catch(() => null);

  await updateIn(tx, sys, "admin_config", String(cfg.id), { seeded: ADMIN_SEED_VERSION }, { trusted: true });
  return out;
}

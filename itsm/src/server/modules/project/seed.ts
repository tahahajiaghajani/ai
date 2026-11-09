// Day-one defaults of project and portfolio management (Persian, idempotent, as the system):
//   · the settings row (project_config: scoring model, weekly capacity, health thresholds); it records the seed
//   · the organisation roles «مدیر پروژه» (project_manager: every project, gates, conversions, approving time) and
//     «عضو تیم پروژه» (project_member: reads projects, works the tasks assigned to them, records time) — agents and
//     requesters have no access to projects by default
//   · the portfolio «سبد فناوری اطلاعات»
//   · the approval rule of the project gate (the sponsor, then the portfolio's manager) through the approvals service
//   · notification rules: a project at risk, a published status report, a rejected time entry, a demand submitted
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { eqAll, liveRows, sysOf, type Row } from "./common";

export const PROJECT_SEED_VERSION = 1;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

export const PROJECT_ROLES: Row[] = [
  {
    key: "project_manager", name: "مدیر پروژه", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "همهٔ پروژه‌ها، سبدها و تقاضاها؛ دروازه‌های تصویب، تبدیل تقاضا به پروژه و تأیید زمان کارکنان",
    grants: { project: { read: "all", create: true, write: "all", approve: true } },
    field_groups: ["internal", "financial", "personal"], contains: [],
  },
  {
    key: "project_member", name: "عضو تیم پروژه", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "دیدن پروژه‌ها و برنامهٔ آن‌ها، کار روی کارهای سپرده به خود، ثبت زمان و ثبت تقاضا",
    grants: { project: { read: "all", create: true, write: "own" } },
    field_groups: ["internal"], contains: [],
  },
];

export function approvalRules(): Row[] {
  return [{
    table_key: "project", name: "دروازهٔ تصویب پروژه ← حامی و مدیر سبد", sort_order: 10, mode: "sequential", expire_after: 7 * 24 * 3600, remind_every: 24 * 3600, expire_action: "reject",
    condition: { f: "state", op: "eq", v: "gate" }, active: true, allow_self_approval: false,
    levels: [
      { name: "حامی پروژه", sources: [{ kind: "field", field: "sponsor_id" }], rule: "any" },
      { name: "مدیر سبد", sources: [{ kind: "owner", of: "portfolio_manager" }], rule: "any" },
    ],
    description: "حامی پروژه و سپس مدیر سبد آن؛ تصویب، پروژه را به «تصویب‌شده» می‌برد و رد آن به «پیشنهادی».",
  }];
}

export function notificationRules(): Row[] {
  return [
    { table_key: "project", name: "پروژه در خطر است", event: "custom", custom_event: "project.at_risk", recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "status_report", name: "گزارش وضعیت پروژه منتشر شد", event: "custom", custom_event: "status_report.published", recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "time_entry", name: "ثبت زمان رد شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "rejected" }, recipients: { fields: ["user_id"] }, channels: ["in_app"] },
    { table_key: "demand", name: "تقاضای تازه برای ارزیابی", event: "state_changed", condition: { f: "state", op: "changes_to", v: "submitted" }, recipients: { roles: ["project_manager"] }, channels: ["in_app"] },
  ].map((r) => ({ active: true, notify_actor: false, digest: false, mandatory: false, ...r }));
}

export async function seedProjectDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "project_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= PROJECT_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensure(tx, sys, out, "project_config", { config_key: "default" }, { name: "تنظیمات پروژه‌ها" }));
  for (const r of PROJECT_ROLES) await ensure(tx, sys, out, "role", { key: r.key }, r);
  await ensure(tx, sys, out, "portfolio", { name: "سبد فناوری اطلاعات" }, { code: "IT", active: true, goals: "- پایداری و امنیت خدمت‌های اصلی\n- خودکارسازی فرایندهای پرتکرار\n- کاهش هزینهٔ زیرساخت" });
  for (const r of approvalRules()) await ensure(tx, sys, out, "approval_rule", { table_key: r.table_key, name: r.name }, r);
  for (const r of notificationRules()) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);
  await updateIn(tx, sys, "project_config", String(config.id), { seeded: PROJECT_SEED_VERSION }, { trusted: true });
  return out;
}

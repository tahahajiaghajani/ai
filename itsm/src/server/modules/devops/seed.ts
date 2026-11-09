// Day-one defaults of DevOps (Persian, idempotent, as the system; after the change and release seeds):
//   · the standard change «استقرار خودکار از خط لوله» in the change module's catalogue (published, low risk) — the
//     template every production deployment of a pipeline gets its change from, set as the release settings' default
//   · a demo connection «نمونهٔ GitHub Actions» with its webhook key (no secret yet: «ساخت راز» shows one once), a
//     repository and a pipeline that deploys to test, staging and production
//   · the approval rule of pending deployment gates (release managers) and the notification of a pending gate
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { eqAll, liveRows, randomKey, sysOf, type Row } from "./common";

export const DEVOPS_SEED_VERSION = 1;
export const PIPELINE_TEMPLATE_NAME = "استقرار خودکار از خط لوله (دواپس)";
export const DEMO_CONNECTION_NAME = "نمونهٔ GitHub Actions";

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

export const PIPELINE_TEMPLATE: Row = {
  kind: "standard", state: "published", category: "application", risk: "low", impact: "3", max_duration: 2 * 3600,
  short_description: "استقرار خودکار نسخهٔ تازه از خط لوله",
  description: "تغییر استاندارد از پیش مجاز برای استقرارهای خط لوله‌ها در محیط عملیاتی: ساخت و آزمون خودکار در خط لوله انجام شده و دروازهٔ استقرار شواهد را ثبت می‌کند. پس از دو اجرای ناموفق معلق می‌شود تا بازبینی شود.",
  implementation_plan: "۱. خط لوله نسخه را ساخته و آزمون‌های خودکار را گذرانده است\n۲. دروازهٔ استقرار مجوز می‌دهد\n۳. استقرار در محیط عملیاتی\n۴. آزمون دود و پایش شاخص‌ها",
  backout_plan: "استقرار دوبارهٔ نسخهٔ پیشین از همان خط لوله (بازگشت خودکار) یا خاموش کردن پرچم ویژگی.",
  test_plan: "آزمون‌های خودکار خط لوله و آزمون دود پس از استقرار.",
};

/** Add the defaults inside `tx` as the system. */
export async function seedDevopsDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "release_config", null, { order: "t.created_at", limit: 1 });
  const marker = await liveRows(tx, sys, "devops_connection", eqAll({ name: DEMO_CONNECTION_NAME }), { limit: 1 });
  if (marker.length && !opts.force) return { ...out, skipped: true };

  const template = await ensure(tx, sys, out, "change_template", { name: PIPELINE_TEMPLATE_NAME }, PIPELINE_TEMPLATE).catch(() => null);
  if (template && cfg && !cfg.default_change_template_id) await updateIn(tx, sys, "release_config", String(cfg.id), { default_change_template_id: template.id }, { trusted: true });

  const envs = await liveRows(tx, sys, "release_environment", null);
  const envIds = ["test", "staging", "prod"].map((k) => envs.find((e) => e.key === k)?.id).filter(Boolean);
  const conn = await ensure(tx, sys, out, "devops_connection", { name: DEMO_CONNECTION_NAME }, {
    kind: "github", active: true, hook_key: randomKey(), principal: "github-actions[bot]", auto_change: true, close_changes: true, gate_timeout_minutes: 60,
    env_map: { production: "prod", staging: "staging", test: "test" },
    description: "اتصال نمونه: نشانی وب‌هوک را در مخزن (Settings → Webhooks) بگذارید، «ساخت راز» را بزنید و راز را در همان‌جا وارد کنید. رویدادهای push، pull_request، workflow_run و deployment_status پذیرفته می‌شوند.",
    ...(template ? { change_template_id: template.id } : {}),
  });
  const repo = await ensure(tx, sys, out, "dev_repository", { connection_id: conn.id, name: "acme/portal" }, { url: "https://github.com/acme/portal", default_branch: "main", visibility: "private" });
  await ensure(tx, sys, out, "dev_pipeline", { connection_id: conn.id, name: "build-and-deploy" }, { repository_id: repo.id, environments: envIds, ...(template ? { change_template_id: template.id } : {}) });

  await ensure(tx, sys, out, "approval_rule", { table_key: "change_gate", name: "دروازهٔ استقرار در انتظار ← مدیر انتشار" }, {
    active: true, allow_self_approval: false, sort_order: 10, mode: "sequential", expire_after: 4 * 3600, remind_every: 3600, expire_action: "reject",
    condition: { f: "state", op: "eq", v: "pending" },
    levels: [{ name: "مدیران انتشار", sources: [{ kind: "owner", of: "release_manager" }], rule: "any" }],
    description: "دروازه‌ای که خط‌مشی نتوانست خودکار تصمیم بگیرد (تغییر مجاز ندارد یا الگوی استاندارد معلق است) را یکی از مدیران انتشار تأیید یا رد می‌کند.",
  });
  await ensure(tx, sys, out, "notification_rule", { table_key: "dev_event", name: "رویدادهای اتصال دواپس ناموفق است" }, {
    active: true, event: "updated", condition: { f: "status", op: "changes_to", v: "failed" }, recipients: { roles: ["release_manager"] }, channels: ["in_app"], notify_actor: false, digest: true, mandatory: false,
  });
  return out;
}

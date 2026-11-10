// Day-one defaults of the service portfolio for an organisation (Persian, idempotent):
//   · the settings row (service_config) — it also records that the defaults were added (`seeded`)
//   · the portfolio taxonomy: «خدمات کسب‌وکار» and «خدمات فنی پشتیبان» with their usual categories (SPF-003)
//   · technology standards of common platforms with their vendors' end-of-support dates (SPF-028)
//   · a first level of business capabilities (SPF-029)
//   · notification rules: status changes and reviews due to the owners, proposals to the configuration managers,
//     design packages handed over, agreements ending
//   · an inactive flow template: stakeholders told when a service goes live
// Every item is created only when no live row with its natural key exists; a second run adds nothing unless forced.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { savepoint, updateIn } from "../../engine";
import { ensureRow, type SeedCounts } from "../incident/seed";
import { liveRows, sysOf, type Row } from "./common";

export const PORTFOLIO_SEED_VERSION = 1;

const TAXONOMY: { name: string; description: string; children: string[] }[] = [
  { name: "خدمات کسب‌وکار", description: "خدمت‌هایی که کارکنان و مشتریان مستقیم به کار می‌برند", children: ["ارتباطات و همکاری", "محیط کار کاربران", "سامانه‌های کسب‌وکار", "داده و گزارش"] },
  { name: "خدمات فنی پشتیبان", description: "خدمت‌هایی که خدمت‌های دیگر روی آن‌ها کار می‌کنند", children: ["زیرساخت و مرکز داده", "شبکه و ارتباطات", "امنیت اطلاعات", "پایگاه داده و میان‌افزار"] },
];

const STANDARDS: Row[] = [
  { name: "Windows Server", vendor: "Microsoft", product_version: "2012", status: "prohibited", eol_date: "2023-10-10", match_field: "os", notes: "پشتیبانی سازنده پایان یافته است؛ به نسخهٔ پشتیبانی‌شده ارتقا دهید." },
  { name: "Windows Server", vendor: "Microsoft", product_version: "2016", status: "retiring", eol_date: "2027-01-12", match_field: "os" },
  { name: "Windows Server", vendor: "Microsoft", product_version: "2022", status: "approved", eol_date: "2031-10-14", match_field: "os" },
  { name: "Windows", vendor: "Microsoft", product_version: "7", status: "prohibited", eol_date: "2020-01-14", match_field: "os" },
  { name: "Windows", vendor: "Microsoft", product_version: "10", status: "retiring", eol_date: "2025-10-14", match_field: "os", notes: "رایانه‌ها را به ویندوز ۱۱ ارتقا دهید." },
  { name: "Windows", vendor: "Microsoft", product_version: "11", status: "approved", match_field: "os" },
  { name: "CentOS", vendor: "CentOS Project", product_version: "7", status: "prohibited", eol_date: "2024-06-30", match_field: "os" },
  { name: "Ubuntu", vendor: "Canonical", product_version: "18.04", status: "retiring", eol_date: "2023-05-31", match_field: "os" },
  { name: "Ubuntu", vendor: "Canonical", product_version: "24.04", status: "approved", eol_date: "2029-05-31", match_field: "os" },
];

const CAPABILITIES = ["ارتباط با مشتری", "فروش و بازاریابی", "مالی و حسابداری", "منابع انسانی", "تأمین و تدارکات", "عملیات و تولید", "فناوری اطلاعات", "حقوقی و انطباق"];

const NOTIFICATIONS = (): Row[] => [
  { table_key: "service", name: "وضعیت خدمت شما تغییر کرد", event: "custom", custom_event: "service.status_changed", recipients: { event_users: true }, channels: ["in_app", "email"] },
  { table_key: "service", name: "موعد بازبینی خدمت", event: "custom", custom_event: "service.review_due", recipients: { event_users: true }, channels: ["in_app", "email"] },
  { table_key: "service", name: "خدمتی به شما سپرده شد", event: "updated", condition: { f: "owner_id", op: "changed" }, recipients: { fields: ["owner_id"] }, channels: ["in_app"] },
  { table_key: "service_proposal", name: "پیشنهاد خدمت تازه برای ارزیابی", event: "state_changed", condition: { f: "state", op: "changes_to", v: "submitted" }, recipients: { roles: ["configuration_manager", "service_owner"] }, channels: ["in_app"] },
  { table_key: "service_proposal", name: "تصمیم دربارهٔ پیشنهاد خدمت شما", event: "state_changed", condition: { f: "state", op: "in", v: ["approved", "rejected", "chartered"] }, recipients: { fields: ["proposer_id"] }, channels: ["in_app", "email"] },
  { table_key: "service_design_package", name: "بستهٔ طراحی برای بازبینی", event: "state_changed", condition: { f: "state", op: "changes_to", v: "in_review" }, recipients: { fields: ["reviewer_id"] }, channels: ["in_app", "email"] },
  { table_key: "service_agreement", name: "توافق مشتری پایان یافت", event: "updated", condition: { f: "status", op: "changes_to", v: "expired" }, recipients: { fields: ["manager_id"] }, channels: ["in_app", "email"] },
];

const LIVE_FLOW = (): Row => ({
  name: "اطلاع به ذی‌نفعان هنگام زنده شدن خدمت",
  active: false,
  description: "الگو: وقتی خدمتی زنده می‌شود مالک و مالک محصول آن خبردار شوند. پیش از استفاده آن را منتشر و فعال کنید.",
  trigger: "record",
  trigger_table: "service",
  trigger_events: ["state_changed"],
  trigger_condition: { f: "state", op: "eq", v: "live" },
  run_as: "trigger_user",
  graph: {
    nodes: [
      { id: "trigger", type: "trigger", config: {}, position: { x: 0, y: 0 } },
      {
        id: "notify1", type: "notify", label: "خبر به مالکان خدمت", position: { x: 0, y: 140 },
        config: {
          to: { fields: ["owner_id", "product_owner_id"] },
          subject: "خدمت {{trigger.record.number}} زنده شد",
          body: "خدمت «{{trigger.record.name}}» زنده شد و در کاتالوگ در دسترس است.",
        },
      },
    ],
    edges: [{ id: "trigger-out-notify1", source: "trigger", target: "notify1" }],
    layout: { direction: "TB" },
  },
});

/** Add the defaults inside `tx` as the system. */
export async function seedPortfolioDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "service_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= PORTFOLIO_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensureRow(tx, sys, out, "service_config", { config_key: "default" }, { name: "تنظیمات سبد خدمات" }));
  for (const [i, top] of TAXONOMY.entries()) {
    const root = await ensureRow(tx, sys, out, "portfolio_node", { name: top.name, kind: "portfolio" }, { description: top.description, sort_order: (i + 1) * 10 });
    for (const [j, name] of top.children.entries()) await ensureRow(tx, sys, out, "portfolio_node", { name, parent_id: root.id }, { kind: "category", sort_order: (j + 1) * 10 });
  }
  for (const s of STANDARDS) await ensureRow(tx, sys, out, "technology_standard", { name: s.name, product_version: s.product_version }, s);
  for (const [i, name] of CAPABILITIES.entries()) await ensureRow(tx, sys, out, "business_capability", { name }, { sort_order: (i + 1) * 10 });
  for (const r of NOTIFICATIONS()) await ensureRow(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, { active: true, notify_actor: false, digest: false, mandatory: false, ...r });
  const flow = LIVE_FLOW();
  await savepoint(tx, () => ensureRow(tx, sys, out, "flow", { name: flow.name }, flow)).catch(() => undefined);
  await updateIn(tx, sys, "service_config", config.id, { seeded: PORTFOLIO_SEED_VERSION }, { trusted: true });
  return out;
}

export type { SeedCounts };

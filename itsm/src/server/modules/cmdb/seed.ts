// Day-one defaults of configuration management for an organisation (Persian, idempotent):
//   · the settings row (cmdb_config) — it also records that the defaults were added (`seeded`)
//   · the CSDM-aligned class pack (CMDB-002) with attributes, completeness and staleness settings, relationship rules
//     and controlled attributes; the relationship types with their impact behaviour; the default identification rules
//   · data sources (manual entry, files, API) and a rule-based relationship (VM host id = server BIOS id → «اجرا روی»)
//   · data-quality and audit rules, a retire-stale policy (inactive until switched on)
//   · notification rules (critical CI down, a CI handed to its owner, findings, drift, duplicates, expiries,
//     certification tasks) and an inactive flow template (owners told when their CI is retired)
// Every item is created only when no live row with its natural key exists; a second run adds nothing unless forced.
import { CLASS_FAMILIES, CLASS_LIBRARY, IDENT_RULES, REL_TYPES } from "@shared/cmdb/classes";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { savepoint, updateIn } from "../../engine";
import { ensureRow, type SeedCounts } from "../incident/seed";
import { liveRows, sysOf, type Row } from "./common";
import { invalidateCmdbCache } from "./common";

export const CMDB_SEED_VERSION = 1;

function classRows(): Row[] {
  return CLASS_LIBRARY.map((c, i) => ({
    key: c.key, label: c.label, parent_key: c.parent, family: c.family, icon: c.icon ?? null, color: CLASS_FAMILIES[c.family].color,
    abstract: !!c.abstract, principal: !!c.principal, create_disabled: false, active: true, builtin: true, pack_version: CMDB_SEED_VERSION,
    description: c.description ?? null, attrs: c.attrs ?? [], required_fields: c.required ?? [], recommended_fields: c.recommended ?? [],
    owner_required: !!c.ownerRequired, stale_days: c.staleDays ?? null, operational_requires: c.operationalRequires ?? [], rel_rules: c.relRules ?? [],
    controlled_attrs: c.controlled ?? [], sort_order: (i + 1) * 10,
  }));
}

const RULES: Row[] = [
  {
    name: "سرور عملیاتی گروه پشتیبانی دارد", kind: "data_quality", class: "server", severity: "high",
    scope_condition: { f: "state", op: "eq", v: "operational" }, check_condition: { f: "support_group_id", op: "nempty" }, due_days: 7,
    description: "هر سرور در حال کار باید گروهی داشته باشد که رخدادهایش به آن برسد.",
  },
  {
    name: "پیکربندی حیاتی مدیر فنی دارد", kind: "audit", class: "ci", severity: "medium", category: "مسئولیت",
    scope_condition: { and: [{ f: "criticality", op: "eq", v: "1" }, { f: "state", op: "in", v: ["operational", "maintenance"] }] }, check_condition: { f: "managed_by", op: "nempty" }, due_days: 14,
  },
  {
    name: "پایگاه دادهٔ تولیدی پشتیبان‌گیری دارد", kind: "audit", class: "database", severity: "high", category: "پشتیبان‌گیری",
    scope_condition: { f: "environment", op: "eq", v: "production" }, required_rel: { type: "backs_up", direction: "in", min: 1 }, due_days: 14,
    description: "هر پایگاه دادهٔ محیط عملیاتی باید پیکربندی پشتیبان‌گیری داشته باشد که با رابطهٔ «پشتیبان‌گیری از» به آن وصل است.",
  },
  {
    name: "گواهی دیجیتال تاریخ انقضا دارد", kind: "data_quality", class: "certificate", severity: "medium",
    check_condition: { f: "expires_at", op: "nempty" }, due_days: 7,
  },
];

const NOTIFICATIONS = (): Row[] => [
  {
    table_key: "ci", name: "پیکربندی حیاتی از کار افتاد", event: "updated",
    condition: { and: [{ f: "operational_status", op: "changes_to", v: "non_operational" }, { f: "criticality", op: "in", v: ["1", "2"] }] },
    recipients: { fields: ["owned_by", "managed_by", "support_group_id"], roles: ["configuration_manager"] }, channels: ["in_app", "email"],
  },
  { table_key: "ci", name: "پیکربندی به شما سپرده شد", event: "updated", condition: { f: "owned_by", op: "changed" }, recipients: { fields: ["owned_by"] }, channels: ["in_app"] },
  { table_key: "ci", name: "انقضای نزدیک پیکربندی", event: "custom", custom_event: "cmdb.expiring", recipients: { event_users: true, fields: ["support_group_id"] }, channels: ["in_app", "email"], mandatory: true },
  { table_key: "cmdb_finding", name: "یافتهٔ کیفیت داده برای پیکربندی شما", event: "created", recipients: { assignee: true, assignment_group: true }, channels: ["in_app"], digest: true },
  { table_key: "ci_drift", name: "انحراف پیکربندی ثبت شد", event: "created", recipients: { assignee: true, assignment_group: true, roles: ["configuration_manager"] }, channels: ["in_app", "email"] },
  { table_key: "cmdb_dedup_task", name: "پیکربندی‌های تکراری نیازمند بررسی", event: "created", recipients: { roles: ["configuration_manager"] }, channels: ["in_app"], digest: true },
  { table_key: "ci_cert_task", name: "تأیید دادهٔ پیکربندی‌های شما", event: "created", recipients: { assignee: true }, channels: ["in_app", "email"] },
];

const RETIRE_FLOW = (): Row => ({
  name: "اطلاع به مالکان هنگام بازنشستگی پیکربندی",
  active: false,
  description: "الگو: وقتی پیکربندی بازنشسته می‌شود مالک و مدیر فنی آن خبردار شوند. پیش از استفاده آن را منتشر و فعال کنید.",
  trigger: "record",
  trigger_table: "ci",
  trigger_events: ["state_changed"],
  trigger_condition: { f: "state", op: "eq", v: "retired" },
  run_as: "trigger_user",
  graph: {
    nodes: [
      { id: "trigger", type: "trigger", config: {}, position: { x: 0, y: 0 } },
      {
        id: "notify1", type: "notify", label: "خبر به مالکان", position: { x: 0, y: 140 },
        config: {
          to: { fields: ["owned_by", "managed_by"] },
          subject: "پیکربندی {{trigger.record.number}} بازنشسته شد",
          body: "پیکربندی «{{trigger.record.name}}» بازنشسته شد. اگر هنوز به آن وابسته‌اید، با مدیر پیکربندی تماس بگیرید.",
        },
      },
    ],
    edges: [{ id: "trigger-out-notify1", source: "trigger", target: "notify1" }],
    layout: { direction: "TB" },
  },
});

/** Add the defaults inside `tx` as the system. */
export async function seedCmdbDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "cmdb_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= CMDB_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensureRow(tx, sys, out, "cmdb_config", { config_key: "default" }, { name: "تنظیمات پیکربندی" }));

  for (const c of classRows()) await ensureRow(tx, sys, out, "ci_class", { key: c.key }, c);
  for (const [i, t] of REL_TYPES.entries()) {
    await ensureRow(tx, sys, out, "ci_rel_type", { key: t.key }, {
      label: t.label, inverse_label: t.inverse, is_symmetric: !!t.symmetric, propagates: t.propagates, impact: t.impact, color: t.color, category: t.category,
      builtin: true, active: true, sort_order: (i + 1) * 10, description: t.description ?? null,
    });
  }
  invalidateCmdbCache(ctx.org.id);
  for (const [i, r] of IDENT_RULES.entries()) await ensureRow(tx, sys, out, "ci_identification_rule", { name: r.name }, { class: r.class, entries: r.entries, active: true, builtin: true, sort_order: (i + 1) * 10 });
  await ensureRow(tx, sys, out, "cmdb_data_source", { name: "ثبت دستی" }, { kind: "manual", priority: 20, stale_after_days: 0, delete_policy: "none", owner_id: null, description: "پیکربندی‌هایی که کارشناسان مستقیم ثبت می‌کنند" });
  await ensureRow(tx, sys, out, "cmdb_data_source", { name: "ورود از فایل" }, { kind: "file", priority: 60, stale_after_days: 90, delete_policy: "flag", owner_id: null, description: "اکسل، CSV یا JSON که در «ورود داده» بارگذاری می‌شود" });
  await ensureRow(tx, sys, out, "cmdb_data_source", { name: "API و وب‌هوک" }, { kind: "api", priority: 50, stale_after_days: 30, delete_policy: "flag", owner_id: null, description: "سامانه‌های دیگر از راه وب‌هوک با موضوع cmdb.items" });
  await ensureRow(tx, sys, out, "ci_rel_rule", { name: "ماشین مجازی روی میزبان (شناسهٔ BIOS)" }, {
    source_class: "virtual_machine", source_attr: "attrs.host_uuid", target_class: "server", target_attr: "bios_uuid", type: "runs_on", mode: "create_and_retire", active: true,
  });
  for (const r of RULES) await ensureRow(tx, sys, out, "cmdb_rule", { name: r.name }, { active: true, creates_findings: true, ...r });
  await ensureRow(tx, sys, out, "cmdb_policy", { name: "بازنشستگی پیکربندی‌های کشف‌شده‌ای که ۱۸۰ روز دیده نشده‌اند" }, {
    action: "retire", after_days: 180, condition: { f: "discovery_source_id", op: "nempty" }, max_per_run: 200, active: false,
    description: "پیش از فعال کردن، فهرست پیکربندی‌های کهنه را در داشبورد بررسی کنید.",
  });
  for (const r of NOTIFICATIONS()) await ensureRow(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, { active: true, notify_actor: false, digest: false, mandatory: false, ...r });
  const flow = RETIRE_FLOW();
  await savepoint(tx, () => ensureRow(tx, sys, out, "flow", { name: flow.name }, flow)).catch(() => undefined);
  await updateIn(tx, sys, "cmdb_config", config.id, { seeded: CMDB_SEED_VERSION }, { trusted: true });
  return out;
}

export type { SeedCounts };

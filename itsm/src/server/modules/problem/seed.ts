// Day-one defaults of problem management (Persian, idempotent like the incident module's): the settings row, the
// category tree and the ITIL priority matrix of problems, and notification rules (a known error published, a problem
// fixed and under monitoring, a new candidate).
import { ITIL_MATRIX } from "@shared/sla/rules";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { updateIn } from "../../engine";
import { ensureRow, liveRows, seedCategories, sysOf, type Row, type SeedCounts } from "../incident";

export const PROBLEM_SEED_VERSION = 1;

const RULES: Row[] = [
  { table_key: "known_error", name: "خطای شناخته‌شدهٔ تازه منتشر شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "published" }, recipients: { assignment_group: true, roles: ["service_desk_manager"] }, channels: ["in_app"] },
  { table_key: "problem", name: "مشکل رفع شد و در پایش است", event: "state_changed", condition: { f: "state", op: "changes_to", v: "resolved" }, recipients: { requester: true, fields: ["manager_id"] }, channels: ["in_app", "email"] },
  { table_key: "problem_candidate", name: "نامزد مشکل تازه", event: "created", recipients: { roles: ["problem_manager"] }, channels: ["in_app"] },
];

export async function seedProblemDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "problem_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= PROBLEM_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensureRow(tx, sys, out, "problem_config", { config_key: "default" }, { name: "تنظیمات مشکل" }));
  await seedCategories(tx, sys, out, "problem");
  await ensureRow(tx, sys, out, "priority_matrix", { table_key: "problem" }, { name: "ماتریس اولویت مشکل", cells: ITIL_MATRIX, description: "اثر × فوریت (ITIL)" });
  for (const r of RULES) await ensureRow(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, { active: true, notify_actor: false, digest: false, mandatory: false, ...r });
  await updateIn(tx, sys, "problem_config", config.id, { seeded: PROBLEM_SEED_VERSION }, { trusted: true });
  return out;
}

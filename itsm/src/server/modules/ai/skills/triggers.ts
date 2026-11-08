// Skills started by a record event or a schedule (docs/spec/AI.md §11 «اجرای خودکار»). They run as the organisation's
// «دستیار هوش مصنوعی» service member (./principal.ts) — never as the system — through jobs, outside every write:
//   · `ai.skills` (event subscriber): a create, update, assignment, state change or comment of a table an enabled
//     event-triggered skill covers queues `ai.skill.run` (one per skill and record while queued). The runtime that
//     applied the write runs it (`via: "sync"` events are skipped) and the member's own writes never trigger it again;
//   · `ai.skills.schedule` (per organisation, every 15 minutes while a scheduled skill exists): the records of each due
//     skill (its filter, read with the member's access, newest first, at most 25 a round) are queued the same way;
//   · `ai.skill.run`: the condition is checked with the member's access, the skill runs as the member, and its output
//     becomes a proposal on the record. Only fields the skill's auto-apply list names are written at once (with the
//     member's access); an internal note only when the list names «work_note»; a reply to a requester never.
import type { Ctx, ServerConfig } from "../../../context";
import type { Cond } from "@shared/model/conditions";
import { AUTO_WORK_NOTE, type SkillEventKind, type SkillRunResult } from "@shared/ai/skills";
import { AI_TABLES } from "@shared/tables/ai";
import { tableDef } from "@shared/tables";
import { addJournal, list, onRecordEvent, orgSchema, systemCtx, update, updateIn } from "../../../engine";
import type { RecordEventKind } from "../../../engine";
import { enqueue, registerJobHandler } from "../../../jobs";
import { AppError } from "../../../http/errors";
import { AiUnavailableError } from "../engine";
import { allSkills, resolveSkill, type ResolvedSkill } from "./config";
import { appliesTo } from "./registry";
import { runCore } from "./runtime";
import type { SkillRuntimeInput } from "./types";
import { proposeFromRun } from "./proposals";
import { principalCtx, principalOf } from "./principal";

const AI_KEYS = new Set(AI_TABLES.map((t) => t.key));
const EVENT_KIND: Partial<Record<RecordEventKind, SkillEventKind>> = {
  "record.created": "created",
  "record.updated": "updated",
  "record.assigned": "assigned",
  "record.state_changed": "state_changed",
  "record.commented": "commented",
};
export const SCHEDULE_EVERY_MS = 15 * 60_000;
const PASSING: string[] = ["rate", "overloaded", "network", "timeout"];

// event-triggered skills per organisation, cached briefly (most events of most organisations trigger nothing)
const cache = new Map<string, { at: number; skills: ResolvedSkill[] }>();
const CACHE_MS = 30_000;

/** Forget the cached trigger configuration of an organisation (an `ai_skill` row changed). */
export function invalidateTriggers(orgId: string): void {
  cache.delete(orgId);
}

async function triggered(cfg: ServerConfig, orgId: string): Promise<ResolvedSkill[]> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.skills;
  const sys = await systemCtx(cfg, orgId);
  const skills = (await allSkills(sys)).filter((s) => s.cfg.enabled && s.def.target === "record" && (s.cfg.triggers.includes("event") || s.cfg.triggers.includes("schedule")));
  cache.set(orgId, { at: Date.now(), skills });
  return skills;
}

/** Queue one triggered run of a skill on a record (deduplicated while it waits). */
export async function queueSkillRun(cfg: ServerConfig, orgId: string, key: string, table: string, id: string, why: string): Promise<void> {
  await cfg.db.tx((tx) => enqueue(tx, { kind: "ai.skill.run", orgId, payload: { key, table, id, why }, dedupeKey: `skill:${key}:${id}`, maxAttempts: 4 }));
}

/** Make sure the organisation's schedule round is queued (when a skill with a schedule is saved). */
export async function ensureSkillSchedule(cfg: ServerConfig, orgId: string): Promise<void> {
  await cfg.db.tx((tx) => enqueue(tx, { kind: "ai.skills.schedule", orgId, payload: {}, dedupeKey: "ai.skills.schedule", delayMs: 5_000 }));
}

function matches(s: ResolvedSkill, kind: SkillEventKind, table: string): boolean {
  if (!s.cfg.triggers.includes("event") || !s.cfg.events.includes(kind)) return false;
  const t = tableDef(table);
  return !!t && !t.virtual && appliesTo(s.def, s.cfg.tables, t);
}

/** Apply what the auto-apply list allows, with the service member's access; the rest stays a proposal. */
async function autoApply(pctx: Ctx, rs: ResolvedSkill, table: string, id: string, result: SkillRunResult): Promise<SkillRunResult> {
  const allow = new Set(rs.cfg.auto_apply);
  if (!allow.size) return result;
  if (result.suggestions.length) {
    const now = result.suggestions.filter((s) => allow.has(s.field));
    if (now.length) {
      await update(pctx, table, id, Object.fromEntries(now.map((s) => [s.field, s.value])));
      return { ...result, suggestions: result.suggestions.filter((s) => !allow.has(s.field)) };
    }
  }
  // an internal note when the list says so; a reply to a requester is never sent without a person
  if (result.journal && result.journal.kind === "work_note" && allow.has(AUTO_WORK_NOTE)) {
    await addJournal(pctx, table, id, { kind: "work_note", body: `${result.journal.body}\n\n_${rs.cfg.name} — ساخته‌شده با هوش مصنوعی_` });
    return { ...result, journal: null };
  }
  return result;
}

/** One triggered run: as the service member, the condition first, the output a proposal (auto-apply aside). */
export async function runTriggered(cfg: ServerConfig, orgId: string, key: string, table: string, id: string): Promise<{ ran: boolean; proposal: string | null }> {
  const pctx = await principalCtx(cfg, orgId);
  if (!pctx) return { ran: false, proposal: null };
  const rs = await resolveSkill(pctx, key).catch(() => null);
  if (!rs || !rs.cfg.enabled || rs.def.target !== "record" || !(rs.cfg.triggers.includes("event") || rs.cfg.triggers.includes("schedule"))) return { ran: false, proposal: null };
  if (rs.cfg.condition && typeof rs.cfg.condition === "object") {
    const hit = await list(pctx, table, { ids: [id], filter: rs.cfg.condition as Cond, size: 1, total: false, fields: ["id"] }).catch(() => null);
    if (!hit?.rows.length) return { ran: false, proposal: null };
  }
  let result: SkillRunResult;
  let input: SkillRuntimeInput;
  try {
    ({ result, input } = await runCore(pctx, rs, { table, id }, { triggered: true, propose: false }));
  } catch (e) {
    if (e instanceof AiUnavailableError && PASSING.includes(e.kind)) throw e; // retried by the queue
    if (e instanceof AiUnavailableError || e instanceof AppError) return { ran: false, proposal: null };
    throw e;
  }
  result = await autoApply(pctx, rs, table, id, result);
  const proposal = await proposeFromRun(pctx, rs, input, result, { principal: "service" });
  return { ran: true, proposal: proposal?.id ?? null };
}

let installed = false;
export function installSkillTriggers(): void {
  if (installed) return;
  installed = true;
  onRecordEvent(
    "ai.skills",
    async (e, jctx) => {
      if (e.via === "sync" || AI_KEYS.has(e.table)) return;
      const kind = EVENT_KIND[e.kind];
      const def = tableDef(e.table);
      if (!kind || !def || def.virtual) return;
      // never in the way of the event's other subscribers: a trigger that cannot be read or queued is logged and missed
      try {
        const cfg = jctx.cfg as ServerConfig;
        const skills = await triggered(cfg, e.org_id);
        if (!skills.length) return;
        const want = skills.filter((s) => matches(s, kind, e.table));
        if (!want.length) return;
        const principal = await principalOf(cfg.db, e.org_id);
        // nothing to run as, or the member's own write (never a loop)
        if (!principal.user_id || !principal.active || e.actor === principal.user_id) return;
        for (const s of want) await queueSkillRun(cfg, e.org_id, s.cfg.key, e.table, e.id, kind);
      } catch (err) {
        jctx.log.warn("ai skill trigger not queued", String((err as Error)?.message ?? err));
      }
    },
    { kinds: Object.keys(EVENT_KIND) as RecordEventKind[] },
  );

  registerJobHandler("ai.skill.run", async (job, jctx) => {
    const p = job.payload as { key?: string; table?: string; id?: string };
    if (!job.org_id || !p.key || !p.table || !p.id) return;
    await runTriggered(jctx.cfg as ServerConfig, job.org_id, p.key, p.table, p.id);
  });

  registerJobHandler("ai.skills.schedule", async (job, jctx) => {
    if (!job.org_id) return;
    const cfg = jctx.cfg as ServerConfig;
    const skills = (await triggered(cfg, job.org_id)).filter((s) => s.cfg.triggers.includes("schedule") && s.cfg.schedule_minutes);
    if (!skills.length) return; // nothing scheduled: the round stops until a skill with a schedule is saved
    const pctx = await principalCtx(cfg, job.org_id);
    if (!pctx) return { again: SCHEDULE_EVERY_MS };
    const sys = await systemCtx(cfg, job.org_id);
    const schema = await orgSchema(sys);
    for (const s of skills) {
      const last = s.row?.last_scheduled_at ? Date.parse(String(s.row.last_scheduled_at)) : 0;
      if (Date.now() - last < (s.cfg.schedule_minutes ?? 60) * 60_000) continue;
      for (const table of s.cfg.tables.filter((t) => t !== "*")) {
        const tdef = schema.def(table);
        if (!tdef || !appliesTo(s.def, s.cfg.tables, tdef)) continue;
        const filter = s.cfg.schedule_filter && typeof s.cfg.schedule_filter === "object" ? (s.cfg.schedule_filter as Cond) : null;
        const rows = await list(pctx, table, { filter, size: 25, sort: "-updated_at", fields: ["id"], total: false }).catch(() => null);
        for (const r of rows?.rows ?? []) await queueSkillRun(cfg, job.org_id, s.cfg.key, table, String(r.id), "schedule");
      }
      if (s.row?.id) await sys.write((tx) => updateIn(tx, sys, "ai_skill", String(s.row!.id), { last_scheduled_at: new Date().toISOString() }, { trusted: true, keepVersion: true }), { internal: true });
    }
    invalidateTriggers(job.org_id);
    return { again: SCHEDULE_EVERY_MS };
  });
}

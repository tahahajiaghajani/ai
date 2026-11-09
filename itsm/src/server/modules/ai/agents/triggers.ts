// What starts an agent (docs/spec/AI.md §11.8): a record event of its tables (`ai.agents` subscriber), its schedule
// (`ai.agents.schedule`, per organisation every 15 minutes while a scheduled agent exists), a member by hand (the
// studio, the record) or from a conversation with the assistant (the `start_agent` tool). Events of the runtime that
// applied the write only (`via: "sync"` is skipped), never for writes of an AI service member (an agent's or the
// assistant's: no loops between agents), never while the organisation's «عامل‌ها» switch is off. The condition and the
// record's readability are checked when the run starts, with the principal's access.
import type { ServerConfig } from "../../../context";
import type { AgentConfig } from "@shared/ai/agents";
import { tableForbidden } from "@shared/ai/agents";
import type { SkillEventKind } from "@shared/ai/skills";
import type { Cond } from "@shared/model/conditions";
import { AI_AGENT, AI_AGENT_TABLES } from "@shared/tables/ai-agents";
import { AI_TABLES } from "@shared/tables/ai";
import { tableDef } from "@shared/tables";
import { list, onRecordEvent, systemCtx, updateIn } from "../../../engine";
import type { RecordEventKind } from "../../../engine";
import { enqueue, registerJobHandler } from "../../../jobs";
import { loadSettings } from "../settings";
import { isServiceEmail, principalCtx } from "../skills/principal";
import { agentRows, configOf } from "./config";
import { queueAgentRun } from "./runtime";

const AI_KEYS = new Set([...AI_TABLES, ...AI_AGENT_TABLES].map((t) => t.key));
const EVENT_KIND: Partial<Record<RecordEventKind, SkillEventKind>> = {
  "record.created": "created",
  "record.updated": "updated",
  "record.assigned": "assigned",
  "record.state_changed": "state_changed",
  "record.commented": "commented",
};
export const AGENT_SCHEDULE_EVERY_MS = 15 * 60_000;
const SCHEDULE_JOB = "ai.agents.schedule";
/** Records one scheduled round queues per agent and table. */
const SCHEDULE_ROWS = 10;

const cache = new Map<string, { at: number; agents: (AgentConfig & { last_scheduled_at: string | null })[] }>();
const CACHE_MS = 30_000;

/** Forget the cached agents of an organisation (an `ai_agent` row changed). */
export function invalidateAgentTriggers(orgId: string): void {
  cache.delete(orgId);
}

async function activeAgents(cfg: ServerConfig, orgId: string) {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.agents;
  const agents = (await agentRows(cfg, orgId))
    .map((r) => ({ ...configOf(r), last_scheduled_at: typeof r.last_scheduled_at === "string" ? r.last_scheduled_at : null }))
    .filter((a) => a.enabled && (a.triggers.includes("event") || a.triggers.includes("schedule")));
  cache.set(orgId, { at: Date.now(), agents });
  return agents;
}

const serviceMembers = new Map<string, boolean>();
/** Is this member an AI service member (the assistant's or an agent's principal)? */
async function isServiceMember(cfg: ServerConfig, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const hit = serviceMembers.get(userId);
  if (hit !== undefined) return hit;
  // a service address alone is not enough: an account someone signs in with is a person (see ../skills/principal)
  const r = await cfg.db.one<{ email: string; can_sign_in: boolean }>(
    `select u.email, (u.password_hash is not null or u.recovery_hash is not null
            or exists (select 1 from sm_sessions s where s.user_id = u.id)) as can_sign_in
     from sm_users u where u.id = $1`,
    [userId],
  );
  const yes = isServiceEmail(r?.email) && !r?.can_sign_in;
  if (serviceMembers.size > 5000) serviceMembers.clear();
  serviceMembers.set(userId, yes);
  return yes;
}

/** Is the organisation's «عامل‌ها» switch on (this runtime's AI settings)? */
export async function agentsOn(cfg: ServerConfig, orgId: string): Promise<boolean> {
  const s = await loadSettings(cfg.db, orgId);
  return s.enabled && s.features.agents;
}

/** Make sure the organisation's schedule round is queued (an agent with a schedule was saved or switched on). */
export async function ensureAgentSchedule(cfg: ServerConfig, orgId: string): Promise<void> {
  await cfg.db.tx((tx) => enqueue(tx, { kind: SCHEDULE_JOB, orgId, payload: {}, dedupeKey: SCHEDULE_JOB, delayMs: 5_000 }));
}

let installed = false;
export function installAgentTriggers(): void {
  if (installed) return;
  installed = true;
  onRecordEvent(
    "ai.agents",
    async (e, jctx) => {
      if (e.via === "sync" || AI_KEYS.has(e.table)) return;
      const kind = EVENT_KIND[e.kind];
      const def = tableDef(e.table);
      if (!kind || !def || def.virtual) return;
      // never in the way of the event's other subscribers: a run that cannot be queued is logged and missed
      try {
        const cfg = jctx.cfg as ServerConfig;
        const agents = (await activeAgents(cfg, e.org_id)).filter((a) => a.triggers.includes("event") && a.events.includes(kind) && a.tables.includes(e.table) && !tableForbidden(a, e.table));
        if (!agents.length) return;
        if (!(await agentsOn(cfg, e.org_id)) || (await isServiceMember(cfg, e.actor))) return;
        for (const a of agents) await queueAgentRun(cfg, e.org_id, a, { trigger: "event", why: kind, table: e.table, id: e.id });
      } catch (err) {
        jctx.log.warn("ai agent trigger not queued", String((err as Error)?.message ?? err));
      }
    },
    { kinds: Object.keys(EVENT_KIND) as RecordEventKind[] },
  );

  registerJobHandler(SCHEDULE_JOB, async (job, jctx) => {
    if (!job.org_id) return;
    const cfg = jctx.cfg as ServerConfig;
    const scheduled = (await activeAgents(cfg, job.org_id)).filter((a) => a.triggers.includes("schedule") && a.schedule_minutes);
    if (!scheduled.length) return; // nothing scheduled: the round stops until an agent with a schedule is saved
    if (!(await agentsOn(cfg, job.org_id))) return { again: AGENT_SCHEDULE_EVERY_MS };
    const sys = await systemCtx(cfg, job.org_id);
    for (const a of scheduled) {
      const last = a.last_scheduled_at ? Date.parse(a.last_scheduled_at) : 0;
      if (Date.now() - last < (a.schedule_minutes ?? 60) * 60_000) continue;
      const pctx = await principalCtx(cfg, job.org_id, a.key);
      if (pctx) {
        const filter = a.schedule_filter && typeof a.schedule_filter === "object" ? (a.schedule_filter as Cond) : null;
        const tables = a.tables.filter((t) => !tableForbidden(a, t) && tableDef(t));
        if (filter && tables.length) {
          // the records of its filter, read with its principal's access, newest first
          for (const table of tables) {
            const rows = await list(pctx, table, { filter, size: SCHEDULE_ROWS, sort: "-updated_at", fields: ["id"], total: false }).catch(() => null);
            for (const r of rows?.rows ?? []) await queueAgentRun(cfg, job.org_id, a, { trigger: "schedule", why: "schedule", table, id: String(r.id) });
          }
        } else {
          // an agent about no single record (a report, a sweep): one run per period
          await queueAgentRun(cfg, job.org_id, a, { trigger: "schedule", why: "schedule" });
        }
      }
      if (a.id) await sys.write((tx) => updateIn(tx, sys, AI_AGENT, a.id!, { last_scheduled_at: new Date().toISOString() }, { trusted: true, keepVersion: true }), { internal: true });
    }
    invalidateAgentTriggers(job.org_id);
    return { again: AGENT_SCHEDULE_EVERY_MS };
  });
}

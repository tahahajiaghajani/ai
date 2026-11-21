// Steps that wait for people (release 1.1.5; the shapes in src/shared/process/waiting.ts): a form step's round that
// opened with nobody to act — nobody was found, or more people than the step takes.
//   · what the case's journal says (`waitingLine`): the line, then the resolver's reasons («مدیر گروه» در «…» دارنده‌ای
//     ندارد»; «۲ نفر از دارندگان … حساب نمایشی‌اند…»), so the managers and the requester read why;
//   · «مسئولان گردش‌کار باخبر شدند» only when the managers' notice reaches someone (`managersTold`): the seeded rule
//     «مرحلهٔ بی‌انجام‌دهنده» is on and the case has managers, or administrators, who get bells — the real managers of
//     a demo pack's case hear nothing about it (docs/DEMO_FA.md), and the journal says so instead;
//   · the round's wait keeps the reason, the line, the reasons and (more than the step takes) the candidates
//     (`waitState`), which the case page shows its managers (`waitingSteps`) and a re-resolution replaces;
//   · `openRoundTasks`: the tasks of a round (one per person, with the step's due time), for an opening and for a
//     re-resolution (../reresolve) alike.
// Reads and writes through the caller's transaction (PGlite has one connection).
import { addBusiness } from "@shared/sla/calendar";
import { durationMs, formStepOf, processNodeLabel, type FormStep, type ProcessGraph } from "@shared/process/graph";
import { nobodyMessage } from "@shared/process/assignees";
import type { StepWaiting } from "@shared/process/waiting";
import type { Ctx } from "../../../context";
import { pgArray, type Queryable, type Tx } from "../../../db";
import { demoPeople, isDemoRow } from "../../../db/scope";
import { createIn, orgTz } from "../../../engine";
import { config as slaConfig } from "../../sla/common";
import { calendarsOf } from "../../sla/calendars";
import { isId, peopleNames, stepWaitKey, type CaseRow, type TaskRow } from "./store";

const iso = (ms: number) => new Date(ms).toISOString();
const ids = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter(isId).map((x) => x.toLowerCase()))];

/** Whether the managers' notice about a step without people reaches anyone. */
export type Told = "told" | "demo" | "nobody" | "off";

/**
 * The journal's line for a step that found nobody: «…؛ مسئولان گردش‌کار باخبر شدند.» only when they were (`told`), else
 * what is true — a demo case's real managers get no notice, a process with no one to tell, the notice switched off.
 * `skip`: the step was passed by «از این مرحله بگذرد» (an approve step's pass counts as approved: its «تأیید شد» path).
 */
export function nobodyLine(label: string | null | undefined, told: Told, skip?: { approve: boolean }): string {
  const step = label ? `برای «${label}»` : "برای این مرحله";
  if (skip) return skip.approve ? `${step} کسی پیدا نشد؛ از این مرحله گذشت و تأییدشده به شمار آمد.` : nobodyMessage(label, "skip");
  switch (told) {
    case "told":
      return nobodyMessage(label, "wait");
    case "demo":
      return `${step} کسی پیدا نشد؛ مرحله منتظر مسئولان گردش‌کار می‌ماند (پروندهٔ نمایشی است و اعلانی برای مسئولان واقعی فرستاده نمی‌شود).`;
    case "nobody":
      return `${step} کسی پیدا نشد؛ مرحله منتظر می‌ماند و مسئولی برای باخبر شدن پیدا نشد.`;
    default:
      return `${step} کسی پیدا نشد؛ مرحله منتظر مسئولان گردش‌کار می‌ماند (اعلان «مرحلهٔ بی‌انجام‌دهنده» روشن نیست و کسی باخبر نشد).`;
  }
}

/** The journal entry's body: the line, then each reason as a sentence of its own. */
export function waitingLine(message: string, notes: readonly string[]): string {
  const sentence = (t: string) => (/[.!؟]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
  return [sentence(message), ...notes.filter((n) => n && n.trim()).map(sentence)].join(" ");
}

/** The people the managers' notice of a case goes to: its managers (named, and members of its groups), else the administrators. */
async function noticeRecipients(q: Queryable, orgId: string, kase: Pick<CaseRow, "managers" | "manager_groups">): Promise<string[]> {
  if (ids(kase.managers).length || ids(kase.manager_groups).length) {
    const groups = ids(kase.manager_groups);
    const members = groups.length
      ? await q.query<{ user_id: string }>(
          `select distinct gm.user_id from sm_group_members gm join sm_groups g on g.id = gm.group_id and g.deleted_at is null and g.active is not false
           where g.org_id = $1 and gm.group_id = any($2::uuid[]) and gm.deleted_at is null
             and (gm.valid_from is null or gm.valid_from <= now()) and (gm.valid_to is null or gm.valid_to > now())`,
          [orgId, pgArray(groups)],
        )
      : [];
    return [...new Set([...ids(kase.managers), ...members.map((m) => String(m.user_id).toLowerCase())])];
  }
  const admins = await q.query<{ user_id: string }>(
    `select user_id from sm_org_members where org_id = $1 and deleted_at is null and is_active and role in ('owner', 'admin')
     union select user_id from sm_member_profiles where org_id = $1 and deleted_at is null and roles ? 'tenant_admin'`,
    [orgId],
  );
  return [...new Set(admins.map((a) => String(a.user_id).toLowerCase()))];
}

/**
 * Does the managers' notice of a step without people reach anyone (api/notices.ts sends it from the step's event)? The
 * seeded rule «مرحلهٔ بی‌انجام‌دهنده» is on, there is someone to tell, and — for a case of the demo pack, about which
 * only the pack's own people get bells (notify/deliver.ts) — one of them is the pack's.
 */
export async function managersTold(q: Queryable, orgId: string, kase: Pick<CaseRow, "id" | "managers" | "manager_groups">): Promise<Told> {
  const rule = await q.one(
    `select 1 as x from sm_notification_rules where org_id = $1 and table_key = 'process_case' and event = 'custom' and custom_event = 'process_unassigned'
       and active is not false and deleted_at is null limit 1`,
    [orgId],
  );
  if (!rule) return "off";
  const users = await noticeRecipients(q, orgId, kase);
  if (!users.length) return "nobody";
  if (await isDemoRow(q, orgId, kase.id)) return (await demoPeople(q, orgId, users)).size ? "told" : "demo";
  return "told";
}

/** What a waiting round's wait keeps (`sm_flow_waits.data`, beside `case`, `round` and the step's log key). */
export interface WaitState {
  reason: "nobody" | "too_many";
  message: string;
  notes: string[];
  /** too_many: the first 500 people found */
  candidates?: string[];
}

/** The wait's data of a round that waits for people. */
export const waitState = (w: WaitState): Record<string, unknown> => ({ reason: w.reason, message: w.message, notes: w.notes, ...(w.candidates ? { candidates: w.candidates } : {}) });

/** When a step opened at `from` is due: business time in the organisation's calendar unless the step says otherwise. */
export async function dueOf(tx: Tx, sys: Ctx, step: Pick<FormStep, "due" | "business">, from: number): Promise<string | null> {
  if (!step.due) return null;
  const ms = durationMs(step.due);
  if (!ms) return null;
  if (step.business === false) return iso(from + ms);
  try {
    const { byId, defaultId } = calendarsOf(await slaConfig(tx, sys), orgTz(sys));
    return iso(addBusiness(defaultId ? byId.get(defaultId) ?? null : null, from, ms) ?? from + ms);
  } catch {
    return iso(from + ms);
  }
}

/** The tasks of a round, one per person (a delegate keeps whom they stand in for), opened `now` with the step's due time. */
export async function openRoundTasks(
  tx: Tx,
  sys: Ctx,
  kase: CaseRow,
  node: { id: string; label: string; step: FormStep },
  round: number,
  people: { user: string; delegatedFrom: string | null }[],
  now: number,
): Promise<{ tasks: TaskRow[]; due: string | null }> {
  const due = people.length ? await dueOf(tx, sys, node.step, now) : null;
  const tasks: TaskRow[] = [];
  for (const p of people) {
    const row = await createIn(
      tx,
      sys,
      "process_task",
      {
        case_id: kase.id, case_number: kase.number, case_title: kase.title, process_id: kase.process_id, version_id: kase.version_id,
        step_key: node.id, step_label: node.label, action: node.step.action, round, assigned_to: p.user, delegated_from: p.delegatedFrom,
        status: "open", opened_at: iso(now), due_at: due,
      },
      { trusted: true },
    );
    tasks.push(row as unknown as TaskRow);
  }
  return { tasks, due };
}

/**
 * The steps of a case whose open round has no open task (the case page's `waiting`): why, the journal's line and — for
 * the case's managers only — the resolver's reasons and the candidates to choose from. From the round's wait where
 * cases advance; a Windows app that holds the case but not its run reads the journal entry the opening wrote.
 */
export async function waitingSteps(q: Queryable, kase: CaseRow, graph: ProcessGraph, tasks: readonly TaskRow[], manage: boolean): Promise<Record<string, StepWaiting>> {
  const out: Record<string, StepWaiting> = {};
  if (kase.state !== "active" && kase.state !== "waiting") return out;
  for (const [nodeId, raw] of Object.entries(kase.open_rounds ?? {})) {
    const round = Number(raw);
    const node = graph.nodes.find((n) => n.id === nodeId && n.type === "form_step");
    if (!node || !round) continue;
    if (tasks.some((t) => t.step_key === nodeId && Number(t.round) === round && t.status === "open")) continue;
    const label = processNodeLabel(node);
    const wait = await q.one<{ data: Record<string, unknown> | null }>(`select data from sm_flow_waits where org_id = $1 and key = $2 and result is null limit 1`, [kase.org_id, stepWaitKey(kase.id, nodeId, round)]);
    let data: Record<string, unknown> = wait?.data ?? {};
    if (!wait) {
      const entry = await q.one<{ data: Record<string, unknown> | null }>(
        `select data from sm_journal where org_id = $1 and table_key = 'process_case' and record_id = $2 and deleted_at is null
           and data ->> 'step' = $3 and data ->> 'round' = $4 and data ? 'waiting'
         order by created_at desc, id desc limit 1`,
        [kase.org_id, kase.id, nodeId, String(round)],
      );
      data = entry?.data ? { reason: entry.data.waiting, message: entry.data.message, notes: entry.data.notes } : {};
    }
    const candidates = Array.isArray(data.candidates) ? ids(data.candidates) : [];
    const reason = data.reason === "too_many" || (data.reason !== "nobody" && candidates.length) ? "too_many" : "nobody";
    const notes = Array.isArray(data.notes) ? data.notes.map(String).filter(Boolean) : [];
    const message = typeof data.message === "string" && data.message ? data.message : `برای «${label}» کسی پیدا نشد`;
    const w: StepWaiting = { reason, message, notes: manage ? notes : [] };
    if (manage && reason === "too_many") {
      const names = await peopleNames(q, candidates);
      const demo = await demoPeople(q, kase.org_id, candidates);
      w.candidates = candidates.slice(0, 500).map((id) => ({ id, name: names.get(id) ?? "—", demo: demo.has(id) }));
    }
    out[nodeId] = w;
  }
  return out;
}

/** The form step of a node of `graph` (null: none). */
export function formNode(graph: ProcessGraph, nodeId: string): { id: string; label: string; step: FormStep } | null {
  const n = graph.nodes.find((x) => x.id === nodeId && x.type === "form_step");
  return n ? { id: n.id, label: processNodeLabel(n), step: formStepOf(n.config) } : null;
}

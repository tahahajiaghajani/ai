// The steps only workflows have (design F §3.5, §3.6.3, F4a), for runs of kind `process` (`processHandlers`):
//   · «مرحلهٔ فرم» (`form_step`): on the authority, in the step's transaction under the case's lock — the round (one
//     more than the step's last; «ثبت درخواست» passes through on its first arrival, which its start submission
//     already was), the people (the step a «بازگشت» sends the case back to goes to its earlier actors — the people
//     they acted for, through today's delegations — unless it says «بر پایهٔ قاعده»; every other opening, the
//     returning step's own next round included, goes by F3's `resolveAssignees`), one task per person, the case's
//     progress, current steps, open rounds, participants and state, the event `record.process_step_opened`, then a
//     wait on `pstep:<case>:<node>:<round>`.
//     Nobody: the step is skipped (`ifNobody: skip`; an approve step's pass counts as approved, and the journal says
//     so) or the case waits («در انتظار») for its managers — as it does when more people are found than a step takes.
//     The journal says why (the resolver's reasons) and whether the managers were told (./waiting.ts), and the round's
//     wait keeps both for the case page and a later re-resolution (../reresolve). `applySubmission` settles the round and resumes the wait with the
//     decision's port; `cancel` (the wait withdrawn by a join's cancel_rest, the run ended or canceled) closes the
//     round's open tasks — «دیگر لازم نیست», or «لغو» when the run failed or was canceled.
//   · «انتخاب» (`choice`): the first case whose comparisons on the run's stored data hold, else «هیچ‌کدام».
//   · «تعیین مقدار» (`set_values`): case values from templates, coerced by the version's snapshot, merged key by key.
//     A text field people read (`takesDisplayText`) takes each pill as its display text — the unit's name, the
//     option's label, the Jalali date, the amount — as the title does (./display.ts); any other field takes the stored
//     value (a unit field from `{{case.u_branch}}` the unit's id).
//   · «اعلان» (`notify`): recipients by assignee rules (positions, groups, step actors…), sent through the
//     notification service in the step's transaction; its subject and body show each pill as its display text,
//     inserted as values (`inlineValue`: no placeholder of the template, escaped in the Markdown body).
import type { FieldDef } from "@shared/model/types";
import { compareData } from "@shared/flows";
import { snapshotFields } from "@shared/forms/snapshot";
import { choiceCases, formStepOf, OUTCOME_PORT, outEdges, processNodeLabel, quorumOf, type CaseProgress, type FormStep, type ProcessGraph } from "@shared/process/graph";
import { cleanRule, ifNobodyOf, tooManyMessage, poolLimit, type AssigneeRule } from "@shared/process/assignees";
import type { Tx } from "../../../db";
import { pgArray } from "../../../db";
import { coerceValue, emitEvent, systemCtx, updateIn } from "../../../engine";
import type { FlowStepHandler, StepContext, StepOutcome, WaitCancel } from "../../flows/registry";
import { Resolution, resolveAssignees, type ResolveInput } from "../../positions";
import { notifyPeople } from "../../notify/deliver";
import { inlineValue } from "@shared/notify";
import { takesDisplayText } from "@shared/process/display";
import { caseDisplay, casePillKeys, runCaseValues } from "./display";
import { caseJournal } from "./journal";
import { managersTold, nobodyLine, openRoundTasks, waitingLine, waitState, type WaitState } from "./waiting";
import { OPEN_STATES, participantsOf, refreshCase, replayProgress, runLog } from "./progress";
import { caseTasks, isId, loadVersionInfo, lockCase, peopleNames, stepWaitKey, type CaseRow, type TaskRow, type VersionInfo } from "./store";
import { processHandlers } from "./runs";

/** The event a step's opening emits on its case (`data`: node, label, round, action, people, status, due_at, message, returned). */
export const STEP_OPENED = "record.process_step_opened";
/** The kind of a form step's wait. */
export const STEP_WAIT = "process_step";

const iso = (ms: number) => new Date(ms).toISOString();
const NO_LISTS = { choices: () => [] };

/** The case a process run works on (its trigger record). */
function caseOf(s: StepContext): string | null {
  return s.triggerRecord?.table === "process_case" && isId(s.triggerRecord.id) ? s.triggerRecord.id : null;
}

/** Who did each earlier step (done tasks' actors), and whoever acted last. */
export function actorsOf(tasks: readonly TaskRow[]): { byStep: Record<string, string[]>; last: string | null } {
  const byStep: Record<string, string[]> = {};
  let last: TaskRow | null = null;
  for (const t of tasks) {
    if (t.status !== "done" || !t.acted_by) continue;
    const list = (byStep[t.step_key] ??= []);
    if (!list.includes(t.acted_by)) list.push(t.acted_by);
    if (!last || String(t.closed_at ?? "") >= String(last.closed_at ?? "")) last = t;
  }
  return { byStep, last: last?.acted_by ?? null };
}

/**
 * Is an opening of `node` the target of a «بازگشت»? Some step's round settled «returned» with a «بازگشت» edge to
 * `node`, and the case's progress still holds it: an opening of the target (or of a step before it) drops it, so a
 * return is taken up once, and a step met again on the way forward after it is not a target.
 */
export function returnedTo(graph: ProcessGraph, progress: CaseProgress, node: string): boolean {
  return Object.entries(progress).some(([id, p]) => p?.status === "done" && p.outcome === "returned" && outEdges(graph, id, "returned").some((e) => e.target === node));
}

/** Storage types of the snapshot's fields (person and unit rules read them). */
function fieldTypes(version: VersionInfo): Record<string, string> {
  const out: Record<string, string> = {};
  if (version.forms) for (const [name, f] of snapshotFields(version.forms)) out[name] = f.type;
  return out;
}

/**
 * The resolver's input for a step of a case (also the «اعلان» recipients'): the case's own work, so a case of the
 * organisation's own never goes to the demo pack's people (`ResolveInput.caseId`).
 */
export function resolveInput(kase: CaseRow, version: VersionInfo, tasks: readonly TaskRow[], step: Pick<FormStep, "assignees" | "exclude" | "fallback" | "ifNobody" | "action" | "quorum">, label: string): ResolveInput {
  const actors = actorsOf(tasks);
  return {
    caseId: kase.id,
    step: { assignees: step.assignees, exclude: step.exclude, fallback: step.fallback, ifNobody: step.ifNobody },
    action: step.action,
    quorum: quorumOf(step),
    label,
    requestedBy: kase.requested_by,
    requestedFor: kase.requested_for,
    // the requester's unit as the case recorded it at its start (the record's access anchor: the profile's unit of the
    // person it is for, set when the case was made) — a requester who moves on keeps the case where it began
    requesterUnit: kase.unit_id ?? null,
    values: kase.data ?? {},
    fieldTypes: fieldTypes(version),
    stepActors: actors.byStep,
    previousActor: actors.last,
    managers: kase.managers?.length ? kase.managers : version.managers,
    managerGroups: kase.manager_groups?.length ? kase.manager_groups : version.manager_groups,
  };
}

/** Active members among `ids`. */
async function activeMembers(tx: Tx, orgId: string, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await tx.query<{ user_id: string }>(
    `select m.user_id from sm_org_members m join sm_users u on u.id = m.user_id
     where m.org_id = $1 and m.user_id = any($2::uuid[]) and m.deleted_at is null and m.is_active and not coalesce(u.disabled, false)`,
    [orgId, pgArray([...new Set(ids)])],
  );
  return new Set(rows.map((r) => String(r.user_id)));
}

/** The port a skipped step leaves by: its «yes» decision. */
const passPort = (step: FormStep) => (step.action === "approve" ? OUTCOME_PORT.approved : OUTCOME_PORT.submitted);

/** «مرحلهٔ فرم» opening (see the header). */
async function openStep(s: StepContext): Promise<StepOutcome> {
  const tx = s.tx!;
  const sys = s.ctx;
  const caseId = caseOf(s);
  if (!caseId) return { error: "«مرحلهٔ فرم» فقط در گردش‌کارها به کار می‌رود" };
  const kase = await lockCase(tx, s.orgId, caseId);
  if (!kase) return { error: "پرونده پیدا نشد" };
  // a case closed while its run was still moving (the requester canceled it): park here; the run is canceled next
  if (!OPEN_STATES.has(kase.state)) return { wait: { kind: "process_closed", key: null } };
  const version = await loadVersionInfo(tx, s.orgId, kase.version_id);
  if (!version) return { error: "نسخهٔ گردش‌کار پیدا نشد" };
  const nodeId = s.node.id;
  const step = formStepOf(s.node.config);
  // the version's own node: the executor's label is the flows catalogue's, which names a form step by its type key
  const label = processNodeLabel(version.graph.nodes.find((n) => n.id === nodeId) ?? { type: "form_step", config: s.node.config });
  const tasks = await caseTasks(tx, s.orgId, caseId);
  const own = tasks.filter((t) => t.step_key === nodeId);
  const trigger = (s.data.trigger ?? {}) as Record<string, unknown>;
  const steps = (s.data.steps ?? {}) as Record<string, unknown>;

  // «ثبت درخواست» on the run's first arrival: round 1 is the start submission itself
  if (step.start && !steps[nodeId] && trigger.event === "start") {
    const first = own.find((t) => Number(t.round) === 1 && t.status === "done");
    const names = await peopleNames(tx, [first?.acted_by ?? kase.requested_by]);
    return { port: OUTCOME_PORT.submitted, output: { round: 1, outcome: "submitted", actors: [...names.values()], start: true } };
  }

  const last = Math.max(0, ...own.map((t) => Number(t.round) || 0), Number(kase.progress?.[nodeId]?.round) || 0);
  const round = last + 1;
  const now = Date.now();

  // the people: the earlier actors of the step a «بازگشت» sends the case back to, else the rules
  let people: { user: string; delegatedFrom: string | null }[] = [];
  let status: "ok" | "managers" | "nobody" | "too_many" = "ok";
  let message: string | null = null;
  let notes: string[] = [];
  let candidates: string[] | undefined;
  const back = last > 0 && returnedTo(version.graph, replayProgress(version.graph, kase.progress, await runLog(tx, kase.run_ref)), nodeId);
  if (back && (step.returnTo ?? "actor") === "actor") {
    // the people the last round's decisions were made for (a delegate acted for someone), each through the
    // delegations of today: the delegate now in force, or the person themself
    const earlier = [...new Set(own.filter((t) => Number(t.round) === last && t.status === "done" && (t.acted_for || t.acted_by)).map((t) => String(t.acted_for ?? t.acted_by)))];
    const live = await activeMembers(tx, s.orgId, earlier);
    const found = earlier.filter((u) => live.has(u)).map((user) => ({ user, via: { rule: 0, kind: "users" as const } }));
    if (found.length) {
      const settled = await new Resolution(tx, sys, { step: { assignees: [] }, action: step.action, requestedBy: kase.requested_by, caseId: kase.id }).settle(found, new Set());
      people = settled.map((p) => ({ user: p.user, delegatedFrom: p.delegatedFrom }));
    }
  }
  if (!people.length && step.start) {
    const live = await activeMembers(tx, s.orgId, kase.requested_by ? [kase.requested_by] : []);
    if (kase.requested_by && live.has(kase.requested_by)) people = [{ user: kase.requested_by, delegatedFrom: null }];
    else {
      status = "nobody";
      notes = ["درخواست‌دهنده عضو فعال سازمان نیست"];
    }
  } else if (!people.length) {
    const r = await resolveAssignees(tx, sys, resolveInput(kase, version, tasks, step, label));
    status = r.status;
    message = r.message;
    notes = r.notes;
    candidates = r.candidates;
    people = r.people.map((p) => ({ user: p.user, delegatedFrom: p.delegatedFrom }));
  }

  if (!people.length && status === "nobody" && ifNobodyOf(step) === "skip") {
    // an approve step passed by «از این مرحله بگذرد» leaves by «تأیید شد»: the journal says it counted as approved
    const line = nobodyLine(label, "told", { approve: step.action === "approve" });
    await caseJournal(tx, sys, kase, waitingLine(line, notes), { data: { step: nodeId, round, skipped: true, notes } });
    return { port: passPort(step), output: { round, skipped: true, outcome: null, message: line } };
  }

  const { tasks: opened, due } = await openRoundTasks(tx, sys, kase, { id: nodeId, label, step }, round, people, now);
  // nobody, or more than the step takes: the journal says why and whether the managers were told; the wait keeps it
  let waiting: WaitState | null = null;
  if (!people.length) {
    const reason = status === "too_many" ? "too_many" : "nobody";
    const line = reason === "too_many" ? message ?? tooManyMessage(poolLimit(step.action, quorumOf(step))) : nobodyLine(label, await managersTold(tx, s.orgId, kase));
    waiting = { reason, message: line, notes, ...(candidates ? { candidates } : {}) };
    message = line;
    await caseJournal(tx, sys, kase, waitingLine(line, notes), { data: { step: nodeId, round, waiting: reason, message: line, notes } });
  } else if (status === "managers") {
    await caseJournal(tx, sys, kase, waitingLine(`برای «${label}» کسی پیدا نشد؛ مرحله به مسئولان گردش‌کار رسید.`, notes), { data: { step: nodeId, round, managers: true, notes } });
  }
  await refreshCase(tx, sys, kase, version.graph, {
    tasks: [...tasks, ...opened],
    extra: { [nodeId]: { status: "active", round, at: iso(now), waiting: people.length } },
  });
  await emitEvent(tx, sys, {
    kind: STEP_OPENED,
    table: "process_case",
    id: caseId,
    number: kase.number,
    data: { node: nodeId, label, round, action: step.action, people: people.map((p) => p.user), status: people.length ? status : waiting!.reason, due_at: due, message, notes, returned: back },
  });
  return {
    wait: { kind: STEP_WAIT, key: stepWaitKey(caseId, nodeId, round), data: { case: caseId, round, step: s.stepKey, ...(waiting ? waitState(waiting) : {}) } },
    output: { round, waiting: people.length, status: people.length ? status : waiting!.reason, ...(message ? { message } : {}) },
  };
}

/** The key of a form step's wait: its case, node and round. */
export function parseWaitKey(key: string | null | undefined): { caseId: string; node: string; round: number } | null {
  const m = /^pstep:([0-9a-f-]{36}):(.+):(\d+)$/i.exec(String(key ?? ""));
  return m ? { caseId: m[1].toLowerCase(), node: m[2], round: Number(m[3]) } : null;
}

/**
 * Withdraw a form step's round (after the transaction that withdrew its wait): its open tasks close — «دیگر لازم
 * نیست» while the run goes on (a join's cancel_rest), «لغو» when the run failed or was canceled — its log row is
 * marked canceled, and the case is recomputed. Idempotent: a second call finds nothing open.
 */
async function cancelStep(a: WaitCancel): Promise<void> {
  const k = parseWaitKey(a.wait.key);
  if (!k) return;
  const run = await a.cfg.db.one<{ state: string }>(`select state from sm_flow_runs where id = $1`, [a.runId]);
  const closeAs = run && (run.state === "failed" || run.state === "canceled") ? "canceled" : "not_needed";
  const sys = await systemCtx(a.cfg, a.orgId);
  const logKey = typeof a.wait.data?.step === "string" ? a.wait.data.step : null;
  await sys.write(async (tx) => {
    const kase = await lockCase(tx, a.orgId, k.caseId);
    if (!kase) return;
    const tasks = await caseTasks(tx, a.orgId, kase.id);
    const open = tasks.filter((t) => t.step_key === k.node && Number(t.round) === k.round && t.status === "open");
    const now = iso(Date.now());
    for (const t of open) {
      await updateIn(tx, sys, "process_task", t.id, { status: closeAs, closed_at: now }, { trusted: true });
      t.status = closeAs;
    }
    const marked = logKey
      ? await tx.query(`update sm_flow_run_steps set status = 'canceled', ended_at = now() where run_id = $1 and key = $2 and status = 'waiting' returning key`, [a.runId, logKey])
      : [];
    if (!open.length && !marked.length) return;
    const version = await loadVersionInfo(tx, a.orgId, kase.version_id);
    if (version && kase.run_ref === a.runId && OPEN_STATES.has(kase.state)) await refreshCase(tx, sys, kase, version.graph, { tasks });
    else if (open.length) await updateIn(tx, sys, "process_case", kase.id, { participants: participantsOf(tasks) }, { trusted: true });
  });
}

const formStep: FlowStepHandler = {
  transactional: true,
  run: openStep,
  async resume(s, w) {
    const r = w.result;
    // only `applySubmission` (and F4b's timers) hand a decision over; anything else waits on
    if (!r || typeof r.port !== "string") return { wait: { kind: w.kind, key: w.key, data: w.data } };
    return { port: r.port, output: { round: r.round ?? w.data.round ?? 1, outcome: r.outcome ?? null, actors: Array.isArray(r.actors) ? r.actors : [], ...(r.auto ? { auto: true } : {}) } };
  },
  cancel: cancelStep,
};

/** «انتخاب»: the first case whose comparisons hold (all of them, or any with `match: any`), else «هیچ‌کدام». */
const choice: FlowStepHandler = {
  async run(s) {
    for (const c of choiceCases(s.node.config)) {
      const results = c.rules.map((r) => compareData(s.render(r.left), String(r.op ?? ""), s.render(r.right)));
      const ok = results.length > 0 && (c.match === "any" ? results.some(Boolean) : results.every(Boolean));
      if (ok) return { port: c.key, output: { case: c.key } };
    }
    return { port: "else", output: { case: null } };
  },
};

/** «تعیین مقدار»: case values from templates, written through the system's apply path (key by key, under the lock). */
const setValues: FlowStepHandler = {
  transactional: true,
  async run(s) {
    const tx = s.tx!;
    const caseId = caseOf(s);
    if (!caseId) return { error: "«تعیین مقدار» فقط در گردش‌کارها به کار می‌رود" };
    const kase = await lockCase(tx, s.orgId, caseId);
    if (!kase) return { error: "پرونده پیدا نشد" };
    const version = await loadVersionInfo(tx, s.orgId, kase.version_id);
    if (!version) return { error: "نسخهٔ گردش‌کار پیدا نشد" };
    const fields = version.forms ? snapshotFields(version.forms) : new Map<string, FieldDef>();
    const raw = s.node.config.values && typeof s.node.config.values === "object" ? (s.node.config.values as Record<string, unknown>) : {};
    const data = { ...(kase.data ?? {}) };
    const set: string[] = [];
    // a text people read takes the display text of its pills (names, labels, Jalali dates); the names its pills need
    const texts = Object.entries(raw).filter(([key]) => { const f = fields.get(key); return !!f && takesDisplayText(f); }).map(([, tpl]) => tpl);
    const shown = texts.length ? await caseDisplay(tx, s.orgId, { fields, values: runCaseValues(s.data), tz: s.tz, keys: casePillKeys(...texts) }) : null;
    for (const [key, tpl] of Object.entries(raw)) {
      const f = fields.get(key);
      if (!f) {
        s.log(`فیلد «${key}» در فرم‌های این نسخه نیست`);
        continue;
      }
      try {
        const input = shown && takesDisplayText(f) ? s.display(tpl, shown.pill) : s.render(tpl);
        const v = coerceValue(f, input, { schema: NO_LISTS, tz: s.tz }, data[key]);
        if (typeof v === "symbol") continue;
        data[key] = v;
        set.push(key);
      } catch (e) {
        return { error: `مقدار «${f.label}» پذیرفته نشد: ${String((e as Error)?.message ?? e)}` };
      }
    }
    if (set.length) await updateIn(tx, s.ctx, "process_case", caseId, { data }, { trusted: true });
    return { output: { set } };
  },
};

/** «اعلان» of a workflow: recipients by assignee rules, through the notification service. */
const notify: FlowStepHandler = {
  transactional: true,
  async run(s) {
    const tx = s.tx!;
    const caseId = caseOf(s);
    if (!caseId) return { error: "«اعلان» گردش‌کار دربارهٔ پرونده فرستاده می‌شود" };
    const kase = await tx.one<CaseRow>(`select * from sm_process_cases where org_id = $1 and id = $2 and deleted_at is null`, [s.orgId, caseId]);
    const version = kase ? await loadVersionInfo(tx, s.orgId, kase.version_id) : null;
    if (!kase || !version) return { error: "پرونده پیدا نشد" };
    const label = processNodeLabel(version.graph.nodes.find((n) => n.id === s.node.id) ?? { type: "notify" });
    const rules = (Array.isArray(s.node.config.to) ? s.node.config.to : []).map(cleanRule).filter((x): x is AssigneeRule => !!x);
    const tasks = await caseTasks(tx, s.orgId, caseId);
    const r = rules.length
      ? await resolveAssignees(tx, s.ctx, resolveInput(kase, version, tasks, { assignees: rules, exclude: [], ifNobody: "skip", action: "fill" }, label))
      : null;
    const users = [...new Set([...(r?.people.map((p) => p.user) ?? []), ...(r?.status === "too_many" ? r.candidates ?? [] : [])])];
    // the subject and body as people read them: each case pill by its display text, inserted as a value
    const fields = version.forms ? snapshotFields(version.forms) : new Map<string, FieldDef>();
    const shown = await caseDisplay(tx, s.orgId, { fields, values: runCaseValues(s.data), tz: s.tz, keys: casePillKeys(s.node.config.subject, s.node.config.body) });
    const subject = s.display(s.node.config.subject, shown.pill, (t) => inlineValue(t, "plain")).trim().slice(0, 300) || s.run.flowName;
    const body = s.display(s.node.config.body, shown.pill, (t) => inlineValue(t, "markdown")).slice(0, 20_000);
    const count = users.length
      ? await notifyPeople(tx, s.orgId, {
          table: "process_case", id: caseId, users, event: "custom", label: s.run.flowName, subject, body,
          channels: ["in_app", "email"], actor: null, source: `گردش‌کار «${s.run.flowName}»`,
        })
      : 0;
    return { output: { recipients: users, subject, sent: count > 0, count } };
  },
};

/** Fill the process run kind's handlers (once per process). */
export function registerProcessSteps(): void {
  processHandlers.form_step = formStep;
  processHandlers.choice = choice;
  processHandlers.set_values = setValues;
  processHandlers.notify = notify;
}

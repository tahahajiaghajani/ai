// Behaviour of the change tables on every write path (API, imports, flows, jobs; a Windows app for its own writes),
// inside the write's transaction:
//
//   change_request (before, own hook — runs before the platform's "*" hooks: the priority matrix, the approvals'
//   planning and the SLA timers see what it sets)
//     · a template fills the empty fields on create (a standard change takes its pre-assessed risk and model)
//     · the model: its type, and the lifecycle it uses snapshotted in `model_states`
//     · field locks of the current state (CHG-007) for a person's edits; on-hold stamps
//     · milestones: submitted (leaving the draft), the authorization cycle (DB clock), authorized, actual start/end
//     · impacted services from the CMDB provider, the risk (questionnaire + profile), the lead time and «دیرهنگام»,
//       whether the CAB and a post-implementation review are needed, and the CAB it goes to
//   change_request (after)
//     · the template's tasks and usage; conflicts of the change (same transaction) and of the changes it meets (job)
//     · tasks become ready when implementation starts; the review (PIR) when one is needed
//     · re-authorization when a person edits what was authorized (CHG-005); the template's outcome counters and the
//       automatic suspension of a standard change that failed twice (CHG-012)
//   guard change_lifecycle: the model's lifecycle, what each state requires, unreviewed conflicts before approval,
//     blackouts/freezes and lockdowns before scheduling or implementing, open tasks and child changes before review,
//     the PIR before closing, holds
//   change_task: inherits from its change, dependencies of the same change; guard change_task_ready; dependents become
//     ready when a task is done
//   change_template, change_window, cab, cab_meeting, change_conflict, change_pir, change_lockdown, change_config,
//   change_risk_question, change_outage: validation, stamps and their reactions; the definitions (models, windows,
//   CABs, questions, lockdowns, scores) only by holders of the change manager's authority
//
// The approvals' reactions (the authorization cycle) are a "*" hook in authorize.ts installed after the SLA service.
import {
  cabRequired, computeRisk, explainRisk, leadDaysFor, lifecycleOf, lifecycleProblem, lockedIn, missingFor, optionsOf, pirReasons, REAUTH_FIELDS, scopeOf, stateLabel,
  STATE_ORDER, applicableQuestions, windowKindLabel, type ModelLike,
} from "@shared/change/logic";
import { CHANGE_TYPES, FAILED_CODES, HOLD_REASONS, TASK_DONE } from "@shared/tables/change";
import type { Ctx } from "../../context";
import { onBeforeCommit, type Tx } from "../../db";
import { access } from "../../access/provider";
import { addJournalIn, defFor, emitEvent, isSystemCtx, registerHooks, savepoint, transitionIn, updateIn, validationError, type WriteArgs } from "../../engine";
import { lockedRow } from "../incident/common";
import { forbidden } from "../../http/errors";
import { enqueue } from "../../jobs";
import { notifyPeople } from "../notify";
import { cabFits, cabFor, cabPeople, changeManagers } from "./authorize";
import { refreshAgenda } from "./cab";
import {
  actorOf, changeConfig, countRows, dbNow, eqAll, faList, fieldLabel, isUuid, liveRow, liveRows, managesChanges, modelLike, msOf, riskQuestions, sysOf, type Row,
} from "./common";
import { impactedServicesOf } from "./impact";
import { IN_FLIGHT, lockdownDue, lockLockdowns, releaseLockdown, startLockdown } from "./lockdown";
import { ensurePir } from "./pir";
import { lockdownOnMajor, resumeWaitingOn } from "./linked";
import { holdsOn, leadDays, planConflicts, riskFor, scheduleBlocks, storeConflicts, syncConflictState, teamScoreOf, type ConflictPlan } from "./schedule";
import { activateTasks, blockingDeps, createTemplateTasks, openMandatoryTasks, taskMayRun, templateTasksProblem } from "./tasks";

type W = WriteArgs;
type WA = WriteArgs & { row: Row };

const entering = (w: W, state: string) => w.next.state === state && (w.op === "create" || w.prev?.state !== state);
/** A person's own edit (not the system, not trusted server code). */
const person = (w: W) => !isSystemCtx(w.ctx) && !w.trusted;
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
const nowIso = () => new Date().toISOString();
const typeLabel = (v: unknown) => CHANGE_TYPES.find((o) => o.value === v)?.label ?? String(v ?? "");

/** Fields the risk depends on (besides the state). */
const RISK_INPUTS = [
  "type", "model_id", "impact", "category", "subcategory", "affected_cis", "affected_services", "impacted_services", "ci_id", "service_id", "implementation_plan", "backout_plan", "test_plan",
  "backout_tested", "outage_expected", "outage_minutes", "in_blackout", "outside_window", "is_late", "conflict_count", "assignment_group_id", "risk_answers", "risk_source", "risk",
  "risk_override_reason",
];
/** Fields whose change can make or remove conflicts. */
export const CONFLICT_TRIGGERS = [
  "planned_start", "planned_end", "state", "affected_cis", "affected_services", "impacted_services", "ci_id", "service_id", "assigned_to", "maintenance_window_id", "exclude_conflicts", "type",
];
/** The change's own people: they never approve or authorize it (requester side, implementer, coordinator). */
const OWN_PEOPLE = ["requested_for", "caller_id", "opened_by", "assigned_to", "change_owner_id"];
/** States before implementation, in which the schedule and the notice still matter. */
const PLANNING = ["new", "assess", "authorize", "scheduled"];

/** Conflict plans of the writes of a transaction, from beforeWrite to afterWrite (by change id). */
const conflictPlans = new WeakMap<Tx, Map<string, ConflictPlan>>();

const forwardMove = (from: string, to: string) => to !== "canceled" && STATE_ORDER.indexOf(to as never) > STATE_ORDER.indexOf(from as never);

// ---------------------------------------------------------------------------------------------------------------
// change_request

/** Copy a template into the empty fields of a new change. */
function applyTemplate(n: Row, t: Row): void {
  const fill = (to: string, from = to) => {
    if (blank(n[to]) && !blank(t[from])) n[to] = t[from];
  };
  for (const f of ["short_description", "description", "justification", "implementation_plan", "test_plan", "backout_plan", "communication_plan", "category", "assignment_group_id", "service_id", "model_id"]) fill(f);
  if (!blank(t.impact)) n.impact = t.impact;
  if (t.kind === "standard") {
    n.type = "standard";
    n.risk = t.risk ?? "low";
    n.risk_source = "template";
  }
}

function cleanAnswers(raw: unknown): Row | string {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return "پاسخ‌های ارزیابی ریسک معتبر نیست";
  const out: Row = {};
  const entries = Object.entries(raw as Row);
  if (entries.length > 200) return "پاسخ‌های ارزیابی ریسک بیش از اندازه است";
  for (const [k, v] of entries) {
    if (!isUuid(k)) return "پاسخ‌های ارزیابی ریسک معتبر نیست";
    if (v === null || v === undefined || v === "") continue;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return "پاسخ‌های ارزیابی ریسک معتبر نیست";
    out[k.toLowerCase()] = String(v).slice(0, 200);
  }
  return out;
}

async function changeBefore(w: W): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const p = w.prev;
  const creating = w.op === "create";
  const sys = sysOf(w.ctx);
  const fields: Record<string, string> = {};
  const changed = (f: string) => (creating ? !blank(n[f]) : w.changed.has(f));
  const stateMoved = creating || w.changed.has("state");

  // the risk's source is the module's to say: «template» comes only from a standard template applied on create (a
  // person's «template» counts as not given)
  const sourceIgnored = person(w) && !!w.input?.has("risk_source") && n.risk_source === "template";
  if (sourceIgnored) n.risk_source = p?.risk_source ?? null;

  // a template fills the empty fields of a new change — read locked until commit: a failure suspending it at this
  // moment finishes first (a suspended standard template is refused), and its usage is counted from the stored row
  if (creating && n.template_id) {
    const t = await lockedRow(w.tx, sys, "change_template", n.template_id);
    if (!t) fields.template_id = "الگو پیدا نشد";
    else if (t.kind === "standard" && t.state !== "published") fields.template_id = `تغییر استاندارد «${t.name}» منتشر نشده است`;
    else applyTemplate(n, t);
  }
  // the model decides the type; a type without a model takes its default model; the lifecycle is snapshotted
  const askedType = String(n.type ?? "normal");
  // a model the person picked themselves (not one a template or the type's default brings)
  const pickedModel = person(w) && !!w.input?.has("model_id") && !!n.model_id && (creating || w.changed.has("model_id"));
  let model: Row | null = null;
  if (creating || w.changed.has("model_id") || w.changed.has("type") || !Array.isArray(n.model_states) || !n.model_states.length) {
    if (n.model_id && (creating || w.changed.has("model_id") || !w.changed.has("type"))) {
      model = await liveRow(w.tx, sys, "change_model", n.model_id);
      if (!model) fields.model_id = "مدل تغییر پیدا نشد";
      else if (model.type && model.type !== n.type) n.type = model.type;
    }
    if (!model && !fields.model_id) {
      const rows = await liveRows(w.tx, sys, "change_model", { and: [{ f: "type", op: "eq", v: String(n.type ?? "normal") }, { f: "active", op: "eq", v: true }] }, { order: "t.is_default desc, t.sort_order, t.name", limit: 1 });
      model = rows[0] ?? null;
      n.model_id = model?.id ?? null;
    }
    n.model_states = lifecycleOf(model?.states, n.type);
  } else if (n.model_id) model = await liveRow(w.tx, sys, "change_model", n.model_id);
  if (n.type === "latent") n.retrospective = true;
  const m: ModelLike | null = modelLike(model);

  // A person's change skips authorization only the ways the process allows: it is standard only as an order of a
  // published standard change of the catalogue (and keeps that template), and a model of another type than the one
  // asked for, or a normal or emergency model without «در انتظار تأیید», is the change managers' choice. (Copies,
  // «ثبت تغییر» from other records and the generic API all pass here.)
  if (person(w)) {
    if (n.type === "standard" && (creating || ["type", "model_id", "template_id"].some((f) => w.changed.has(f)))) {
      const t = isUuid(n.template_id) ? await liveRow(w.tx, sys, "change_template", n.template_id) : null;
      if (!t || t.kind !== "standard" || t.state !== "published") fields.type = "تغییر استاندارد فقط از کاتالوگ تغییرهای استاندارد (الگوی منتشرشده) ثبت می‌شود";
      else if (!creating && w.changed.has("template_id")) fields.template_id = "الگوی تغییر استاندارد پس از ثبت عوض نمی‌شود";
    }
    if (pickedModel && model && !fields.type) {
      const other = !!model.type && model.type !== askedType;
      const unauthorized = (n.type === "normal" || n.type === "emergency") && !lifecycleOf(n.model_states, n.type).includes("authorize");
      if ((other || unauthorized) && !(await managesChanges(w.tx, w.ctx))) {
        fields.model_id = other
          ? `مدل «${model.name}» برای تغییرهای «${typeLabel(model.type)}» است؛ نوع تغییر را عوض کنید یا مدلی از همین نوع برگزینید`
          : `مدل «${model.name}» مرحلهٔ «در انتظار تأیید» ندارد؛ انتخاب آن با مدیران تغییر است`;
      }
    }
  }
  const cfg = await changeConfig(w.tx, sys);

  // field locks of the current state (a person's edits; the system and trusted code keep their stamps)
  if (!creating && p && person(w)) {
    for (const f of lockedIn(String(p.state), m, n.type)) {
      if (w.changed.has(f) && w.input?.has(f)) fields[f] = `«${fieldLabel("change_request", f)}» از مرحلهٔ «${stateLabel(p.state)}» به بعد تغییر نمی‌کند`;
    }
  }

  // who approves is not the author's to pick: a change manager named on the change is one, its CAB an active board
  // of its kind (the approver sources pass over anything else as well)
  if (person(w)) {
    const given = (f: string) => !!w.input?.has(f) && !blank(n[f]) && changed(f);
    if (given("change_manager_id") && !(await changeManagers(w.tx, sys)).includes(String(n.change_manager_id))) fields.change_manager_id = "«مدیر تغییر» باید یکی از مدیران تغییر باشد";
    if (given("cab_id") && !cabFits(await liveRow(w.tx, sys, "cab", n.cab_id), n.type === "emergency")) fields.cab_id = n.type === "emergency" ? "هیئت تغییر اضطراری باید هیئت اضطراری فعال باشد" : "هیئت CAB باید فعال باشد و هیئت اضطراری نباشد";
  }

  // on hold
  if (creating ? !!n.on_hold : w.changed.has("on_hold")) n.on_hold_since = n.on_hold ? nowIso() : null;
  if (!n.on_hold) {
    if (n.on_hold_reason) n.on_hold_reason = null;
    if (n.lockdown_id) n.lockdown_id = null;
  }

  // milestones
  if (stateMoved) {
    const from = String(p?.state ?? "new");
    const to = String(n.state);
    if (!creating && from === "new" && forwardMove(from, to)) n.submitted_at = nowIso();
    if (entering(w, "authorize")) n.auth_cycle_at = await dbNow(w.tx);
    if (from === "authorize" && (to === "scheduled" || to === "implement")) n.authorized_at = nowIso();
    else if ((to === "scheduled" || to === "implement") && !n.authorized_at && !lifecycleOf(n.model_states, n.type).includes("authorize")) n.authorized_at = nowIso();
    if (entering(w, "implement") && !n.actual_start) n.actual_start = nowIso();
    if (!creating && from === "implement" && to === "review" && !n.actual_end) n.actual_end = nowIso();
    if (entering(w, "implement")) n.overrun_alerted_at = null;
    if (entering(w, "scheduled")) n.window_alerted_at = null;
    // a state's reason belongs to it: a move clears the old one unless the write names a new one
    if (!creating && !w.input?.has("status_reason")) n.status_reason = null;
  }
  const as = msOf(n.actual_start);
  const ae = msOf(n.actual_end);
  n.duration_actual = as !== null && ae !== null && ae >= as ? Math.round((ae - as) / 1000) : null;
  const ps = msOf(n.planned_start);
  const pe = msOf(n.planned_end);
  if (ps !== null && pe !== null && pe <= ps && (changed("planned_start") || changed("planned_end"))) fields.planned_end = "پایان برنامه‌ریزی‌شده باید پس از شروع آن باشد";
  if (as !== null && ae !== null && ae < as && (changed("actual_start") || changed("actual_end"))) fields.actual_end = "پایان واقعی نمی‌تواند پیش از شروع واقعی باشد";
  if (n.type === "standard" && n.template_id && ps !== null && pe !== null && (changed("planned_start") || changed("planned_end"))) {
    const t = await liveRow(w.tx, sys, "change_template", n.template_id);
    const max = Number(t?.max_duration ?? 0);
    if (max > 0 && (pe - ps) / 1000 > max) fields.planned_end = `مدت اجرای تغییر استاندارد «${t!.name}» حداکثر ${Math.round(max / 60)} دقیقه است`;
  }

  // risk answers
  if (changed("risk_answers")) {
    const a = cleanAnswers(n.risk_answers);
    if (typeof a === "string") fields.risk_answers = a;
    else n.risk_answers = a;
  }

  // impacted services (CMDB)
  if (changed("affected_cis") || changed("ci_id")) {
    const svc = await impactedServicesOf(w.tx, sys, scopeOf(n).cis);
    if (svc !== null) n.impacted_services = svc;
  }

  // leaving a change out of conflict detection is the change managers' call (it clears the gate before approval)
  if (person(w) && (creating ? !!n.exclude_conflicts : w.changed.has("exclude_conflicts")) && !(await managesChanges(w.tx, w.ctx))) {
    fields.exclude_conflicts = "کنار گذاشتن تغییر از بررسی تداخل با مدیران تغییر است";
  }

  // conflicts with other changes, windows and lockdowns: the flags land in this write, the rows after it
  if (creating ? !!(n.planned_start && n.planned_end) : CONFLICT_TRIGGERS.some((f) => w.changed.has(f))) {
    const plan = await planConflicts(w.tx, sys, n);
    Object.assign(n, plan.flags);
    let m = conflictPlans.get(w.tx);
    if (!m) conflictPlans.set(w.tx, (m = new Map()));
    m.set(String(n.id), plan);
  }

  // risk, notice and «دیرهنگام» (each needs the other: the notice depends on the risk, the risk on lateness)
  const leadDue = PLANNING.includes(String(n.state)) && (creating || ["planned_start", "risk", "type", "model_id"].some((f) => w.changed.has(f)) || entering(w, "assess") || entering(w, "authorize"));
  if (creating || stateMoved || RISK_INPUTS.some((f) => w.changed.has(f)) || leadDue) {
    const holds = await holdsOn(w.tx, sys, n);
    const questions = applicableQuestions(await riskQuestions(w.tx, sys), n, holds);
    const team = await teamScoreOf(w.tx, sys, n.assignment_group_id);
    let result = computeRisk({ change: n, questions, answers: n.risk_answers, teamScore: team, bands: cfg });
    const exempt = !!m?.lead_time_exempt || ["emergency", "standard", "latent"].includes(String(n.type));
    if (leadDue) {
      const days = await leadDays(w.tx, sys, n.planned_start);
      n.lead_days = days;
      const level = n.risk_source === "calculated" || !n.risk_source ? result.level : n.risk;
      const late = !exempt && days !== null && days < leadDaysFor(level, cfg);
      if (!!n.is_late !== late) {
        n.is_late = late;
        result = computeRisk({ change: n, questions, answers: n.risk_answers, teamScore: team, bands: cfg });
      }
    }
    // «template» holds only for a standard change of its template; a person who sets a risk other than the calculated
    // one sets it by hand (a reason is required) — on a template's change too
    if (n.risk_source === "template" && !(n.type === "standard" && n.template_id)) n.risk_source = "calculated";
    const setByHand = person(w) && w.input?.has("risk") && (!w.input?.has("risk_source") || sourceIgnored) && (n.risk_source !== "template" || (!creating && w.changed.has("risk")));
    if (setByHand && n.risk && n.risk !== result.level) n.risk_source = "manual";
    if (!n.risk_source) n.risk_source = "calculated";
    if (n.risk_source === "calculated" || !n.risk) n.risk = result.level;
    if (n.risk_source === "manual" && n.risk !== result.level && blank(n.risk_override_reason) && person(w)) fields.risk_override_reason = "دلیل تعیین دستی ریسک را بنویسید";
    n.risk_score = result.score;
    n.risk_calculated = result.level;
    n.risk_factors = result.factors;
    n.risk_assessed_at = nowIso();
    n.risk_explanation = explainRisk(result, { manual: n.risk_source !== "calculated" ? { level: String(n.risk), reason: n.risk_override_reason ?? null } : null });
  }

  // CAB and review
  n.cab_required = cabRequired(n, m, cfg.cab_risks);
  if (n.cab_required && !n.cab_id && ["new", "assess", "authorize"].includes(String(n.state))) {
    const cab = await cabFor(w.tx, sys, n, n.type === "emergency");
    if (cab) n.cab_id = cab.id;
  }
  n.pir_required = pirReasons(n, m, cfg.pir_required_for).length > 0;

  if (Object.keys(fields).length) throw validationError(fields);
}

async function changeGuard(w: W & { transition: NonNullable<W["transition"]> }): Promise<string | null> {
  const n = w.next;
  const from = String(w.prev?.state ?? "new");
  const to = String(w.transition.to);
  const sys = sysOf(w.ctx);
  const lifecycle = lifecycleOf(n.model_states, n.type);
  const lp = lifecycleProblem(lifecycle, from, to);
  if (lp) return lp;
  const forward = forwardMove(from, to);
  // authorized by hand (the approvals' own completion is the system's): never by the change's own people
  if (from === "authorize" && (to === "scheduled" || to === "implement") && person(w)) {
    const me = w.ctx.user.id;
    if (OWN_PEOPLE.some((f) => n[f] === me)) return "تغییری را که درخواست‌دهنده، مجری یا هماهنگ‌کنندهٔ آن هستید خودتان مجاز نمی‌کنید";
  }
  const holdLabel = () => HOLD_REASONS.find((o) => o.value === n.on_hold_reason)?.label ?? "بدون دلیل";
  if (n.on_hold && forward) return `این تغییر متوقف است (${holdLabel()})؛ پیش از ادامه، توقف را بردارید`;
  const cfg = await changeConfig(w.tx, sys);
  if (to === "canceled" && n.on_hold && cfg.hold_blocks_cancel) return "تغییر متوقف لغو نمی‌شود؛ نخست توقف را بردارید";
  const model = modelLike(n.model_id ? await liveRow(w.tx, sys, "change_model", n.model_id) : null);
  if (forward || to === "closed" || to === "canceled") {
    const missing = missingFor(to, n, model);
    if (missing.length) return `برای «${stateLabel(to)}» این موارد لازم است: ${faList(missing.map((f) => `«${fieldLabel("change_request", f)}»`))}`;
  }
  if (forward && to === "authorize" && n.type !== "emergency" && !isSystemCtx(w.ctx)) {
    const open = await countRows(w.tx, sys, "change_conflict", { and: [{ f: "change_id", op: "eq", v: n.id }, { f: "active", op: "eq", v: true }, { f: "status", op: "eq", v: "detected" }] });
    if (open) return `${open} تداخل بررسی‌نشده دارد؛ پیش از درخواست تأیید، تداخل‌ها را بررسی کنید`;
    // the questionnaire's mandatory questions are answered before approval is asked (a manual risk, with its reason,
    // stands in for the questionnaire's verdict)
    if (person(w) && n.risk_source !== "manual") {
      const { result } = await riskFor(w.tx, sys, n, cfg);
      const missing = result.questionnaire.missing;
      if (missing.length) return `پرسش‌نامهٔ ریسک کامل نیست (${missing.length} پرسش لازم بی‌پاسخ، مانند «${missing[0]}»)؛ پیش از درخواست تأیید به آن‌ها پاسخ دهید`;
    }
  }
  if (forward && (to === "scheduled" || to === "implement")) {
    // a lockdown starting at this moment takes turns with this move (lockdown.ts): one that committed is read below,
    // one that starts later waits and then holds this change in flight. Moves inside scheduling and implementation need
    // no turn — a starting lockdown reads such a change as stored and waits for its row
    if (n.type !== "emergency" && !IN_FLIGHT.includes(from)) await lockLockdowns(w.tx, w.ctx.org.id);
    const b = await scheduleBlocks(w.tx, sys, n);
    if (b.lockdowns.length) return `قرنطینهٔ تغییرات «${b.lockdowns[0].title}» برقرار است؛ فقط تغییرهای اضطراری مجازند`;
    if (b.windows.length && blank(n.blackout_override_reason)) {
      const o = b.windows[0];
      return `زمان این تغییر با «${o.name}» (${windowKindLabel(o.kind)}) هم‌پوشانی دارد؛ زمان را جابه‌جا کنید یا «${fieldLabel("change_request", "blackout_override_reason")}» را بنویسید`;
    }
  }
  if (to === "review" && from === "implement") {
    const open = await openMandatoryTasks(w.tx, sys, String(n.id));
    if (open.length) return `کارهای لازمِ ${faList(open.slice(0, 5).map((t) => String(t.number)))}${open.length > 5 ? " و …" : ""} هنوز باز است`;
  }
  if (forward && (to === "review" || to === "closed")) {
    const kids = await countRows(w.tx, sys, "change_request", { and: [{ f: "parent_id", op: "eq", v: n.id }, { f: "state", op: "nin", v: ["review", "closed", "canceled"] }] });
    if (kids) return `${kids} تغییر فرزند هنوز اجرا نشده است`;
  }
  if (to === "closed" && n.pir_required) {
    const pir = n.pir_id ? await liveRow(w.tx, sys, "change_pir", n.pir_id) : null;
    if (!pir || !["completed", "canceled"].includes(String(pir.state))) return "بازبینی پس از اجرای این تغییر هنوز تمام نشده است";
  }
  return null;
}

async function note(w: W, row: Row, body: string, kind: "system" | "work_note" = "system"): Promise<void> {
  const actor = actorOf(w.ctx);
  await addJournalIn(w.tx, sysOf(w.ctx, actor), w.def, row, { kind, body }, { trusted: true, author: actor });
}

/** A closed change counts for its template; a standard change failing a second time suspends its template (CHG-012). */
async function templateOutcome(w: WA, row: Row): Promise<void> {
  const sys = sysOf(w.ctx);
  // counted on the template locked and read again: two closings at once count twice, and the second failure suspends it
  const t = await lockedRow(w.tx, sys, "change_template", row.template_id);
  if (!t) return;
  const code = String(row.close_code ?? "");
  const failed = FAILED_CODES.includes(code);
  const ok = code === "successful" || code === "successful_issues";
  if (!failed && !ok) return;
  const patch: Row = failed ? { failure_count: Number(t.failure_count ?? 0) + 1 } : { success_count: Number(t.success_count ?? 0) + 1 };
  await updateIn(w.tx, sys, "change_template", String(t.id), patch, { trusted: true, keepVersion: true });
  if (failed && t.kind === "standard" && t.state === "published" && Number(patch.failure_count) >= 2) {
    await transitionIn(w.tx, sys, "change_template", String(t.id), "suspended", {}, { trusted: true });
    const { def } = await defFor(sys, "change_template", w.tx);
    await addJournalIn(w.tx, sys, def, t, { kind: "system", body: `تغییر ${row.number} ناموفق بود؛ این تغییر استاندارد پس از ${patch.failure_count} اجرای ناموفق معلق شد و تا بازبینی، تغییرهای آن عادی ثبت می‌شوند.` }, { trusted: true });
    await emitEvent(w.tx, sys, { kind: "record.change_template.suspended", table: "change_template", id: String(t.id), number: t.number ?? null, data: { users: [t.owner_id].filter(Boolean), change: row.number } });
  }
}

/** States in which a change has been implemented. */
const IMPLEMENTED = ["review", "closed"];

async function changeAfter(w: WA): Promise<void> {
  if (w.op === "delete") return;
  const row = w.row;
  const prev = w.prev;
  const creating = w.op === "create";
  const sys = sysOf(w.ctx);
  const id = String(row.id);

  if (creating && row.template_id) {
    // locked since the before-write hook: the use is counted on the stored row
    const t = await lockedRow(w.tx, sys, "change_template", row.template_id);
    if (t) {
      await createTemplateTasks(w.tx, w.ctx, row, t.tasks);
      await updateIn(w.tx, sys, "change_template", String(t.id), { usage_count: Number(t.usage_count ?? 0) + 1, last_used_at: nowIso() }, { trusted: true, keepVersion: true });
    }
  }

  // conflicts planned before the write: their rows now, the changes they meet (before or now) by job
  const plan = conflictPlans.get(w.tx)?.get(id);
  if (plan) {
    conflictPlans.get(w.tx)!.delete(id);
    const r = await storeConflicts(w.tx, w.ctx, row, plan);
    // the change itself too: a change written at the same moment (another one created on the same CI) was not
    // committed when this plan was made — after both commits, the job sees it (and tells the changes it then meets)
    for (const o of [...r.others, id]) await enqueue(w.tx, { kind: "change.conflicts", orgId: w.ctx.org.id, payload: { id: o }, dedupeKey: `change.conflicts:${o}` });
  }

  // its tasks and review keep the change's confidentiality (their hooks merge it in)
  if (!creating && SECRECY.some((f) => w.changed.has(f))) {
    const rows = [
      ...(await liveRows(w.tx, sys, "change_task", eqAll({ change_id: id }), { limit: 500 })).map((r) => ["change_task", r] as const),
      ...(await liveRows(w.tx, sys, "change_pir", eqAll({ change_id: id }), { limit: 50 })).map((r) => ["change_pir", r] as const),
    ];
    for (const [table, r] of rows) {
      const patch: Row = { confidential: row.confidential === true, ...(row.confidential === true ? {} : { access_list: r.access_list ?? [] }), ...secrecyOf(row, r, false) };
      if (Object.entries(patch).some(([k, v]) => JSON.stringify(r[k] ?? null) !== JSON.stringify(v ?? null))) await updateIn(w.tx, sys, table, String(r.id), patch, { trusted: true, keepVersion: true, allowLocked: true });
    }
  }

  if (!creating && w.changed.has("state") && (row.state === "implement" || row.state === "review")) tasksBeforeCommit(w, id);

  // the post-implementation review, when one is needed
  if (row.state === "review" && row.pir_required && !row.pir_id) {
    const cfg = await changeConfig(w.tx, sys);
    const model = modelLike(row.model_id ? await liveRow(w.tx, sys, "change_model", row.model_id) : null);
    const pir = await ensurePir(w.tx, w.ctx, row, pirReasons(row, model, cfg.pir_required_for));
    if (pir) await note(w, row, `بازبینی پس از اجرا (${pir.number}) ساخته شد؛ تغییر پس از پایان آن بسته می‌شود.`);
  }

  if (w.changed.has("state") && row.state === "closed" && row.template_id) await templateOutcome(w, row);

  // implemented (first «بازبینی» or «بسته»): incidents and problems waiting on this change move on (linked.ts)
  if (!creating && w.changed.has("state") && IMPLEMENTED.includes(String(row.state)) && !IMPLEMENTED.includes(String(prev?.state))) {
    const r = await resumeWaitingOn(w.tx, w.ctx, row, actorOf(w.ctx));
    const moved = r.incidents.length + r.problems.length;
    if (moved) await note(w, row, `رکوردهای منتظر این تغییر خبر گرفتند: ${moved.toLocaleString("fa-IR")} رکورد (رخداد و مشکل).`);
    if (r.failed.length) await note(w, row, `این رکوردها منتظر تغییر ماندند: ${r.failed.join("، ")}`, "work_note");
  }

  // what was authorized changed: authorize again (CHG-005)
  if (!creating && person(w) && prev?.state === "scheduled" && row.state === "scheduled") {
    const hit = REAUTH_FIELDS.filter((f) => w.changed.has(f));
    const cfg = hit.length ? await changeConfig(w.tx, sys) : null;
    if (cfg?.reauthorize_on_edit && row.type !== "standard" && lifecycleOf(row.model_states, row.type).includes("authorize")) {
      const actor = actorOf(w.ctx);
      try {
        await savepoint(w.tx, () => transitionIn(w.tx, sysOf(w.ctx, actor), "change_request", id, "authorize", {}, { trusted: true }));
        await note(w, row, `${faList(hit.map((f) => `«${fieldLabel("change_request", f)}»`))} پس از تأیید تغییر کرد؛ تغییر دوباره به «در انتظار تأیید» رفت.`);
      } catch (e) {
        await note(w, row, `${faList(hit.map((f) => `«${fieldLabel("change_request", f)}»`))} پس از تأیید تغییر کرد ولی درخواست تأیید دوباره انجام نشد: ${e instanceof Error ? e.message : String(e)}`, "work_note");
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// rows of a change: tasks, reviews, agenda items, outages, conflicts

/**
 * A row that hangs off a change (a task, a review, an agenda item, a planned outage, a conflict) is the business of the
 * people working that change: a person who adds one, or moves one to another change, must read the change and be able
 * to change it. A change they cannot read answers like one that does not exist.
 */
async function assertWorksChange(w: W, what: string): Promise<void> {
  if (!person(w) || (w.op !== "create" && !w.changed.has("change_id"))) return;
  const change = await liveRow(w.tx, w.ctx, "change_request", w.next.change_id);
  if (!change) throw validationError({ change_id: `«${w.def.fields.find((f) => f.name === "change_id")?.label ?? "تغییر"}» پیدا نشد` });
  const { def } = await defFor(w.ctx, "change_request", w.tx);
  if (!access().canWrite(w.ctx, def, change)) throw forbidden(`${what} را کسی می‌سازد که روی ${change.number ? `تغییر ${change.number}` : "این تغییر"} کار می‌کند`);
}

/** Fields that carry a change's confidentiality to what is made from it. */
const SECRECY = ["confidential", "access_list", "workspace_id"];

/**
 * The confidentiality a task or review of `change` takes from it: confidential with the change's readers (its access
 * list, implementer, coordinator and change manager — its group reads through the row's own group) when the change is,
 * and the change's workspace.
 */
function secrecyOf(change: Row, row: Row, merge = true): Row {
  const out: Row = {};
  if (change.confidential === true) {
    const own = merge && Array.isArray(row.access_list) ? row.access_list : [];
    const people = [...(Array.isArray(change.access_list) ? change.access_list : []), change.assigned_to, change.change_owner_id, change.change_manager_id, ...own];
    out.confidential = true;
    out.access_list = [...new Set(people.filter((x): x is string => typeof x === "string" && !!x))];
  }
  if (change.workspace_id && row.workspace_id !== change.workspace_id) out.workspace_id = change.workspace_id;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// change_task

async function taskBefore(w: W): Promise<void> {
  if (w.op === "delete") return;
  await assertWorksChange(w, "کار تغییر");
  const n = w.next;
  const sys = sysOf(w.ctx);
  const fields: Record<string, string> = {};
  // a new (or moved) task reads its change shared until commit: a closing or cancellation in flight finishes first and
  // the task is refused; one that comes later waits for this task
  const attach = w.op === "create" || w.changed.has("change_id");
  const change = n.change_id ? await (attach ? lockedRow(w.tx, sys, "change_request", n.change_id, "share") : liveRow(w.tx, sys, "change_request", n.change_id)) : null;
  if (change && (w.op === "create" || w.changed.has("change_id") || SECRECY.some((f) => w.changed.has(f)))) Object.assign(n, secrecyOf(change, n));
  if (w.op === "create") {
    if (change && ["closed", "canceled"].includes(String(change.state))) throw validationError({ change_id: "به تغییر بسته یا لغوشده کار افزوده نمی‌شود" });
    if (change && !n.assignment_group_id) n.assignment_group_id = change.assignment_group_id ?? null;
  }
  if (change && (w.op === "create" || w.changed.has("change_id"))) n.change_owner_id = change.change_owner_id ?? null;
  if (w.op === "create" || w.changed.has("depends_on")) {
    const deps = Array.isArray(n.depends_on) ? n.depends_on.map(String) : [];
    if (deps.includes(String(n.id))) fields.depends_on = "کار نمی‌تواند پس از خودش باشد";
    else if (deps.length) {
      const mine = new Set((await liveRows(w.tx, sys, "change_task", eqAll({ change_id: n.change_id }))).map((r) => String(r.id)));
      if (deps.some((d) => !mine.has(d))) fields.depends_on = "پیش‌نیازها باید کارهای همین تغییر باشند";
    }
  }
  // a new task of a change being implemented is ready at once when nothing holds it
  if (w.op === "create" && n.state === "pending" && change && taskMayRun(n, change) && !(Array.isArray(n.depends_on) && n.depends_on.length)) n.state = "open";
  const ps = msOf(n.planned_start);
  const pe = msOf(n.planned_end);
  if (ps !== null && pe !== null && pe <= ps) fields.planned_end = "پایان برنامه‌ریزی‌شده باید پس از شروع آن باشد";
  if (w.changed.has("state") && n.state === "in_progress" && !n.actual_start) n.actual_start = nowIso();
  if (w.changed.has("state") && TASK_DONE.includes(String(n.state)) && n.state !== "canceled" && !n.actual_end) n.actual_end = nowIso();
  if (Object.keys(fields).length) throw validationError(fields);
}

async function taskReady(w: W): Promise<string | null> {
  const sys = sysOf(w.ctx);
  const change = await liveRow(w.tx, sys, "change_request", w.next.change_id);
  if (!taskMayRun(w.next, change)) return "این کار پس از شروع اجرای تغییر انجام می‌شود";
  const tasks = await liveRows(w.tx, sys, "change_task", eqAll({ change_id: w.next.change_id }));
  const deps = blockingDeps(w.next, tasks);
  if (deps.length) return `نخست ${faList(deps.map((t) => String(t.number)))} باید انجام شود`;
  return null;
}

/** Changes whose mandatory task a transaction finished (the before-commit work announces when none is left open). */
const mandatoryDone = new WeakMap<Tx, Set<string>>();

/**
 * The change's waiting tasks become ready just before commit, under the change's key: two tasks finished at once (the
 * dependencies of a third) take turns there, and the later one sees both done — never a task left waiting with its
 * dependencies done. The note «همهٔ کارهای لازم … انجام شد» follows the same way.
 */
function tasksBeforeCommit(w: W, changeId: string): void {
  const tx = w.tx;
  const ctx = w.ctx;
  onBeforeCommit(tx, `change.tasks:${changeId}`, async () => {
    await activateTasks(tx, ctx, changeId);
    if (!mandatoryDone.get(tx)?.delete(changeId)) return;
    const sys = sysOf(ctx);
    const change = await liveRow(tx, sys, "change_request", changeId);
    if (change?.state !== "implement") return;
    if ((await openMandatoryTasks(tx, sys, changeId)).length) return;
    const { def } = await defFor(sys, "change_request", tx);
    await addJournalIn(tx, sys, def, change, { kind: "system", body: "همهٔ کارهای لازم این تغییر انجام شد؛ نتیجهٔ اجرا را ثبت و اجرا را پایان دهید." }, { trusted: true });
  });
}

async function taskAfter(w: WA): Promise<void> {
  if (w.op === "delete" || !w.changed.has("state") || !TASK_DONE.includes(String(w.row.state))) return;
  const changeId = String(w.row.change_id);
  if (w.row.mandatory) {
    let m = mandatoryDone.get(w.tx);
    if (!m) mandatoryDone.set(w.tx, (m = new Set()));
    m.add(changeId);
  }
  tasksBeforeCommit(w, changeId);
}

// ---------------------------------------------------------------------------------------------------------------
// templates, windows, CABs and meetings

/**
 * The module's definitions — models (lifecycles), windows, CABs, the risk questionnaire, lockdowns, success scores —
 * shape every team's changes: which states they pass, who approves them, when they may run. A person creates, changes
 * or removes one only with the change manager's authority, whatever the table's own scope would let them write (a
 * window's or a CAB's group, a CAB's chair). The system and trusted code (the seed, the sweep) are not asked.
 */
async function assertDefines(w: W): Promise<void> {
  if (!person(w) || (await managesChanges(w.tx, w.ctx))) return;
  const verb = w.op === "create" ? "ساختن" : w.op === "delete" ? "حذف" : "تغییر";
  throw forbidden(`${verb} «${w.def.label}» با مدیران تغییر است`);
}

function templateBefore(w: W): void {
  if (w.op === "delete") return;
  const n = w.next;
  const p = templateTasksProblem(n.tasks);
  if (p) throw validationError({ tasks: p });
  if (entering(w, "published")) {
    if (n.kind === "standard") {
      const missing = ["short_description", "implementation_plan", "backout_plan", "risk"].filter((f) => blank(n[f]));
      if (missing.length) throw validationError(Object.fromEntries(missing.map((f) => [f, `تغییر استاندارد پیش از انتشار «${fieldLabel("change_template", f)}» لازم دارد`])));
    }
    if (w.prev?.published_at) n.revision = Number(w.prev.revision ?? 1) + 1;
    n.published_at = nowIso();
    n.published_by = actorOf(w.ctx);
  }
}

const WINDOW_MAX: Record<string, number> = { daily: 86_400_000, weekly: 7 * 86_400_000 };

async function windowBefore(w: W): Promise<void> {
  await assertDefines(w);
  if (w.op === "delete") return;
  const n = w.next;
  const fields: Record<string, string> = {};
  const s = msOf(n.start_at);
  const e = msOf(n.end_at);
  if (s !== null && e !== null && e <= s) fields.end_at = "پایان پنجره باید پس از شروع آن باشد";
  const rec = String(n.recurrence ?? "none");
  if (s !== null && e !== null && WINDOW_MAX[rec] && e - s > WINDOW_MAX[rec]) fields.end_at = rec === "daily" ? "پنجرهٔ روزانه حداکثر ۲۴ ساعت است" : "پنجرهٔ هفتگی حداکثر یک هفته است";
  if (rec !== "none" && n.until && s !== null && String(n.until) < new Date(s).toISOString().slice(0, 10)) fields.until = "پایان تکرار نمی‌تواند پیش از شروع پنجره باشد";
  if (rec !== "weekly" && Array.isArray(n.weekdays) && n.weekdays.length) n.weekdays = [];
  if (n.kind === "maintenance" && n.enforcement !== "block") n.enforcement = "block";
  if (Object.keys(fields).length) throw validationError(fields);
}

async function windowAfter(w: WA): Promise<void> {
  // windows decide blackout and maintenance conflicts: recheck the changes still to come
  await enqueue(w.tx, { kind: "change.recheck", orgId: w.ctx.org.id, dedupeKey: "change.recheck" });
}

async function cabBefore(w: W): Promise<void> {
  await assertDefines(w);
  if (w.op === "delete") return;
  const n = w.next;
  if (!blank(n.meeting_time) && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(n.meeting_time).trim())) throw validationError({ meeting_time: "ساعت جلسه را به شکل «۱۰:۰۰» بنویسید" });
  if (!blank(n.meeting_time)) n.meeting_time = String(n.meeting_time).trim().padStart(5, "0");
  if (blank(n.meeting_weekday) !== blank(n.meeting_time)) throw validationError(blank(n.meeting_time) ? { meeting_time: "ساعت جلسه را هم تعیین کنید" } : { meeting_weekday: "روز جلسه را هم تعیین کنید" });
}

async function meetingBefore(w: W): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const s = msOf(n.starts_at);
  const e = msOf(n.ends_at);
  if (s !== null && e !== null && e <= s) throw validationError({ ends_at: "پایان جلسه باید پس از شروع آن باشد" });
  if (w.op === "create" && n.cab_id && (blank(n.attendees) || !n.chair_id)) {
    const sys = sysOf(w.ctx);
    const cab = await liveRow(w.tx, sys, "cab", n.cab_id);
    if (cab) {
      if (!n.chair_id) n.chair_id = cab.manager_id ?? null;
      if (blank(n.attendees)) n.attendees = await cabPeople(w.tx, sys, cab);
      if (blank(n.location)) n.location = cab.location ?? null;
      if (blank(n.conference_url)) n.conference_url = cab.conference_url ?? null;
    }
  }
  if (entering(w, "completed")) n.minutes_sent_at = blank(n.minutes) ? null : nowIso();
}

async function meetingAfter(w: WA): Promise<void> {
  if (w.op === "delete") return;
  const row = w.row;
  const sys = sysOf(w.ctx);
  if (w.op === "create" && (row.state === "planned" || row.state === "in_progress")) await refreshAgenda(w.tx, w.ctx, String(row.id));
  if (!entering(w, "completed")) return;
  // what the meeting did not decide goes to the next one
  for (const listed of await liveRows(w.tx, sys, "cab_agenda_item", eqAll({ meeting_id: row.id }))) {
    if (listed.decision !== "pending" && listed.decision !== "voting") continue;
    // read again locked: a decision recorded at this moment (the CAB approved) stays
    const i = await lockedRow(w.tx, sys, "cab_agenda_item", listed.id);
    if (i && (i.decision === "pending" || i.decision === "voting")) {
      await updateIn(w.tx, sys, "cab_agenda_item", String(i.id), { decision: "deferred", decided_at: nowIso(), decision_notes: i.decision_notes ?? "در این جلسه تصمیمی گرفته نشد؛ به جلسهٔ بعد رفت" }, { trusted: true });
    }
  }
  if (!blank(row.minutes)) {
    const users = [...new Set([...(Array.isArray(row.attendees) ? row.attendees : []), ...(Array.isArray(row.present) ? row.present : []), ...(row.chair_id ? [row.chair_id] : [])].map(String))];
    await notifyPeople(w.tx, w.ctx.org.id, {
      table: "cab_meeting", id: String(row.id), users, event: "custom", label: "صورت‌جلسهٔ CAB",
      subject: `صورت‌جلسهٔ ${row.title}`, body: String(row.minutes), channels: ["in_app", "email"], actor: actorOf(w.ctx), source: "مدیریت تغییر",
    });
  }
}

async function agendaBefore(w: W): Promise<void> {
  if (w.op === "delete") return;
  await assertWorksChange(w, "مورد دستور جلسه");
  if (w.op !== "create" || !blank(w.next.title) || !w.next.change_id) return;
  const c = await liveRow(w.tx, sysOf(w.ctx), "change_request", w.next.change_id);
  if (c) w.next.title = String(c.number ?? "").slice(0, 60);
}

// ---------------------------------------------------------------------------------------------------------------
// conflicts, reviews, lockdowns, settings, questions, outages

async function conflictBefore(w: W): Promise<void> {
  if (w.op === "delete") return;
  await assertWorksChange(w, "تداخل");
  if (!person(w) || !w.changed.has("status")) return;
  if ((w.next.status === "ignored" || w.next.status === "resolved") && blank(w.next.justification)) throw validationError({ justification: "برای بستن تداخل، دلیل را بنویسید" });
}

async function conflictAfter(w: WA): Promise<void> {
  if (w.op === "delete" || isSystemCtx(w.ctx) || !w.changed.has("status")) return;
  await syncConflictState(w.tx, w.ctx, String(w.row.change_id));
}

async function pirBefore(w: W): Promise<void> {
  if (w.op === "delete") return;
  await assertWorksChange(w, "بازبینی پس از اجرا");
  if (w.op === "create" || w.changed.has("change_id") || SECRECY.some((f) => w.changed.has(f))) {
    const change = await liveRow(w.tx, sysOf(w.ctx), "change_request", w.next.change_id);
    if (change) Object.assign(w.next, secrecyOf(change, w.next));
  }
  if (entering(w, "completed")) w.next.completed_at = nowIso();
  else if (w.changed.has("state") && w.next.state !== "completed") w.next.completed_at = null;
}

async function pirAfter(w: WA): Promise<void> {
  if (w.op === "delete" || !entering(w, "completed")) return;
  const sys = sysOf(w.ctx);
  const change = await liveRow(w.tx, sys, "change_request", w.row.change_id);
  // only the change's own review speaks for it (its lessons, «تغییر را می‌توان بست»)
  if (!change || change.pir_id !== w.row.id) return;
  if (blank(change.lessons) && !blank(w.row.lessons)) await updateIn(w.tx, sys, "change_request", String(change.id), { lessons: w.row.lessons }, { trusted: true, keepVersion: true });
  const { def } = await defFor(sys, "change_request", w.tx);
  const actor = actorOf(w.ctx);
  await addJournalIn(w.tx, sysOf(w.ctx, actor), def, change, { kind: "system", body: `بازبینی پس از اجرا (${w.row.number}) انجام شد؛ تغییر را می‌توان بست.` }, { trusted: true, author: actor });
}

async function lockdownBefore(w: W): Promise<void> {
  await assertDefines(w);
  if (w.op === "delete") return;
  const s = msOf(w.next.starts_at);
  const e = msOf(w.next.ends_at);
  if (s !== null && e !== null && e <= s) throw validationError({ ends_at: "پایان قرنطینه باید پس از شروع آن باشد" });
  if (entering(w, "released")) {
    w.next.released_at = nowIso();
    w.next.released_by = actorOf(w.ctx);
  }
}

async function lockdownAfter(w: WA): Promise<void> {
  if (w.op === "delete") return;
  const actor = actorOf(w.ctx);
  if (entering(w, "released")) await releaseLockdown(w.tx, w.ctx, w.row, actor);
  // a lockdown that has started holds the changes in flight once (created now, or moved to a start that passed);
  // one that starts later is applied by the sweep when its start comes
  else if ((w.op === "create" || w.changed.has("starts_at") || w.changed.has("hold_in_flight")) && lockdownDue(w.row, Date.now() + 60_000)) await startLockdown(w.tx, w.ctx, w.row, actor);
}

function configBefore(w: W): void {
  if (w.op === "delete") return;
  const n = w.next;
  const a = Number(n.risk_moderate_from);
  const b = Number(n.risk_high_from);
  const c = Number(n.risk_very_high_from);
  if (!(a < b && b < c)) throw validationError({ risk_high_from: "آستانه‌های ریسک باید به ترتیب «متوسط < زیاد < بسیار زیاد» باشند" });
}

async function questionBefore(w: W): Promise<void> {
  await assertDefines(w);
  if (w.op === "delete") return;
  const n = w.next;
  const raw = n.options;
  if (raw !== null && raw !== undefined && !Array.isArray(raw)) throw validationError({ options: "گزینه‌ها باید فهرست باشند" });
  const opts = optionsOf({ kind: n.kind, options: raw ?? [] });
  if (n.kind === "choice" && opts.length < 2) throw validationError({ options: "پرسش چندگزینه‌ای دست‌کم دو گزینه لازم دارد" });
  if (new Set(opts.map((o) => o.value)).size !== opts.length) throw validationError({ options: "مقدار گزینه‌ها نباید تکراری باشد" });
  if (n.kind === "number") {
    const maxes = opts.map((o) => o.max).filter((x): x is number => x !== null && x !== undefined);
    if (!opts.length) throw validationError({ options: "برای پرسش عددی بازه‌ها و امتیازشان را تعیین کنید" });
    if (maxes.some((x, i) => i > 0 && x <= maxes[i - 1])) throw validationError({ options: "سقف بازه‌ها باید صعودی باشد" });
  }
  if (Array.isArray(raw)) n.options = opts;
}

async function outageBefore(w: W): Promise<void> {
  if (w.op === "delete") return;
  await assertWorksChange(w, "قطعی برنامه‌ریزی‌شده");
  const s = msOf(w.next.starts_at);
  const e = msOf(w.next.ends_at);
  if (s !== null && e !== null && e <= s) throw validationError({ ends_at: "پایان قطعی باید پس از شروع آن باشد" });
}

/** Register the hooks of the change tables. */
export function installChangeHooks(): (() => void)[] {
  return [
    registerHooks("change_request", { beforeWrite: changeBefore, afterWrite: changeAfter, guards: { change_lifecycle: (w) => changeGuard(w) } }),
    registerHooks("change_task", { beforeWrite: taskBefore, afterWrite: taskAfter, guards: { change_task_ready: (w) => taskReady(w) } }),
    registerHooks("change_template", { beforeWrite: templateBefore }),
    registerHooks("change_model", { beforeWrite: assertDefines }),
    registerHooks("change_success_score", { beforeWrite: assertDefines }),
    registerHooks("change_window", { beforeWrite: windowBefore, afterWrite: windowAfter }),
    registerHooks("cab", { beforeWrite: cabBefore }),
    registerHooks("cab_meeting", { beforeWrite: meetingBefore, afterWrite: meetingAfter }),
    registerHooks("cab_agenda_item", { beforeWrite: agendaBefore }),
    registerHooks("change_conflict", { beforeWrite: conflictBefore, afterWrite: conflictAfter }),
    registerHooks("change_pir", { beforeWrite: pirBefore, afterWrite: pirAfter }),
    registerHooks("change_lockdown", { beforeWrite: lockdownBefore, afterWrite: lockdownAfter }),
    // a declared major incident may start a lockdown (settings «قرنطینهٔ خودکار با اعلام رخداد عمده»)
    registerHooks("incident", { afterWrite: (w) => lockdownOnMajor(w) }),
    registerHooks("change_config", { beforeWrite: configBefore }),
    registerHooks("change_risk_question", { beforeWrite: questionBefore }),
    registerHooks("change_outage", { beforeWrite: outageBefore }),
  ];
}

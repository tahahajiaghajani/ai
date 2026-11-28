// `validateProcess` (design F §3.5, F4a): what a process graph must be before it is published. Errors block the
// publish (F4c); warnings are shown on the designer's nodes (F6).
//   · exactly one «آغاز», followed directly by exactly one start step «ثبت درخواست» (a fill step);
//   · «بازگشت برای اصلاح» is the only cycle: an edge from a review or approve step's `returned` port back to an
//     earlier form step on the same branch («ثبت درخواست» included) — one that every path to the step passes — and
//     never across a «موازی»/«پیوستن» boundary; any other edge back is a cycle;
//   · a join in mode «any» sets `cancel_rest` (the other branches are withdrawn, their open tasks closed);
//   · the rules of the flows validator: node and edge ids, known steps, ports and their wiring, reachable steps, the
//     settings each step needs, the data pills it reads.
// Warnings: a field editable on two parallel branches («آخرین ثبت می‌ماند»), a pool larger than 30, a title pill a
// step hides, a required field no step can edit, a «تکمیل فرم» step with nothing to fill — those need the forms and
// fields (`ProcessValidateContext`); an approve step that passes when nobody is found counts as approved; the demo
// pack's people among the managers of a process of the organisation's own (the server's `demoManagers`).
// Pure and shared: the designer shows the problems live; the publish refuses with errors.
// Imported by the UI: keep it free of server imports.
import type { FlowEdge, FlowProblem } from "../flows/types";
import { FLOW_LIMITS, RULE_OPS } from "../flows/nodes";
import { cleanGraph } from "../flows/validate";
import { pillRoot, pillsOf } from "../flows/template";
import { canEdit, effectiveRights, fieldGetter, fieldItems, type FieldSource, type FormLayoutV2, type Right } from "../forms/layout";
import { LIBRARY_NAME } from "../forms/fieldtypes";
import { faDigits } from "../format";
import {
  APPROVER_LIMIT,
  assigneeProblems,
  assigneeWarnings,
  cleanStepAssignees,
  poolWarnings,
  QUORUMS,
  STEP_ACTIONS,
  type AssigneeFacts,
  type PoolCounts,
} from "./assignees";
import {
  CASE_META_KEYS,
  CASE_ROOT,
  CHOICE_KEY,
  choiceCases,
  END_OUTCOMES,
  ESCALATION_ACTIONS,
  formStepOf,
  isProcessNodeType,
  MAX_CHOICE_CASES,
  outEdges,
  processNodeLabel,
  processPorts,
  quorumOf,
  RETURN_TO,
  returnAllowed,
  stepOutcomes,
  structureOf,
  type FormStep,
  type ProcessGraph,
} from "./graph";
import { TITLE_PEOPLE, titlePills } from "./title";

export interface ProcessValidateContext {
  /** the forms steps use, by id (their name and layout); omit to skip form checks */
  forms?: (id: string) => { name: string; layout: FormLayoutV2 } | null | undefined;
  /** library field definitions (by name) — for step rights and the warnings about fields */
  fields?: FieldSource;
  /** what the server or the designer knows about positions, groups, roles, units and members */
  assigneeFacts?: AssigneeFacts;
  /** pool sizes for the «بیش از ۳۰ نفر» warning */
  poolCounts?: PoolCounts;
  /** the process's title template (pills of the start form's fields and the requester only) */
  titleTemplate?: string | null;
  /** the automations a «جریان خودکار» may run, by id */
  flow?: (id: string) => { name: string; published: boolean } | null | undefined;
  /**
   * The demo pack's people among the managers of a process of the organisation's own — named, or members of its manager
   * groups (release 1.1.5): their names, and whether they are all its managers.
   */
  demoManagers?: { names: readonly string[]; all: boolean } | null;
}

/**
 * Why the demo pack's people do not manage a process's cases of the organisation's own (FINAL-1): they manage only the
 * cases the pack's people start; when they are all its managers, its own cases fall to the organisation's administrators.
 */
export function demoManagersWarning(d: { names: readonly string[]; all: boolean }): string {
  const shown = d.names.slice(0, 3).map((n) => `«${n}»`).join("، ");
  const who = d.names.length > 3 ? `${shown} و ${faDigits(d.names.length - 3)} نفر دیگر` : shown;
  const one = d.names.length === 1;
  const line = `${who} از مسئولان این گردش‌کار ${one ? "حساب نمایشی است و" : "حساب نمایشی‌اند و"} فقط پرونده‌هایی را مدیریت ${one ? "می‌کند" : "می‌کنند"} که حساب‌های نمایشی آغاز کنند؛ پرونده‌های خود سازمان را نه`;
  return d.all ? `${line} — پرونده‌های خود سازمان در این گردش‌کار به مدیران سازمان سپرده می‌شوند` : line;
}

/** Do the problems block a publish? */
export const hasProcessErrors = (problems: readonly FlowProblem[]): boolean => problems.some((p) => p.level === "error");

/** Roots a process's pills may start with: the case's values, step outputs (automations), the run and the clock. */
export const PROCESS_PILL_ROOTS = [CASE_ROOT, "steps", "run", "now", "today", "jalali"] as const;

const NODE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const ruleOps = new Set<string>(RULE_OPS.map((o) => o.value));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isEmpty = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);

/** The first edge of a cycle among `edges` (null: none). */
function cycleEdge(nodes: readonly { id: string }[], edges: readonly FlowEdge[]): FlowEdge | null {
  const state = new Map<string, 1 | 2>();
  const out = new Map<string, FlowEdge[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e]);
  let found: FlowEdge | null = null;
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      if (found) return;
      const s = state.get(e.target);
      if (s === 1) {
        found = e;
        return;
      }
      if (!s) visit(e.target);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if (!state.get(n.id) && !found) visit(n.id);
  return found;
}

function rulesProblems(rules: unknown, add: (message: string) => void) {
  if (!Array.isArray(rules) || !rules.length) return add("دست‌کم یک مقایسه لازم است");
  for (const r of rules as { left?: unknown; op?: unknown }[]) {
    if (isEmpty(r?.left)) add("سمت چپ هر مقایسه را وارد کنید");
    if (!ruleOps.has(String(r?.op ?? ""))) add("نوع مقایسه معتبر نیست");
  }
}

/** Every problem of a process graph (errors block publishing). */
export function validateProcess(input: unknown, vctx: ProcessValidateContext = {}): FlowProblem[] {
  if (!isObj(input) || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) return [{ level: "error", message: "طرح گردش‌کار معتبر نیست" }];
  const graph = cleanGraph(input) as unknown as ProcessGraph;
  const problems: FlowProblem[] = [];
  const err = (message: string, at: { node?: string; edge?: string; field?: string } = {}) => problems.push({ level: "error", message, ...at });
  const warn = (message: string, at: { node?: string; edge?: string; field?: string } = {}) => problems.push({ level: "warning", message, ...at });
  if (graph.nodes.length > FLOW_LIMITS.nodes) err(`گردش‌کار بیش از ${faDigits(FLOW_LIMITS.nodes)} گام دارد`);

  // ----- nodes
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (!NODE_ID.test(n.id)) err("شناسهٔ گام معتبر نیست", { node: n.id });
    else if (ids.has(n.id)) err("شناسهٔ گام تکراری است", { node: n.id });
    ids.add(n.id);
    if (!isProcessNodeType(n.type)) err(`گام «${String(n.type)}» در گردش‌کارها به کار نمی‌رود؛ آن را در یک «جریان خودکار» بگذارید`, { node: n.id });
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) err(triggers.length ? "گردش‌کار فقط یک «آغاز» دارد" : "گام «آغاز» پیدا نشد");
  const starts = graph.nodes.filter((n) => n.type === "form_step" && n.config?.start === true);
  if (!starts.length) err("مرحلهٔ «ثبت درخواست» پیدا نشد");
  if (starts.length > 1) for (const s of starts.slice(1)) err("گردش‌کار فقط یک «ثبت درخواست» دارد", { node: s.id });

  // ----- edges and ports
  const edgeIds = new Set<string>();
  const portUse = new Map<string, number>();
  const pairs = new Set<string>();
  const valid: FlowEdge[] = [];
  for (const e of graph.edges) {
    const src = byId.get(e.source);
    const dst = byId.get(e.target);
    if (!e.id || edgeIds.has(e.id)) err("شناسهٔ اتصال تکراری یا خالی است", { edge: e.id });
    edgeIds.add(e.id);
    if (!src || !dst) {
      err("اتصال به گامی ناموجود اشاره می‌کند", { edge: e.id });
      continue;
    }
    if (e.source === e.target) err("گامی به خودش وصل شده است", { edge: e.id, node: e.source });
    if (dst.type === "trigger") err("به «آغاز» نمی‌توان وصل شد", { edge: e.id, node: dst.id });
    const port = e.port ?? "out";
    const pd = isProcessNodeType(src.type) ? processPorts(src).find((p) => p.key === port) : undefined;
    if (isProcessNodeType(src.type) && !pd) err(`«${processNodeLabel(src)}» خروجی «${port}» ندارد`, { edge: e.id, node: src.id });
    const pair = `${e.source}|${port}|${e.target}`;
    if (pairs.has(pair)) err("این اتصال تکراری است", { edge: e.id });
    pairs.add(pair);
    const k = `${e.source}|${port}`;
    portUse.set(k, (portUse.get(k) ?? 0) + 1);
    if (pd && !pd.multi && portUse.get(k) === 2) err(`از خروجی «${pd.label}» فقط یک اتصال می‌رود؛ برای چند مسیر هم‌زمان از «موازی» استفاده کنید`, { node: src.id, edge: e.id });
    if (pd) valid.push(e);
  }

  // ----- the start
  const trigger = triggers.length === 1 ? triggers[0] : null;
  const start = starts.length === 1 ? starts[0] : null;
  if (trigger) {
    const outs = outEdges(graph, trigger.id);
    if (!outs.length) err("پس از «آغاز» باید «ثبت درخواست» بیاید", { node: trigger.id });
    else if (outs.length > 1 || !start || outs[0].target !== start.id) err("«آغاز» فقط به «ثبت درخواست» وصل می‌شود", { node: trigger.id, edge: outs[0].id });
  }
  if (start) {
    const c = start.config ?? {};
    if (c.action !== undefined && c.action !== "fill") err("«ثبت درخواست» مرحلهٔ تکمیل فرم است", { node: start.id, field: "action" });
    for (const e of graph.edges) {
      if (e.target !== start.id || e.source === trigger?.id) continue;
      if ((e.port ?? "out") !== "returned") err("به «ثبت درخواست» فقط از «آغاز» یا با «بازگشت برای اصلاح» می‌رسند", { edge: e.id, node: start.id });
    }
  }

  // ----- structure: forward cycles, «بازگشت», parallel blocks
  const s = structureOf(graph);
  if (!s.order) {
    const c = cycleEdge(graph.nodes, s.forward.filter((e) => byId.has(e.source) && byId.has(e.target)));
    err("این اتصال دور می‌سازد؛ تنها بازگشت مجاز «بازگشت برای اصلاح» از مرحلهٔ بررسی یا تأیید به مرحله‌ای پیشین است", c ? { edge: c.id, node: c.target } : {});
  } else {
    for (const e of valid) {
      const src = byId.get(e.source)!;
      if (src.type !== "form_step" || (e.port ?? "out") !== "returned") continue;
      const dst = byId.get(e.target)!;
      if (!s.reach.has(src.id)) continue;
      if (returnAllowed(graph, s, src.id, dst.id)) continue;
      if (dst.type !== "form_step") err("«بازگشت برای اصلاح» فقط به مرحلهٔ فرمی پیشین می‌رود", { edge: e.id, node: src.id });
      else if (!s.dom.get(src.id)?.has(dst.id)) err("«بازگشت برای اصلاح» فقط به مرحله‌ای پیشین در همین مسیر می‌رود", { edge: e.id, node: src.id });
      else err("«بازگشت برای اصلاح» از مرز «موازی» و «پیوستن» نمی‌گذرد", { edge: e.id, node: src.id });
    }
    for (const id of s.mixed) err("این گام هم از درون و هم از بیرون شاخه‌های موازی در دسترس است؛ شاخه‌ها فقط در «پیوستن» به هم می‌رسند", { node: id });
    for (const [block, members] of s.branches) {
      for (const [id, set] of members) {
        if (set.size < 2) continue;
        const n = byId.get(id)!;
        const closes = n.type === "join" && (s.blocks.get(id) ?? []).at(-1) === block;
        if (!closes) err("شاخه‌های «موازی» پیش از «پیوستن» به هم رسیده‌اند؛ این گام برای هر شاخه یک بار اجرا می‌شود", { node: id });
      }
    }
  }

  // ----- every node: reach, wiring, settings
  const facts: AssigneeFacts = { ...(vctx.assigneeFacts ?? {}) };
  const fieldOf = vctx.fields ? fieldGetter(vctx.fields) : null;
  if (fieldOf && !facts.field) {
    facts.field = (name: string) => {
      const f = fieldOf(name);
      return f ? { label: f.label, type: f.type, ref: f.ref ?? null } : null;
    };
  }
  const stepsOf = new Map<string, FormStep>();
  for (const n of graph.nodes) {
    if (!isProcessNodeType(n.type)) continue;
    const at = (field?: string) => ({ node: n.id, ...(field ? { field } : {}) });
    if (n.type !== "trigger" && trigger && !s.reach.has(n.id)) warn("این گام به مسیر گردش‌کار وصل نیست و اجرا نمی‌شود", at());
    if (s.reach.has(n.id)) {
      for (const p of processPorts(n)) {
        if (!p.optional && !outEdges(graph, n.id, p.key).length) err(`خروجی «${p.label}» به گامی وصل نیست`, at());
      }
    }
    const c = (n.config ?? {}) as Record<string, unknown>;
    switch (n.type) {
      case "form_step": {
        const step = formStepOf(c);
        stepsOf.set(n.id, step);
        if (!(STEP_ACTIONS as readonly string[]).includes(step.action)) err("کار این مرحله معتبر نیست", at("action"));
        if (!step.form) err("فرم این مرحله را انتخاب کنید", at("form"));
        else if (vctx.forms && !vctx.forms(step.form)) err("فرم این مرحله پیدا نشد", at("form"));
        if (step.start) break;
        // the people: an earlier step is one every path to this one passes
        const before = s.dom.get(n.id) ?? new Set<string>();
        const stepFacts: AssigneeFacts = {
          ...facts,
          step: (key: string) => (key !== n.id && before.has(key) && byId.get(key)?.type === "form_step" ? { label: processNodeLabel(byId.get(key)!) } : null),
        };
        for (const p of assigneeProblems(cleanStepAssignees(c), stepFacts)) err(p.message, at(p.path.split(".")[0]));
        for (const w of assigneeWarnings(step, step.action)) warn(w, at("assignees"));
        if (vctx.poolCounts) for (const w of poolWarnings(step, step.action, quorumOf(step), vctx.poolCounts)) warn(w, at("assignees"));
        if (step.action === "approve") {
          // «از این مرحله بگذرد» on an approval: nobody approved it, yet the case goes on by «تأیید شد»
          if (step.ifNobody === "skip") warn("اگر برای این تأیید کسی پیدا نشود، مرحله تأییدشده به شمار می‌آید و پرونده از مسیر «تأیید شد» ادامه می‌یابد", at("ifNobody"));
          if (step.quorum !== undefined && !(QUORUMS as readonly string[]).includes(step.quorum)) err("قاعدهٔ تأیید معتبر نیست", at("quorum"));
          const t = step.threshold;
          if (step.quorum === "count" && !(Number.isInteger(t) && t! >= 1 && t! <= APPROVER_LIMIT)) err(`تعداد تأیید لازم باید عددی میان ۱ و ${faDigits(APPROVER_LIMIT)} باشد`, at("threshold"));
          if (step.quorum === "percent" && !(Number.isFinite(t) && t! > 0 && t! <= 100)) err("درصد تأیید لازم باید میان ۱ و ۱۰۰ باشد", at("threshold"));
        }
        if (step.returnTo !== undefined && !(RETURN_TO as readonly string[]).includes(step.returnTo)) err("مقصد بازگشت معتبر نیست", at("returnTo"));
        if (!isEmpty(c.due) && !step.due) err("مهلت معتبر نیست", at("due"));
        if (!isEmpty(c.remind_every) && !step.remind_every) err("فاصلهٔ یادآوری معتبر نیست", at("remind_every"));
        const raw = Array.isArray(c.escalate) ? c.escalate : [];
        if (raw.length !== (step.escalate?.length ?? 0)) err("یکی از تشدیدهای مهلت معتبر نیست", at("escalate"));
        for (const x of step.escalate ?? []) {
          if (!(ESCALATION_ACTIONS as readonly string[]).includes(x.action)) continue;
          if (x.action === "auto" && (x.outcome === "returned" || !stepOutcomes(step.action).includes(x.outcome))) err("نتیجهٔ خودکار با کار این مرحله نمی‌خواند", at("escalate"));
          if (x.action === "reassign") {
            if (!x.rules.length) err("برای ارجاع پس از مهلت، قاعدهٔ افراد را مشخص کنید", at("escalate"));
            for (const p of assigneeProblems({ assignees: x.rules }, stepFacts)) err(p.message, at("escalate"));
          }
        }
        break;
      }
      case "branch":
        if (c.mode !== "data") err("در گردش‌کار، «شرط» مقدارهای پرونده را مقایسه می‌کند", at("mode"));
        rulesProblems(c.rules, (m) => err(m, at("rules")));
        break;
      case "choice": {
        const cases = choiceCases(c);
        if (!cases.length) err("دست‌کم یک حالت لازم است", at("cases"));
        if (cases.length > MAX_CHOICE_CASES) err(`حداکثر ${faDigits(MAX_CHOICE_CASES)} حالت`, at("cases"));
        const keys = new Set<string>();
        for (const x of cases) {
          if (!CHOICE_KEY.test(x.key) || x.key === "else") err(`کلید حالت «${x.key || "خالی"}» معتبر نیست`, at("cases"));
          else if (keys.has(x.key)) err(`کلید حالت «${x.key}» تکراری است`, at("cases"));
          keys.add(x.key);
          rulesProblems(x.rules, (m) => err(m, at("cases")));
        }
        break;
      }
      case "join":
        if ((c.mode ?? "all") === "any" && c.cancel_rest !== true) err("«پیوستن» با «نخستین شاخه» باید شاخه‌های دیگر را لغو کند", at("cancel_rest"));
        if (s.order && s.reach.has(n.id) && !(s.blocks.get(n.id)?.length)) warn("«پیوستن» بیرون از شاخه‌های موازی است", at());
        break;
      case "parallel":
        if (outEdges(graph, n.id, "out").length < 2) warn("«موازی» دست‌کم دو شاخه لازم دارد", at());
        break;
      case "wait_duration":
        if (c.mode === "until") {
          if (isEmpty(c.until)) err("زمان را وارد کنید", at("until"));
        } else {
          const d = c.duration as { amount?: unknown; unit?: unknown } | undefined;
          if (!d || !(Number(d.amount) > 0) || !["minute", "hour", "day", "week"].includes(String(d.unit ?? ""))) err("مدت انتظار را وارد کنید", at("duration"));
        }
        break;
      case "notify": {
        const to = Array.isArray(c.to) ? c.to : [];
        if (!to.length) err("گیرندگان اعلان را مشخص کنید", at("to"));
        else for (const p of assigneeProblems(cleanStepAssignees({ assignees: to }), facts)) err(p.message, at("to"));
        if (isEmpty(c.subject) && isEmpty(c.body)) err("متن اعلان را وارد کنید", at("body"));
        break;
      }
      case "subflow": {
        const id = typeof c.flow === "string" ? c.flow : "";
        if (!id) err("جریان خودکار این گام را انتخاب کنید", at("flow"));
        else if (vctx.flow) {
          const f = vctx.flow(id);
          if (!f) err("جریان خودکار این گام پیدا نشد", at("flow"));
          else if (!f.published) err(`جریان خودکار «${f.name}» هنوز منتشر نشده است`, at("flow"));
        }
        break;
      }
      case "set_values": {
        const values = isObj(c.values) ? c.values : {};
        if (!Object.keys(values).length) err("دست‌کم یک مقدار را تعیین کنید", at("values"));
        for (const name of Object.keys(values)) {
          if (!LIBRARY_NAME.test(name)) err(`«${name}» فیلد کتابخانه نیست`, at("values"));
          else if (fieldOf && !fieldOf(name)) err(`فیلد «${name}» در فرم‌های این گردش‌کار نیست`, at("values"));
        }
        break;
      }
      case "end":
        if (c.outcome !== undefined && !(END_OUTCOMES as readonly string[]).includes(String(c.outcome))) err("نتیجهٔ پایان معتبر نیست", at("outcome"));
        break;
    }
    // data pills
    if (n.type === "form_step") continue;
    for (const expr of pillsOf(c)) {
      const { root, step } = pillRoot(expr);
      if (!(PROCESS_PILL_ROOTS as readonly string[]).includes(root)) {
        warn(`دادهٔ «${expr}» در گردش‌کار شناخته نیست`, at());
        continue;
      }
      if (root === CASE_ROOT) {
        const key = expr.trim().slice(CASE_ROOT.length + 1).split(".")[0];
        if (!key) warn("نام فیلد پرونده را کامل کنید", at());
        else if (!(CASE_META_KEYS as readonly string[]).includes(key) && fieldOf && !fieldOf(key)) warn(`فیلد «${key}» در فرم‌های این گردش‌کار نیست`, at());
      }
      if (root === "steps") {
        if (!step || !byId.has(step)) err(`گام «${step ?? ""}» در «${expr}» وجود ندارد`, at());
        else if (!reachesBefore(s.forward, step, n.id)) warn(`گام «${processNodeLabel(byId.get(step)!)}» پیش از این گام اجرا نمی‌شود`, at());
      }
    }
  }
  if (graph.nodes.some((n) => n.label && n.label.length > 80)) err("نام گام بیش از ۸۰ نویسه است");

  // ----- what needs the forms: fields on parallel branches, the title, required fields
  if (vctx.forms && vctx.fields) {
    const rights = new Map<string, Record<string, Right>>();
    for (const [id, step] of stepsOf) {
      const form = step.form ? vctx.forms(step.form) : null;
      if (form) rights.set(id, effectiveRights(form.layout, step.rights, vctx.fields, { groups: "all" }));
    }
    const label = (name: string) => fieldOf?.(name)?.label ?? name;
    // a «تکمیل فرم» step (not the start) whose rights let nobody change any field: its people can only send it on
    for (const [id, step] of stepsOf) {
      const r = rights.get(id);
      if (step.start || step.action !== "fill" || !r) continue;
      if (!Object.values(r).some(canEdit)) warn(`در «${processNodeLabel(byId.get(id)!)}» فیلدی برای پر کردن نیست`, { node: id, field: "rights" });
    }
    // a field two parallel branches may both change: the later submission wins
    if (s.order) {
      for (const [block, members] of s.branches) {
        const byField = new Map<string, Set<number>>();
        for (const [id, set] of members) {
          const r = rights.get(id);
          if (!r || set.size !== 1) continue;
          const branch = [...set][0];
          for (const [f, right] of Object.entries(r)) if (canEdit(right)) byField.set(f, new Set([...(byField.get(f) ?? []), branch]));
        }
        for (const [f, set] of byField) if (set.size > 1) warn(`فیلد «${label(f)}» در دو شاخهٔ موازی ویرایش‌پذیر است؛ آخرین ثبت می‌ماند`, { node: block });
      }
    }
    // the title: pills of the start form's fields and the requester; a pill some step hides shows it there anyway
    const pills = titlePills(vctx.titleTemplate);
    if (pills.other.length) err(`الگوی عنوان فقط فیلدهای فرم «ثبت درخواست» و درخواست‌دهنده را می‌پذیرد («${pills.other[0]}»)`, { field: "title_template" });
    const startForm = start ? stepsOf.get(start.id)?.form : null;
    const startLayout = startForm ? vctx.forms(startForm)?.layout : null;
    const startFields = new Set(startLayout ? fieldItems(startLayout).map((i) => i.field) : []);
    for (const key of pills.keys) {
      if ((TITLE_PEOPLE as readonly string[]).includes(key)) continue;
      if (!startFields.has(key)) {
        err(`الگوی عنوان فقط فیلدهای فرم «ثبت درخواست» و درخواست‌دهنده را می‌پذیرد («${label(key)}»)`, { field: "title_template" });
        continue;
      }
      for (const [id, r] of rights) if (r[key] === "hidden") warn(`عنوان پرونده «${label(key)}» را نشان می‌دهد که این مرحله پنهان می‌کند`, { node: id });
    }
    // a field a form requires that no step lets anyone fill
    const editable = new Set<string>();
    for (const r of rights.values()) for (const [f, right] of Object.entries(r)) if (canEdit(right)) editable.add(f);
    const required = new Set<string>();
    for (const step of stepsOf.values()) {
      const form = step.form ? vctx.forms(step.form) : null;
      if (form) for (const item of fieldItems(form.layout)) if (item.required) required.add(item.field);
    }
    for (const f of required) if (!editable.has(f)) warn(`فیلد الزامی «${label(f)}» در هیچ مرحله‌ای ویرایش‌پذیر نیست`);
  }

  // ----- the managers: the demo pack's people manage none of the organisation's own cases
  if (vctx.demoManagers?.names.length) warn(demoManagersWarning(vctx.demoManagers), { field: "managers" });

  const seen = new Set<string>();
  return problems.filter((p) => {
    const k = `${p.level}|${p.node ?? ""}|${p.edge ?? ""}|${p.field ?? ""}|${p.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Does `from` run before `to` on some forward path? */
function reachesBefore(edges: readonly FlowEdge[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to && id !== from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}

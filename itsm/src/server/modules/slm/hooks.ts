// Hooks of service level management:
//   · service_agreement (the portfolio's table, extended): the lifecycle drives the portfolio's `status` (in force →
//     «در جریان», ended → «پایان‌یافته»); a status the portfolio's own expiry job sets moves the lifecycle to
//     «پایان‌یافته»; a person changes the status only through the lifecycle; version on renewal, review dates, the
//     multi-level tree without loops, the readiness guard (targets, provider group of OLAs, supplier of UCs, experience
//     target when the organisation asks for one); generated SLA definitions follow the agreement's force and scope
//   · slm_target: per-kind validation and defaults, the generated SLA definition kept in step (or switched off)
//   · slm_review: dates, the pack built on «ساختن بستهٔ بازبینی», held time, closing only when every proposed action
//     was decided, and an interval review's close records the agreement's last and next review
//   · slm_improvement: the priority score; slm_credit: created only by measuring; slm_xla_policy: weights add up
//   · templates: their timer lines must be able to generate a definition
import { AGREEMENT_IN_FORCE, CUSTOMER_KINDS } from "@shared/tables/slm";
import { addJalaliMonths, improvementScore, inForce, num, parseTiers, stateFromStatus, statusFromState, weightsProblem } from "@shared/slm/logic";
import { tableDef } from "@shared/tables";
import { pushFromBefore, registerHooks, transitionIn, updateIn, validationError, isSystemCtx, type WriteArgs } from "../../engine";
import { bad, conflict } from "../../http/errors";
import type { Row } from "./common";
import { countRows, isUuid, liveRow, liveRows, slmConfig, sysOf, todayOf } from "./common";
import { generationProblem, retireDefinition, syncAgreementDefinitions, syncTargetDefinition } from "./definitions";
import { buildPack } from "./review";
import { packNarrative } from "@shared/slm/logic";
import { enqueue } from "../../jobs";

const A = "service_agreement";

// ---------------------------------------------------------------------------------------------------------------
// Agreements

async function agreementBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (w.op === "create") {
    // an agreement created (or imported) with the portfolio's status starts in the matching lifecycle state
    const from = stateFromStatus(n.status);
    if (from && !w.input?.has("state")) n.state = from;
    n.agreement_version = Number(n.agreement_version ?? 1) || 1;
  } else if (w.changed.has("status") && !w.changed.has("state") && !isSystemCtx(w.ctx) && !w.trusted) {
    throw validationError({ status: "وضعیت اجرای توافق از چرخهٔ عمر آن پیروی می‌کند؛ از دکمه‌های چرخهٔ عمر استفاده کنید" });
  }
  // the portfolio's status follows the lifecycle
  if (w.op === "create" || w.changed.has("state")) n.status = statusFromState(n.state);
  if (n.parent_agreement_id) {
    if (n.parent_agreement_id === n.id) throw validationError({ parent_agreement_id: "توافق نمی‌تواند بالادستی خودش باشد" });
    let p: unknown = n.parent_agreement_id;
    for (let i = 0; isUuid(p) && i < 12; i++) {
      if (p === n.id) throw validationError({ parent_agreement_id: "این توافق بالادستی حلقه می‌سازد" });
      p = (await liveRow(w.tx, sys, A, p))?.parent_agreement_id;
    }
  }
  const cTarget = num(n.compliance_target);
  const rTarget = num(n.at_risk_target);
  if (cTarget !== null && rTarget !== null && rTarget < cTarget) throw validationError({ at_risk_target: "آستانهٔ هشدار باید هم‌اندازه یا بالاتر از هدف انطباق باشد" });
  const today = todayOf(sys);
  const months = Number(n.review_months ?? 3) || 3;
  if (w.changed.has("state")) {
    const from = w.prev?.state;
    // leaving force (expired, withdrawn) is remembered: the sweep closes the last period after it
    if (inForce(String(from ?? "")) && !inForce(n.state)) n.left_force_on = today;
    if (inForce(n.state)) n.left_force_on = null;
    // renewal completed: a new version of the agreement
    if (from === "renewal" && n.state === "active") n.agreement_version = Number(w.prev?.agreement_version ?? 1) + 1;
    // a review completed: the next one is due a cadence later
    if (from === "under_review" && n.state === "active") {
      n.last_review_at = today;
      n.next_review_at = addJalaliMonths(today, months);
    }
  }
  if (inForce(n.state) && !n.next_review_at) {
    const from = typeof n.valid_from === "string" && n.valid_from.slice(0, 10) > today ? n.valid_from.slice(0, 10) : today;
    n.next_review_at = addJalaliMonths(from, months);
  }
  n.review_overdue = inForce(n.state) && !!n.next_review_at && String(n.next_review_at) < today;
}

async function agreementAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete") {
    // targets of a deleted agreement stop timing
    const sys = sysOf(w.ctx);
    for (const t of await liveRows(w.tx, sys, "slm_target", { f: "agreement_id", op: "eq", v: w.prev!.id })) if (t.generated) await retireDefinition(w.tx, w.ctx, t.definition_id);
    return;
  }
  const r = w.row;
  // the portfolio's expiry job (or another trusted writer) set «پایان‌یافته» on an agreement still in force
  if (w.changed.has("status") && !w.changed.has("state") && r.status === "expired" && inForce(r.state)) {
    await transitionIn(w.tx, sysOf(w.ctx), A, String(r.id), "expired", {}, { trusted: true });
    return;
  }
  const scopeChanged = ["state", "kind", "service_id", "customer_unit_id", "provider_group_id", "calendar_id", "name"].some((f) => w.changed.has(f));
  if (w.op !== "create" && scopeChanged) await syncAgreementDefinitions(w.tx, w.ctx, String(r.id));
  if (w.op === "create" || w.changed.has("state")) await enqueue(w.tx, { kind: "slm.measure", orgId: w.ctx.org.id, payload: { id: r.id }, delayMs: 5_000, dedupeKey: `slm.measure:${r.id}`, maxAttempts: 5 });
}

/** «ارسال برای تأیید» and «آغاز اجرا» need a measurable agreement (SLM-004). */
async function agreementReady(w: WriteArgs): Promise<string | null> {
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (!isUuid(n.service_id)) return "توافق باید به خدمتی از کاتالوگ وصل باشد";
  if (!n.valid_from) return "تاریخ آغاز اعتبار توافق را بنویسید";
  if ((n.kind === "ola" || n.kind === "collaboration") && !isUuid(n.provider_group_id)) return "برای توافق سطح عملیات، گروه ارائه‌دهنده را مشخص کنید";
  if (n.kind === "uc" && !String(n.supplier_name ?? "").trim()) return "برای قرارداد پشتیبان، تأمین‌کننده را بنویسید";
  const targets = await liveRows(w.tx, sys, "slm_target", { and: [{ f: "agreement_id", op: "eq", v: n.id }, { f: "active", op: "eq", v: true }] });
  if (!targets.length) return "توافق دست‌کم یک هدف فعال قابل‌سنجش لازم دارد";
  const broken = targets.find((t) => t.kind === "timer" && !isUuid(t.definition_id));
  if (broken) return `هدف «${broken.name}» زمان‌سنجی ندارد؛ تعریف را برگزینید یا ساعت‌ها را بنویسید`;
  const cfg = await slmConfig(w.tx, sys);
  if (cfg.require_experience_target && CUSTOMER_KINDS.includes(String(n.kind)) && !targets.some((t) => t.kind === "experience" || t.kind === "satisfaction")) {
    return "سازمان برای توافق‌های مشتری هدف تجربه یا رضایت را لازم دانسته است";
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Targets

async function targetBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  const a = await liveRow(w.tx, sys, A, n.agreement_id);
  if (!a) throw validationError({ agreement_id: "توافق پیدا نشد" });
  if (w.op === "create" && ["expired", "withdrawn", "rejected"].includes(String(a.state))) throw conflict("به توافق پایان‌یافته یا ردشده هدف تازه افزوده نمی‌شود");
  if (w.op === "create" && !w.input?.has("customer_facing")) n.customer_facing = CUSTOMER_KINDS.includes(String(a.kind));
  if (n.kind === "timer") {
    // a person who picks another definition links it; hours on a generated (or empty) target generate one
    if (w.changed.has("definition_id") && w.input?.has("definition_id") && isUuid(n.definition_id)) n.generated = false;
    if (w.changed.has("definition_id") && !isUuid(n.definition_id)) n.generated = false;
    const linked = isUuid(n.definition_id) && !n.generated;
    if (!linked) {
      const problem = generationProblem(n);
      if (problem) throw validationError({ definition_id: problem });
      const patch = await syncTargetDefinition(w.tx, w.ctx, n, a);
      if (patch) Object.assign(n, patch);
    } else if (!(await liveRow(w.tx, sys, "sla_definition", n.definition_id))) throw validationError({ definition_id: "تعریف زمان‌سنج پیدا نشد" });
  } else if (w.prev?.kind === "timer" && w.prev.generated) {
    await retireDefinition(w.tx, w.ctx, w.prev.definition_id);
    n.definition_id = null;
    n.generated = false;
  }
  if (n.kind === "availability" && num(n.goal) === null) n.goal = "99.5";
  if (n.kind === "indicator" && !isUuid(n.indicator_id)) throw validationError({ indicator_id: "شاخص را برگزینید" });
  if ((n.kind === "experience" || n.kind === "satisfaction") && num(n.goal) === null) n.goal = n.kind === "experience" ? "75" : "85";
  const goal = num(n.goal);
  const risk = num(n.at_risk);
  if (goal !== null && risk !== null && risk < goal) throw validationError({ at_risk: "آستانهٔ هشدار باید هم‌اندازه یا بالاتر از هدف باشد" });
  if (n.credit_tiers !== null && n.credit_tiers !== undefined && n.credit_tiers !== "") {
    if (!Array.isArray(n.credit_tiers)) throw validationError({ credit_tiers: "پله‌های جریمه باید فهرستی مانند [{\"below\": 95, \"pct\": 5}] باشد" });
    const tiers = parseTiers(n.credit_tiers);
    if (tiers.length !== n.credit_tiers.length || tiers.some((t) => t.pct > 100)) throw validationError({ credit_tiers: "هر پله «below» (درصد) و «pct» (۰ تا ۱۰۰) لازم دارد" });
  }
}

async function targetAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const r = w.op === "delete" ? w.prev! : w.row;
  if (w.op === "delete" && r.generated) await retireDefinition(w.tx, w.ctx, r.definition_id);
  if (w.op === "update" && w.changed.has("active") && r.generated) {
    const a = await liveRow(w.tx, sysOf(w.ctx), A, r.agreement_id);
    if (a) await syncAgreementDefinitions(w.tx, w.ctx, String(a.id));
  }
  if (isUuid(r.agreement_id) && !(w.op === "update" && [...w.changed].every((f) => ["current_value", "current_status", "current_n", "measured_at"].includes(f)))) {
    await enqueue(w.tx, { kind: "slm.measure", orgId: w.ctx.org.id, payload: { id: r.agreement_id }, delayMs: 5_000, dedupeKey: `slm.measure:${r.agreement_id}`, maxAttempts: 5 });
  }
}

function templateTargetBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const n = w.next;
  if (n.kind === "timer") {
    const problem = generationProblem(n);
    if (problem) throw validationError({ table_key: problem });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reviews

async function reviewBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (n.period_from && n.period_to && String(n.period_to) < String(n.period_from)) throw validationError({ period_to: "پایان دوره نمی‌تواند پیش از آغاز آن باشد" });
  if (isUuid(n.agreement_id) && !isUuid(n.service_id)) {
    const a = await liveRow(w.tx, sysOf(w.ctx), A, n.agreement_id);
    if (a) n.service_id = a.service_id ?? null;
  }
  if (w.changed.has("state") && n.state === "held" && !n.held_at) n.held_at = new Date().toISOString();
}

async function reviewAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete" || !w.changed.has("state")) return;
  const r = w.row;
  const sys = sysOf(w.ctx);
  if (r.state === "prepared") {
    // the pack: numbers code computed for the review's period (the narrative starts from them)
    const pack = await buildPack(w.tx, w.ctx, r);
    await updateIn(w.tx, sys, "slm_review", r.id, { pack, pack_at: pack.generated_at, ...(String(r.narrative ?? "").trim() ? {} : { narrative: packNarrative(pack), narrative_ai: false }) }, { trusted: true });
  }
  if (r.state === "closed" && r.kind === "interval" && isUuid(r.agreement_id)) {
    const a = await liveRow(w.tx, sys, A, r.agreement_id);
    if (a) {
      const held = String(r.held_at ?? new Date().toISOString()).slice(0, 10);
      if (a.state === "under_review") await transitionIn(w.tx, sys, A, String(a.id), "active", {}, { trusted: true });
      await updateIn(w.tx, sys, A, a.id, { last_review_at: held, next_review_at: addJalaliMonths(held, Number(a.review_months ?? 3) || 3), review_overdue: false }, { trusted: true, allowLocked: true });
    }
  }
}

async function reviewPackGuard(w: WriteArgs): Promise<string | null> {
  if (!isUuid(w.next.agreement_id) && !isUuid(w.next.service_id)) return "بازبینی باید توافق یا خدمتی داشته باشد تا بسته‌اش ساخته شود";
  return null;
}

async function reviewClosable(w: WriteArgs): Promise<string | null> {
  const open = await countRows(w.tx, sysOf(w.ctx), "slm_improvement", { and: [{ f: "review_id", op: "eq", v: w.next.id }, { f: "state", op: "eq", v: "proposed" }] });
  return open ? "اقدام‌های پیشنهادی این بازبینی را پیش از بستن تأیید یا رد کنید" : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Improvements, credits, XLA policies

async function improvementBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  n.score = improvementScore(n.value, n.effort);
  const sys = sysOf(w.ctx);
  if (isUuid(n.review_id) && w.changed.has("review_id")) {
    const r = await liveRow(w.tx, sys, "slm_review", n.review_id);
    if (r) {
      if (!isUuid(n.agreement_id)) n.agreement_id = r.agreement_id ?? null;
      if (!isUuid(n.service_id)) n.service_id = r.service_id ?? null;
      if (w.op === "create" && !w.input?.has("source")) n.source = "review";
    }
  }
  if (isUuid(n.agreement_id) && !isUuid(n.service_id)) n.service_id = (await liveRow(w.tx, sys, A, n.agreement_id))?.service_id ?? null;
}

function creditBefore(w: WriteArgs): void {
  if (w.op === "create" && !isSystemCtx(w.ctx) && !w.trusted) throw bad("جریمه‌های خدمت از سنجش دوره‌های بسته ساخته می‌شوند");
}

async function creditManager(w: WriteArgs): Promise<void> {
  if (w.op !== "create") return;
  const a = await liveRow(w.tx, sysOf(w.ctx), A, w.next.agreement_id);
  if (a) w.next.manager_id = a.manager_id ?? null;
}

function xlaPolicyBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const problem = weightsProblem(w.next);
  if (problem) throw validationError({ w_effort: problem });
  const def = tableDef(String(w.next.table_key ?? ""));
  if (!def || def.virtual) throw validationError({ table_key: `جدول «${w.next.table_key ?? ""}» شناخته نیست` });
}

/** A credit: its derived values, then the manager rule. */
const creditHook = async (w: WriteArgs): Promise<void> => {
  creditBefore(w);
  await creditManager(w);
};

async function xlaScoreAnchors(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const def = tableDef(String(w.next.table_key ?? ""));
  const rec = def && !def.virtual && isUuid(w.next.record_id) ? await liveRow(w.tx, sysOf(w.ctx), def.key, w.next.record_id) : null;
  w.next.domain_id = isUuid(rec?.domain_id) ? rec!.domain_id : null;
  w.next.unit_id = isUuid(rec?.unit_id) ? rec!.unit_id : null;
}

export function installSlmHooks(): (() => void)[] {
  return [
    registerHooks(A, { beforeWrite: agreementBefore, ...pushFromBefore(agreementBefore), afterWrite: agreementAfter, guards: { agreement_ready: agreementReady } }),
    registerHooks("slm_target", { beforeWrite: targetBefore, ...pushFromBefore(targetBefore), afterWrite: targetAfter }),
    registerHooks("slm_template_target", { beforeWrite: templateTargetBefore, ...pushFromBefore(templateTargetBefore) }),
    registerHooks("slm_review", { beforeWrite: reviewBefore, ...pushFromBefore(reviewBefore), afterWrite: reviewAfter, guards: { review_pack: reviewPackGuard, review_closable: reviewClosable } }),
    registerHooks("slm_improvement", { beforeWrite: improvementBefore, ...pushFromBefore(improvementBefore) }),
    registerHooks("slm_credit", { beforeWrite: creditHook, ...pushFromBefore(creditHook) }),
    registerHooks("slm_xla_policy", { beforeWrite: xlaPolicyBefore, ...pushFromBefore(xlaPolicyBefore) }),
    // a score lives where its record lives: the record's domain and unit anchor it (with domain separation, readers of
    // another domain never see it); the workspace is copied by the scoring
    registerHooks("slm_xla_score", { beforeWrite: xlaScoreAnchors }),
  ];
}

export { AGREEMENT_IN_FORCE };

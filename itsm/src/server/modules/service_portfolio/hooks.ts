// Hooks of the service portfolio (same transaction as the write):
//   service            its CI (class business_service / technical_service) is created with it and kept in step — name,
//                      owner, support group, criticality from the tier, lifecycle; stamps of approval, going live and
//                      retirement; «زنده» needs an owner, a description and an active offering; «کنارگذاشتن» is refused
//                      while live services still depend on it; retiring it retires its offerings
//   service_offering   its CI (class offering) under the service's CI («دارای گزینهٔ»), the service owner's anchor copy,
//                      activated only for an approved service
//   service_commitment its readable label, revision, and the SLA definition it generates for incidents of the offering
//   service_instance, service_subscription, service_agreement: copies, labels and consistency
//   portfolio_node, business_capability: paths, depth and no loops
//   service_proposal   its score; chartering creates the service (or deprecates the one it retires)
//   service_design_package its readiness; app_assessment writes the TIME decision onto the application's CI
import { SERVICE_CI_CLASS, COMMITMENT_KINDS } from "@shared/tables/service_portfolio";
import { proposalScore, readinessPct } from "@shared/service_portfolio/logic";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { lockKey, type Tx } from "../../db";
import { conflict, forbidden } from "../../http/errors";
import { createIn, onBeforeCommit, registerHooks, transitionIn, updateIn, validationError, type WriteArgs } from "../../engine";
import { countRows, liveRow, liveRows, lockedRow, isUuid, sysOf, type Row } from "../cmdb/common";
import { servicesImpactedBy } from "../cmdb/impact";
import { notifyLifecycle } from "./status";
import { isPortfolioManager } from "./common";

const TIER_CRITICALITY: Record<string, string> = { tier_1: "1", tier_2: "2", tier_3: "3", tier_4: "4" };

/** The CI lifecycle state that matches a service or offering state. */
export const CI_STATE_OF: Record<string, string> = {
  proposed: "planned", approved: "planned", design: "build", transition: "test", live: "operational", deprecated: "end_of_life", retired: "retired", rejected: "canceled",
  draft: "planned", active: "operational",
};

/** Move a CI towards `to` through the CI state model (only transitions that exist; nothing when there is none). */
async function moveCi(tx: Tx, sys: Ctx, ciId: string, to: string): Promise<void> {
  const ci = await liveRow(tx, sys, "ci", ciId);
  if (!ci || ci.state === to) return;
  const model = tableDef("ci")!.states!;
  const direct = model.transitions.find((t) => t.to === to && (t.from === "*" || t.from.includes(ci.state)));
  if (direct) {
    await transitionIn(tx, sys, "ci", ciId, to, {}, { trusted: true }).catch(() => undefined);
    return;
  }
  // one step through «در حال ساخت» when the model has no direct way (planned → test)
  if (to === "test" && ci.state === "planned") {
    await transitionIn(tx, sys, "ci", ciId, "build", {}, { trusted: true }).catch(() => undefined);
    await transitionIn(tx, sys, "ci", ciId, "test", {}, { trusted: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Services

async function serviceBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (n.tier && !n.criticality) n.criticality = TIER_CRITICALITY[n.tier] ?? null;
  if (w.op === "transition") {
    const to = w.transition?.to;
    const now = new Date().toISOString();
    if (to === "approved") n.approved_at = now;
    if (to === "live" && !n.live_at) n.live_at = now;
    if (to === "retired") n.retired_at = now;
  }
  // the service's CI (graph, impact, maps)
  const cls = SERVICE_CI_CLASS[String(n.service_type ?? "business")] ?? "business_service";
  if (!n.ci_id) {
    const ci = await createIn(w.tx, sys, "ci", {
      name: n.name, class: cls, description: n.description ?? null, owned_by: n.owner_id ?? null, support_group_id: n.support_group_id ?? null,
      criticality: n.criticality ?? null, tier: n.tier ?? null, state: CI_STATE_OF[String(n.state)] ?? "planned",
    }, { trusted: true });
    n.ci_id = ci.id;
  }
}

async function serviceAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const sys = sysOf(w.ctx);
  const r = w.op === "delete" ? w.prev! : w.row;
  if (!isUuid(r.ci_id)) return;
  if (w.op === "delete") {
    await moveCi(w.tx, sys, r.ci_id, "retired");
    return;
  }
  if (w.op !== "create") {
    const patch: Row = {};
    if (w.changed.has("name")) patch.name = r.name;
    if (w.changed.has("owner_id")) patch.owned_by = r.owner_id ?? null;
    if (w.changed.has("support_group_id")) patch.support_group_id = r.support_group_id ?? null;
    if (w.changed.has("criticality")) patch.criticality = r.criticality ?? null;
    if (w.changed.has("tier")) patch.tier = r.tier ?? null;
    if (w.changed.has("description")) patch.description = r.description ?? null;
    if (w.changed.has("service_type")) patch.class = SERVICE_CI_CLASS[String(r.service_type)] ?? "business_service";
    if (Object.keys(patch).length) await updateIn(w.tx, sys, "ci", r.ci_id, patch, { trusted: true, allowLocked: true });
    if (w.changed.has("owner_id")) ownersInStep(w.tx, w.ctx, String(r.id));
  }
  if (w.changed.has("state")) {
    await moveCi(w.tx, sys, r.ci_id, CI_STATE_OF[String(r.state)] ?? "planned");
    if (r.state === "deprecated" || r.state === "retired") await notifyLifecycle(w.tx, sys, r, r.state);
    if (r.state === "retired") {
      for (const o of await liveRows(w.tx, sys, "service_offering", { and: [{ f: "service_id", op: "eq", v: r.id }, { f: "state", op: "ne", v: "retired" }] }, { limit: 500 })) {
        await transitionIn(w.tx, sys, "service_offering", o.id, "retired", {}, { trusted: true }).catch(() => undefined);
      }
    }
  }
}

async function canGoLive(w: WriteArgs): Promise<string | null> {
  const missing: string[] = [];
  if (!w.next.owner_id) missing.push("مالک خدمت");
  if (!String(w.next.description ?? "").trim()) missing.push("شرح به زبان مشتری");
  const offerings = await countRows(w.tx, sysOf(w.ctx), "service_offering", { and: [{ f: "service_id", op: "eq", v: w.next.id }, { f: "state", op: "eq", v: "active" }] });
  if (!offerings) missing.push("دست‌کم یک گزینهٔ فعال");
  return missing.length ? `برای زنده شدن خدمت لازم است: ${missing.join("، ")}` : null;
}

async function canRetire(w: WriteArgs): Promise<string | null> {
  if (!isUuid(w.next.ci_id)) return null;
  const dependents = (await servicesImpactedBy(w.tx, sysOf(w.ctx), [w.next.ci_id])).filter((id) => id !== w.next.id);
  if (!dependents.length) return null;
  const live = await liveRows(w.tx, sysOf(w.ctx), "service", { and: [{ f: "id", op: "in", v: dependents }, { f: "state", op: "in", v: ["live", "deprecated"] }] }, { limit: 5 });
  return live.length ? `خدمت‌های زندهٔ «${live.map((s) => s.name).join("»، «")}» هنوز به این خدمت وابسته‌اند` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Offerings

/**
 * The owner copies of a service's offerings and instances, put in step at commit under the service's key — queued by
 * a change of the service's owner and by a new (or moved) offering or instance: whichever commits second re-reads the
 * service and its rows after the other, so a row made while the owner changes never keeps the old owner.
 */
function ownersInStep(tx: Tx, ctx: Ctx, serviceId: string): void {
  if (!isUuid(serviceId)) return;
  onBeforeCommit(tx, `service.owner:${serviceId}`, async () => {
    const sys = sysOf(ctx);
    const service = await liveRow(tx, sys, "service", serviceId);
    if (!service) return;
    for (const t of ["service_offering", "service_instance"]) {
      for (const x of await liveRows(tx, sys, t, { f: "service_id", op: "eq", v: serviceId }, { limit: 1000 })) {
        if ((x.owner_id ?? null) !== (service.owner_id ?? null)) await updateIn(tx, sys, t, x.id, {}, { trusted: true, keepVersion: true });
      }
    }
  });
}

async function offeringBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  const service = await liveRow(w.tx, sys, "service", n.service_id);
  if (!service) throw validationError({ service_id: "خدمت پیدا نشد" });
  n.owner_id = service.owner_id ?? null;
  if (w.op === "create" || w.changed.has("service_id")) ownersInStep(w.tx, w.ctx, String(n.service_id));
  if (!n.ci_id) {
    const ci = await createIn(w.tx, sys, "ci", {
      name: `${service.name} — ${n.name}`.slice(0, 200), class: "offering", owned_by: service.owner_id ?? null, support_group_id: n.support_group_id ?? service.support_group_id ?? null,
      criticality: service.criticality ?? null, tier: service.tier ?? null, state: CI_STATE_OF[String(n.state)] ?? "planned", description: n.description ?? null,
    }, { trusted: true });
    n.ci_id = ci.id;
    if (isUuid(service.ci_id)) await createIn(w.tx, sys, "ci_rel", { parent_id: service.ci_id, child_id: ci.id, type: "has_offering", origin_kind: "service" }, { trusted: true });
  }
}

async function offeringAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const sys = sysOf(w.ctx);
  const r = w.op === "delete" ? w.prev! : w.row;
  if (!isUuid(r.ci_id)) return;
  if (w.op === "delete") return moveCi(w.tx, sys, r.ci_id, "retired");
  if (w.op !== "create" && (w.changed.has("name") || w.changed.has("support_group_id"))) {
    const service = await liveRow(w.tx, sys, "service", r.service_id);
    await updateIn(w.tx, sys, "ci", r.ci_id, { name: `${service?.name ?? ""} — ${r.name}`.slice(0, 200), support_group_id: r.support_group_id ?? service?.support_group_id ?? null }, { trusted: true, allowLocked: true });
  }
  if (w.changed.has("state")) await moveCi(w.tx, sys, r.ci_id, CI_STATE_OF[String(r.state)] ?? "planned");
}

async function offeringCanActivate(w: WriteArgs): Promise<string | null> {
  const service = await liveRow(w.tx, sysOf(w.ctx), "service", w.next.service_id);
  if (!service || ["proposed", "rejected", "retired"].includes(service.state)) return "گزینه فقط برای خدمت تأییدشده فعال می‌شود";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Commitments → SLA definitions (SPF-005)

const H = 3600;

async function commitmentBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  const offering = await liveRow(w.tx, sys, "service_offering", n.offering_id);
  if (!offering) throw validationError({ offering_id: "گزینهٔ خدمت پیدا نشد" });
  const target = Number(n.target);
  if (!Number.isFinite(target) || target <= 0) throw validationError({ target: "هدف باید عددی بزرگ‌تر از صفر باشد" });
  if (n.kind === "availability" && target > 100) throw validationError({ target: "دسترس‌پذیری درصد است (حداکثر ۱۰۰)" });
  if ((n.kind === "response" || n.kind === "resolution") && !n.priority) throw validationError({ priority: "برای زمان پاسخ یا حل، اولویت را مشخص کنید" });
  n.owner_id = offering.owner_id ?? null;
  if (w.prev && (w.changed.has("target") || w.changed.has("priority") || w.changed.has("calendar_id") || w.changed.has("kind"))) n.revision = Number(w.prev.revision ?? 1) + 1;
  const kind = COMMITMENT_KINDS.find((k) => k.value === n.kind)?.label ?? n.kind;
  const unit = n.kind === "availability" ? "٪" : n.kind === "support_hours" ? " ساعت در هفته" : " ساعت";
  n.label = `${kind} ${target}${unit}${n.priority ? ` — اولویت ${n.priority}` : ""} — ${offering.name}`.slice(0, 300);
  // the SLA definition of incidents on this offering (response / resolution)
  if (n.kind === "response" || n.kind === "resolution") {
    const def = commitmentSla(n, offering, target);
    const wanted = n.generate_sla !== false && n.active !== false;
    const existing = isUuid(n.sla_definition_id) ? await liveRow(w.tx, sys, "sla_definition", n.sla_definition_id) : null;
    if (existing) await updateIn(w.tx, sys, "sla_definition", existing.id, { ...def, active: wanted }, { trusted: true });
    else if (wanted) n.sla_definition_id = (await createIn(w.tx, sys, "sla_definition", def, { trusted: true })).id;
  }
}

function commitmentSla(n: Row, offering: Row, target: number): Row {
  const p = String(n.priority);
  const mine = { and: [{ f: "offering_id", op: "eq", v: offering.id }, { f: "priority", op: "eq", v: p }] };
  const canceled = { or: [{ f: "state", op: "eq", v: "canceled" }, { f: "offering_id", op: "ne", v: offering.id }, { f: "priority", op: "ne", v: p }] };
  const base = {
    table_key: "incident", type: "sla", duration_mode: "priority", priority_field: "priority", retroactive: true, retroactive_field: "opened_at", warn_percents: [50, 75, 90],
    name: `تعهد «${offering.name}» — ${n.kind === "response" ? "پاسخ" : "حل"} اولویت ${p}`.slice(0, 160),
    target: n.kind, calendar_id: n.calendar_id ?? offering.calendar_id ?? null, durations: { [p]: Math.round(target * H) }, sort_order: 200,
    description: `ساخته‌شده از تعهد گزینهٔ «${offering.name}» (ویرایش ${n.revision ?? 1})`,
  };
  if (n.kind === "response") return { ...base, start_condition: { and: [mine, { f: "state", op: "eq", v: "new" }] }, stop_condition: { or: [{ f: "state", op: "nin", v: ["new"] }, { f: "first_response_at", op: "nempty" }] }, cancel_condition: canceled };
  return { ...base, start_condition: mine, stop_condition: { f: "state", op: "in", v: ["resolved", "closed"] }, cancel_condition: canceled, reset_condition: { f: "reopen_count", op: "changed" } };
}

async function commitmentAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op !== "delete") return;
  const id = w.prev?.sla_definition_id;
  if (isUuid(id)) {
    const sys = sysOf(w.ctx);
    if (await liveRow(w.tx, sys, "sla_definition", id)) await updateIn(w.tx, sys, "sla_definition", id, { active: false }, { trusted: true });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Instances, subscriptions, agreements

async function ownerCopy(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const service = await liveRow(w.tx, sysOf(w.ctx), "service", w.next.service_id);
  if (!service) throw validationError({ service_id: "خدمت پیدا نشد" });
  w.next.owner_id = service.owner_id ?? null;
  if (w.op === "create" || w.changed.has("service_id")) ownersInStep(w.tx, w.ctx, String(w.next.service_id));
}

async function nameOf(tx: Tx, ctx: Ctx, table: string, id: unknown): Promise<string> {
  if (!isUuid(id)) return "";
  if (table === "user") {
    const r = await tx.one<{ full_name: string }>(`select u.full_name from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.user_id = $2 and m.deleted_at is null`, [ctx.org.id, id]);
    return r?.full_name ?? "";
  }
  return String((await liveRow(tx, sysOf(ctx), table, id))?.name ?? "");
}

const SUBSCRIBER_FIELD: Record<string, [string, string]> = { user: ["user_id", "user"], group: ["group_id", "group"], unit: ["org_unit_id", "org_unit"], location: ["location_id", "location"] };

async function subscriptionBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (n.offering_id) {
    const o = await liveRow(w.tx, sys, "service_offering", n.offering_id);
    if (!o) throw validationError({ offering_id: "گزینه پیدا نشد" });
    if (!n.service_id) n.service_id = o.service_id;
    if (o.service_id !== n.service_id) throw validationError({ offering_id: "این گزینه از خدمت انتخاب‌شده نیست" });
  }
  const service = await liveRow(w.tx, sys, "service", n.service_id);
  if (!service) throw validationError({ service_id: "خدمت پیدا نشد" });
  if (w.op === "create" && ["deprecated", "retired", "rejected"].includes(service.state)) throw validationError({ service_id: "این خدمت مشترک تازه نمی‌پذیرد" });
  const [field, table] = SUBSCRIBER_FIELD[String(n.subscriber_kind)] ?? SUBSCRIBER_FIELD.user;
  if (!n[field]) throw validationError({ [field]: "مشترک را مشخص کنید" });
  for (const [f] of Object.values(SUBSCRIBER_FIELD)) if (f !== field) n[f] = null;
  if (n.valid_from && n.valid_to && n.valid_to < n.valid_from) throw validationError({ valid_to: "«تا» نمی‌تواند پیش از «از» باشد" });
  const offering = n.offering_id ? await liveRow(w.tx, sys, "service_offering", n.offering_id) : null;
  n.label = `${await nameOf(w.tx, w.ctx, table, n[field])} ← ${service.name}${offering ? ` — ${offering.name}` : ""}`.slice(0, 300);
}

async function agreementBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (n.valid_from && n.valid_to && n.valid_to < n.valid_from) throw validationError({ valid_to: "«تا» نمی‌تواند پیش از «از» باشد" });
  const offerings: string[] = (n.offerings ?? []).filter(isUuid);
  if (offerings.length) {
    const rows = await liveRows(w.tx, sysOf(w.ctx), "service_offering", { f: "id", op: "in", v: offerings });
    if (rows.some((o) => o.service_id !== n.service_id)) throw validationError({ offerings: "گزینه‌ها باید از همین خدمت باشند" });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Trees

function treeBefore(table: string, maxDepth: number, levelField: string) {
  return async (w: WriteArgs): Promise<void> => {
    const sys = sysOf(w.ctx);
    if (w.op === "delete") {
      const kids = await countRows(w.tx, sys, table, { f: "parent_id", op: "eq", v: w.prev!.id });
      if (kids) throw conflict("این شاخه زیرشاخه دارد؛ ابتدا آن‌ها را جابه‌جا کنید");
      return;
    }
    const n = w.next;
    // re-parenting takes the tree's key: two crossing moves (A under B, B under A) at once never make a loop
    if (w.op !== "create" && w.changed.has("parent_id")) await lockKey(w.tx, `${table}.tree:${w.ctx.org.id}`);
    const chain: string[] = [];
    for (let p = n.parent_id, i = 0; isUuid(p) && i < 20; i++) {
      if (p === n.id) throw validationError({ parent_id: "این والد حلقه می‌سازد" });
      chain.unshift(p);
      p = (await liveRow(w.tx, sys, table, p))?.parent_id ?? null;
    }
    if (chain.length + 1 > maxDepth) throw validationError({ parent_id: `حداکثر ${maxDepth} سطح` });
    n[levelField] = chain.length + 1;
    if (table === "portfolio_node") n.path = `/${[...chain, n.id].join("/")}/`;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Proposals, design packages, assessments

async function proposalBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  n.score = proposalScore(Number(n.value_score) || null, Number(n.fit_score) || null, Number(n.risk_score) || null);
  if ((n.kind === "change" || n.kind === "retire") && !n.service_id) throw validationError({ service_id: "خدمت مورد نظر را مشخص کنید" });
}

async function proposalCanCharter(w: WriteArgs): Promise<string | null> {
  if (w.next.kind === "retire") {
    const s = await liveRow(w.tx, sysOf(w.ctx), "service", w.next.service_id);
    if (!s || s.state !== "live") return "فقط خدمت زنده رو به کنارگذاری می‌رود";
  }
  return null;
}

async function proposalAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (!(w.op === "transition" && w.transition?.to === "chartered")) return;
  const r = w.row;
  const sys = sysOf(w.ctx, w.ctx.actor === "system" ? null : w.ctx.user.id);
  if (r.kind === "new") {
    const s = await createIn(w.tx, sys, "service", {
      name: r.name, service_type: r.service_type ?? "business", portfolio_node_id: r.portfolio_node_id ?? null, owner_id: r.proposer_id ?? null,
      description: r.business_need ?? null, value_proposition: r.expected_benefits ?? null, state: "approved",
    }, { trusted: true });
    await updateIn(w.tx, sysOf(w.ctx), "service_proposal", r.id, { chartered_service_id: s.id }, { trusted: true, allowLocked: true });
  } else if (r.kind === "retire" && isUuid(r.service_id)) {
    await transitionIn(w.tx, sys, "service", r.service_id, "deprecated", { retire_reason: r.decision_notes || `پیشنهاد ${r.number ?? ""}` }, { trusted: true });
  }
}

async function designBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  w.next.readiness_pct = String(readinessPct(w.next.readiness));
}

const designReady = (w: WriteArgs) => (readinessPct(w.next.readiness) >= 100 ? null : "همهٔ موارد فهرست آمادگی عملیاتی باید انجام شده باشند");

async function assessmentAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (!(w.op === "transition" && w.transition?.to === "completed") || !isUuid(w.row.ci_id)) return;
  const sys = sysOf(w.ctx);
  // locked and read again: attributes an import or a person wrote meanwhile are kept, only the disposition is added
  const ci = await lockedRow(w.tx, sys, "ci", w.row.ci_id);
  if (!ci) return;
  await updateIn(w.tx, sys, "ci", ci.id, { attrs: { ...(ci.attrs ?? {}), time_disposition: w.row.time_disposition } }, { trusted: true, allowLocked: true });
}

async function adminWrite(w: WriteArgs): Promise<void> {
  // service owners own their services: a service owner may not hand a service to someone else's group without write
  // access there (the provider judged the row; this keeps an owner from moving a service out of their own reach)
  if (w.op !== "update" || w.ctx.actor === "system" || w.trusted) return;
  if (w.changed.has("owner_id") && w.prev?.owner_id === w.ctx.user.id && w.next.owner_id !== w.ctx.user.id && !w.next.owner_group_id) {
    throw forbidden("پیش از واگذاری خدمت، تیم مالک را مشخص کنید");
  }
  // the owner and the product owner read every record linked to the service (roles.ts): naming oneself is taking a
  // role, which only portfolio managers do (ACCESS invariant 6)
  const me = w.ctx.user.id;
  const self = (["owner_id", "product_owner_id"] as const).filter((f) => w.changed.has(f) && w.next[f] === me);
  const holds = w.prev?.owner_id === me || w.prev?.product_owner_id === me;
  if (self.length && !holds && !(await isPortfolioManager(w.ctx, w.tx))) {
    throw forbidden(self.includes("owner_id") ? "خودتان را مالک این خدمت نمی‌توانید بگذارید؛ این کار با مدیر سبد خدمات است" : "خودتان را مالک محصول این خدمت نمی‌توانید بگذارید؛ این کار با مدیر سبد خدمات است");
  }
}

export function installPortfolioHooks(): (() => void)[] {
  return [
    registerHooks("service", { beforeWrite: async (w) => { await adminWrite(w); await serviceBefore(w); }, afterWrite: serviceAfter, guards: { service_can_go_live: canGoLive, service_can_retire: canRetire } }),
    registerHooks("service_offering", { beforeWrite: offeringBefore, afterWrite: offeringAfter, guards: { offering_can_activate: offeringCanActivate } }),
    registerHooks("service_commitment", { beforeWrite: commitmentBefore, afterWrite: commitmentAfter }),
    registerHooks("service_instance", { beforeWrite: ownerCopy }),
    registerHooks("service_subscription", { beforeWrite: subscriptionBefore }),
    registerHooks("service_agreement", { beforeWrite: agreementBefore }),
    registerHooks("portfolio_node", { beforeWrite: treeBefore("portfolio_node", 6, "depth") }),
    registerHooks("business_capability", { beforeWrite: treeBefore("business_capability", 3, "level") }),
    registerHooks("service_proposal", { beforeWrite: proposalBefore, afterWrite: proposalAfter, guards: { proposal_can_charter: proposalCanCharter } }),
    registerHooks("service_design_package", { beforeWrite: designBefore, guards: { design_ready: designReady } }),
    registerHooks("app_assessment", { afterWrite: assessmentAfter }),
  ];
}

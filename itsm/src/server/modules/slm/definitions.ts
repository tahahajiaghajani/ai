// Targets → the SLA service's timers (SLM-005/019/020): a timer target either links an existing `sla_definition` or
// carries hours per priority, from which the module generates one definition and keeps it in step — the agreement's
// kind decides the timer type (SLA / OLA / UC), its service and customer unit scope the timers of customer agreements,
// its provider group starts and stops the clocks of OLAs and underpinning contracts (assigned to the group → running;
// reassigned away or resolved → stopped), and the agreement's lifecycle switches them on and off (only agreements in
// force attach timers to new records).
import type { Cond } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import { CUSTOMER_KINDS, TIMER_TYPE_OF } from "@shared/tables/slm";
import { inForce, num, PRIORITY_KEYS } from "@shared/slm/logic";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { isUuid, liveRow, liveRows, sysOf, type Row } from "./common";

const has = (def: TableDef, f: string) => def.fields.some((x) => x.name === f);

/** States of the table's model in the given categories. */
function statesIn(def: TableDef, cats: string[]): string[] {
  return (def.states?.states ?? []).filter((s) => cats.includes(s.category)).map((s) => s.value);
}

/** The durations of a target (seconds per priority), only the priorities it names. */
export function durationsOf(t: Row): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of PRIORITY_KEYS) {
    const h = num(t[`p${p}_hours`]);
    if (h !== null && h > 0) out[p] = Math.round(h * 3600);
  }
  return out;
}

/** Why a target cannot generate a timer on its table (Persian), or null. */
export function generationProblem(t: Row): string | null {
  const def = tableDef(String(t.table_key ?? ""));
  if (!def || def.virtual) return `جدول «${t.table_key ?? ""}» شناخته نیست`;
  if (!def.states) return "این جدول مدل وضعیت ندارد؛ یک تعریف زمان‌سنج موجود را برگزینید";
  if (!has(def, "priority")) return "این جدول اولویت ندارد؛ یک تعریف زمان‌سنج موجود را برگزینید";
  if (t.timer_target === "response" && !statesIn(def, ["new"]).length) return "این جدول وضعیت «جدید» ندارد؛ زمان پاسخ را با تعریف موجود بسازید";
  if (!Object.keys(durationsOf(t)).length) return "دست‌کم برای یک اولویت ساعت هدف را بنویسید";
  return null;
}

/** The SLA definition a target generates (values of `sla_definition`). */
export function definitionValues(t: Row, a: Row, agreementLabel: string): Row {
  const def = tableDef(String(t.table_key))!;
  const kind = String(a.kind ?? "sla");
  const type = TIMER_TYPE_OF[kind] ?? "sla";
  const group = def.scope.group && has(def, def.scope.group) ? def.scope.group : null;
  const provider = isUuid(a.provider_group_id) && group ? String(a.provider_group_id) : null;
  const customerScoped = CUSTOMER_KINDS.includes(kind) || !provider;
  const resolvedStates = statesIn(def, ["resolved", "closed"]);
  const waiting = statesIn(def, ["waiting"]);
  const canceled = statesIn(def, ["canceled"]);
  const fresh = statesIn(def, ["new"]);
  const start: Cond[] = [];
  const stopAny: Cond[] = [];
  if (provider) {
    start.push({ f: group!, op: "eq", v: provider });
    stopAny.push({ f: group!, op: "ne", v: provider });
  }
  let values: Row;
  if (t.timer_target === "response") {
    start.push({ f: "state", op: "in", v: fresh });
    stopAny.push({ f: "state", op: "nin", v: fresh });
    if (has(def, "first_response_at")) stopAny.push({ f: "first_response_at", op: "nempty" });
    values = { target: "response" };
  } else {
    stopAny.push({ f: "state", op: "in", v: resolvedStates });
    values = {
      target: "resolution",
      pause_condition: waiting.length ? { f: "state", op: "in", v: waiting } : null,
      reset_condition: has(def, "reopen_count") ? { f: "reopen_count", op: "changed" } : null,
    };
  }
  const retro = !provider && has(def, "opened_at");
  return {
    ...values,
    name: `${agreementLabel} — ${String(t.name ?? "")}`.slice(0, 150),
    table_key: def.key,
    type,
    active: t.active !== false && inForce(a.state),
    duration_mode: "priority",
    priority_field: "priority",
    durations: durationsOf(t),
    calendar_id: (isUuid(t.calendar_id) ? t.calendar_id : null) ?? (isUuid(a.calendar_id) ? a.calendar_id : null),
    timezone_source: "calendar",
    start_condition: start.length ? { and: start } : null,
    stop_condition: stopAny.length === 1 ? stopAny[0] : { or: stopAny },
    cancel_condition: canceled.length ? { f: "state", op: "in", v: canceled } : null,
    retroactive: retro,
    retroactive_field: retro ? "opened_at" : null,
    warn_percents: [50, 75, 90],
    breach_actions: [{ type: "notify", fields: ["assigned_to"] }],
    service_id: customerScoped && isUuid(a.service_id) ? a.service_id : null,
    customer_unit_id: CUSTOMER_KINDS.includes(kind) && isUuid(a.customer_unit_id) ? a.customer_unit_id : null,
    sort_order: 300,
    description: `ساخته‌شده از هدف «${String(t.name ?? "")}» توافق ${agreementLabel}؛ تغییرها را در هدف توافق بدهید.`,
  };
}

const labelOf = (a: Row) => String(a.number ? `${a.number}` : a.name ?? "");

/**
 * Create or update the definition of a generated timer target (inside the target's write). Returns the patch for
 * the target (`definition_id`, `generated`) or null when nothing is generated.
 */
export async function syncTargetDefinition(tx: Tx, ctx: Ctx, t: Row, a: Row): Promise<{ definition_id: string; generated: true } | null> {
  if (t.kind !== "timer") return null;
  const sys = sysOf(ctx);
  const linked = isUuid(t.definition_id) && !t.generated;
  if (linked) return null;
  const values = definitionValues(t, a, labelOf(a));
  const existing = isUuid(t.definition_id) ? await liveRow(tx, sys, "sla_definition", t.definition_id) : null;
  if (existing) {
    await updateIn(tx, sys, "sla_definition", existing.id, values, { trusted: true });
    return { definition_id: String(existing.id), generated: true };
  }
  const row = await createIn(tx, sys, "sla_definition", values, { trusted: true });
  return { definition_id: String(row.id), generated: true };
}

/** Switch the generated definitions of an agreement's targets on or off with its lifecycle (and re-scope them). */
export async function syncAgreementDefinitions(tx: Tx, ctx: Ctx, agreementId: string): Promise<number> {
  const sys = sysOf(ctx);
  const a = await liveRow(tx, sys, "service_agreement", agreementId);
  if (!a) return 0;
  const targets = await liveRows(tx, sys, "slm_target", { and: [{ f: "agreement_id", op: "eq", v: agreementId }, { f: "kind", op: "eq", v: "timer" }, { f: "generated", op: "eq", v: true }] });
  let n = 0;
  for (const t of targets) {
    if (!isUuid(t.definition_id) || generationProblem(t)) continue;
    const d = await liveRow(tx, sys, "sla_definition", t.definition_id);
    if (!d) continue;
    await updateIn(tx, sys, "sla_definition", d.id, definitionValues(t, a, labelOf(a)), { trusted: true });
    n++;
  }
  return n;
}

/** Switch a generated definition off (its target was deleted or switched to another kind). */
export async function retireDefinition(tx: Tx, ctx: Ctx, definitionId: unknown): Promise<void> {
  if (!isUuid(definitionId)) return;
  const sys = sysOf(ctx);
  if (await liveRow(tx, sys, "sla_definition", definitionId)) await updateIn(tx, sys, "sla_definition", definitionId, { active: false }, { trusted: true });
}

/** The definition ids an agreement measures (linked and generated timer targets). */
export async function definitionsOf(q: Queryable, ctx: Ctx, agreementId: string): Promise<{ target: Row; definition_id: string }[]> {
  const rows = await liveRows(q, sysOf(ctx), "slm_target", { and: [{ f: "agreement_id", op: "eq", v: agreementId }, { f: "kind", op: "eq", v: "timer" }] }, { order: "t.sort_order, t.name" });
  return rows.filter((t) => isUuid(t.definition_id)).map((t) => ({ target: t, definition_id: String(t.definition_id) }));
}

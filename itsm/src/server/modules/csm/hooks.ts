// Hooks of customer service management (same transaction as the write):
//   · accounts: no parent loops; each account is bound to a company node of the organisation tree under the root
//     «مشتریان» (created for it, renamed with it) — the access model then anchors the customer's cases to that unit,
//     so the unit's manager (the customer's administrator) reads the account's cases (CSM-028)
//   · rows of an account copy its support group (the group reads and works them)
//   · contacts: grouped to an account by their e-mail domain (CSM-005); a contact's member sits in the account's unit
//   · customer cases (CSM-009/011/019): account and contact from the person; the entitlement resolved at intake and
//     snapshotted (exhausted «block» refuses the case); customer-friendly state words; complaint flag; text sentiment;
//     the customer's acceptance or rejection of a resolution; routing to the product's or account's group, and to the
//     relationship manager when nothing entitles the case; units consumed once when the case closes
//   · entitlements keep their remaining units; the ledger is written by the module only
//   · escalations: the account of their case, the case marked escalated when the escalation is accepted
import { customerStatusOf, crossedWarning, resolveEntitlement, sentimentOf, unitsFor, unitsLeft, type EntitlementLike } from "@shared/csm/logic";
import { ACCOUNT_CHILD_TABLES } from "@shared/tables/csm";
import Decimal from "decimal.js";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, createIn, emitEvent, isSystemCtx, onBeforeCommit, pushGuard, registerHooks, updateIn, validationError, type PushArgs, type WriteArgs } from "../../engine";
import { tableDef } from "@shared/tables";
import { forbidden } from "../../http/errors";
import { countRows, csmConfig, ids, isUuid, liveRow, liveRows, sysOf, todayUtc, type Row } from "./common";

// ----- accounts ------------------------------------------------------------------------------------------------------

async function accountBefore(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, op } = w;
  if (op === "delete" || !isUuid(next.parent_id)) return;
  const sys = sysOf(ctx);
  let cur: unknown = next.parent_id;
  for (let i = 0; i < 50 && isUuid(cur); i++) {
    if (String(cur) === String(next.id)) throw validationError({ parent_id: "حساب نمی‌تواند زیرمجموعهٔ خودش باشد" });
    cur = (await liveRow(tx, sys, "customer_account", cur))?.parent_id ?? null;
  }
}

async function accountAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { tx, ctx, row, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  // the company node of the organisation tree the customer's people sit in
  if (!isUuid(row.org_unit_id)) {
    const cfg = await csmConfig(tx, ctx);
    const parent = isUuid(row.parent_id) ? await liveRow(tx, sys, "customer_account", row.parent_id) : null;
    const under = (parent?.org_unit_id as string) ?? cfg.root_unit_id;
    if (isUuid(under)) {
      const unit = await createIn(tx, sys, "org_unit", { name: String(row.name).slice(0, 120), kind: "company", parent_id: under, active: true, description: "واحد مشتری (خدمات مشتریان)" }, { trusted: true });
      await updateIn(tx, sys, "customer_account", String(row.id), { org_unit_id: unit.id }, { trusted: true, keepVersion: true });
    }
  } else if (w.changed.has("name")) {
    const unit = await liveRow(tx, sys, "org_unit", row.org_unit_id);
    if (unit && unit.kind === "company") await updateIn(tx, sys, "org_unit", String(unit.id), { name: String(row.name).slice(0, 120) }, { trusted: true });
  }
  if (op === "update" && w.changed.has("support_group_id")) {
    for (const t of ACCOUNT_CHILD_TABLES) {
      const field = t === "entitlement_ledger" ? null : "account_id";
      if (!field) continue;
      for (const r of await liveRows(tx, sys, t, { f: field, op: "eq", v: row.id }, { limit: 5000 })) {
        await updateIn(tx, sys, t, String(r.id), { support_group_id: row.support_group_id ?? null }, { trusted: true, keepVersion: true });
      }
    }
  }
}

/** The support group a row of an account copies (through its entitlement for ledger rows). */
async function supportGroupOf(tx: Tx, ctx: Ctx, table: string, next: Row): Promise<string | null> {
  const sys = sysOf(ctx);
  let accountId: unknown = next.account_id;
  if (table === "entitlement_ledger") accountId = (await liveRow(tx, sys, "entitlement", next.entitlement_id))?.account_id;
  if (table === "case_escalation" && !isUuid(accountId) && isUuid(next.case_id)) accountId = (await liveRow(tx, sys, "customer_case", next.case_id))?.account_id;
  const acc = isUuid(accountId) ? await liveRow(tx, sys, "customer_account", accountId) : null;
  return (acc?.support_group_id as string) ?? null;
}

async function childBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  w.next.support_group_id = await supportGroupOf(w.tx, w.ctx, w.def.key, w.next);
}

// ----- contacts ------------------------------------------------------------------------------------------------------

async function contactBefore(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  if (!isUuid(next.account_id) && typeof next.email === "string" && next.email.includes("@")) {
    const domain = next.email.split("@")[1].toLowerCase();
    const [acc] = await liveRows(tx, sys, "customer_account", { and: [{ f: "email_domain", op: "eq", v: domain }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
    if (acc) next.account_id = acc.id;
  }
  if (!isUuid(next.account_id)) throw validationError({ account_id: "حساب مخاطب را مشخص کنید (یا دامنهٔ رایانامهٔ او را برای حسابی ثبت کنید)" });
  next.support_group_id = await supportGroupOf(tx, ctx, "customer_contact", next);
}

async function contactAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { tx, ctx, row, op } = w;
  if (op === "delete" || !isUuid(row.user_id) || !(op === "create" || w.changed.has("user_id") || w.changed.has("account_id"))) return;
  const sys = sysOf(ctx);
  const acc = await liveRow(tx, sys, "customer_account", row.account_id);
  if (!isUuid(acc?.org_unit_id)) return;
  // the contact's member sits in the customer's unit (their cases anchor there; the customer's administrator reads them)
  const [profile] = await liveRows(tx, sys, "member_profile", { f: "user_id", op: "eq", v: row.user_id }, { limit: 1 });
  if (profile) {
    if (profile.org_unit_id !== acc!.org_unit_id) await updateIn(tx, sys, "member_profile", String(profile.id), { org_unit_id: acc!.org_unit_id }, { trusted: true });
  } else {
    await createIn(tx, sys, "member_profile", { user_id: row.user_id, org_unit_id: acc!.org_unit_id, persona: "requester", roles: ["requester"] }, { trusted: true });
  }
}

// ----- customer cases --------------------------------------------------------------------------------------------------

const snapshotOf = (e: EntitlementLike & Row): Row => ({
  id: e.id, name: e.name ?? null, support_level: e.support_level ?? null, channels: e.channels ?? [], response_hours: e.response_hours ?? null, resolution_hours: e.resolution_hours ?? null,
  unit_type: e.unit_type ?? "none", units_remaining: unitsLeft(e), ends_on: e.ends_on ?? null,
});

async function caseBefore(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, prev, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  // the account and contact of the person the case is for
  if (isUuid(next.contact_id) && (op === "create" || w.changed.has("contact_id"))) {
    const contact = await liveRow(tx, sys, "customer_contact", next.contact_id);
    if (!contact) throw validationError({ contact_id: "مخاطب پیدا نشد" });
    const allowed = [contact.account_id, ...((contact.other_accounts as string[]) ?? [])];
    if (isUuid(next.account_id) && !allowed.includes(next.account_id)) throw validationError({ contact_id: "این مخاطب از حساب دیگری است" });
    if (!isUuid(next.account_id)) next.account_id = contact.account_id;
  }
  if (op === "create" && !isUuid(next.contact_id)) {
    const person = [next.requested_for, next.caller_id].find(isUuid);
    if (person) {
      const [contact] = await liveRows(tx, sys, "customer_contact", { and: [{ f: "user_id", op: "eq", v: person }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
      if (contact) {
        next.contact_id = contact.id;
        if (!isUuid(next.account_id)) next.account_id = contact.account_id;
      }
    }
  }
  if (op === "create" && !next.proactive) {
    // the entitlement at intake (CSM-009): installed base → product → the account's default
    const cands = isUuid(next.account_id) ? ((await liveRows(tx, sys, "entitlement", { f: "account_id", op: "eq", v: next.account_id }, { limit: 500 })) as (EntitlementLike & Row)[]) : [];
    const r = resolveEntitlement(cands, { account_id: (next.account_id as string) ?? null, product_id: (next.product_id as string) ?? null, ibi_id: (next.ibi_id as string) ?? null, contact_id: (next.contact_id as string) ?? null, channel: (next.channel as string) ?? null, today: todayUtc() });
    if (r.blocked && !w.trusted && !isSystemCtx(ctx)) throw validationError({ product_id: `${r.reason}؛ برای تمدید با مدیر حساب خود تماس بگیرید` });
    next.entitlement_status = isUuid(next.account_id) ? r.status : null;
    next.entitlement_id = r.entitlement?.id ?? null;
    next.contract_id = (r.entitlement?.contract_id as string) ?? null;
    next.entitlement_snapshot = r.entitlement ? snapshotOf(r.entitlement as EntitlementLike & Row) : null;
    // the support level picks the case's response and resolution agreements (CSM-010; seeded per level)
    next.support_level = r.status === "covered" ? ((r.entitlement?.support_level as string) ?? null) : null;
  }
  if (next.case_type === "complaint") next.complaint = true;
  next.customer_status = customerStatusOf(next.state);
  if (op === "create" || w.changed.has("description")) {
    const s = sentimentOf(`${next.short_description ?? ""} ${next.description ?? ""}`);
    next.sentiment = s.sentiment;
  }
  // the customer accepts or rejects the resolution
  if (prev && w.changed.has("state") && prev.state === "resolved") {
    if (next.state === "closed") next.resolution_accepted = true;
    if (next.state === "open") next.resolution_accepted = false;
  }
}

/** Consume the case's units once, when it closes; warn the relationship manager when the threshold is crossed. */
async function consumeUnits(tx: Tx, ctx: Ctx, row: Row): Promise<void> {
  if (row.units_charged !== null && row.units_charged !== undefined) return;
  const sys = sysOf(ctx);
  const ent = isUuid(row.entitlement_id) ? await liveRow(tx, sys, "entitlement", row.entitlement_id) : null;
  if (!ent || !ent.unit_type || ent.unit_type === "none") return;
  const units = unitsFor(String(ent.unit_type), Number(row.time_worked ?? 0));
  const usedBefore = new Decimal(String(ent.units_used ?? 0) || 0);
  const usedAfter = usedBefore.plus(units);
  const balance = new Decimal(String(ent.units_total ?? 0) || 0).minus(usedAfter);
  await createIn(tx, sys, "entitlement_ledger", { entitlement_id: ent.id, case_id: row.id, delta: new Decimal(units).neg().toString(), balance_after: balance.toString(), reason: `پروندهٔ ${row.number ?? ""} بسته شد`.slice(0, 200) }, { trusted: true });
  await updateIn(tx, sys, "entitlement", String(ent.id), { units_used: usedAfter.toString() }, { trusted: true });
  await updateIn(tx, sys, "customer_case", String(row.id), { units_charged: units }, { trusted: true, keepVersion: true });
  if (crossedWarning(ent.units_total as string, usedBefore.toString(), usedAfter.toString(), Number(ent.warn_percent ?? 80))) {
    const acc = await liveRow(tx, sys, "customer_account", ent.account_id);
    const users = ids([acc?.relationship_manager_id, acc?.service_delivery_manager_id]);
    if (users.length) await emitEvent(tx, sys, { kind: "record.entitlement_warning", table: "entitlement", id: String(ent.id), number: (ent.number as string) ?? null, data: { users } });
  }
}

async function caseAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { tx, ctx, row, op, prev } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  if (op === "create") {
    const patch: Row = {};
    if (!row.assignment_group_id) {
      const product = isUuid(row.product_id) ? await liveRow(tx, sys, "customer_product", row.product_id) : null;
      const acc = isUuid(row.account_id) ? await liveRow(tx, sys, "customer_account", row.account_id) : null;
      const cfg = await csmConfig(tx, ctx);
      const g = (product?.support_group_id as string) ?? (acc?.support_group_id as string) ?? cfg.default_group_id;
      if (g) patch.assignment_group_id = g;
      // nothing entitles the case: the relationship manager decides, rather than a silent refusal
      if (row.entitlement_status && row.entitlement_status !== "covered" && !row.assigned_to && isUuid(acc?.relationship_manager_id)) patch.assigned_to = acc!.relationship_manager_id;
    }
    if (Object.keys(patch).length) await updateIn(tx, sys, "customer_case", String(row.id), patch, { trusted: true, keepVersion: true });
    if (patch.assigned_to) await addJournalIn(tx, sys, tableDef("customer_case")!, row, { kind: "work_note", body: `استحقاق: ${row.entitlement_status === "none" ? "بدون استحقاق" : String(row.entitlement_status)} — پرونده به مدیر رابطهٔ حساب سپرده شد تا دربارهٔ پشتیبانی تصمیم بگیرد.` }, { trusted: true });
  }
  if (prev && w.changed.has("state") && row.state === "closed") await consumeUnits(tx, ctx, row);
  if (isUuid(row.account_id) && (op === "create" || w.changed.has("state") || w.changed.has("account_id"))) {
    for (const acc of ids([row.account_id, prev?.account_id])) {
      onBeforeCommit(tx, `csm.open_cases:${acc}`, async () => {
        const n = await countRows(tx, sys, "customer_case", { and: [{ f: "account_id", op: "eq", v: acc }, { f: "active", op: "eq", v: true }] });
        const a = await liveRow(tx, sys, "customer_account", acc);
        if (a && Number(a.open_cases ?? 0) !== n) await updateIn(tx, sys, "customer_account", acc, { open_cases: n }, { trusted: true, keepVersion: true });
      });
    }
  }
}

async function caseOnPush(p: PushArgs): Promise<Row> {
  return { customer_status: customerStatusOf(p.next.state), entitlement_id: p.prev?.entitlement_id ?? null, entitlement_status: p.prev?.entitlement_status ?? null, entitlement_snapshot: p.prev?.entitlement_snapshot ?? null, support_level: p.prev?.support_level ?? null, contract_id: p.prev?.contract_id ?? null, units_charged: p.prev?.units_charged ?? null };
}

// ----- entitlements, the ledger, escalations -------------------------------------------------------------------------

async function entitlementBefore(w: WriteArgs): Promise<void> {
  const { next, op } = w;
  if (op === "delete") return;
  if (next.starts_on && next.ends_on && String(next.ends_on) < String(next.starts_on)) throw validationError({ ends_on: "پایان باید پس از آغاز باشد" });
  next.units_remaining = !next.unit_type || next.unit_type === "none" ? null : new Decimal(String(next.units_total ?? 0) || 0).minus(String(next.units_used ?? 0) || 0).toString();
  await childBefore(w);
}

function ledgerGuard(w: WriteArgs): void {
  if (!isSystemCtx(w.ctx) && !w.trusted) throw forbidden("دفتر مصرف استحقاق را فقط سامانه می‌نویسد");
}

async function escalationAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { tx, ctx, row, prev } = w;
  if (w.op === "delete" || !prev || !w.changed.has("state") || row.state !== "active") return;
  const sys = sysOf(ctx);
  if (isUuid(row.case_id)) {
    const c = await liveRow(tx, sys, "customer_case", row.case_id);
    if (c) {
      await updateIn(tx, sys, "customer_case", String(c.id), { escalated: true }, { trusted: true, keepVersion: true });
      await addJournalIn(tx, sys, tableDef("customer_case")!, c, { kind: "work_note", body: `تشدید ${row.number ?? ""} پذیرفته شد: ${row.short_description}` }, { trusted: true });
    }
  }
  const users = ids([row.owner_id, row.executive_sponsor_id]);
  if (users.length) await emitEvent(tx, sys, { kind: "record.escalation_active", table: "case_escalation", id: String(row.id), number: (row.number as string) ?? null, data: { users } });
}

export function installCsmHooks(): (() => void)[] {
  const offs: (() => void)[] = [
    registerHooks("customer_account", { beforeWrite: accountBefore, afterWrite: accountAfter }),
    registerHooks("customer_contact", { beforeWrite: contactBefore, afterWrite: contactAfter, derivePush: async (p) => ({ support_group_id: await supportGroupOf(p.tx, p.ctx, "customer_contact", p.next) }) }),
    registerHooks("customer_case", { beforeWrite: caseBefore, afterWrite: caseAfter, derivePush: caseOnPush }),
    registerHooks("entitlement", { beforeWrite: entitlementBefore }),
    registerHooks("entitlement_ledger", { beforeWrite: ledgerGuard, validatePush: pushGuard(ledgerGuard) }),
    registerHooks("case_escalation", { afterWrite: escalationAfter }),
    // a notice is sent only by «ارسال» (the route that delivers it and keeps the evidence)
    registerHooks("customer_notice", { guards: { notice_send: (w) => (w.trusted || isSystemCtx(w.ctx) ? null : "اطلاع‌رسانی با دکمهٔ «ارسال» فرستاده می‌شود") } }),
  ];
  for (const t of ACCOUNT_CHILD_TABLES.filter((t) => !["customer_contact", "entitlement"].includes(t))) {
    offs.push(registerHooks(t, { beforeWrite: childBefore, derivePush: async (p) => ({ support_group_id: await supportGroupOf(p.tx, p.ctx, p.def.key, p.next) }) }));
  }
  return offs;
}

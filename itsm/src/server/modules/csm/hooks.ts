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
import { ACCOUNT_CHILD_TABLES, ENTITLEMENT_STATES, NOTICE_STATES } from "@shared/tables/csm";
import Decimal from "decimal.js";
import type { Ctx } from "../../context";
import { lockKey, type Tx } from "../../db";
import { addJournalIn, createIn, emitEvent, isSystemCtx, onBeforeCommit, pushGuard, registerHooks, updateIn, validationError, type PushArgs, type WriteArgs } from "../../engine";
import { tableDef } from "@shared/tables";
import { forbidden } from "../../http/errors";
import { lockedRow } from "../incident/common";
import { contactsOfUser, countRows, csmConfig, ids, isUuid, liveRow, liveRows, sysOf, todayUtc, worksCsm, type Row } from "./common";

// ----- who defines customers ------------------------------------------------------------------------------------------

/**
 * Tables that define customers and what they are entitled to (CSM-001…008): only CSM staff create or change them.
 * The requester role every customer contact holds creates in area csm for its cases — never accounts, contracts,
 * entitlements, brands or notices (an entitlement forged active would cover their cases; a brand would show in other
 * customers' portals). A contact changes only its own requester fields (the engine's requester mode).
 */
export const CSM_DEFINITION_TABLES = [
  "customer_account", "customer_contact", "customer_product", "install_base_item", "customer_contract", "entitlement",
  "account_plan", "account_stakeholder", "account_review", "account_health", "customer_experience", "customer_notice", "csm_config",
];

/** States a definition starts in (a new entitlement is a draft until activated, a notice a draft until approved). */
const INITIAL_STATE: Record<string, string> = { entitlement: ENTITLEMENT_STATES.initial, customer_notice: NOTICE_STATES.initial };

async function staffOnly(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || w.trusted || isSystemCtx(w.ctx)) return;
  const initial = INITIAL_STATE[w.def.key];
  if (w.op === "create" && initial && w.next.state !== initial) {
    if (w.via === "sync") throw validationError({ state: `«${w.def.label}» تازه در وضعیت آغازین ساخته می‌شود` });
    w.next.state = initial;
  }
  if (await worksCsm(w.tx, w.ctx)) return;
  // a contact's own requester fields (the engine keeps a contact's writes on their own row to those)
  if (w.def.key === "customer_contact" && w.op !== "create") return;
  throw forbidden(`«${w.def.label}» را کارشناسان خدمات مشتریان تعریف می‌کنند`);
}

// ----- accounts ------------------------------------------------------------------------------------------------------

async function accountBefore(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, op } = w;
  if (op === "delete" || !isUuid(next.parent_id)) return;
  const sys = sysOf(ctx);
  // re-parenting takes the accounts' tree key: two crossing moves at once never make a loop
  if (op !== "create" && w.changed.has("parent_id")) await lockKey(tx, `customer_account.tree:${ctx.org.id}`);
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
  if (op === "update" && w.changed.has("support_group_id")) groupsAtCommit(tx, ctx, String(row.id), { all: true });
}

/** Rows of accounts whose support group copy is put in step at commit, per account (see `groupsAtCommit`). */
const groupWork = new WeakMap<Tx, Map<string, { all: boolean; rows: { table: string; id: string }[] }>>();

/**
 * Put the support group copies of an account's rows in step at commit, under the account's key: queued by a change of
 * the account's group (every row of the account) and by a new or moved row (that row). Whichever of two such writes
 * commits second re-reads the account and the rows after the other, so a row made while the account's group changes
 * never keeps the old group (the team that no longer supports the customer).
 */
function groupsAtCommit(tx: Tx, ctx: Ctx, accountId: string, add: { all?: boolean; table?: string; id?: string }): void {
  if (!isUuid(accountId)) return;
  let byAccount = groupWork.get(tx);
  if (!byAccount) groupWork.set(tx, (byAccount = new Map()));
  let work = byAccount.get(accountId);
  if (!work) byAccount.set(accountId, (work = { all: false, rows: [] }));
  if (add.all) work.all = true;
  if (add.table && isUuid(add.id)) work.rows.push({ table: add.table, id: String(add.id) });
  onBeforeCommit(tx, `csm.account_group:${accountId}`, async () => {
    const todo = groupWork.get(tx)?.get(accountId);
    groupWork.get(tx)?.delete(accountId);
    if (!todo) return;
    const sys = sysOf(ctx);
    const acc = await liveRow(tx, sys, "customer_account", accountId);
    if (!acc) return;
    const group = (acc.support_group_id as string) ?? null;
    const fix = async (t: string, r: Row | null) => {
      if (r && ((r.support_group_id as string) ?? null) !== group) await updateIn(tx, sys, t, String(r.id), { support_group_id: group }, { trusted: true, keepVersion: true });
    };
    if (todo.all) {
      for (const t of ACCOUNT_CHILD_TABLES) {
        if (t === "entitlement_ledger") continue;
        for (const r of await liveRows(tx, sys, t, { f: "account_id", op: "eq", v: accountId }, { limit: 5000 })) await fix(t, r);
      }
    } else {
      for (const x of todo.rows) await fix(x.table, await liveRow(tx, sys, x.table, x.id));
    }
  });
}

/** The account a row belongs to (through its entitlement for ledger rows, its case for an escalation without one). */
async function accountOf(tx: Tx, ctx: Ctx, table: string, next: Row): Promise<string | null> {
  const sys = sysOf(ctx);
  let accountId: unknown = next.account_id;
  if (table === "entitlement_ledger") accountId = (await liveRow(tx, sys, "entitlement", next.entitlement_id))?.account_id;
  if (table === "case_escalation" && !isUuid(accountId) && isUuid(next.case_id)) accountId = (await liveRow(tx, sys, "customer_case", next.case_id))?.account_id;
  return isUuid(accountId) ? String(accountId) : null;
}

/** The support group a row of an account copies (through its entitlement for ledger rows). */
async function supportGroupOf(tx: Tx, ctx: Ctx, table: string, next: Row): Promise<string | null> {
  const accountId = await accountOf(tx, ctx, table, next);
  const acc = accountId ? await liveRow(tx, sysOf(ctx), "customer_account", accountId) : null;
  return (acc?.support_group_id as string) ?? null;
}

async function childBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  w.next.support_group_id = await supportGroupOf(w.tx, w.ctx, w.def.key, w.next);
  // a new row (or one moved to another account) is checked again at commit, after a change of the account's group
  if (w.op === "create" || w.changed.has("account_id") || w.changed.has("entitlement_id") || w.changed.has("case_id")) {
    const accountId = await accountOf(w.tx, w.ctx, w.def.key, w.next);
    if (accountId) groupsAtCommit(w.tx, w.ctx, accountId, { table: w.def.key, id: String(w.next.id) });
  }
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
  if (op === "create" || w.changed.has("account_id")) groupsAtCommit(tx, ctx, String(next.account_id), { table: "customer_contact", id: String(next.id) });
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

/** The accounts a contact may file under: its own and the others it was given access to. */
const accountsOf = (contact: Row): string[] => ids([contact.account_id, ...((contact.other_accounts as string[]) ?? [])]);

async function caseBefore(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, prev, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  // the account and contact of the person the case is for — supplied, or the person's own contact
  let contact: Row | null = null;
  if (isUuid(next.contact_id) && (op === "create" || w.changed.has("contact_id"))) {
    contact = await liveRow(tx, sys, "customer_contact", next.contact_id);
    if (!contact) throw validationError({ contact_id: "مخاطب پیدا نشد" });
  } else if (op === "create" && !isUuid(next.contact_id)) {
    const person = [next.requested_for, next.caller_id].find(isUuid);
    if (person) {
      [contact] = await liveRows(tx, sys, "customer_contact", { and: [{ f: "user_id", op: "eq", v: person }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
      if (contact) next.contact_id = contact.id;
    }
  }
  if (contact) {
    if (isUuid(next.account_id) && !accountsOf(contact).includes(String(next.account_id).toLowerCase())) throw validationError({ account_id: "این مخاطب از حساب دیگری است" });
    if (!isUuid(next.account_id)) next.account_id = contact.account_id;
  }
  // a customer files only under the accounts their own contacts belong to (another account's entitlement, units,
  // health and review pack are not theirs to use)
  if ((op === "create" || w.changed.has("account_id") || w.changed.has("contact_id")) && isUuid(next.account_id) && !w.trusted && !isSystemCtx(ctx) && !(await worksCsm(tx, ctx))) {
    const mine = new Set((await contactsOfUser(tx, ctx, ctx.user.id)).flatMap(accountsOf));
    if (!mine.has(String(next.account_id).toLowerCase())) throw forbidden("پرونده را فقط برای حساب خودتان ثبت می‌کنید");
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

/** A Windows app's pushed case: the same account rule (the contact's accounts; a customer's own accounts only). */
async function caseAccountGuard(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, prev } = w;
  if (!isUuid(next.account_id) || w.trusted || isSystemCtx(ctx)) return;
  if (prev && String(prev.account_id ?? "") === String(next.account_id) && String(prev.contact_id ?? "") === String(next.contact_id ?? "")) return;
  if (isUuid(next.contact_id)) {
    const contact = await liveRow(tx, sysOf(ctx), "customer_contact", next.contact_id);
    if (!contact || !accountsOf(contact).includes(String(next.account_id).toLowerCase())) throw validationError({ account_id: "این مخاطب از حساب دیگری است" });
  }
  if (await worksCsm(tx, ctx)) return;
  const mine = new Set((await contactsOfUser(tx, ctx, ctx.user.id)).flatMap(accountsOf));
  if (!mine.has(String(next.account_id).toLowerCase())) throw forbidden("پرونده را فقط برای حساب خودتان ثبت می‌کنید");
}

/**
 * Consume the case's units once, when it closes; warn the relationship manager when the threshold is crossed. The
 * entitlement is locked before its units are read: two cases of one entitlement closing at once take turns, and the
 * second adds its units to what the first left (its ledger balance follows), never to the same old total.
 */
async function consumeUnits(tx: Tx, ctx: Ctx, row: Row): Promise<void> {
  if (row.units_charged !== null && row.units_charged !== undefined) return;
  const sys = sysOf(ctx);
  const ent = isUuid(row.entitlement_id) ? await lockedRow(tx, sys, "entitlement", row.entitlement_id) : null;
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
    // definitions are CSM staff's (registered first: the guard runs before the hooks that derive)
    ...CSM_DEFINITION_TABLES.map((t) => registerHooks(t, { beforeWrite: staffOnly, validatePush: pushGuard(staffOnly) })),
    registerHooks("customer_account", { beforeWrite: accountBefore, afterWrite: accountAfter }),
    registerHooks("customer_contact", { beforeWrite: contactBefore, afterWrite: contactAfter, derivePush: async (p) => ({ support_group_id: await supportGroupOf(p.tx, p.ctx, "customer_contact", p.next) }) }),
    registerHooks("customer_case", { beforeWrite: caseBefore, afterWrite: caseAfter, derivePush: caseOnPush, validatePush: pushGuard(caseAccountGuard) }),
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

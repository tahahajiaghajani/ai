// Hooks of configuration management (same transaction as the write; never a model or a network call):
//   ci_class        key immutable and well-formed, parent exists without a loop, attributes checked against the
//                   ancestry (removed ones come back archived — classes change additively), no delete while CIs or
//                   child classes exist; every write mirrors the class into the choice list «ci.class»
//   ci_rel_type     the same for relationship types («ci_rel.type»)
//   ci              the class exists and may hold CIs (abstract and creation-disabled classes refuse people), class
//                   attributes coerced like engine fields and required ones enforced for people, identifiers
//                   normalised, manual provenance recorded, controlled attributes blocked or flagged as drift without
//                   an authorising change, the «عملیاتی» guard of the class; follow-ups by job (health, relationships'
//                   anchors, rule-based relationships, drift)
//   ci_rel          no self-loops or duplicates, an existing active type, the caller may change one of the two CIs,
//                   anchors copied from the parent CI, a readable label, «تا» not before «از»
//   ci_group, cmdb_rule, ci_baseline, ci_cert_campaign, ci_cert_task, cmdb_dedup_task: their own consistency rules
import { CMDB_CONFIG_DEFAULTS } from "@shared/tables/cmdb";
import { attrPath, attrProblems, ciValue, keepArchived, normalizeIdent, relLabel } from "@shared/cmdb/logic";
import type { AttrDef } from "@shared/cmdb/classes";
import { latinDigits } from "@shared/ai/text";
import type { FieldDef } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { conflict, forbidden } from "../../http/errors";
import { coerceValue, condEnv, createIn, loadReadable, orgSchema, orgTz, registerHooks, updateIn, validationError, type WriteArgs } from "../../engine";
import { access } from "../../access/provider";
import { enqueue } from "../../jobs";
import { classTree, cmdbConfig, CI_COLUMNS, countRows, eqAll, invalidateCmdbCache, isCmdbAdmin, isUuid, liveRow, liveRows, relTypes, sysOf, type Row } from "./common";
import { redactBaselines, redactRunResults } from "./baseline";

const KEY = /^[a-z][a-z0-9_]{0,62}$/;
const isSystem = (ctx: Ctx) => ctx.actor === "system";

// ---------------------------------------------------------------------------------------------------------------
// Mirroring classes and relationship types into their choice lists

async function mirrorChoice(w: WriteArgs & { row: Row }, list: string): Promise<void> {
  const sys = sysOf(w.ctx);
  const value = String(w.row.key ?? "");
  if (!value) return;
  const [found] = await liveRows(w.tx, sys, "choice", eqAll({ list, value }), { limit: 1 });
  if (w.op === "delete") {
    if (found && found.active !== false) await updateIn(w.tx, sys, "choice", found.id, { active: false }, { trusted: true });
    return;
  }
  const values = { label: String(w.row.label ?? value), sort_order: w.row.sort_order ?? null, active: w.row.active !== false, color: w.row.color ?? null };
  if (found) {
    if (found.label !== values.label || found.active !== values.active || (found.sort_order ?? null) !== values.sort_order || (found.color ?? null) !== values.color) await updateIn(w.tx, sys, "choice", found.id, values, { trusted: true });
  } else await createIn(w.tx, sys, "choice", { list, value, ...values }, { trusted: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Classes

const CI_FIELD_NAMES = new Set((tableDef("ci")?.fields ?? []).map((f) => f.name));

async function classBefore(w: WriteArgs): Promise<void> {
  const tree = await classTree(w.tx, w.ctx, { fresh: true });
  if (w.op === "delete") {
    const key = String(w.prev?.key ?? "");
    const children = tree.childrenOf(key).filter((c) => c.key !== key);
    if (children.length) throw conflict(`کلاس «${w.prev?.label}» زیرکلاس دارد؛ ابتدا آن‌ها را جابه‌جا یا حذف کنید یا کلاس را غیرفعال کنید`);
    const n = await countRows(w.tx, sysOf(w.ctx), "ci", { f: "class", op: "eq", v: key });
    if (n) throw conflict(`${n} پیکربندی در کلاس «${w.prev?.label}» هست؛ کلاس را غیرفعال کنید یا پیکربندی‌ها را به کلاس دیگری ببرید`);
    return;
  }
  const n = w.next;
  const key = String(n.key ?? "").trim();
  if (!KEY.test(key)) throw validationError({ key: "کلید باید با حرف کوچک لاتین شروع شود و فقط حرف، رقم و _ داشته باشد" });
  n.key = key;
  if (w.prev && w.prev.key !== key) throw validationError({ key: "کلید سامانه‌ای کلاس تغییر نمی‌کند؛ نام نمایشی را تغییر دهید" });
  if (n.parent_key) {
    if (n.parent_key === key) throw validationError({ parent_key: "کلاس نمی‌تواند والد خودش باشد" });
    if (!tree.get(n.parent_key)) throw validationError({ parent_key: "کلاس والد پیدا نشد" });
    if (tree.ancestry(String(n.parent_key)).includes(key)) throw validationError({ parent_key: "این والد حلقه می‌سازد" });
  }
  const own: AttrDef[] = Array.isArray(n.attrs) ? n.attrs : [];
  const inherited = n.parent_key ? tree.resolve(String(n.parent_key))?.allAttrs ?? [] : [];
  const problems = attrProblems(own.filter((a) => !a?.archived), inherited, CI_FIELD_NAMES);
  if (problems.length) throw validationError({ attrs: problems[0] });
  n.attrs = w.prev ? keepArchived(own, Array.isArray(w.prev.attrs) ? w.prev.attrs : []) : own;
  if (n.rel_rules !== null && n.rel_rules !== undefined) {
    if (!Array.isArray(n.rel_rules)) throw validationError({ rel_rules: "قاعده‌های رابطه باید فهرست باشند" });
    for (const r of n.rel_rules) {
      if (!r || typeof r !== "object" || !String(r.type ?? "") || !["in", "out"].includes(String(r.direction))) throw validationError({ rel_rules: "هر قاعدهٔ رابطه نوع و جهت (in یا out) لازم دارد" });
    }
  }
  for (const f of ["required_fields", "recommended_fields", "operational_requires", "controlled_attrs"]) {
    const list: string[] = Array.isArray(n[f]) ? n[f] : [];
    const bad = list.find((p) => !CI_COLUMNS.has(p) && !p.startsWith("attrs.") && !CI_FIELD_NAMES.has(p));
    if (bad) throw validationError({ [f]: `«${bad}» فیلد پیکربندی نیست؛ برای ویژگی کلاس attrs.${bad} بنویسید` });
  }
}

async function classAfter(w: WriteArgs & { row: Row }): Promise<void> {
  invalidateCmdbCache(w.ctx.org.id);
  await mirrorChoice(w, "ci.class");
}

// ---------------------------------------------------------------------------------------------------------------
// Relationship types

async function relTypeBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") {
    const n = await countRows(w.tx, sysOf(w.ctx), "ci_rel", { f: "type", op: "eq", v: String(w.prev?.key ?? "") });
    if (n) throw conflict(`${n} رابطه از این نوع هست؛ نوع را غیرفعال کنید`);
    return;
  }
  const n = w.next;
  const key = String(n.key ?? "").trim();
  if (!KEY.test(key)) throw validationError({ key: "کلید باید با حرف کوچک لاتین شروع شود و فقط حرف، رقم و _ داشته باشد" });
  n.key = key;
  if (w.prev && w.prev.key !== key) throw validationError({ key: "کلید نوع رابطه تغییر نمی‌کند" });
  if (n.impact === "none") n.propagates = false;
  if (n.is_symmetric && !n.inverse_label) n.inverse_label = n.label;
}

async function relTypeAfter(w: WriteArgs & { row: Row }): Promise<void> {
  invalidateCmdbCache(w.ctx.org.id);
  await mirrorChoice(w, "ci_rel.type");
}

// ---------------------------------------------------------------------------------------------------------------
// CIs

/** A class attribute as an engine field (the engine's coercion validates it). */
export function attrField(a: AttrDef): FieldDef {
  return { name: a.name, label: a.label, type: a.type, choices: a.choices, min: a.min, max: a.max, maxLength: a.maxLength, required: a.required };
}

const NORMALIZED = ["mac_address", "hostname", "fqdn"];
/** Identifiers stored with Latin digits (people type Persian or Arabic ones; identification compares Latin ones). */
const DIGIT_IDENTS = ["serial_number", "asset_tag", "bios_uuid"];
const DIGIT_ATTRS = ["cert_serial", "imei"];

async function ciBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const tree = await classTree(w.tx, w.ctx);
  const cls = tree.get(n.class);
  if (!cls) throw validationError({ class: "کلاس پیکربندی پیدا نشد" });
  const people = !isSystem(w.ctx) && !w.trusted;
  if (people && (w.op === "create" || w.changed.has("class"))) {
    if (cls.abstract) throw validationError({ class: `«${cls.label}» کلاس انتزاعی است؛ یکی از زیرکلاس‌های آن را انتخاب کنید` });
    if (cls.create_disabled && w.op === "create") throw validationError({ class: `پیکربندی‌های «${cls.label}» فقط از کشف و ورود داده ساخته می‌شوند` });
    if (!cls.active && w.op === "create") throw validationError({ class: `کلاس «${cls.label}» غیرفعال است` });
  }
  for (const f of NORMALIZED) {
    if (!w.changed.has(f) || n[f] === null || n[f] === undefined) continue;
    const v = normalizeIdent(f, n[f]);
    if (f === "mac_address" && n[f] && !v) throw validationError({ mac_address: "نشانی MAC معتبر نیست" });
    n[f] = v;
  }
  for (const f of DIGIT_IDENTS) if (w.changed.has(f) && typeof n[f] === "string") n[f] = latinDigits(n[f]).trim();
  // class attributes: coerce what is set, keep what the class no longer offers (archived values stay)
  const resolved = tree.resolve(String(n.class));
  const defs = new Map((resolved?.allAttrs ?? []).map((a) => [a.name, a]));
  const raw = n.attrs && typeof n.attrs === "object" && !Array.isArray(n.attrs) ? (n.attrs as Record<string, unknown>) : {};
  if (n.attrs !== null && n.attrs !== undefined && (typeof n.attrs !== "object" || Array.isArray(n.attrs))) throw validationError({ attrs: "ویژگی‌های کلاس باید یک شیء باشند" });
  if (w.op === "create" || w.changed.has("attrs") || w.changed.has("class")) {
    const schema = await orgSchema(w.ctx, w.tx);
    const vc = { schema, tz: orgTz(w.ctx) };
    const prevAttrs = (w.prev?.attrs ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const def = defs.get(k);
      if (!def) {
        if (KEY.test(k)) out[k] = v;
        continue;
      }
      try {
        const c = coerceValue(attrField(def), v, vc, prevAttrs[k]);
        if (c !== null && c !== undefined && !(Array.isArray(c) && !c.length)) out[k] = c;
      } catch (e) {
        errors.attrs = errors.attrs ?? (e as Error).message;
      }
    }
    if (people) {
      for (const a of defs.values()) {
        if (a.required && (out[a.name] === undefined || out[a.name] === "")) errors.attrs = errors.attrs ?? `«${a.label}» را وارد کنید`;
      }
    }
    if (Object.keys(errors).length) throw validationError(errors);
    for (const k of DIGIT_ATTRS) if (typeof out[k] === "string") out[k] = latinDigits(out[k] as string).trim();
    n.attrs = out;
  }
  // provenance of what people set by hand (the reconciliation engine weighs it against the sources)
  if (people) {
    const meta = { ...((w.prev?.attr_meta ?? n.attr_meta ?? {}) as Record<string, any>) };
    const at = new Date().toISOString();
    let touched = false;
    for (const f of w.changed) {
      if (f === "attrs") {
        const before = (w.prev?.attrs ?? {}) as Record<string, unknown>;
        const after = (n.attrs ?? {}) as Record<string, unknown>;
        for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null)) continue;
          meta[attrPath(k)] = { ...(meta[attrPath(k)] ?? {}), src: "manual", by: w.ctx.user.id, at };
          touched = true;
        }
      } else if (CI_COLUMNS.has(f) && f !== "class" && f !== "state") {
        meta[f] = { ...(meta[f] ?? {}), src: "manual", by: w.ctx.user.id, at };
        touched = true;
      }
    }
    if (touched) n.attr_meta = meta;
  }
  // configuration control: controlled attributes change only with an authorising change
  if (w.op !== "create" && resolved?.allControlled.length) {
    const hit = resolved.allControlled.filter((p) => (p.startsWith("attrs.") ? w.changed.has("attrs") && JSON.stringify(ciValue(w.prev ?? {}, p) ?? null) !== JSON.stringify(ciValue(n, p) ?? null) : w.changed.has(p)));
    // the write names the change itself, and the change authorises it now (see authorisingChange)
    const given = !!n.change_id && !!w.input?.has("change_id");
    const authorised = hit.length > 0 && given && (await authorisingChange(w, String(n.change_id), String(n.id)));
    if (hit.length && !authorised) {
      const cfg = await cmdbConfig(w.tx, w.ctx);
      if (cfg.controlled_mode === "block" && people) {
        const labels = hit.map((p) => (p.startsWith("attrs.") ? defs.get(p.slice(6))?.label ?? p : tableDef("ci")?.fields.find((f) => f.name === p)?.label ?? p));
        throw validationError({
          change_id: given
            ? `این تغییر ویرایش «${labels.join("»، «")}» را مجاز نمی‌کند: تغییر باید زمان‌بندی‌شده یا در حال اجرا باشد و این پیکربندی را نام ببرد`
            : `«${labels.join("»، «")}» تحت کنترل تغییر است؛ «تغییر مجوز» را مشخص کنید`,
        });
      }
      if (cfg.controlled_mode !== "off") {
        const changes = hit.map((p) => ({ attribute: p, expected: ciValue(w.prev ?? {}, p) ?? null, actual: ciValue(n, p) ?? null }));
        await enqueue(w.tx, { kind: "cmdb.drift", orgId: w.ctx.org.id, payload: { ci: n.id, changes, actor: w.ctx.user.id, via: people ? "manual" : "system" } });
      }
    }
  }
}

/** States in which a change authorises work on its CIs (approved and scheduled, or being implemented). */
const AUTHORISING_STATES = ["scheduled", "implement"];

/**
 * Does this change authorise an edit of controlled attributes of the CI now: one the editor may read, authorised
 * (scheduled or being implemented, never a draft or a closed one) and naming the CI (its CI or affected CIs)?
 */
async function authorisingChange(w: WriteArgs, changeId: string, ciId: string): Promise<boolean> {
  const change = await liveRow(w.tx, w.ctx, "change_request", changeId);
  if (!change || !AUTHORISING_STATES.includes(String(change.state))) return false;
  return change.ci_id === ciId || (Array.isArray(change.affected_cis) && change.affected_cis.includes(ciId));
}

/** The CI as the caller may write it (readable, the provider's write rule and the table's row rule), else null. */
async function writableCi(w: WriteArgs, id: unknown): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const schema = await orgSchema(w.ctx, w.tx);
  const def = schema.def("ci") ?? tableDef("ci")!;
  const row = await loadReadable(w.tx, w.ctx, def, id, await condEnv(w.ctx));
  return row && row.$writable !== false && access().canWrite(w.ctx, def, row) ? row : null;
}

async function ciAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const org = w.ctx.org.id;
  const id = w.row.id as string;
  if (w.op === "delete") {
    await enqueue(w.tx, { kind: "cmdb.ci_removed", orgId: org, payload: { ci: id } });
    return;
  }
  if (w.op === "create" || w.changed.size) await enqueue(w.tx, { kind: "cmdb.health_ci", orgId: org, payload: { ci: id }, delayMs: 3000, dedupeKey: `cmdb.health_ci:${id}` });
  if (w.op !== "create" && (w.changed.has("owned_by") || w.changed.has("support_group_id") || w.changed.has("workspace_id"))) {
    await enqueue(w.tx, { kind: "cmdb.rel_anchors", orgId: org, payload: { ci: id }, dedupeKey: `cmdb.rel_anchors:${id}` });
  }
  if (w.op === "create" || w.changed.has("attrs") || [...w.changed].some((f) => CI_COLUMNS.has(f))) {
    await enqueue(w.tx, { kind: "cmdb.rel_rules", orgId: org, payload: { ci: id }, delayMs: 2000, dedupeKey: `cmdb.rel_rules:${id}` });
  }
  if (w.op !== "create" && w.changed.has("name")) await enqueue(w.tx, { kind: "cmdb.rel_labels", orgId: org, payload: { ci: id }, dedupeKey: `cmdb.rel_labels:${id}` });
}

/** «عملیاتی» needs what the class asks for (e.g. an owner and a support group). */
async function canOperate(w: WriteArgs): Promise<string | null> {
  // the system restoring a state the CI had (a merge undone, a retired CI discovered again) is not asked twice
  if (w.trusted && isSystem(w.ctx)) return null;
  const tree = await classTree(w.tx, w.ctx);
  const cls = tree.resolve(String(w.next.class));
  const missing = (cls?.operationalRequires ?? []).filter((p) => {
    const v = ciValue(w.next, p);
    return v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
  });
  if (!missing.length) return null;
  const labels = missing.map((p) => (p.startsWith("attrs.") ? cls?.allAttrs.find((a) => a.name === p.slice(6))?.label ?? p : tableDef("ci")?.fields.find((f) => f.name === p)?.label ?? p));
  return `برای «عملیاتی» شدن، «${labels.join("»، «")}» را مشخص کنید`;
}

// ---------------------------------------------------------------------------------------------------------------
// Relationships

async function relBefore(w: WriteArgs): Promise<void> {
  const sys = sysOf(w.ctx);
  const n = w.op === "delete" ? w.prev! : w.next;
  const parent = await liveRow(w.tx, sys, "ci", n.parent_id);
  const child = await liveRow(w.tx, sys, "ci", n.child_id);
  if (w.op !== "delete") {
    if (!parent || !child) throw validationError({ [parent ? "child_id" : "parent_id"]: "پیکربندی پیدا نشد" });
    if (n.parent_id === n.child_id) throw validationError({ child_id: "پیکربندی نمی‌تواند با خودش رابطه داشته باشد" });
    const types = await relTypes(w.tx, w.ctx);
    const t = types.get(String(n.type));
    if (!t) throw validationError({ type: "نوع رابطه پیدا نشد" });
    if (!t.active && (w.op === "create" || w.changed.has("type"))) throw validationError({ type: `نوع «${t.label}» غیرفعال است` });
    if (n.valid_to && n.valid_from && Date.parse(n.valid_to) < Date.parse(n.valid_from)) throw validationError({ valid_to: "«تا» نمی‌تواند پیش از «از» باشد" });
    const live = !n.valid_to || Date.parse(n.valid_to) > Date.now();
    if (live && (w.op === "create" || w.changed.has("parent_id") || w.changed.has("child_id") || w.changed.has("type") || w.changed.has("valid_to"))) {
      const pairs = t.symmetric ? [[n.parent_id, n.child_id], [n.child_id, n.parent_id]] : [[n.parent_id, n.child_id]];
      for (const [p, c] of pairs) {
        const dup = await liveRows(w.tx, sys, "ci_rel", { and: [{ f: "parent_id", op: "eq", v: p }, { f: "child_id", op: "eq", v: c }, { f: "type", op: "eq", v: n.type }, { or: [{ f: "valid_to", op: "empty" }, { f: "valid_to", op: "gt", v: new Date().toISOString() }] }] }, { limit: 2 });
        if (dup.some((d) => d.id !== n.id)) throw conflict("این رابطه از پیش برقرار است");
      }
    }
    n.label = relLabel(String(parent.name), t, String(child.name), String(n.type));
    // anchors of the parent: whoever may change it may change its relationships
    n.owned_by = parent.owned_by ?? null;
    n.support_group_id = parent.support_group_id ?? null;
    if (w.op === "create" && !n.workspace_id && parent.workspace_id) n.workspace_id = parent.workspace_id;
  }
  if (!isSystem(w.ctx)) {
    const schema = await orgSchema(w.ctx, w.tx);
    const def = schema.def("ci") ?? tableDef("ci")!;
    const prov = access();
    const ok = (parent && prov.canWrite(w.ctx, def, parent)) || (child && prov.canWrite(w.ctx, def, child));
    if (!ok) throw forbidden("برای ویرایش رابطه باید اجازهٔ تغییر یکی از دو پیکربندی را داشته باشید");
  }
}

async function relAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const r = w.op === "delete" ? w.prev! : w.row;
  for (const id of [r.parent_id, r.child_id].filter(isUuid)) await enqueue(w.tx, { kind: "cmdb.health_ci", orgId: w.ctx.org.id, payload: { ci: id }, delayMs: 3000, dedupeKey: `cmdb.health_ci:${id}` });
}

// ---------------------------------------------------------------------------------------------------------------
// Groups, rules, baselines, certification, de-duplication

async function groupBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (n.kind === "dynamic" && !n.condition) throw validationError({ condition: "گروه پویا شرط عضویت لازم دارد" });
  if (n.kind === "redundancy") {
    if (!n.ci_id) throw validationError({ ci_id: "گروه افزونگی پیکربندی خوشه را لازم دارد" });
    if (!n.min_up && !n.min_up_pct) throw validationError({ min_up: "کمینهٔ اعضای سالم یا درصد آن را مشخص کنید" });
    // a redundancy group softens the impact on its cluster (and the services above it): it is the cluster's writers'
    // to define, over members they may read, and a cluster has one
    if (!isSystem(w.ctx) && !w.trusted && (w.op === "create" || ["kind", "ci_id", "members", "min_up", "min_up_pct", "active"].some((f) => w.changed.has(f)))) {
      if (!(await writableCi(w, n.ci_id))) throw forbidden("گروه افزونگی را کسی تعریف می‌کند که اجازهٔ تغییر پیکربندی خوشه را دارد");
      const members = (Array.isArray(n.members) ? n.members : []).filter(isUuid);
      if (members.length && (await liveRows(w.tx, w.ctx, "ci", { f: "id", op: "in", v: members })).length !== new Set(members).size) {
        throw validationError({ members: "همهٔ اعضا باید پیکربندی‌هایی باشند که به آن‌ها دسترسی دارید" });
      }
    }
    if (n.active !== false && (w.op === "create" || ["kind", "ci_id", "active"].some((f) => w.changed.has(f)))) {
      const others = await liveRows(w.tx, sysOf(w.ctx), "ci_group", { and: [{ f: "kind", op: "eq", v: "redundancy" }, { f: "active", op: "eq", v: true }, { f: "ci_id", op: "eq", v: n.ci_id }] }, { limit: 2 });
      if (others.some((g) => g.id !== n.id)) throw conflict("این خوشه گروه افزونگی فعال دارد؛ همان را ویرایش کنید");
    }
  }
  if (n.kind === "dynamic" && n.condition) n.member_count = await countRows(w.tx, sysOf(w.ctx), "ci", n.condition);
  else n.member_count = Array.isArray(n.members) ? n.members.length : 0;
}

async function ruleBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (!n.check_condition && !n.required_rel) throw validationError({ check_condition: "شرط یا رابطهٔ لازم را مشخص کنید" });
  if (n.required_rel) {
    const r = n.required_rel;
    if (typeof r !== "object" || Array.isArray(r) || !r.type || !["in", "out"].includes(String(r.direction ?? "out"))) throw validationError({ required_rel: "رابطهٔ لازم باید نوع و جهت (in یا out) داشته باشد" });
  }
}

async function baselineBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "transition" && w.transition?.to === "approved") {
    n.approved_by = isSystem(w.ctx) ? null : w.ctx.user.id;
    n.approved_at = new Date().toISOString();
  }
  if (n.scope_kind === "class" && !n.class) throw validationError({ class: "کلاس خط مبنا را مشخص کنید" });
  if (n.scope_kind === "group" && !n.group_id) throw validationError({ group_id: "گروه پیکربندی را مشخص کنید" });
}

const baselineHasItems = (w: WriteArgs) => (Number(w.next.item_count ?? 0) > 0 ? null : "ابتدا «گرفتن عکس» را بزنید");

async function campaignBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete" && w.prev?.state !== "draft") throw conflict("دوره‌ای که آغاز شده حذف نمی‌شود؛ آن را لغو کنید");
}

async function campaignCanStart(w: WriteArgs): Promise<string | null> {
  const cond = w.next.condition ?? null;
  const n = await countRows(w.tx, sysOf(w.ctx), "ci", cond ? { and: [cond, { f: "owned_by", op: "nempty" }] } : { f: "owned_by", op: "nempty" });
  return n ? null : "هیچ پیکربندی دارای مالکی با این شرط پیدا نشد";
}

async function campaignAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "transition" && w.transition?.to === "active") {
    await generateCertTasks(w.tx, w.ctx, w.row);
  }
}

/** One certification task per owner with their CIs (capped), created with the campaign's start. */
export async function generateCertTasks(tx: WriteArgs["tx"], ctx: Ctx, campaign: Row): Promise<number> {
  const sys = sysOf(ctx);
  const cond = campaign.condition ?? null;
  const cis = await liveRows(tx, sys, "ci", cond ? { and: [cond, { f: "owned_by", op: "nempty" }] } : { f: "owned_by", op: "nempty" }, { order: "t.owned_by, t.name", limit: 5000 });
  const byOwner = new Map<string, string[]>();
  for (const c of cis) byOwner.set(c.owned_by, [...(byOwner.get(c.owned_by) ?? []), c.id]);
  let n = 0;
  for (const [owner, list] of [...byOwner].slice(0, 500)) {
    const existing = await liveRows(tx, sys, "ci_cert_task", eqAll({ campaign_id: campaign.id, assigned_to: owner }), { limit: 1 });
    if (existing.length) continue;
    await createIn(tx, sys, "ci_cert_task", {
      short_description: `تأیید دادهٔ ${list.length} پیکربندی — ${campaign.name}`,
      campaign_id: campaign.id, ci_ids: list.slice(0, 500), assigned_to: owner, due_at: campaign.due_at ?? null,
      description: campaign.description ?? null,
    }, { trusted: true });
    n++;
  }
  await updateIn(tx, sys, "ci_cert_campaign", campaign.id, { task_count: n + (Number(campaign.task_count) || 0) }, { trusted: true, keepVersion: true });
  return n;
}

async function certTaskAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (!(w.op === "transition" && w.transition?.to === "done")) return;
  const sys = sysOf(w.ctx, isSystem(w.ctx) ? null : w.ctx.user.id);
  const at = new Date().toISOString();
  let confirmed = 0;
  for (const id of (w.row.ci_ids ?? []).filter(isUuid)) {
    const ci = await liveRow(w.tx, sys, "ci", id);
    if (!ci) continue;
    // an owner certifies their own CIs: those of the task's assignee, or ones the person completing it may change
    if (!isSystem(w.ctx) && ci.owned_by !== w.row.assigned_to && !(await writableCi(w, id))) continue;
    await updateIn(w.tx, sys, "ci", id, { certified_at: at, certified_by: isSystem(w.ctx) ? null : w.ctx.user.id }, { trusted: true, keepVersion: true, allowLocked: true });
    confirmed++;
  }
  await updateIn(w.tx, sysOf(w.ctx), "ci_cert_task", w.row.id, { confirmed_count: confirmed }, { trusted: true, keepVersion: true });
  const campaign = await liveRow(w.tx, sysOf(w.ctx), "ci_cert_campaign", w.row.campaign_id);
  if (campaign) {
    const done = await countRows(w.tx, sysOf(w.ctx), "ci_cert_task", { and: [{ f: "campaign_id", op: "eq", v: campaign.id }, { f: "state", op: "in", v: ["done", "closed"] }] });
    await updateIn(w.tx, sysOf(w.ctx), "ci_cert_campaign", campaign.id, { done_count: done }, { trusted: true, keepVersion: true });
  }
}

async function dedupBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const list = [...new Set((n.candidates ?? []).filter(isUuid))].sort();
  if (list.length < 2) throw validationError({ candidates: "دست‌کم دو پیکربندی نامزد لازم است" });
  n.candidates = list;
  n.candidate_key = list.join(",").slice(0, 600);
  if (n.main_ci_id && !list.includes(n.main_ci_id)) throw validationError({ main_ci_id: "پیکربندی اصلی باید یکی از نامزدها باشد" });
}

async function configBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sum = Number(n.w_completeness ?? CMDB_CONFIG_DEFAULTS.w_completeness) + Number(n.w_correctness ?? CMDB_CONFIG_DEFAULTS.w_correctness) + Number(n.w_compliance ?? CMDB_CONFIG_DEFAULTS.w_compliance);
  if (sum <= 0) throw validationError({ w_completeness: "دست‌کم یکی از وزن‌ها باید بیشتر از صفر باشد" });
  if (n.cert_warn_days !== null && n.cert_warn_days !== undefined && (!Array.isArray(n.cert_warn_days) || n.cert_warn_days.some((d: unknown) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 365))) throw validationError({ cert_warn_days: "فهرستی از روزها، مثلاً [30, 14, 7]" });
}

async function sourceBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (n.kind === "url" && n.active !== false && !n.url) throw validationError({ url: "نشانی داده را وارد کنید" });
  if (n.mapping !== null && n.mapping !== undefined && (typeof n.mapping !== "object" || Array.isArray(n.mapping))) throw validationError({ mapping: "نگاشت باید شیئی از نام ستون به فیلد باشد" });
}

async function simBefore(w: WriteArgs): Promise<void> {
  if (w.op === "create" && !isSystem(w.ctx)) w.next.owner_id = w.ctx.user.id;
}

/** Definitions of the CMDB (classes, types, rules, policies) are changed by its administrators only. */
const ADMIN_TABLES = ["ci_class", "ci_rel_type", "ci_identification_rule", "ci_reconciliation_rule", "cmdb_rule", "ci_rel_rule", "cmdb_policy", "cmdb_data_source"];

async function adminOnly(w: WriteArgs): Promise<void> {
  if (!(await isCmdbAdmin(w.ctx, w.tx))) throw forbidden("تعریف‌های پایگاه پیکربندی را مدیر پیکربندی تغییر می‌دهد");
}

/** The hooks of the module's tables (installed once by `installCmdbModule`). */
export function installCmdbHooks(): (() => void)[] {
  return [
    ...ADMIN_TABLES.map((t) => registerHooks(t, { beforeWrite: adminOnly })),
    registerHooks("ci_class", { beforeWrite: classBefore, afterWrite: classAfter }),
    registerHooks("ci_rel_type", { beforeWrite: relTypeBefore, afterWrite: relTypeAfter }),
    registerHooks("ci", { beforeWrite: ciBefore, afterWrite: ciAfter, guards: { ci_can_operate: canOperate } }),
    registerHooks("ci_rel", { beforeWrite: relBefore, afterWrite: relAfter }),
    registerHooks("ci_group", { beforeWrite: groupBefore }),
    registerHooks("cmdb_rule", { beforeWrite: ruleBefore }),
    registerHooks("ci_baseline", { beforeWrite: baselineBefore, guards: { baseline_has_items: baselineHasItems }, redactRows: redactBaselines }),
    // copies of CI data in a run's row results follow the CIs' readability
    registerHooks("cmdb_import_run", { redactRows: redactRunResults }),
    registerHooks("ci_cert_campaign", { beforeWrite: campaignBefore, afterWrite: campaignAfter, guards: { campaign_can_start: campaignCanStart } }),
    registerHooks("ci_cert_task", { afterWrite: certTaskAfter }),
    registerHooks("cmdb_dedup_task", { beforeWrite: dedupBefore }),
    registerHooks("cmdb_config", { beforeWrite: configBefore }),
    registerHooks("cmdb_data_source", { beforeWrite: sourceBefore }),
    registerHooks("ci_impact_sim", { beforeWrite: simBefore }),
  ];
}


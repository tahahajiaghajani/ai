// The API of the field library and the table overlays (design F §3.1, §3.3, §4.2, §6.1, package F1), behind
// src/server/routes/fields.ts. Every write goes through the engine as the system with the person recorded as the actor
// (`systemCtx(…, { onBehalfOf })`): the integrity hooks (hooks.ts, combinations.ts) hold on this path as on every
// other, and history, events and sync see an ordinary write.
//   · who: library fields and field types — `process_design` write or `settings` edit; overrides of built-in tables
//     and attaching library fields — `settings` edit; lifecycle overlays — `settings` full; reading — `process_design`
//     read or `settings` edit (lifecycles: `settings` view). `settings` is the membership level or the access model's
//     grant in the area, whichever the person holds.
import type { FieldDef, TableDef } from "@shared/model/types";
import { FORM_ROW, cleanArrangement } from "@shared/model/arrangement";
import { LABELS_ONLY_LIFECYCLES, STATES_ROW, cleanLifecycle, transitionKey, type EffectiveTransition, type LifecycleOverlay } from "@shared/model/lifecycle";
import { lockedFields } from "@shared/forms/locked";
import { isRequiredFor, pathsOf, requirementBlockers, requirementEffects, type RequiredFor } from "@shared/forms/paths";
import {
  BUILTIN_FIELD_TYPES, FIELD_TYPE_GROUPS, availableBuiltinTypes, builtinFieldType, resolveFieldType, type FieldTypeRow,
} from "@shared/forms/fieldtypes";
import { CUSTOM_FIELD_TYPES } from "@shared/tables/core";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { createIn, orgSchema, removeIn, systemCtx, updateIn } from "../../engine";
import type { Row } from "../../engine/hooks";
import { SETTINGS_ENV, orgFieldTypes } from "./hooks";
import { libraryUsage, type FieldUsage } from "./usage";
import { NO_LIBRARY_TABLES, portalReportsThroughCatalogue } from "./combinations";
import { LIFECYCLE_REFUSAL, designGrant, holdsSettings, type SettingsLevel } from "./grants";

// ---------------------------------------------------------------------------------------------------------------
// Who may

/** Reads the library, the types, locks and paths: `process_design` read or `settings` edit. */
export async function needDesignRead(ctx: Ctx): Promise<void> {
  const g = await designGrant(ctx);
  if ((g && g.read !== "none") || (await holdsSettings(ctx, "edit"))) return;
  throw forbidden("به «فیلدها» دسترسی ندارید");
}

/** Writes library fields and field types: `process_design` write or `settings` edit. */
export async function needDesignWrite(ctx: Ctx): Promise<void> {
  const g = await designGrant(ctx);
  if ((g && (g.write !== "none" || g.create)) || (await holdsSettings(ctx, "edit"))) return;
  throw forbidden("ساخت و ویرایش فیلدها دسترسی «طراحی فرم و گردش‌کار» یا «تنظیمات سازمان» می‌خواهد");
}

export async function needSettings(ctx: Ctx, level: SettingsLevel): Promise<void> {
  if (await holdsSettings(ctx, level)) return;
  throw forbidden(level === "full" ? LIFECYCLE_REFUSAL : "این تنظیم دسترسی «تنظیمات سازمان» می‌خواهد");
}

/** The system, acting for the person: hooks hold, the person is the actor of history and events. */
const actingFor = (ctx: Ctx) => systemCtx(ctx.cfg, ctx.org.id, { onBehalfOf: ctx.user.id });

/** A built-in or studio table the organisation may tailor (404 otherwise). */
function physical(key: string): TableDef {
  const def = tableDef(key);
  if (!def || def.virtual) throw notFound(`جدول «${key}» وجود ندارد`);
  return def;
}

// ---------------------------------------------------------------------------------------------------------------
// The library and the types

export interface LibraryEntry {
  id: string;
  name: string;
  label: string;
  type: string;
  type_label: string;
  /** the storage type of the engine */
  storage: string | null;
  group: string | null;
  field_group: string | null;
  status: string;
  help: string | null;
  placeholder: string | null;
  usage: FieldUsage;
}

/** GET /fields/library — every library field with its type and where it is used. */
export async function libraryList(ctx: Ctx): Promise<{ fields: LibraryEntry[] }> {
  await needDesignRead(ctx);
  const [rows, types] = await Promise.all([
    ctx.db.query<Row>(
      `select id, name, label, type, field_group, status, help, placeholder from sm_field_defs where org_id = $1 and deleted_at is null order by label, name`,
      [ctx.org.id],
    ),
    orgFieldTypes(ctx.db, ctx.org.id),
  ]);
  // the tables it is attached to, and the forms and published versions (F2, F4) through `registerFieldUsage`
  const usage = await libraryUsage(ctx.db, ctx.org.id, rows.map((r) => ({ id: String(r.id), name: String(r.name) })));
  const fields: LibraryEntry[] = rows.map((r) => {
    const type = resolveFieldType(r.type, types, SETTINGS_ENV);
    const u = usage.get(String(r.id))!;
    return {
      id: String(r.id), name: String(r.name), label: String(r.label), type: String(r.type), type_label: type?.label ?? String(r.type),
      storage: type?.base ?? null, group: type?.group ?? null, field_group: r.field_group ?? null, status: String(r.status ?? "active"),
      help: r.help ?? null, placeholder: r.placeholder ?? null, usage: { tables: [...new Set(u.tables)], forms: u.forms, versions: u.versions },
    };
  });
  return { fields };
}

/** GET /fields/types — the built-in types (read-only, listed first) and the organisation's own. */
export async function typeList(ctx: Ctx) {
  await needDesignRead(ctx);
  const available = new Set(availableBuiltinTypes(SETTINGS_ENV.tableExists!).map((b) => b.key));
  const rows = await ctx.db.query<FieldTypeRow & { id: string; description: string | null }>(
    `select id, key, name, base, widget, validation, display, options, choices, status, description from sm_field_types where org_id = $1 and deleted_at is null order by name`,
    [ctx.org.id],
  );
  const counts = await ctx.db.query<{ type: string; n: number }>(`select type, count(*)::int as n from sm_field_defs where org_id = $1 and deleted_at is null group by type`, [ctx.org.id]);
  const used = new Map(counts.map((c) => [c.type, Number(c.n)]));
  const map = new Map(rows.map((r) => [r.key, r]));
  return {
    groups: FIELD_TYPE_GROUPS,
    builtin: BUILTIN_FIELD_TYPES.map((b) => ({
      key: b.key, label: b.label, group: b.group, storage: b.base, widget: b.settings.widget, settings: b.settings, editable: b.editable,
      available: available.has(b.key), fields: used.get(b.key) ?? 0,
    })),
    types: rows.map((r) => {
      const t = resolveFieldType(r.key, map, SETTINGS_ENV);
      return {
        id: String(r.id), key: r.key, name: r.name, base: r.base, base_label: builtinFieldType(r.base)?.label ?? r.base, storage: t?.base ?? null,
        widget: t?.settings.widget ?? r.widget ?? null, settings: t?.settings ?? null, status: r.status ?? "active", description: r.description ?? null,
        fields: used.get(r.key) ?? 0,
      };
    }),
  };
}

/** POST/PATCH of a library field or a field type (as the system, for the person). */
export async function writeLibrary(ctx: Ctx, table: "field_def" | "field_type", id: string | null, data: Record<string, unknown>): Promise<Row> {
  await needDesignWrite(ctx);
  const sys = await actingFor(ctx);
  return sys.write((tx) => (id ? updateIn(tx, sys, table, id, data) : createIn(tx, sys, table, data)));
}

// ---------------------------------------------------------------------------------------------------------------
// Locks, paths and attaching

/** GET /fields/locked/:table — the fields module code depends on, with their reasons. */
export async function lockedOf(ctx: Ctx, table: string) {
  await needDesignRead(ctx);
  const def = physical(table);
  return { table: def.key, locked: lockedFields(def) };
}

/** Does an inbound e-mail channel of the organisation create records of `table`? */
async function emailTarget(ctx: Ctx, table: string): Promise<boolean> {
  return !!(await ctx.db.one(`select 1 from sm_email_channels where org_id = $1 and target_table = $2 and inbound and active and deleted_at is null limit 1`, [ctx.org.id, table]));
}

/** GET /fields/paths/:table — who creates the table's records, and what a requirement «همه» / «فقط کارشناسان» binds. */
export async function pathsFor(ctx: Ctx, table: string, requiredFor: unknown) {
  await needDesignRead(ctx);
  const def = physical(table);
  const rf: RequiredFor = isRequiredFor(requiredFor) ? requiredFor : "all";
  const email = await emailTarget(ctx, def.key);
  const portalReportItem = await portalReportsThroughCatalogue(ctx.db, ctx.org.id);
  return {
    table: def.key,
    required_for: rf,
    paths: pathsOf(def.key, { emailTarget: email }),
    effects: requirementEffects(def.key, rf, { emailTarget: email }),
    blockers: requirementBlockers(def.key, rf, { portalReportItem }),
  };
}

export interface AttachInput {
  table: string;
  /** the library field: its id or its name */
  field: string;
  section?: string | null;
  required?: boolean;
  required_for?: RequiredFor | null;
  form_hidden?: boolean;
}

/** POST /fields/attach — a library field becomes a field of a table (an ordinary `custom_field` row naming it). */
export async function attachField(ctx: Ctx, input: AttachInput): Promise<{ row: Row; field: FieldDef | null }> {
  await needSettings(ctx, "edit");
  const def = physical(input.table);
  if (NO_LIBRARY_TABLES.has(def.key)) throw bad("پرونده‌های گردش‌کار فیلد کتابخانه نمی‌گیرند؛ فیلدهای پرونده در فرم‌های گردش‌کار تعریف می‌شوند");
  const lib = await ctx.db.one<{ id: string; name: string; label: string; type: string; status: string | null; help: string | null }>(
    `select id, name, label, type, status, help from sm_field_defs where org_id = $1 and deleted_at is null and (id::text = $2 or name = $2)`,
    [ctx.org.id, String(input.field ?? "")],
  );
  if (!lib) throw notFound("فیلد کتابخانه پیدا نشد");
  const type = resolveFieldType(lib.type, await orgFieldTypes(ctx.db, ctx.org.id), SETTINGS_ENV);
  // the row's own type column, when the custom-field manager can show it (a «پیوست» field's json is the library's)
  const storage = type && (CUSTOM_FIELD_TYPES as string[]).includes(type.base) ? type.base : null;
  const values: Row = {
    table_key: def.key, name: lib.name, label: lib.label, library_id: lib.id, type: storage, active: true,
    section: input.section ?? null, required: input.required === true, required_for: input.required ? (input.required_for ?? "all") : null,
    form_hidden: input.form_hidden === true,
  };
  const sys = await actingFor(ctx);
  const row = await sys.write(async (tx) => {
    const prior = await tx.one<{ id: string; active: boolean; library_id: string | null }>(
      `select id, active, library_id from sm_custom_fields where org_id = $1 and table_key = $2 and name = $3 and deleted_at is null`,
      [ctx.org.id, def.key, lib.name],
    );
    if (prior?.active) throw conflict(prior.library_id === lib.id ? `«${lib.label}» پیش‌تر به «${def.plural}» افزوده شده است` : `«${def.plural}» فیلدی به نام «${lib.name}» دارد`);
    // a field taken off the table earlier comes back with its values (they stayed in `custom`)
    return prior ? updateIn(tx, sys, "custom_field", prior.id, values) : createIn(tx, sys, "custom_field", values);
  });
  const field = (await orgSchema(sys)).def(def.key)?.fields.find((f) => f.name === lib.name) ?? null;
  return { row, field };
}

// ---------------------------------------------------------------------------------------------------------------
// System forms: the overrides of a table's default form

export interface OverrideInput {
  label?: string | null;
  help?: string | null;
  placeholder?: string | null;
  form_hidden?: boolean;
  required?: boolean;
  required_for?: RequiredFor | null;
}

const OVERRIDE_COLUMNS = ["label", "help", "placeholder", "form_hidden", "required", "required_for"] as const;

async function overrideRows(q: Queryable, orgId: string, table: string): Promise<Row[]> {
  return q.query<Row>(
    `select id, name, label, help, placeholder, form_hidden, required, required_for, library_id, options, active, list, section from sm_custom_fields
     where org_id = $1 and table_key = $2 and deleted_at is null order by sort_order, name`,
    [orgId, table],
  );
}

/** GET /forms/system/:table/overrides — every field of the table's form with the organisation's overrides. */
export async function systemOverrides(ctx: Ctx, table: string) {
  await needSettings(ctx, "edit");
  const base = physical(table);
  const eff = (await orgSchema(ctx)).def(base.key)!;
  const rows = await overrideRows(ctx.db, ctx.org.id, base.key);
  const byName = new Map(rows.filter((r) => r.active !== false).map((r) => [String(r.name), r]));
  const locks = lockedFields(base);
  const fields = eff.fields
    .filter((f) => !f.base && !f.hidden)
    .map((f) => {
      const own = base.fields.find((x) => x.name === f.name && !x.custom);
      const r = byName.get(f.name);
      return {
        name: f.name, label: f.label, default_label: own?.label ?? null, type: f.type, custom: !!f.custom, library: f.library ?? null,
        help: f.help ?? null, placeholder: f.placeholder ?? null, form_hidden: !!f.formHidden,
        required: !!f.formRequired, required_for: f.formRequired ?? null, module_required: !!own?.required, locked: locks[f.name] ?? [],
        overridden: !!r,
      };
    });
  const form = byName.get(FORM_ROW);
  return { table: base.key, fields, arrangement: form ? cleanArrangement(form.options) : null, overrides: rows.filter((r) => r.active !== false && r.name !== FORM_ROW && r.name !== STATES_ROW).length };
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());

/**
 * PUT /forms/system/:table/overrides — label, help and placeholder (the field's override, shared by every place the
 * table's form appears), «پنهان در فرم», «الزامی برای…», and the arrangement (`_form`), in one transaction. A
 * built-in field back at its defaults loses its override row. Library fields take their label, help and placeholder
 * from the library.
 */
export async function saveSystemOverrides(ctx: Ctx, table: string, input: { fields?: Record<string, OverrideInput>; arrangement?: unknown }) {
  await needSettings(ctx, "edit");
  const base = physical(table);
  const sys = await actingFor(ctx);
  const eff = (await orgSchema(sys)).def(base.key)!;
  await sys.write(async (tx) => {
    const rows = await overrideRows(tx, ctx.org.id, base.key);
    const live = (name: string) => rows.find((r) => r.name === name && r.active !== false) ?? rows.find((r) => r.name === name);
    for (const [name, o] of Object.entries(input.fields ?? {})) {
      const f = eff.fields.find((x) => x.name === name);
      if (!f || f.base || f.hidden) throw bad(`فیلد «${name}» در فرم «${base.plural}» نیست`);
      const r = live(name);
      const data: Row = {};
      for (const k of OVERRIDE_COLUMNS) if (o[k] !== undefined) data[k] = o[k];
      // whom a requirement binds: «همه» unless it says «فقط کارشناسان»; no requirement, no audience
      if (o.required === false) data.required_for = null;
      else if (o.required === true && !isRequiredFor(o.required_for)) data.required_for = isRequiredFor(r?.required_for) ? r!.required_for : "all";
      if (f.library && (["label", "help", "placeholder"] as const).some((k) => !blank(o[k]) && o[k] !== f[k])) {
        throw bad(`برچسب، راهنما و متن نمونهٔ «${f.label}» در «فیلدها» تغییر می‌کند و به همهٔ جدول‌هایش می‌رسد`);
      }
      if (f.custom) {
        // an organisation field: its own row carries everything
        if (!r) throw bad(`فیلد «${f.label}» پیدا نشد`);
        if (f.library) for (const k of ["label", "help", "placeholder"]) delete data[k];
        if (Object.keys(data).length) await updateIn(tx, sys, "custom_field", String(r.id), data);
        continue;
      }
      const own = base.fields.find((x) => x.name === name)!;
      const next = { label: r?.label ?? own.label, help: r?.help ?? null, placeholder: r?.placeholder ?? null, form_hidden: !!r?.form_hidden, required: !!r?.required, required_for: r?.required_for ?? null, ...data };
      // the older custom-field manager's list flag and form section live on the same row: it stays for them
      const atDefaults = (blank(next.label) || next.label === own.label) && blank(next.help) && blank(next.placeholder) && !next.form_hidden && !next.required && !r?.list && blank(r?.section);
      if (atDefaults) {
        if (r && r.active !== false) await removeIn(tx, sys, "custom_field", String(r.id));
        continue;
      }
      const values = { ...next, label: blank(next.label) ? own.label : next.label, active: true };
      if (r) await updateIn(tx, sys, "custom_field", String(r.id), values);
      else await createIn(tx, sys, "custom_field", { table_key: base.key, name, ...values });
    }
    if (input.arrangement !== undefined) {
      const r = live(FORM_ROW);
      const arrangement = input.arrangement === null ? null : cleanArrangement(input.arrangement);
      if (input.arrangement !== null && !arrangement) throw bad("چیدمان فرم معتبر نیست");
      if (!arrangement) {
        if (r) await removeIn(tx, sys, "custom_field", String(r.id));
      } else if (r) await updateIn(tx, sys, "custom_field", String(r.id), { options: arrangement, active: true });
      else await createIn(tx, sys, "custom_field", { table_key: base.key, name: FORM_ROW, label: "چیدمان فرم", options: arrangement, active: true });
    }
  });
  return systemOverrides(ctx, base.key);
}

// ---------------------------------------------------------------------------------------------------------------
// Lifecycles

/** Lines and links of tables whose lifecycle a module configures elsewhere (design F §4.3). */
const ELSEWHERE: Record<string, { text: string; link: string }> = {
  change_request: { text: "مرحله‌ها و الزام‌های تغییر در «مدل‌های تغییر» تنظیم می‌شود", link: "changes/models" },
  request_item: { text: "پیشرفت قلم‌های درخواست را قلم کاتالوگ، جریان تأمین یا برنامهٔ انجام آن تعیین می‌کند", link: "catalog-items" },
  journey: { text: "فعالیت‌های سفر را الگوی سفر تعیین می‌کند", link: "esm/journey-templates" },
  sec_incident: { text: "گام‌های پاسخ را دستورالعمل‌های پاسخ امنیتی تعیین می‌کنند", link: "security/playbooks" },
};

/** GET /lifecycles/:table — the module's lifecycle (locked parts marked), the organisation's overlay and the result. */
export async function lifecycleOf(ctx: Ctx, table: string) {
  await needSettings(ctx, "view");
  const base = physical(table);
  if (!base.states) throw bad(`«${base.plural}» چرخهٔ وضعیت ندارد`);
  const eff = (await orgSchema(ctx)).def(base.key)!;
  const row = (await overrideRows(ctx.db, ctx.org.id, base.key)).find((r) => r.name === STATES_ROW && r.active !== false);
  const notes: { text: string; link: string }[] = [];
  if (ELSEWHERE[base.key]) notes.push(ELSEWHERE[base.key]);
  const rule = await ctx.db.one(`select 1 from sm_approval_rules where org_id = $1 and table_key = $2 and active and deleted_at is null limit 1`, [ctx.org.id, base.key]).catch(() => null);
  if (rule) notes.push({ text: "این جدول قاعدهٔ تأیید دارد؛ قاعده رکورد را پس از تصمیم جابه‌جا می‌کند", link: "sla/approval-rules" });
  const merged = new Map(eff.states!.transitions.map((t) => [transitionKey(t), t as EffectiveTransition]));
  return {
    table: base.key,
    labels_only: LABELS_ONLY_LIFECYCLES.has(base.key),
    notes,
    states: base.states.states.map((s) => {
      const e = eff.states!.states.find((x) => x.value === s.value)!;
      return { value: s.value, category: s.category, default_label: s.label, default_color: s.color ?? null, label: e.label, color: e.color ?? null };
    }),
    transitions: base.states.transitions.map((t) => {
      const key = transitionKey(t);
      const e = merged.get(key);
      return {
        key, from: t.from, to: t.to, default_label: t.label, requires: t.requires ?? [], roles: t.roles ?? null, guard: !!t.guard, optional: !!t.optional,
        label: e?.label ?? t.label, primary: !!e?.primary, needs: e?.needs ?? [], also: e?.also ?? [], when: e?.when ?? null, message: e?.whenMessage ?? null, off: !e,
      };
    }),
    overlay: row ? cleanLifecycle(row.options) : null,
  };
}

/**
 * PUT /lifecycles/:table — the organisation's overlay (validated by the `_states` row's hook on every path); an empty
 * overlay restores the module's lifecycle («بازگشت به پیش‌فرض»).
 */
export async function saveLifecycle(ctx: Ctx, table: string, overlay: LifecycleOverlay | null) {
  await needSettings(ctx, "full");
  const base = physical(table);
  if (!base.states) throw bad(`«${base.plural}» چرخهٔ وضعیت ندارد`);
  const sys = await actingFor(ctx);
  const empty = !overlay || ((!overlay.states || !Object.keys(overlay.states).length) && !overlay.transitions?.length);
  await sys.write(async (tx) => {
    const r = (await overrideRows(tx, ctx.org.id, base.key)).find((x) => x.name === STATES_ROW);
    if (empty) {
      if (r) await removeIn(tx, sys, "custom_field", String(r.id));
      return;
    }
    if (r) await updateIn(tx, sys, "custom_field", String(r.id), { options: overlay, active: true });
    else await createIn(tx, sys, "custom_field", { table_key: base.key, name: STATES_ROW, label: "چرخهٔ عمر", options: overlay, active: true });
  });
  return lifecycleOf(ctx, base.key);
}

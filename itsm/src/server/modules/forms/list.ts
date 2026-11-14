// «فرم‌ها»: every form of the system in one list (design F D15, §8.2, package F2) — GET /forms:
//   · «فرم‌های سامانه»: each table's default form (every table people open on a form: the custom-field manager's
//     tables, the studio's under the organisation's names and only those it uses), with its fields, the
//     organisation's changes to it («تغییر نسبت به پیش‌فرض») and where it is used;
//   · «فرم‌های گردش‌کار»: the `form` rows, with their status, version and the processes that use them;
//   · the linked kinds, each opening its own editor: «فرم‌های کاتالوگ» (catalogue items and record producers),
//     «فرم‌های درگاه» (each portal's «گزارش مشکل»: its built-in form or the catalogue form chosen for it),
//     «نظرسنجی‌ها» and «پرسش‌نامهٔ ریسک تغییر».
// Who: `process_design` read or `settings` edit (as F1's library). A linked kind lists only what the caller may read in
// its own table (their own access, row by row); system forms and process forms are definitions those grants read.
import type { TableDef } from "@shared/model/types";
import { isNever } from "@shared/model/conditions";
import { areaLabel } from "@shared/access/areas";
import { physicalTables, tableDef } from "@shared/tables";
import { FORM_ROW } from "@shared/model/arrangement";
import { STATES_ROW } from "@shared/model/lifecycle";
import { isCustomSlot } from "@shared/admin/studio";
import { tableFormFields } from "@shared/forms/layout";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import { orgSchema } from "../../engine";
import { access } from "../../access/provider";
import { liveRows, sysOf } from "../incident/common";
import { NO_LIBRARY_TABLES } from "../fields";
import { canChangeSystemForms, canDesignForms, needFormsRead } from "./access";
import { formsUsage } from "./usage";

export type FormKind = "system" | "process" | "catalog" | "portal_report" | "survey" | "risk";

/** The kinds, in the list's order (labels of the kind chips). */
export const FORM_KINDS: Record<FormKind, string> = {
  system: "فرم‌های سامانه",
  process: "فرم‌های گردش‌کار",
  catalog: "فرم‌های کاتالوگ",
  portal_report: "فرم‌های درگاه",
  survey: "نظرسنجی‌ها",
  risk: "پرسش‌نامهٔ ریسک تغییر",
};

/** The kinds whose forms live in other modules and open those modules' editors. */
export const LINKED_KINDS: readonly FormKind[] = ["catalog", "portal_report", "survey", "risk"];

export interface FormEntry {
  /** unique in the list: «system:incident», «process:<id>», «catalog:<id>», «portal_report:<portal id>», «survey:<id>», «risk» */
  key: string;
  kind: FormKind;
  name: string;
  /** the table whose records the form fills (null: none of its own) */
  table: string | null;
  /** the group the list shows it under («رخدادها»، «گردش‌کارها»…) */
  group: string;
  /** the record behind the entry (a form, an item, a portal, a survey) */
  id: string | null;
  /** fields or questions on the form */
  fields: number;
  /** system forms: the organisation's changes to the default form (overrides and fields of its own) */
  overrides?: number;
  /** system forms: the organisation arranged the form's tabs and sections */
  arranged?: boolean;
  /** a status chip («پیش‌نویس»، «منتشرشده»، «فعال»…) */
  status?: string;
  version?: number;
  /** what this form is used in («درگاه اصلی: گزارش مشکل»، processes…) */
  used_in: string[];
  /** a line beside it (the portal's form in use) */
  note?: string;
  updated_at: string | null;
  /** where its editor opens (an app route under the organisation) */
  link: string;
  /** may the caller change it there */
  editable: boolean;
}

export interface FormsList {
  kinds: { key: FormKind; label: string; count: number; available: boolean }[];
  forms: FormEntry[];
}

/** Tables kept off the list: the customisation rows themselves (the field manager never offers them). */
const NO_SYSTEM_FORM = new Set(["custom_field", "choice", "view"]);

/**
 * The tables that have a default form: every table people open in the record page — not the customisation tables,
 * not the runtime tables nobody reads through the record API (`rowAccess.read` NEVER), and not tables whose values are
 * not fields of their own (a process case: its forms are process forms). `slots`: the studio's slots the organisation
 * uses (an unused slot is no table of its yet); without it, every slot.
 */
export function systemFormTables(slots?: ReadonlySet<string>): TableDef[] {
  return physicalTables().filter(
    (d) => !NO_SYSTEM_FORM.has(d.key) && !NO_LIBRARY_TABLES.has(d.key) && !isNever(d.rowAccess?.read ?? null) && (!slots || !isCustomSlot(d.key) || slots.has(d.key)),
  );
}

/** The organisation's studio tables by slot: their names (the studio's `custom_table` rows; names are not secret). */
async function studioNames(ctx: Ctx): Promise<Map<string, string>> {
  const rows = await liveRows(ctx.db, sysOf(ctx), "custom_table", null, { order: "t.slot" });
  return new Map(rows.map((r) => [String(r.slot), String(r.plural || r.label)]));
}

const LIMIT = 1000;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** The built-in «گزارش مشکل» of the portal: subject, details, how much it stops the person (and files). */
const PORTAL_REPORT_FIELDS = 3;

/** GET /forms (optionally one kind). */
export async function formsList(ctx: Ctx, opts: { kind?: FormKind | null } = {}): Promise<FormsList> {
  await needFormsRead(ctx);
  const want = (k: FormKind) => !opts.kind || opts.kind === k;
  const forms: FormEntry[] = [];
  const available: Record<FormKind, boolean> = { system: true, process: true, catalog: false, portal_report: false, survey: false, risk: false };
  const readable = (key: string) => {
    const def = tableDef(key);
    return !!def && access().canReadTable(ctx, def);
  };

  // the portals and what they report problems through (the incident form, or a catalogue form)
  const portals = readable("portal") ? await liveRows(ctx.db, ctx, "portal", { f: "active", op: "eq", v: true }, { order: "t.name", limit: 200 }) : [];
  const reportItems = new Map<string, string[]>();
  for (const p of portals) if (p.report_item_id) reportItems.set(String(p.report_item_id), [...(reportItems.get(String(p.report_item_id)) ?? []), String(p.name)]);
  const builtInReport = portals.filter((p) => !p.report_item_id).map((p) => String(p.name));
  const reportUse = (portal: string) => `${portal}: گزارش مشکل`;

  if (want("system")) {
    const schema = await orgSchema(ctx);
    const stats = await ctx.db.query<{ table_key: string; n: number; arranged: boolean; at: string | null }>(
      `select table_key,
              count(*) filter (where name not in ($2, $3))::int as n,
              bool_or(name = $2) as arranged,
              max(updated_at) as at
       from sm_custom_fields where org_id = $1 and deleted_at is null and active group by table_key`,
      [ctx.org.id, FORM_ROW, STATES_ROW],
    );
    const byTable = new Map(stats.map((s) => [s.table_key, s]));
    const editable = await canChangeSystemForms(ctx);
    const studio = await studioNames(ctx);
    for (const base of systemFormTables(new Set(studio.keys()))) {
      const def = schema.def(base.key) ?? base;
      const s = byTable.get(def.key);
      forms.push({
        key: `system:${def.key}`,
        kind: "system",
        name: studio.get(def.key) ?? def.plural,
        table: def.key,
        group: areaLabel(def.area),
        id: null,
        fields: tableFormFields(def).length,
        overrides: Number(s?.n ?? 0),
        arranged: !!s?.arranged,
        used_in: def.key === "incident" ? builtInReport.map(reportUse) : [],
        updated_at: iso(s?.at),
        link: `settings/forms/t/${def.key}`,
        editable,
      });
    }
  }

  if (want("process")) {
    const rows = await ctx.db.query<{ id: string; name: string; status: string | null; version_no: number | null; n: number; updated_at: string }>(
      `select id, name, status, version_no, coalesce(jsonb_array_length(case when jsonb_typeof(fields) = 'array' then fields end), 0)::int as n, updated_at
       from sm_forms where org_id = $1 and deleted_at is null order by name limit ${LIMIT}`,
      [ctx.org.id],
    );
    const usage = await formsUsage(ctx.db, ctx.org.id, rows.map((r) => ({ id: String(r.id), name: String(r.name) })));
    const editable = await canDesignForms(ctx);
    for (const r of rows) {
      forms.push({
        key: `process:${r.id}`,
        kind: "process",
        name: String(r.name),
        table: null,
        group: "گردش‌کارها",
        id: String(r.id),
        fields: Number(r.n ?? 0),
        status: String(r.status ?? "draft"),
        version: Number(r.version_no ?? 0),
        used_in: usage.get(String(r.id))?.processes ?? [],
        updated_at: iso(r.updated_at),
        link: `settings/forms/${r.id}`,
        editable,
      });
    }
  }

  if (readable("catalog_item")) {
    available.catalog = true;
    if (want("catalog")) {
      const items = await liveRows(ctx.db, ctx, "catalog_item", { f: "type", op: "ne", v: "content" }, { order: "t.name", limit: LIMIT });
      const ids = items.map((i) => String(i.id));
      const sets = [...new Set(items.flatMap((i) => (Array.isArray(i.variable_sets) ? i.variable_sets.map(String) : [])))];
      const [direct, inSets] = await Promise.all([
        ids.length
          ? ctx.db.query<{ k: string; n: number }>(`select item_id as k, count(*)::int as n from sm_catalog_variables where org_id = $1 and deleted_at is null and item_id = any($2::uuid[]) group by item_id`, [ctx.org.id, pgArray(ids)])
          : [],
        sets.length
          ? ctx.db.query<{ k: string; n: number }>(`select set_id as k, count(*)::int as n from sm_catalog_variables where org_id = $1 and deleted_at is null and set_id = any($2::uuid[]) group by set_id`, [ctx.org.id, pgArray(sets)])
          : [],
      ]);
      const own = new Map(direct.map((d) => [String(d.k), Number(d.n)]));
      const ofSet = new Map(inSets.map((d) => [String(d.k), Number(d.n)]));
      const itemDef = tableDef("catalog_item")!;
      const stateLabel = (v: unknown) => itemDef.states?.states.find((s) => s.value === v)?.label ?? String(v ?? "");
      const editable = access().canCreate(ctx, itemDef, null);
      for (const i of items) {
        const id = String(i.id);
        const setCount = (Array.isArray(i.variable_sets) ? i.variable_sets.map(String) : []).reduce((n: number, s: string) => n + (ofSet.get(s) ?? 0), 0);
        forms.push({
          key: `catalog:${id}`,
          kind: "catalog",
          name: String(i.name),
          table: i.type === "record_producer" && i.target_table ? String(i.target_table) : "request_item",
          group: areaLabel(itemDef.area),
          id,
          fields: (own.get(id) ?? 0) + setCount,
          status: stateLabel(i.state),
          used_in: (reportItems.get(id) ?? []).map(reportUse),
          updated_at: iso(i.updated_at),
          link: `catalog-items/${id}/builder`,
          editable,
        });
      }
    }
  }

  if (readable("portal")) {
    available.portal_report = true;
    if (want("portal_report")) {
      const itemNames = new Map<string, string>();
      const chosen = [...reportItems.keys()];
      if (chosen.length) {
        for (const r of await ctx.db.query<{ id: string; name: string }>(`select id, name from sm_catalog_items where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [ctx.org.id, pgArray(chosen)])) {
          itemNames.set(String(r.id), String(r.name));
        }
      }
      const counts = chosen.length
        ? new Map(
            (await ctx.db.query<{ k: string; n: number }>(`select item_id as k, count(*)::int as n from sm_catalog_variables where org_id = $1 and deleted_at is null and item_id = any($2::uuid[]) group by item_id`, [ctx.org.id, pgArray(chosen)])).map((d) => [String(d.k), Number(d.n)]),
          )
        : new Map<string, number>();
      const editable = access().canCreate(ctx, tableDef("portal")!, null);
      for (const p of portals) {
        const item = p.report_item_id ? String(p.report_item_id) : null;
        forms.push({
          key: `portal_report:${p.id}`,
          kind: "portal_report",
          name: portals.length > 1 ? `گزارش مشکل — ${p.name}` : "گزارش مشکل",
          table: "incident",
          group: areaLabel(tableDef("portal")!.area),
          id: String(p.id),
          fields: item ? (counts.get(item) ?? 0) : PORTAL_REPORT_FIELDS,
          status: "فعال",
          used_in: [String(p.name)],
          note: item ? `فرم کاتالوگ «${itemNames.get(item) ?? "قلمی که دیگر نیست"}»` : "فرم پیش‌فرض درگاه (رخداد)",
          updated_at: iso(p.updated_at),
          link: `portal-admin/portals/${p.id}`,
          editable,
        });
      }
    }
  }

  if (readable("survey")) {
    available.survey = true;
    if (want("survey")) {
      const surveys = await liveRows(ctx.db, ctx, "survey", null, { order: "t.name", limit: LIMIT });
      const ids = surveys.map((s) => String(s.id));
      const counts = ids.length
        ? new Map(
            (await ctx.db.query<{ k: string; n: number }>(`select survey_id as k, count(*)::int as n from sm_survey_questions where org_id = $1 and deleted_at is null and survey_id = any($2::uuid[]) group by survey_id`, [ctx.org.id, pgArray(ids)])).map((d) => [String(d.k), Number(d.n)]),
          )
        : new Map<string, number>();
      const editable = access().canCreate(ctx, tableDef("survey")!, null);
      for (const s of surveys) {
        forms.push({
          key: `survey:${s.id}`,
          kind: "survey",
          name: String(s.name),
          table: null,
          group: areaLabel(tableDef("survey")!.area),
          id: String(s.id),
          fields: counts.get(String(s.id)) ?? 0,
          status: s.active === false ? "غیرفعال" : "فعال",
          used_in: [],
          updated_at: iso(s.updated_at),
          link: `portal-admin/surveys/${s.id}`,
          editable,
        });
      }
    }
  }

  if (readable("change_risk_question")) {
    available.risk = true;
    if (want("risk")) {
      const qs = await liveRows(ctx.db, ctx, "change_risk_question", null, { order: "t.sort_order, t.id", limit: LIMIT });
      const active = qs.filter((q) => q.active !== false);
      forms.push({
        key: "risk",
        kind: "risk",
        name: "پرسش‌نامهٔ ریسک تغییر",
        table: "change_request",
        group: areaLabel(tableDef("change_request")!.area),
        id: null,
        fields: active.length,
        status: active.length ? "فعال" : "بی‌پرسش",
        used_in: [tableDef("change_request")!.plural],
        updated_at: qs.reduce<string | null>((at, q) => later(at, iso(q.updated_at)), null),
        link: "changes/risk-questions",
        editable: access().canCreate(ctx, tableDef("change_risk_question")!, null),
      });
    }
  }

  const kinds = (Object.keys(FORM_KINDS) as FormKind[]).map((key) => ({ key, label: FORM_KINDS[key], count: forms.filter((f) => f.kind === key).length, available: available[key] }));
  return { kinds, forms };
}

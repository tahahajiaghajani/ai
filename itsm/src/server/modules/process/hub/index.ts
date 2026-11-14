// «همهٔ گردش‌کارها در یک‌جا» (design F §4, §8.3, package F4c): `GET /process/hub` — read-only summaries of the nine
// kinds of workflow the product has, each row with its kind, table or category, status, last change and owner, what
// may be changed there and which editor opens it:
//   · «گردش‌کارهای سازمانی» (process: everything, draft → publish; the process designer), with their open cases;
//   · «چرخهٔ عمر رکوردها» (every table with states and its `_states` overlay: the safe subset — labels only for
//     change requests; the lifecycle editor);
//   · «مدل‌های تغییر», «قواعد تأیید», «جریان‌های خودکار», «جریان‌های تأمین کاتالوگ», «برنامه‌های انجام کاتالوگ»,
//     «سفرهای کارکنان», «دستورالعمل‌های پاسخ امنیتی» — owned by their modules, opened in their own pages.
// Rows are read as the caller (a kind they may not read is left empty), the processes by `process_design` read. The
// notices on top: customised roles without `work` create (§6.5, with «افزودن حق»), and published processes whose
// shared choice lists changed after publish (§3.2). «قاعده‌ها» links the rules that are not workflows (§1.6).
import { LABELS_ONLY_LIFECYCLES, STATES_ROW } from "@shared/model/lifecycle";
import { listsChanged, readSnapshot } from "@shared/forms/snapshot";
import { faDigits } from "@shared/format";
import { TABLES } from "@shared/tables";
import type { Ctx } from "../../../context";
import { pgArray } from "../../../db";
import { forbidden } from "../../../http/errors";
import { list, orgSchema, type ListParams } from "../../../engine";
import type { Row } from "../../../engine/hooks";
import { holdsSettings } from "../../fields/grants";
import { rolesWithoutWorkCreate, addWorkCreate } from "../access";
import { designRights } from "../publish";

export type HubKind = "process" | "lifecycle" | "change_model" | "approval_rule" | "flow" | "catalog_flow" | "catalog_tasks" | "journey" | "playbook";

/** The kinds, in the hub's order: chip label, what may be changed, and the module that owns them. */
export const HUB_KINDS: { key: HubKind; label: string; editable: string; module: string }[] = [
  { key: "process", label: "گردش‌کارهای سازمانی", editable: "همه چیز؛ پیش‌نویس و انتشار", module: "گردش‌کارها" },
  { key: "lifecycle", label: "چرخهٔ عمر رکوردها", editable: "تغییرهای امن", module: "ماژول جدول" },
  { key: "change_model", label: "مدل‌های تغییر", editable: "همه چیز", module: "مدیریت تغییر" },
  { key: "approval_rule", label: "قواعد تأیید", editable: "همه چیز", module: "توافق‌ها و تأییدها" },
  { key: "flow", label: "جریان‌های خودکار", editable: "همه چیز؛ با نسخه", module: "جریان‌های خودکار" },
  { key: "catalog_flow", label: "جریان‌های تأمین کاتالوگ", editable: "همه چیز", module: "کاتالوگ خدمات" },
  { key: "catalog_tasks", label: "برنامه‌های انجام کاتالوگ", editable: "همه چیز", module: "کاتالوگ خدمات" },
  { key: "journey", label: "سفرهای کارکنان", editable: "همه چیز", module: "خدمات سازمانی" },
  { key: "playbook", label: "دستورالعمل‌های پاسخ امنیتی", editable: "همه چیز", module: "امنیت" },
];

export interface HubRow {
  kind: HubKind;
  id: string;
  name: string;
  /** the table it works on (key and label), or its category */
  table: string | null;
  table_label: string | null;
  category: string | null;
  /** «منتشرشده نسخهٔ ۳»، «پیش‌نویس»، «فعال»، «غیرفعال»، «بازنشسته»، «سفارشی‌شده»، «پیش‌فرض» */
  status: string;
  active: boolean;
  /** processes only */
  open_cases?: number;
  updated_at: string | null;
  /** who changed it last (a member id) */
  owner: string | null;
  /** the module whose page edits it */
  module: string;
  /** all: everything; safe: the safe subset; labels: labels, colours and the primary transition */
  editable: "all" | "safe" | "labels";
  /** the app route of its editor */
  editor: string;
}

export interface HubNotice {
  kind: "roles_without_work" | "lists_changed";
  message: string;
  /** roles_without_work: the roles («افزودن حق»: POST /process/hub/roles/:key/work) */
  roles?: { key: string; name: string; holders: number }[];
  /** lists_changed: the process and the lists */
  process?: { id: string; name: string };
  lists?: string[];
}

export interface Hub {
  kinds: { key: HubKind; label: string; count: number; editable: string; module: string }[];
  rows: HubRow[];
  notices: HubNotice[];
  /** «قاعده‌ها»: the rules that are not workflows */
  rules: { label: string; link: string }[];
  /** no process yet: the page shows its first-use panel */
  empty: boolean;
  can: { create: boolean; publish: boolean };
}

const RULES: { label: string; link: string }[] = [
  { label: "قاعده‌های کسب‌وکار", link: "sla/business-rules" },
  { label: "قاعده‌های ارجاع", link: "sla/assignment-rules" },
  { label: "سیاست‌های فرم", link: "sla/ui-policies" },
  { label: "تعریف‌های توافق سطح خدمت", link: "sla/definitions" },
  { label: "قاعده‌های اعلان", link: "notify/rules" },
  { label: "کشیک و تشدید", link: "oncall/policies" },
  { label: "الزام‌های گزارش‌دهی امنیتی", link: "security/regimes" },
];

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const at = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : str(v));

/** Rows of a table as the caller reads them (none when they may not), with when and by whom each last changed. */
async function rowsOf(ctx: Ctx, table: string, fields: string[], more: Pick<ListParams, "ids"> = {}): Promise<Row[]> {
  let rows: Row[];
  try {
    rows = (await list(ctx, table, { fields, size: 500, total: false, ...more })).rows;
  } catch {
    return [];
  }
  const def = TABLES.get(table);
  if (!rows.length || !def) return rows;
  // the rows the caller read: their stamps (base columns the record API does not list)
  const stamps = new Map(
    (await ctx.db.query<{ id: string; updated_at: unknown; updated_by: string | null }>(`select id, updated_at, updated_by from ${def.table} where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, pgArray(rows.map((r) => String(r.id)))])).map((r) => [String(r.id), r]),
  );
  return rows.map((r) => ({ ...r, updated_at: stamps.get(String(r.id))?.updated_at ?? null, updated_by: stamps.get(String(r.id))?.updated_by ?? null }));
}

const versioned = (no: unknown, active: unknown) => {
  const n = Number(no) || 0;
  if (!n) return "پیش‌نویس";
  return `منتشرشده نسخهٔ ${faDigits(n)}${active === false ? " · غیرفعال" : ""}`;
};
const onOff = (active: unknown) => (active === false ? "غیرفعال" : "فعال");

/** The hub (see the header). `process_design` read or `settings` edit. */
export async function processHub(ctx: Ctx): Promise<Hub> {
  const design = await designRights(ctx);
  const settingsView = await holdsSettings(ctx, "view");
  if (!design.read && !(await holdsSettings(ctx, "edit"))) throw forbidden("به «گردش‌کارها»ی سازمان دسترسی ندارید");
  const org = ctx.org.id;
  const rows: HubRow[] = [];
  const notices: HubNotice[] = [];
  const kindOf = (k: HubKind) => HUB_KINDS.find((x) => x.key === k)!;

  // the organisation's own processes
  let processCount = 0;
  if (design.read) {
    const procs = await ctx.db.query<{ id: string; name: string; key: string; category: string | null; status: string; version_no: number | null; updated_at: unknown; updated_by: string | null; forms: unknown; open: number }>(
      `select p.id, p.name, p.key, p.category, p.status, p.version_no, p.updated_at, p.updated_by, v.forms,
         (select count(*)::int from sm_process_cases c where c.org_id = p.org_id and c.process_id = p.id and c.deleted_at is null and c.state in ('active', 'waiting', 'attention')) as open
       from sm_processes p left join sm_process_versions v on v.id = p.current_version_id and v.org_id = p.org_id
       where p.org_id = $1 and p.deleted_at is null order by p.name`,
      [org],
    );
    processCount = procs.length;
    const schema = await orgSchema(ctx);
    for (const p of procs) {
      rows.push({
        kind: "process", id: String(p.id), name: String(p.name), table: null, table_label: null, category: str(p.category),
        status: p.status === "retired" ? "بازنشسته" : p.status === "published" ? `منتشرشده نسخهٔ ${faDigits(Number(p.version_no) || 0)}` : "پیش‌نویس",
        active: p.status === "published", open_cases: Number(p.open) || 0, updated_at: at(p.updated_at), owner: str(p.updated_by),
        module: kindOf("process").module, editable: "all", editor: `settings/workflows/p/${p.id}`,
      });
      const snap = p.status === "published" ? readSnapshot(p.forms) : null;
      const changed = snap ? listsChanged(snap, (l) => schema.choices(l)) : [];
      if (changed.length) {
        notices.push({
          kind: "lists_changed", process: { id: String(p.id), name: String(p.name) }, lists: changed,
          message: `${changed.length === 1 ? `فهرست «${changed[0]}»` : `${faDigits(changed.length)} فهرست`} پس از انتشار «${p.name}» تغییر کرده است؛ برای به‌کاربردن آن دوباره منتشر کنید`,
        });
      }
    }
  }

  // lifecycles of every table with states (the overlay: `_states`)
  if (settingsView) {
    const overlays = new Map(
      (await ctx.db.query<{ table_key: string; updated_at: unknown; updated_by: string | null }>(
        `select table_key, updated_at, updated_by from sm_custom_fields where org_id = $1 and name = $2 and deleted_at is null and active is not false`,
        [org, STATES_ROW],
      )).map((r) => [String(r.table_key), r]),
    );
    for (const def of [...TABLES.values()].filter((d) => d.states && !d.virtual).sort((a, b) => a.plural.localeCompare(b.plural, "fa"))) {
      const o = overlays.get(def.key);
      rows.push({
        kind: "lifecycle", id: def.key, name: `چرخهٔ عمر «${def.plural}»`, table: def.key, table_label: def.plural, category: null,
        status: o ? "سفارشی‌شده" : "پیش‌فرض", active: true, updated_at: at(o?.updated_at), owner: str(o?.updated_by),
        module: kindOf("lifecycle").module, editable: LABELS_ONLY_LIFECYCLES.has(def.key) ? "labels" : "safe", editor: `settings/workflows/states/${def.key}`,
      });
    }
  }

  // the kinds other modules own (read as the caller)
  const label = (t: unknown) => (typeof t === "string" ? TABLES.get(t)?.plural ?? t : null);
  for (const r of await rowsOf(ctx, "change_model", ["name", "type", "active"])) {
    rows.push({ kind: "change_model", id: String(r.id), name: String(r.name), table: "change_request", table_label: label("change_request"), category: str(r.type), status: onOff(r.active), active: r.active !== false, updated_at: at(r.updated_at), owner: str(r.updated_by), module: kindOf("change_model").module, editable: "all", editor: "changes/models" });
  }
  for (const r of await rowsOf(ctx, "approval_rule", ["name", "table_key", "active"])) {
    rows.push({ kind: "approval_rule", id: String(r.id), name: String(r.name), table: str(r.table_key), table_label: label(r.table_key), category: null, status: onOff(r.active), active: r.active !== false, updated_at: at(r.updated_at), owner: str(r.updated_by), module: kindOf("approval_rule").module, editable: "all", editor: "sla/approval-rules" });
  }
  for (const r of await rowsOf(ctx, "flow", ["name", "trigger", "trigger_table", "active", "version_no"])) {
    if (r.trigger === "process") continue;
    const kind: HubKind = r.trigger === "catalog" ? "catalog_flow" : "flow";
    rows.push({ kind, id: String(r.id), name: String(r.name), table: str(r.trigger_table), table_label: label(r.trigger_table), category: str(r.trigger), status: versioned(r.version_no, r.active), active: r.active !== false, updated_at: at(r.updated_at), owner: str(r.updated_by), module: kindOf(kind).module, editable: "all", editor: `flows/${r.id}/design` });
  }
  const plans = await rowsOf(ctx, "catalog_task_template", ["item_id", "active"]);
  if (plans.length) {
    const items = new Map<string, number>();
    for (const t of plans) if (t.active !== false && typeof t.item_id === "string") items.set(t.item_id, (items.get(t.item_id) ?? 0) + 1);
    const cat = items.size ? await rowsOf(ctx, "catalog_item", ["name", "flow_id", "hidden"], { ids: [...items.keys()] }) : [];
    for (const i of cat) {
      if (i.flow_id) continue;
      rows.push({ kind: "catalog_tasks", id: String(i.id), name: String(i.name), table: "request_item", table_label: label("request_item"), category: `${faDigits(items.get(String(i.id)) ?? 0)} کار`, status: onOff(i.hidden !== true), active: i.hidden !== true, updated_at: at(i.updated_at), owner: str(i.updated_by), module: kindOf("catalog_tasks").module, editable: "all", editor: `catalog-items/${i.id}/builder` });
    }
  }
  for (const r of await rowsOf(ctx, "journey_template", ["name", "type", "active"])) {
    rows.push({ kind: "journey", id: String(r.id), name: String(r.name), table: "journey", table_label: label("journey"), category: str(r.type), status: onOff(r.active), active: r.active !== false, updated_at: at(r.updated_at), owner: str(r.updated_by), module: kindOf("journey").module, editable: "all", editor: "esm/journey-templates" });
  }
  for (const r of await rowsOf(ctx, "sec_playbook", ["name", "category", "active"])) {
    rows.push({ kind: "playbook", id: String(r.id), name: String(r.name), table: "sec_incident", table_label: label("sec_incident"), category: str(r.category), status: onOff(r.active), active: r.active !== false, updated_at: at(r.updated_at), owner: str(r.updated_by), module: kindOf("playbook").module, editable: "all", editor: "security/playbooks" });
  }

  // §6.5: customised roles without `work` create (needs the access view; others do not see the notice)
  try {
    const r = await rolesWithoutWorkCreate(ctx);
    if (r.message) notices.unshift({ kind: "roles_without_work", message: r.message, roles: r.roles.map((x) => ({ key: x.key, name: x.name, holders: x.holders })) });
  } catch {
    // no access view: no notice
  }

  return {
    kinds: HUB_KINDS.map((k) => ({ ...k, count: rows.filter((r) => r.kind === k.key).length })),
    rows,
    notices,
    rules: RULES,
    empty: design.read && processCount === 0,
    can: { create: design.create || design.write, publish: design.publish },
  };
}

/** «افزودن حق»: a customised role gains `work` create (the roles page's own save and checks). */
export const grantWorkCreate = (ctx: Ctx, key: string) => addWorkCreate(ctx, key);

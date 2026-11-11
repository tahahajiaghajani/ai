// «استودیو» — custom tables and fields on the record engine (catalogue ADM-001/005/007/009, PLT custom tables). A custom
// table claims a free slot of the registry (custom_01 … custom_10): its name, code and icon are a `custom_table` row, its
// fields `custom_field` rows named u_* (validated, filterable, searchable, audited and synced by the engine like every
// field), its form layout the `_form` arrangement row. Nothing here writes DDL or reads around the engine: the slots'
// tables exist through the additive schema reconciliation, and every write below goes through the record service
// with the administrator's own access (history, events, sync). Publishing keeps a snapshot (`studio_version`) that
// can be restored; a package (JSON) carries tables, fields, choice lists and forms to another organisation.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import type { FormArrangement, Option } from "@shared/model/types";
import { FORM_ROW } from "@shared/model/arrangement";
import {
  CUSTOM_SLOTS, fieldChanges, fieldProblem, isCustomSlot, packageProblem, STUDIO_ICONS, TABLE_CODE, tableCodeFor, iconFor,
  type PackageTable, type StudioField, type StudioPackage, type TablePlan, type FieldChange,
} from "@shared/admin/studio";
import { TABLES } from "@shared/tables";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { condEnv, createIn, invalidateSchema, readable, removeIn, updateIn } from "../../engine";
import { audit } from "../data/crud";
import { limitAtCommit, liveRows, needFeature, needWithinLimit, sysOf, type Row } from "./common";

const MAX_FIELDS = 120;

const cleanText = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The studio needs the settings area (edit) and the custom tables feature. */
export async function needStudio(ctx: Ctx): Promise<void> {
  ctx.need("settings", "edit");
  await needFeature(ctx, "custom_tables");
}

async function tableRows(tx: Tx | Ctx["db"], ctx: Ctx): Promise<Row[]> {
  return liveRows(tx, sysOf(ctx), "custom_table", null, { order: "t.slot" });
}

export interface SlotView {
  slot: string;
  table: Row | null;
  records: number;
  fields: number;
}

/**
 * Every slot, with the organisation's table in it (if any), its record and field counts — the studio's, so for those
 * who change settings; the records counted are the ones the caller reads.
 */
export async function studioOverview(ctx: Ctx): Promise<{ slots: SlotView[] }> {
  ctx.need("settings", "edit");
  const tables = await tableRows(ctx.db, ctx);
  const counts = await ctx.db.query<{ table_key: string; n: number }>(
    `select table_key, count(*)::int as n from sm_custom_fields where org_id = $1 and deleted_at is null and active and name like 'u\\_%' group by table_key`,
    [ctx.org.id],
  );
  const out: SlotView[] = [];
  for (const slot of CUSTOM_SLOTS) {
    const table = tables.find((t) => t.slot === slot) ?? null;
    let records = 0;
    if (table) {
      const def = TABLES.get(slot)!;
      const params: unknown[] = [];
      const where = readable(ctx, def, "t", params, await condEnv(ctx));
      const r = await ctx.db.one<{ n: number }>(`select count(*)::int as n from ${def.table} t where ${where} and t.deleted_at is null`, params);
      records = r?.n ?? 0;
    }
    out.push({ slot, table, records, fields: counts.find((c) => c.table_key === slot)?.n ?? 0 });
  }
  return { slots: out };
}

/** The custom fields of a table as studio fields (u_* rows only; relabelled built-in fields are not studio fields). */
export async function fieldsOf(q: Tx | Ctx["db"], ctx: Ctx, table: string): Promise<(StudioField & { id: string; active: boolean })[]> {
  const rows = await liveRows(q, sysOf(ctx), "custom_field", { and: [{ f: "table_key", op: "eq", v: table }] }, { order: "t.sort_order, t.name" });
  return rows
    .filter((r) => String(r.name).startsWith("u_"))
    .map((r) => ({
      id: String(r.id),
      active: r.active !== false,
      name: String(r.name),
      label: String(r.label ?? r.name),
      type: r.type,
      choices: r.choices ?? null,
      options: Array.isArray(r.options) ? (r.options as Option[]) : null,
      ref: r.ref ?? null,
      required: !!r.required,
      list: !!r.list,
      search: !!r.search,
      filter: !!r.filter,
      help: r.help ?? null,
      section: r.section ?? null,
      max_length: r.max_length ?? null,
      sort_order: r.sort_order ?? null,
    }));
}

async function formOf(q: Tx | Ctx["db"], ctx: Ctx, table: string): Promise<{ id: string; arrangement: FormArrangement | null } | null> {
  const [row] = await liveRows(q, sysOf(ctx), "custom_field", { and: [{ f: "table_key", op: "eq", v: table }, { f: "name", op: "eq", v: FORM_ROW }] }, { limit: 1 });
  return row ? { id: String(row.id), arrangement: (row.options as FormArrangement) ?? null } : null;
}

const fieldValues = (table: string, f: StudioField, order: number) => ({
  table_key: table,
  name: f.name,
  label: cleanText(f.label, 80),
  type: f.type,
  choices: f.choices ?? null,
  options: f.options ?? null,
  ref: f.ref ?? null,
  required: !!f.required,
  list: !!f.list,
  search: !!f.search,
  filter: !!f.filter,
  help: f.help ? cleanText(f.help, 300) : null,
  section: f.section ? cleanText(f.section, 80) : null,
  max_length: f.max_length ?? null,
  sort_order: f.sort_order ?? order,
  active: true,
});

/** Add or update fields of a table (with the caller's access); fields not named are left as they are. */
async function upsertFields(tx: Tx, ctx: Ctx, table: string, fields: StudioField[]): Promise<{ added: number; changed: number }> {
  const current = await fieldsOf(tx, ctx, table);
  let added = 0;
  let changed = 0;
  for (const [i, f] of fields.entries()) {
    const why = fieldProblem(f);
    if (why) throw bad(why);
    if ((f.type === "ref" || f.type === "refs") && f.ref && !TABLES.has(f.ref)) throw bad(`جدول مقصد «${f.ref}» فیلد «${f.label}» وجود ندارد`);
    const cur = current.find((c) => c.name === f.name);
    const values = fieldValues(table, f, (i + 1) * 10);
    if (!cur) {
      await createIn(tx, ctx, "custom_field", values);
      added++;
    } else {
      const { table_key: _t, name: _n, ...patch } = values;
      await updateIn(tx, ctx, "custom_field", cur.id, patch);
      changed++;
    }
  }
  return { added, changed };
}

export interface CreateTableInput {
  label: string;
  plural?: string | null;
  description?: string | null;
  icon?: string | null;
  code?: string | null;
  fields?: StudioField[];
}

/** A new custom table in the next free slot (with its first fields), as the administrator. */
export async function createCustomTable(ctx: Ctx, input: CreateTableInput): Promise<{ table: Row; slot: string; fields: number }> {
  await needStudio(ctx);
  const label = cleanText(input.label, 60);
  if (label.length < 2) throw bad("نام جدول را وارد کنید");
  const fields = (input.fields ?? []).slice(0, MAX_FIELDS);
  await needWithinLimit(ctx.db, ctx.cfg, ctx.org.id, "custom_tables", 1);
  if (fields.length) await needWithinLimit(ctx.db, ctx.cfg, ctx.org.id, "custom_fields", fields.length);
  const result = await ctx.write(async (tx) => {
    // the ceiling of custom tables again at commit (fields are checked by their own writes)
    limitAtCommit(tx, ctx.cfg, ctx.org.id, "custom_tables");
    const tables = await tableRows(tx, ctx);
    const slot = CUSTOM_SLOTS.find((s) => !tables.some((t) => t.slot === s));
    if (!slot) throw conflict(`همهٔ ${CUSTOM_SLOTS.length.toLocaleString("fa-IR")} جایگاه جدول سفارشی پر است`);
    const code = input.code?.trim() || tableCodeFor(label, tables.map((t) => String(t.code)));
    if (!TABLE_CODE.test(code)) throw bad("کد جدول باید با حرف کوچک لاتین شروع شود و فقط حرف، رقم و _ داشته باشد");
    if (tables.some((t) => t.code === code)) throw conflict(`کد «${code}» را جدول دیگری دارد`);
    const icon = input.icon && STUDIO_ICONS.includes(input.icon) ? input.icon : iconFor(label);
    const table = await createIn(
      tx,
      ctx,
      "custom_table",
      { slot, code, label, plural: cleanText(input.plural || `${label}‌ها`, 70), description: input.description ? String(input.description).slice(0, 2000) : null, icon, active: true },
      { trusted: true },
    );
    // a slot may hold fields from a table removed before: they stay off until named again
    await upsertFields(tx, ctx, slot, fields);
    await audit(tx, ctx, "studio_table_create", "custom_table", String(table.id), `جدول سفارشی «${label}» (${code}) در ${slot}`, { slot, code, fields: fields.length });
    return { table, slot, fields: fields.length };
  });
  invalidateSchema(ctx.org.id);
  return result;
}

async function tableBySlot(tx: Tx | Ctx["db"], ctx: Ctx, slot: string): Promise<Row> {
  if (!isCustomSlot(slot)) throw notFound("جایگاه جدول سفارشی پیدا نشد");
  const [t] = await liveRows(tx, sysOf(ctx), "custom_table", { f: "slot", op: "eq", v: slot }, { limit: 1 });
  if (!t) throw notFound("در این جایگاه جدولی تعریف نشده است");
  return t;
}

/** Add or change fields of a custom table (or of a built-in table: custom u_* fields only). */
export async function saveFields(ctx: Ctx, table: string, fields: StudioField[]): Promise<{ added: number; changed: number }> {
  await needStudio(ctx);
  if (!TABLES.has(table) || TABLES.get(table)!.virtual) throw notFound(`جدول «${table}» وجود ندارد`);
  if (isCustomSlot(table)) await tableBySlot(ctx.db, ctx, table);
  const current = await fieldsOf(ctx.db, ctx, table);
  const adding = fields.filter((f) => !current.some((c) => c.name === f.name)).length;
  if (adding) await needWithinLimit(ctx.db, ctx.cfg, ctx.org.id, "custom_fields", adding);
  const r = await ctx.write(async (tx) => {
    const out = await upsertFields(tx, ctx, table, fields.slice(0, MAX_FIELDS));
    await audit(tx, ctx, "studio_fields", "custom_field", null, `فیلدهای «${table}»: ${out.added} تازه، ${out.changed} تغییر`, { table });
    return out;
  });
  invalidateSchema(ctx.org.id);
  return r;
}

/** Remove a custom table: only when it holds no live records; its fields are removed and the slot is freed. */
export async function deleteCustomTable(ctx: Ctx, slot: string): Promise<void> {
  await needStudio(ctx);
  ctx.need("settings", "full");
  const def = TABLES.get(slot);
  await ctx.write(async (tx) => {
    const t = await tableBySlot(tx, ctx, slot);
    const n = await tx.one<{ n: number }>(`select count(*)::int as n from ${def!.table} where org_id = $1 and deleted_at is null`, [ctx.org.id]);
    if (n?.n) throw conflict(`این جدول ${n.n.toLocaleString("fa-IR")} رکورد دارد؛ نخست رکوردها را حذف یا جابه‌جا کنید`);
    for (const f of await fieldsOf(tx, ctx, slot)) await removeIn(tx, ctx, "custom_field", f.id);
    const form = await formOf(tx, ctx, slot);
    if (form) await removeIn(tx, ctx, "custom_field", form.id);
    await removeIn(tx, ctx, "custom_table", String(t.id));
    await audit(tx, ctx, "studio_table_delete", "custom_table", String(t.id), `حذف جدول سفارشی «${t.label}»`, { slot, code: t.code });
  });
  invalidateSchema(ctx.org.id);
}

// ---------------------------------------------------------------- snapshots and versions

async function choiceRows(q: Tx | Ctx["db"], ctx: Ctx, lists: string[]): Promise<{ list: string; options: Option[] }[]> {
  if (!lists.length) return [];
  const rows = await liveRows(q, sysOf(ctx), "choice", { f: "list", op: "in", v: lists }, { order: "t.list, t.sort_order, t.value" });
  return lists
    .map((list) => ({
      list,
      options: rows
        .filter((r) => r.list === list)
        .map((r) => ({ value: String(r.value), label: String(r.label ?? r.value), ...(r.color ? { color: r.color } : {}), ...(r.sort_order !== null && r.sort_order !== undefined ? { order: Number(r.sort_order) } : {}), ...(r.active === false ? { active: false } : {}) }) as Option),
    }))
    .filter((c) => c.options.length);
}

/** A custom table as a package table (references to other custom tables written as custom:<code>). */
async function packageTable(q: Tx | Ctx["db"], ctx: Ctx, t: Row, codes: Map<string, string>): Promise<PackageTable> {
  const fields = (await fieldsOf(q, ctx, String(t.slot))).filter((f) => f.active).map(({ id: _i, active: _a, ...f }) => ({ ...f, ref: f.ref && codes.has(f.ref) ? `custom:${codes.get(f.ref)}` : f.ref }));
  const form = await formOf(q, ctx, String(t.slot));
  return { code: String(t.code), label: String(t.label), plural: String(t.plural), description: t.description ?? null, icon: t.icon ?? null, fields, form: form?.arrangement ?? null };
}

/** Publish a custom table: a new numbered snapshot of its definition. */
export async function publishTable(ctx: Ctx, slot: string, note: string | null): Promise<Row> {
  await needStudio(ctx);
  return ctx.write(async (tx) => {
    const t = await tableBySlot(tx, ctx, slot);
    const tables = await tableRows(tx, ctx);
    const codes = new Map(tables.map((x) => [String(x.slot), String(x.code)]));
    const snap = await packageTable(tx, ctx, t, codes);
    const lists = [...new Set(snap.fields.map((f) => f.choices).filter((x): x is string => !!x))];
    const revision = Number(t.revision ?? 0) + 1;
    const version = await createIn(
      tx,
      ctx,
      "studio_version",
      { title: `${t.label} — نسخهٔ ${revision.toLocaleString("fa-IR")}`, table_code: t.code, revision, kind: "publish", note: note ? cleanText(note, 300) : null, snapshot: { table: snap, choices: await choiceRows(tx, ctx, lists) } },
      { trusted: true },
    );
    await updateIn(tx, ctx, "custom_table", String(t.id), { revision, published_at: new Date().toISOString() }, { trusted: true });
    await audit(tx, ctx, "studio_publish", "custom_table", String(t.id), `انتشار نسخهٔ ${revision} «${t.label}»`, { slot, revision });
    return version;
  });
}

/** Restore a published version: its fields are added or changed back, fields it did not have are switched off. */
export async function restoreVersion(ctx: Ctx, versionId: string): Promise<{ slot: string; revision: number }> {
  await needStudio(ctx);
  const r = await ctx.write(async (tx) => {
    const [v] = await liveRows(tx, sysOf(ctx), "studio_version", { f: "id", op: "in", v: [versionId] }, { limit: 1 });
    if (!v) throw notFound("نسخه پیدا نشد");
    const snap = (v.snapshot ?? {}) as { table?: PackageTable; choices?: { list: string; options: Option[] }[] };
    if (!snap.table) throw bad("این نسخه تصویر جدول ندارد");
    const tables = await tableRows(tx, ctx);
    const t = tables.find((x) => x.code === v.table_code);
    if (!t) throw notFound(`جدول با کد «${v.table_code}» دیگر وجود ندارد؛ آن را از بسته وارد کنید`);
    const slot = String(t.slot);
    const byCode = new Map(tables.map((x) => [String(x.code), String(x.slot)]));
    const fields = snap.table.fields.map((f) => ({ ...f, ref: f.ref?.startsWith("custom:") ? byCode.get(f.ref.slice(7)) ?? null : f.ref }));
    await upsertFields(tx, ctx, slot, fields.filter((f) => !((f.type === "ref" || f.type === "refs") && !f.ref)));
    for (const cur of await fieldsOf(tx, ctx, slot)) if (cur.active && !fields.some((f) => f.name === cur.name)) await updateIn(tx, ctx, "custom_field", cur.id, { active: false });
    await saveForm(tx, ctx, slot, snap.table.form ?? null);
    await updateIn(tx, ctx, "custom_table", String(t.id), { label: snap.table.label, plural: snap.table.plural, description: snap.table.description ?? null, ...(snap.table.icon && STUDIO_ICONS.includes(snap.table.icon) ? { icon: snap.table.icon } : {}) });
    const revision = Number(t.revision ?? 0) + 1;
    await createIn(tx, ctx, "studio_version", { title: `${snap.table.label} — بازگردانی به نسخهٔ ${Number(v.revision).toLocaleString("fa-IR")}`, table_code: t.code, revision, kind: "restore", note: `از نسخهٔ ${v.revision}`, snapshot: snap }, { trusted: true });
    await updateIn(tx, ctx, "custom_table", String(t.id), { revision, published_at: new Date().toISOString() }, { trusted: true });
    await audit(tx, ctx, "studio_restore", "custom_table", String(t.id), `بازگردانی «${t.label}» به نسخهٔ ${v.revision}`, { version: versionId });
    return { slot, revision };
  });
  invalidateSchema(ctx.org.id);
  return r;
}

async function saveForm(tx: Tx, ctx: Ctx, table: string, arrangement: FormArrangement | null): Promise<void> {
  const cur = await formOf(tx, ctx, table);
  if (!arrangement) return;
  if (cur) await updateIn(tx, ctx, "custom_field", cur.id, { options: arrangement, active: true });
  else await createIn(tx, ctx, "custom_field", { table_key: table, name: FORM_ROW, label: "چیدمان فرم", options: arrangement, active: true });
}

// ---------------------------------------------------------------- packages: export and import between organisations

/** The package of the organisation's custom tables (all, or the named slots) and the u_* fields of built-in tables. */
export async function exportPackage(ctx: Ctx, opts: { slots?: string[] | null; builtins?: boolean; title?: string | null } = {}): Promise<StudioPackage> {
  ctx.need("settings", "edit");
  const tables = await tableRows(ctx.db, ctx);
  const codes = new Map(tables.map((t) => [String(t.slot), String(t.code)]));
  const chosen = tables.filter((t) => !opts.slots?.length || opts.slots.includes(String(t.slot)));
  const out: StudioPackage = { format: "itsm-studio", version: 1, exported_at: new Date().toISOString(), title: opts.title ?? `${ctx.org.name}`, tables: [], fields: [], choices: [] };
  for (const t of chosen) out.tables.push(await packageTable(ctx.db, ctx, t, codes));
  if (opts.builtins !== false) {
    const rows = await ctx.db.query<{ table_key: string }>(
      `select distinct table_key from sm_custom_fields where org_id = $1 and deleted_at is null and active and name like 'u\\_%' and table_key not like 'custom\\_%' order by table_key`,
      [ctx.org.id],
    );
    for (const r of rows) {
      if (!TABLES.has(r.table_key)) continue;
      const fields = (await fieldsOf(ctx.db, ctx, r.table_key)).filter((f) => f.active).map(({ id: _i, active: _a, ...f }) => ({ ...f, ref: f.ref && codes.has(f.ref) ? `custom:${codes.get(f.ref)}` : f.ref }));
      if (fields.length) out.fields.push({ table: r.table_key, fields, form: (await formOf(ctx.db, ctx, r.table_key))?.arrangement ?? null });
    }
  }
  const lists = [...new Set([...out.tables.flatMap((t) => t.fields), ...out.fields.flatMap((g) => g.fields)].map((f) => f.choices).filter((x): x is string => !!x))];
  out.choices = await choiceRows(ctx.db, ctx, lists);
  return out;
}

export interface ImportPlan {
  tables: TablePlan[];
  fields: { table: string; label: string; fields: FieldChange[] }[];
  choices: { list: string; options: number }[];
  problems: string[];
}

/** What importing a package would change (dry run), or the change itself. */
export async function importPackage(ctx: Ctx, raw: unknown, opts: { dryRun: boolean }): Promise<ImportPlan & { applied: boolean }> {
  await needStudio(ctx);
  const problem = packageProblem(raw);
  if (problem) throw bad(problem);
  const pkg = raw as StudioPackage;
  const tables = await tableRows(ctx.db, ctx);
  const free = CUSTOM_SLOTS.filter((s) => !tables.some((t) => t.slot === s));
  const plan: ImportPlan = { tables: [], fields: [], choices: pkg.choices.map((c) => ({ list: c.list, options: c.options.length })), problems: [] };
  const slotOf = new Map<string, string | null>();
  for (const t of pkg.tables) {
    const cur = tables.find((x) => x.code === t.code);
    const slot = cur ? String(cur.slot) : free.shift() ?? null;
    slotOf.set(t.code, slot);
    if (!slot) plan.problems.push(`برای جدول «${t.label}» جایگاه خالی نمانده است`);
    const current = cur ? (await fieldsOf(ctx.db, ctx, String(cur.slot))).filter((f) => f.active) : [];
    plan.tables.push({ code: t.code, label: t.label, action: cur ? "update" : "create", slot, fields: fieldChanges(current, t.fields) });
  }
  for (const g of pkg.fields) {
    const def = TABLES.get(g.table);
    if (!def || def.virtual) {
      plan.problems.push(`جدول «${g.table}» در این سامانه نیست`);
      continue;
    }
    const current = (await fieldsOf(ctx.db, ctx, g.table)).filter((f) => f.active);
    plan.fields.push({ table: g.table, label: def.plural, fields: fieldChanges(current, g.fields) });
  }
  const resolve = (f: StudioField): StudioField => (f.ref?.startsWith("custom:") ? { ...f, ref: slotOf.get(f.ref.slice(7)) ?? null } : f);
  for (const f of [...pkg.tables.flatMap((t) => t.fields), ...pkg.fields.flatMap((g) => g.fields)].map(resolve))
    if ((f.type === "ref" || f.type === "refs") && (!f.ref || !TABLES.has(f.ref))) plan.problems.push(`مقصد فیلد «${f.label}» در این سامانه پیدا نشد`);
  const adding = [...plan.tables.flatMap((t) => t.fields), ...plan.fields.flatMap((g) => g.fields)].filter((f) => f.change === "new").length;
  const newTables = plan.tables.filter((t) => t.action === "create").length;
  if (opts.dryRun || plan.problems.length) return { ...plan, applied: false };
  if (newTables) await needWithinLimit(ctx.db, ctx.cfg, ctx.org.id, "custom_tables", newTables);
  if (adding) await needWithinLimit(ctx.db, ctx.cfg, ctx.org.id, "custom_fields", adding);
  await ctx.write(async (tx) => {
    if (newTables) limitAtCommit(tx, ctx.cfg, ctx.org.id, "custom_tables");
    for (const t of pkg.tables) {
      const slot = slotOf.get(t.code)!;
      const cur = (await tableRows(tx, ctx)).find((x) => x.code === t.code);
      const meta = { label: cleanText(t.label, 60), plural: cleanText(t.plural || `${t.label}‌ها`, 70), description: t.description ? String(t.description).slice(0, 2000) : null, icon: t.icon && STUDIO_ICONS.includes(t.icon) ? t.icon : "table" };
      if (cur) await updateIn(tx, ctx, "custom_table", String(cur.id), meta);
      else await createIn(tx, ctx, "custom_table", { ...meta, slot, code: t.code, active: true }, { trusted: true });
    }
    for (const c of pkg.choices) {
      const existing = await liveRows(tx, sysOf(ctx), "choice", { f: "list", op: "eq", v: c.list });
      for (const o of c.options) {
        const row = existing.find((r) => r.value === o.value);
        const values = { label: o.label, color: o.color ?? null, sort_order: o.order ?? null, active: o.active !== false };
        if (row) await updateIn(tx, ctx, "choice", String(row.id), values);
        else await createIn(tx, ctx, "choice", { list: c.list, value: o.value, ...values });
      }
    }
    for (const t of pkg.tables) {
      const slot = slotOf.get(t.code)!;
      await upsertFields(tx, ctx, slot, t.fields.map(resolve));
      await saveForm(tx, ctx, slot, t.form ?? null);
      const row = (await tableRows(tx, ctx)).find((x) => x.code === t.code)!;
      const revision = Number(row.revision ?? 0) + 1;
      await createIn(tx, ctx, "studio_version", { title: `${t.label} — ورود از بسته`, table_code: t.code, revision, kind: "import", note: pkg.title ? cleanText(`از «${pkg.title}»`, 300) : null, snapshot: { table: t, choices: pkg.choices } }, { trusted: true });
      await updateIn(tx, ctx, "custom_table", String(row.id), { revision, published_at: new Date().toISOString() }, { trusted: true });
    }
    for (const g of pkg.fields) {
      if (!TABLES.has(g.table)) continue;
      await upsertFields(tx, ctx, g.table, g.fields.map(resolve));
      if (g.form) await saveForm(tx, ctx, g.table, g.form);
    }
    await audit(tx, ctx, "studio_import", "custom_table", null, `ورود بستهٔ استودیو${pkg.title ? ` «${String(pkg.title).slice(0, 80)}»` : ""}: ${pkg.tables.length} جدول، ${adding} فیلد تازه`, { tables: pkg.tables.map((t) => t.code) });
  });
  invalidateSchema(ctx.org.id);
  return { ...plan, applied: true };
}

/** Refuse writes of a custom table's slot from anything but the studio (the slot is claimed by the studio only). */
export function slotGuard(ctx: Ctx, slot: unknown): void {
  if (slot !== undefined && slot !== null && !isCustomSlot(String(slot))) throw forbidden("جایگاه جدول سفارشی معتبر نیست");
}

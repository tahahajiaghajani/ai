// Pieces the notification settings pages share: the table picker (record tables a rule may watch), the recipients
// picker of a rule (people on the record, its user and group fields, named members, groups and roles), role options
// (built-in roles and the organisation's) and the conversion of a rule to the row the generic API stores.
import { useMemo } from "react";
import { Checkbox, Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { RECIPIENT_FLAGS, type RecipientFlag, type RecipientSpec } from "@shared/notify";
import { builtinRoles } from "@shared/access/builtins";
import { useOrg } from "../../lib/org";
import { Field } from "../../components/blocks";
import { RecordSelect, UserSelect } from "../../records/fields/RecordSelect";
import { recordsApi } from "../../records/data/api";
import type { Schema } from "../../records/model/schema";
import type { TableMeta } from "../../records/model/types";
import { recipientFields, ruleTableOk } from "./model";
import type { RuleView } from "./api";

/** Record tables a rule may watch, by label. */
export function ruleTables(schema: Schema | undefined): TableMeta[] {
  return [...(schema?.tables.values() ?? [])].filter(ruleTableOk).sort((a, b) => a.plural.localeCompare(b.plural, "fa"));
}

export function TableSelect({ schema, value, onChange, disabled, status, allowAll }: { schema: Schema | undefined; value: string | null; onChange: (v: string | null) => void; disabled?: boolean; status?: "error"; allowAll?: boolean }) {
  const options = useMemo(
    () => [...(allowAll ? [{ value: "*", label: "همهٔ جدول‌ها" }] : []), ...ruleTables(schema).map((t) => ({ value: t.key, label: t.plural }))],
    [schema, allowAll],
  );
  return (
    <Select
      showSearch
      optionFilterProp="label"
      value={value ?? undefined}
      options={options}
      onChange={(v) => onChange(v ?? null)}
      disabled={disabled}
      status={status}
      placeholder="جدول را انتخاب کنید"
      aria-label="جدول"
    />
  );
}

/** Built-in roles and the organisation's own (when the caller may read them), by key. */
export function useRoleOptions(schema: Schema | undefined): { value: string; label: string }[] {
  const { api, orgId } = useOrg();
  const readable = !!schema?.def("role");
  const rows = useQuery({
    queryKey: ["notify-roles", orgId],
    queryFn: () => recordsApi.list(api, "role", { size: 200, fields: ["key", "name"], total: false }),
    enabled: readable,
    staleTime: 60_000,
  });
  return useMemo(() => {
    const out = new Map<string, string>(builtinRoles().map((r) => [r.key, r.name]));
    for (const r of rows.data?.rows ?? []) if (typeof r.key === "string") out.set(r.key, String(r.name ?? r.key));
    return [...out].map(([value, label]) => ({ value, label }));
  }, [rows.data]);
}

export function RecipientsPicker({
  value,
  onChange,
  def,
  schema,
  display,
  disabled,
}: {
  value: RecipientSpec;
  onChange: (v: RecipientSpec) => void;
  def: TableMeta | undefined;
  schema: Schema | undefined;
  display?: Record<string, string>;
  disabled?: boolean;
}) {
  const roles = useRoleOptions(schema);
  const fields = recipientFields(def);
  const set = (p: Partial<RecipientSpec>) => {
    const next: RecipientSpec = { ...value, ...p };
    for (const k of Object.keys(next) as (keyof RecipientSpec)[]) {
      const v = next[k];
      if (v === false || (Array.isArray(v) && !v.length)) delete next[k];
    }
    onChange(next);
  };
  const flags = Object.keys(RECIPIENT_FLAGS) as RecipientFlag[];
  return (
    <div className="flex flex-col gap-3">
      <div className="nf-checks" role="group" aria-label="افراد رکورد">
        {flags.map((k) => (
          <Checkbox key={k} checked={!!value[k]} disabled={disabled} onChange={(e) => set({ [k]: e.target.checked } as Partial<RecipientSpec>)}>
            {RECIPIENT_FLAGS[k]}
          </Checkbox>
        ))}
      </div>
      <div className="nf-form">
        {def ? (
          <Field label="فیلدهای کاربر و گروه">
            <Select
              mode="multiple"
              value={value.fields ?? []}
              options={fields.map((f) => ({ value: f.name, label: f.label }))}
              onChange={(v) => set({ fields: v })}
              disabled={disabled || !fields.length}
              placeholder={fields.length ? "فیلد را انتخاب کنید" : "این جدول فیلد کاربر یا گروه ندارد"}
              aria-label="فیلدهای کاربر و گروه"
            />
          </Field>
        ) : null}
        <Field label="اعضا">
          <UserSelect multiple value={value.users ?? []} onChange={(v) => set({ users: (v as string[] | null) ?? [] })} display={display} disabled={disabled} placeholder="عضو را جست‌وجو کنید" aria-label="اعضا" />
        </Field>
        <Field label="گروه‌ها">
          <RecordSelect table="group" multiple value={value.groups ?? []} onChange={(v) => set({ groups: (v as string[] | null) ?? [] })} display={display} disabled={disabled} placeholder="گروه را جست‌وجو کنید" aria-label="گروه‌ها" />
        </Field>
        <Field label="نقش‌ها">
          <Select mode="multiple" value={value.roles ?? []} options={roles} optionFilterProp="label" onChange={(v) => set({ roles: v })} disabled={disabled} placeholder="نقش را انتخاب کنید" aria-label="نقش‌ها" />
        </Field>
      </div>
    </div>
  );
}

/** The editable part of a rule, as the generic API stores it. */
export interface RuleDraft {
  name: string;
  active: boolean;
  mandatory: boolean;
  table_key: string | null;
  event: RuleView["event"];
  custom_event: string | null;
  entry_kinds: string[];
  condition: RuleView["condition"];
  recipients: RecipientSpec;
  notify_actor: boolean;
  channels: RuleView["channels"];
  targets: string[];
  template_id: string | null;
  digest: boolean;
  builtin: string | null;
  description: string | null;
}

export const NEW_RULE: RuleDraft = {
  name: "",
  active: true,
  mandatory: false,
  table_key: null,
  event: "updated",
  custom_event: null,
  entry_kinds: [],
  condition: null,
  recipients: {},
  notify_actor: false,
  channels: ["in_app"],
  targets: [],
  template_id: null,
  digest: true,
  builtin: null,
  description: null,
};

/** A rule (the list's view or a stored row) as the editor's draft. */
export function draftOf(rule: object): RuleDraft {
  const r = rule as Record<string, unknown>;
  return {
    name: String(r.name ?? ""),
    active: r.active !== false,
    mandatory: !!r.mandatory,
    table_key: (r.table as string | undefined) ?? (r.table_key as string | undefined) ?? null,
    event: (r.event ?? "updated") as RuleDraft["event"],
    custom_event: (r.custom_event as string | null) ?? null,
    entry_kinds: Array.isArray(r.entry_kinds) ? (r.entry_kinds as string[]) : [],
    condition: (r.condition as RuleDraft["condition"]) ?? null,
    recipients: (r.recipients as RecipientSpec | undefined) ?? {},
    notify_actor: !!r.notify_actor,
    channels: Array.isArray(r.channels) ? (r.channels as RuleDraft["channels"]) : [],
    targets: Array.isArray(r.targets) ? (r.targets as string[]) : [],
    template_id: (r.template_id as string | null) ?? null,
    digest: r.digest !== false,
    builtin: (r.builtin as string | null) ?? null,
    description: (r.description as string | null) ?? null,
  };
}

/** The row to POST or PATCH (a built-in's copy keeps `table_key` «*»; the server sets it again). */
export function rowOf(d: RuleDraft): Record<string, unknown> {
  const { table_key, condition, ...rest } = d;
  return {
    ...rest,
    table_key: d.builtin ? "*" : table_key,
    condition: d.builtin ? null : condition,
    custom_event: d.event === "custom" ? d.custom_event : null,
    entry_kinds: d.event === "commented" || d.event === "mentioned" ? d.entry_kinds : [],
  };
}

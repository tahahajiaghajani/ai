// The designer's property panel: the selected step's settings (generated from its node type's fields in
// @shared/flows/nodes), with field pickers and data pills, and its problems; or, for «شروع», the flow's trigger and
// run identity (fields of the flow record, saved with the graph).
import { useState } from "react";
import { App, Button, Input, Select, Switch, Typography } from "antd";
import { KeyRound, Trash2 } from "lucide-react";
import {
  NODE_TYPES, RUN_AS_OPTIONS, TRIGGER_EVENTS, TRIGGER_KINDS, fieldShown, nodeDef, nodeTable,
  type ConfigField, type FlowNode, type FlowProblem, type TriggerConfig,
} from "@shared/flows";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { ICON, ICON14, Note } from "../../components/blocks";
import { RecordSelect, UserSelect } from "../../records";
import { ConditionEditor, DurationEditor, PillInput, PillTextArea, RecipientsEditor, RowsEditor, RulesEditor, TableSelect, ValuesEditor } from "./editors";
import { ScheduleEditor } from "./ScheduleEditor";
import { NodeIcon } from "./icons";
import { flowsApi, type FlowCatalog } from "./api";
import type { FieldLite, Pill } from "./model";

function Problems({ list }: { list: FlowProblem[] }) {
  if (!list.length) return null;
  const errors = list.filter((p) => p.level === "error");
  return (
    <Note tone={errors.length ? "danger" : "warning"}>
      {list.map((p, i) => (
        <div key={i}>{p.message}</div>
      ))}
    </Note>
  );
}

function Labelled({ label, children, problem }: { label: string; children: React.ReactNode; problem?: string }) {
  return (
    <div>
      <div className="fl-field-label">{label}</div>
      {children}
      {problem ? <div className="text-danger" style={{ fontSize: 12, marginTop: 2 }}>{problem}</div> : null}
    </div>
  );
}

const toNumber = (s: string) => {
  const t = s.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).trim();
  return t === "" ? undefined : Number(t);
};

export interface InspectorProps {
  node: FlowNode;
  trigger: Partial<TriggerConfig>;
  problems: FlowProblem[];
  pills: Pill[];
  readOnly: boolean;
  fieldsOf: (table: string) => FieldLite[] | undefined;
  catalog: FlowCatalog | undefined;
  onChange: (patch: { label?: string; config?: Record<string, unknown> }) => void;
  onRemove: () => void;
}

/** One setting of a node. */
function FieldEditor({ f, node, trigger, pills, readOnly, fieldsOf, catalog, set }: Omit<InspectorProps, "onChange" | "onRemove" | "problems"> & { f: ConfigField; set: (v: unknown) => void }) {
  const v = node.config[f.key];
  const table = nodeTable(node.config, trigger, f.tableKey ?? "table");
  switch (f.kind) {
    case "text":
      return <Input value={String(v ?? "")} dir={f.ltr ? "ltr" : undefined} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} disabled={readOnly} />;
    case "template":
    case "record":
      return <PillInput value={v ?? (f.kind === "record" ? "" : "")} pills={pills} onChange={set} placeholder={f.placeholder ?? (f.kind === "record" ? "{{trigger.record.id}}" : undefined)} ltr={f.ltr} disabled={readOnly} />;
    case "textarea":
      return <PillTextArea value={v} pills={pills} onChange={set} disabled={readOnly} />;
    case "body":
      return <PillTextArea value={v} pills={pills} onChange={set} ltr rows={6} disabled={readOnly} placeholder={'{"title": "{{trigger.record.short_description}}"}'} />;
    case "number":
      return <Input inputMode="numeric" value={v === undefined || v === null ? "" : faDigits(String(v))} onChange={(e) => set(toNumber(e.target.value))} disabled={readOnly} style={{ maxWidth: 160 }} />;
    case "switch":
      return <Switch checked={v === undefined ? f.default === true : !!v} onChange={set} disabled={readOnly} />;
    case "select":
      return <Select value={(v ?? f.default) as string} options={f.options} onChange={set} disabled={readOnly} />;
    case "table":
      return <TableSelect value={v} onChange={(t) => set(t ?? "")} placeholder={f.placeholder ?? "جدول"} creatable={node.type === "create_record"} disabled={readOnly} />;
    case "values":
      return <ValuesEditor value={v} onChange={set} fields={table ? fieldsOf(table) : undefined} pills={pills} disabled={readOnly} />;
    case "condition":
      return <ConditionEditor table={table} value={v} onChange={set} disabled={readOnly} />;
    case "rules":
      return <RulesEditor value={v} onChange={set} pills={pills} disabled={readOnly} />;
    case "recipients":
      return <RecipientsEditor value={v} onChange={set} fields={table ? fieldsOf(table) : undefined} disabled={readOnly} />;
    case "duration":
      return <DurationEditor value={v} onChange={set} disabled={readOnly} />;
    case "assignments":
      return <RowsEditor value={v} onChange={set} keys={["name", "value"]} labels={["نام", "مقدار"]} pills={pills} disabled={readOnly} addLabel="افزودن" />;
    case "mappings":
      return <RowsEditor value={v} onChange={set} keys={["name", "path"]} labels={["نام", "مسیر در پاسخ: data.items[0].id"]} ltrSecond disabled={readOnly} addLabel="افزودن" />;
    case "keyvalues":
      return <RowsEditor value={v} onChange={set} keys={["key", "value"]} labels={["نام", "مقدار"]} pills={pills} disabled={readOnly} addLabel="افزودن" />;
    case "flow":
      return <RecordSelect table="flow" value={typeof v === "string" ? v : null} onChange={(x) => set(x ?? "")} disabled={readOnly} openLink />;
    case "connection":
      return <RecordSelect table="flow_connection" value={typeof v === "string" ? v : null} onChange={(x) => set(x ?? "")} disabled={readOnly} openLink />;
    case "skill": {
      const skills = catalog?.skills ?? [];
      return (
        <Select
          value={typeof v === "string" && v ? v : undefined}
          placeholder={skills.length ? "مهارت" : "مهارتی نصب نیست"}
          options={skills.map((s) => ({ value: s.key, label: s.label }))}
          onChange={set}
          disabled={readOnly || !skills.length}
        />
      );
    }
  }
}

export function NodeInspector(p: InspectorProps) {
  const def = nodeDef(p.node.type)!;
  const set = (key: string) => (v: unknown) => {
    const config = { ...p.node.config };
    if (v === undefined || v === null || v === "") delete config[key];
    else config[key] = v;
    p.onChange({ config });
  };
  const fieldProblem = (key: string) => p.problems.find((x) => x.field === key && x.level === "error")?.message;
  const service =
    (p.node.type === "notify" && p.catalog && !p.catalog.services.notify && "سرویس اعلان هنوز نصب نیست؛ پیام در گزارش اجرا ثبت می‌شود") ||
    (p.node.type === "approval" && p.catalog && !p.catalog.services.approval && "تأیید در صفحهٔ اجرا انجام می‌شود تا سرویس تأیید نصب شود") ||
    null;
  return (
    <>
      <div className="fl-panel-h">
        <span className="fl-node-ic">
          <NodeIcon type={p.node.type} />
        </span>
        <span style={{ flex: 1 }}>{def.label}</span>
        {p.readOnly ? null : <Button size="small" type="text" danger icon={<Trash2 {...ICON14} />} onClick={p.onRemove} aria-label="حذف گام" />}
      </div>
      <div className="fl-panel-b">
        <Problems list={p.problems.filter((x) => !x.field)} />
        {service ? <Note>{service}</Note> : null}
        <Labelled label="نام گام">
          <Input value={p.node.label ?? ""} placeholder={def.label} maxLength={80} onChange={(e) => p.onChange({ label: e.target.value })} disabled={p.readOnly} />
        </Labelled>
        <Typography.Text type="secondary" copyable={{ text: `{{steps.${p.node.id}.output}}`, tooltips: ["رونوشت دادهٔ خروجی", "رونوشت شد"] }}>
          شناسهٔ گام: <bdi className="fl-mono">{p.node.id}</bdi>
        </Typography.Text>
        {def.fields.filter((f) => fieldShown(f, p.node.config)).map((f) => (
          <Labelled key={f.key} label={f.label} problem={fieldProblem(f.key)}>
            <FieldEditor f={f} {...p} set={set(f.key)} />
          </Labelled>
        ))}
      </div>
    </>
  );
}

/** What the trigger panel edits: the trigger fields of the flow record. */
export interface TriggerDraft {
  trigger: TriggerConfig["kind"];
  trigger_table: string | null;
  trigger_events: string[];
  trigger_fields: string[];
  trigger_condition: unknown;
  schedule: unknown;
  catalog_item: string | null;
  run_as: TriggerConfig["run_as"];
  run_as_user: string | null;
}

export function TriggerInspector({
  value, onChange, problems, readOnly, flowId, fieldsOf, saved,
}: { value: TriggerDraft; onChange: (patch: Partial<TriggerDraft>) => void; problems: FlowProblem[]; readOnly: boolean; flowId: string; fieldsOf: (t: string) => FieldLite[] | undefined; saved: boolean }) {
  const { api } = useOrg();
  const { modal } = App.useApp();
  const [token, setToken] = useState<string | null>(null);
  const issue = useAction(() => flowsApi.webhookToken(api, flowId), { onSuccess: (r) => setToken(r.token) });
  const fields = value.trigger_table ? fieldsOf(value.trigger_table) : undefined;
  const problem = (k: string) => problems.find((x) => x.field === k)?.message;
  const url = `${window.location.origin}/api/hooks/flows/${flowId}`;
  return (
    <>
      <div className="fl-panel-h">
        <span className="fl-node-ic">
          <NodeIcon type="trigger" />
        </span>
        <span>{NODE_TYPES.trigger.label}</span>
      </div>
      <div className="fl-panel-b">
        <Problems list={problems.filter((x) => !x.field && !x.node)} />
        <Labelled label="آغازگر" problem={problem("trigger")}>
          <Select value={value.trigger} options={TRIGGER_KINDS.map((k) => ({ value: k.value, label: k.label }))} onChange={(trigger) => onChange({ trigger })} disabled={readOnly} />
        </Labelled>
        <Labelled label={value.trigger === "record" ? "جدول رویداد" : "جدول رکوردها (اختیاری)"} problem={problem("trigger_table")}>
          <TableSelect value={value.trigger_table} onChange={(t) => onChange({ trigger_table: t, trigger_fields: [], trigger_condition: null })} disabled={readOnly} />
        </Labelled>
        {value.trigger === "record" ? (
          <>
            <Labelled label="رویدادها" problem={problem("trigger_events")}>
              <Select mode="multiple" value={value.trigger_events} options={TRIGGER_EVENTS.map((e) => ({ value: e.value, label: e.label }))} onChange={(trigger_events) => onChange({ trigger_events })} disabled={readOnly} />
            </Labelled>
            {value.trigger_events.includes("updated") ? (
              <Labelled label="فقط با تغییر این فیلدها" problem={problem("trigger_fields")}>
                <Select
                  mode="multiple"
                  allowClear
                  value={value.trigger_fields}
                  placeholder="هر فیلد"
                  options={(fields ?? []).filter((f) => !f.hidden && f.type !== "secret").map((f) => ({ value: f.name, label: f.label }))}
                  onChange={(trigger_fields) => onChange({ trigger_fields })}
                  disabled={readOnly || !fields}
                />
              </Labelled>
            ) : null}
            <Labelled label="شرط رکورد">
              <ConditionEditor table={value.trigger_table ?? ""} value={value.trigger_condition} onChange={(trigger_condition) => onChange({ trigger_condition })} disabled={readOnly} />
            </Labelled>
          </>
        ) : null}
        {value.trigger === "schedule" ? (
          <Labelled label="زمان‌بندی" problem={problem("schedule")}>
            <ScheduleEditor value={value.schedule} onChange={(schedule) => onChange({ schedule })} disabled={readOnly} />
          </Labelled>
        ) : null}
        {value.trigger === "catalog" ? (
          <Labelled label="قلم کاتالوگ" problem={problem("catalog_item")}>
            <Input dir="ltr" value={value.catalog_item ?? ""} onChange={(e) => onChange({ catalog_item: e.target.value || null })} disabled={readOnly} />
          </Labelled>
        ) : null}
        {value.trigger === "webhook" ? (
          <Labelled label="نشانی وب‌هوک">
            <Typography.Paragraph copyable className="fl-mono" style={{ direction: "ltr", textAlign: "left", marginBottom: 6 }}>
              {url}
            </Typography.Paragraph>
            <Button
              icon={<KeyRound {...ICON} />}
              disabled={readOnly || !saved}
              loading={issue.isPending}
              onClick={async () => {
                const ok = await new Promise<boolean>((resolve) =>
                  modal.confirm({ title: "کلید تازه بسازید؟", content: "کلید پیشین دیگر پذیرفته نمی‌شود.", okText: "ساختن کلید", cancelText: "انصراف", onOk: () => resolve(true), onCancel: () => resolve(false) }),
                );
                if (ok) issue.mutate(undefined);
              }}
            >
              کلید تازه
            </Button>
            {token ? (
              <Note tone="warning">
                کلید فقط همین یک بار نشان داده می‌شود:
                <Typography.Paragraph copyable className="fl-mono" style={{ direction: "ltr", textAlign: "left", margin: "4px 0 0" }}>
                  {token}
                </Typography.Paragraph>
              </Note>
            ) : null}
          </Labelled>
        ) : null}
        <Labelled label="اجرا با دسترسی" problem={problem("run_as")}>
          <Select value={value.run_as} options={RUN_AS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={(run_as) => onChange({ run_as })} disabled={readOnly} />
        </Labelled>
        {value.run_as === "user" || value.run_as === "trigger_user" ? (
          <Labelled label={value.run_as === "user" ? "کاربر اجرا" : "کاربر اجرا وقتی آغازکننده‌ای نیست"} problem={problem("run_as_user")}>
            <UserSelect value={value.run_as_user} onChange={(x) => onChange({ run_as_user: (x as string | null) ?? null })} disabled={readOnly} allowClear />
          </Labelled>
        ) : null}
      </div>
    </>
  );
}


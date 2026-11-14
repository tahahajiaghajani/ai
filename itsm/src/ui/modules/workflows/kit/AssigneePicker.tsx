// The role-then-people picker (design F §3.4, §8.4 «انجام‌دهنده» tab): who a step goes to. Each rule is chosen role
// first — the kind (نقش سازمانی، گروه، نقش دسترسی، افراد مشخص، مدیر مستقیم، رئیس واحد، فیلد فرم، انجام‌دهندهٔ مرحلهٔ قبل،
// درخواست‌دهنده) — then its scope (where the role is held, which group, how far up), then the people: the current
// holders of the chosen position with checkboxes («همهٔ دارندگان» or «فقط این افراد»; with a dynamic scope the ticked
// people are an intersection, and a warning says so). Below the rules: the explanation line and the pool warnings
// from the server's static estimate (POST /positions/estimate, from 30 people), who is kept out (the requester on
// approve steps), what happens when nobody is found, and the fallback rules.
// The value is the step's `StepAssignees` (@shared/process); the server checks it again on save and publish.
import { useId, useMemo, useState } from "react";
import { Button, Checkbox, Dropdown, Radio, Segmented, Select } from "antd";
import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { builtinRoles } from "@shared/access";
import {
  ASSIGNEE_KINDS, ASSIGNEE_KIND_LABELS, IF_NOBODY, IF_NOBODY_LABELS, MAX_RULES, POSITION_WHERE, POSITION_WHERE_LABELS, exclusionsOf, ifNobodyOf,
  type AssigneeKind, type AssigneeRule, type Exclusion, type Quorum, type StepAction, type StepAssignees,
} from "@shared/process";
import { UNIT_KINDS } from "@shared/tables/access";
import { faDigits } from "@shared/format";
import { localDate } from "@shared/model/jalali-buckets";
import { ApiError } from "../../../lib/api";
import { useOrg } from "../../../lib/org";
import { useDebounced } from "../../../lib/hooks";
import { Loader } from "../../../components/display";
import { RecordSelect } from "../../../records/fields/RecordSelect";
import { displayOf } from "../../../records/model/schema";
import { ESTIMATE_GATES, kitApi } from "./api";
import { newRule, ruleFields, validHolder, withMembers } from "./model";
import { PositionPicker } from "./PositionPicker";
import "./kit.css";

const I14 = { size: 14, strokeWidth: 1.5, absoluteStrokeWidth: true } as const;

/** What the rules may name besides the organisation's data: the step's forms' fields and the earlier steps. */
export interface AssigneeContext {
  /** fields of the process's forms: people and groups (`field`), units (`unit_field`) */
  fields?: { name: string; label: string; type: string; ref?: string | null }[];
  /** steps before this one (`step_actor`, exclusions) */
  steps?: { id: string; label: string }[];
}

export interface AssigneePickerProps extends AssigneeContext {
  value: StepAssignees;
  /** absent: read-only (a published version) */
  onChange?: (v: StepAssignees) => void;
  action: StepAction;
  quorum?: Quorum | null;
  className?: string;
}

const roleOptions = () => builtinRoles().map((r) => ({ value: r.key, label: r.name }));

// ---------------------------------------------------------------------------------------------------------------
// One rule

interface RuleProps extends AssigneeContext {
  rule: AssigneeRule;
  index: number;
  onChange?: (r: AssigneeRule) => void;
  onRemove?: () => void;
  /** fallback rules: no members filter */
  plain?: boolean;
}

function Holders({ rule, onChange }: { rule: Extract<AssigneeRule, { kind: "position" }>; onChange?: (r: AssigneeRule) => void }) {
  const { api, orgId, timezone } = useOrg();
  const labelId = useId();
  const pos = useQuery({
    queryKey: ["wfk-positions-of", orgId, "key", [rule.position]],
    queryFn: () => kitApi.positions(api, { keys: [rule.position] }),
    enabled: !!rule.position,
    staleTime: 300_000,
  });
  const positionId = pos.data?.[0]?.id ?? null;
  const unit = rule.where === "unit" ? (rule.unit ?? null) : null;
  const holders = useQuery({
    queryKey: ["wfk-holders", orgId, positionId, unit],
    queryFn: () => kitApi.holders(api, positionId!, unit),
    enabled: !!positionId && (rule.where !== "unit" || !!unit),
    staleTime: 60_000,
  });
  const today = localDate(Date.now(), timezone);
  const rows = (holders.data?.rows ?? []).filter((h) => validHolder(h, today));
  const people = [...new Map(rows.map((h) => [h.user_id, h])).values()];
  const members = rule.members ?? [];
  const only = members.length > 0;
  const dynamic = rule.where !== "anywhere" && rule.where !== "unit";
  const name = (id: string | null) => (id ? (displayOf(holders.data?.display, id) ?? "…") : "");
  if (!rule.position) return null;
  return (
    <div>
      <span className="wfk-lbl" id={labelId}>
        افراد
      </span>
      <Radio.Group
        aria-labelledby={labelId}
        value={only ? "only" : "all"}
        disabled={!onChange}
        onChange={(e) => onChange?.(withMembers(rule, e.target.value === "all" ? null : people.slice(0, 1).map((h) => h.user_id)))}
        options={[
          { value: "all", label: "همهٔ دارندگان" },
          { value: "only", label: "فقط این افراد", disabled: !people.length && !only },
        ]}
      />
      {holders.isFetching && !holders.data ? (
        <Loader />
      ) : only || people.length ? (
        <div className="wfk-holders" role="group" aria-label="دارندگان این نقش">
          {people.map((h) => (
            <label key={h.user_id}>
              <Checkbox
                aria-label={name(h.user_id)}
                checked={!only || members.includes(h.user_id)}
                disabled={!onChange || !only}
                onChange={(e) => onChange?.(withMembers(rule, e.target.checked ? [...members, h.user_id] : members.filter((m) => m !== h.user_id)))}
              />
              <span>{name(h.user_id)}</span>
              {h.org_unit_id ? <small>{name(h.org_unit_id)}</small> : null}
            </label>
          ))}
          {people.length ? null : <span className="wfk-line">این نقش اکنون دارنده‌ای ندارد</span>}
        </div>
      ) : (
        <p className="wfk-line">{rule.where === "unit" && !unit ? "واحد را برگزینید تا دارندگان آن دیده شوند." : "این نقش اکنون دارنده‌ای ندارد؛ با پیدا شدن دارنده، مرحله به او می‌رسد."}</p>
      )}
      {only && dynamic ? (
        <p className="wfk-warn">
          <CircleAlert {...I14} aria-hidden />
          <span>فقط این افراد، اگر در آن واحد باشند؛ ممکن است برای پرونده‌ای کسی نماند.</span>
        </p>
      ) : null}
    </div>
  );
}

function RuleEditor({ rule, index, onChange, onRemove, fields = [], steps = [], plain }: RuleProps) {
  const uid = useId();
  const off = !onChange;
  const set = (patch: Partial<AssigneeRule>) => onChange?.({ ...rule, ...patch } as AssigneeRule);
  const id = (k: string) => `${uid}-${k}`;
  const body = (() => {
    switch (rule.kind) {
      case "position":
        return (
          <>
            <div>
              <label className="wfk-lbl" htmlFor={id("pos")}>
                نقش سازمانی
              </label>
              <PositionPicker id={id("pos")} by="key" value={rule.position || null} disabled={off} allowClear={false} onChange={(v) => onChange?.({ kind: "position", position: String(v ?? ""), where: rule.where })} />
            </div>
            <div>
              <label className="wfk-lbl" htmlFor={id("where")}>
                کجا
              </label>
              <Select
                id={id("where")}
                value={rule.where}
                disabled={off}
                onChange={(where) => onChange?.({ kind: "position", position: rule.position, where, ...(rule.members ? { members: rule.members } : {}) })}
                options={POSITION_WHERE.map((w) => ({ value: w, label: POSITION_WHERE_LABELS[w] }))}
              />
            </div>
            {rule.where === "unit" ? (
              <div>
                <label className="wfk-lbl" htmlFor={id("unit")}>
                  واحد
                </label>
                <RecordSelect id={id("unit")} table="org_unit" value={rule.unit ?? null} disabled={off} onChange={(v) => set({ unit: (v as string | null) ?? undefined, members: undefined })} />
              </div>
            ) : null}
            {rule.where === "unit_field" ? (
              <div>
                <label className="wfk-lbl" htmlFor={id("ufield")}>
                  فیلد واحد در فرم
                </label>
                <Select id={id("ufield")} value={rule.unitField} disabled={off} placeholder="فیلدی از نوع واحد سازمانی" onChange={(unitField) => set({ unitField })} options={ruleFields(fields, "unit").map((f) => ({ value: f.name, label: f.label }))} />
              </div>
            ) : null}
            {rule.where === "requester_unit_up" ? (
              <div>
                <label className="wfk-lbl" htmlFor={id("ukind")}>
                  نزدیک‌ترین واحد از نوع
                </label>
                <Select id={id("ukind")} value={rule.unitKind} disabled={off} allowClear placeholder="نوع واحدِ خودِ نقش" onChange={(unitKind) => set({ unitKind: unitKind ?? undefined })} options={UNIT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
              </div>
            ) : null}
            {plain ? null : <Holders rule={rule} onChange={onChange} />}
          </>
        );
      case "group":
        return (
          <>
            <div>
              <label className="wfk-lbl" htmlFor={id("group")}>
                گروه
              </label>
              <RecordSelect id={id("group")} table="group" value={rule.group || null} disabled={off} onChange={(v) => onChange?.({ kind: "group", group: String(v ?? ""), ...(rule.leadsOnly ? { leadsOnly: true } : {}) })} />
            </div>
            <Checkbox checked={!!rule.leadsOnly} disabled={off} onChange={(e) => onChange?.({ kind: "group", group: rule.group, ...(e.target.checked ? { leadsOnly: true } : {}) })}>
              فقط سرپرستان گروه
            </Checkbox>
          </>
        );
      case "role":
        return (
          <div>
            <label className="wfk-lbl" htmlFor={id("role")}>
              نقش دسترسی
            </label>
            <Select id={id("role")} value={rule.role || undefined} disabled={off} showSearch={{ optionFilterProp: "label" }} placeholder="نقش دسترسی…" onChange={(role) => onChange?.({ kind: "role", role })} options={roleOptions()} />
          </div>
        );
      case "users":
        return (
          <div>
            <label className="wfk-lbl" htmlFor={id("users")}>
              افراد
            </label>
            <RecordSelect id={id("users")} table="user" multiple meFirst value={rule.users} disabled={off} onChange={(v) => onChange?.({ kind: "users", users: (v as string[] | null) ?? [] })} />
          </div>
        );
      case "manager":
        return (
          <>
            <div>
              <label className="wfk-lbl" htmlFor={id("of")}>
                مدیرِ
              </label>
              <Select
                id={id("of")}
                value={rule.of}
                disabled={off}
                onChange={(of) => set({ of })}
                options={[
                  { value: "requester", label: "درخواست‌دهنده" },
                  { value: "previous_actor", label: "انجام‌دهندهٔ مرحلهٔ پیشین" },
                ]}
              />
            </div>
            <div>
              <span className="wfk-lbl" id={id("depth")}>
                چند سطح بالاتر
              </span>
              <Segmented
                aria-labelledby={id("depth")}
                disabled={off}
                value={rule.depth ?? 1}
                onChange={(d) => onChange?.({ kind: "manager", of: rule.of, ...(Number(d) > 1 ? { depth: Number(d) as 2 | 3 } : {}) })}
                options={[1, 2, 3].map((d) => ({ value: d, label: d === 1 ? "مدیر مستقیم" : `${faDigits(d)} سطح` }))}
              />
            </div>
          </>
        );
      case "unit_head":
        return (
          <>
            <div>
              <label className="wfk-lbl" htmlFor={id("hof")}>
                رئیس کدام واحد
              </label>
              <Select
                id={id("hof")}
                value={rule.of}
                disabled={off}
                onChange={(of) => onChange?.({ kind: "unit_head", of, ...(rule.unitKind ? { unitKind: rule.unitKind } : {}) })}
                options={[
                  { value: "requester", label: "واحد درخواست‌دهنده" },
                  { value: "unit_field", label: "واحدی که فیلد فرم می‌گوید" },
                ]}
              />
            </div>
            {rule.of === "unit_field" ? (
              <div>
                <label className="wfk-lbl" htmlFor={id("hfield")}>
                  فیلد واحد در فرم
                </label>
                <Select id={id("hfield")} value={rule.unitField} disabled={off} placeholder="فیلدی از نوع واحد سازمانی" onChange={(unitField) => set({ unitField })} options={ruleFields(fields, "unit").map((f) => ({ value: f.name, label: f.label }))} />
              </div>
            ) : (
              <div>
                <label className="wfk-lbl" htmlFor={id("hkind")}>
                  نزدیک‌ترین واحد از نوع
                </label>
                <Select id={id("hkind")} value={rule.unitKind} disabled={off} allowClear placeholder="خودِ واحد درخواست‌دهنده" onChange={(unitKind) => set({ unitKind: unitKind ?? undefined })} options={UNIT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
              </div>
            )}
          </>
        );
      case "field":
        return (
          <div>
            <label className="wfk-lbl" htmlFor={id("field")}>
              فیلد فرم
            </label>
            <Select id={id("field")} value={rule.field || undefined} disabled={off} placeholder="فیلدی از نوع شخص یا گروه" onChange={(field) => onChange?.({ kind: "field", field })} options={ruleFields(fields, "people").map((f) => ({ value: f.name, label: f.label }))} />
          </div>
        );
      case "step_actor":
        return (
          <div>
            <label className="wfk-lbl" htmlFor={id("step")}>
              مرحله
            </label>
            <Select id={id("step")} value={rule.step || undefined} disabled={off} placeholder="مرحله‌ای پیش از این مرحله" onChange={(step) => onChange?.({ kind: "step_actor", step })} options={steps.map((s) => ({ value: s.id, label: s.label }))} />
          </div>
        );
      default:
        return <p className="wfk-line">مرحله به خود درخواست‌دهنده می‌رسد.</p>;
    }
  })();
  return (
    <div className="wfk-rule" role="group" aria-label={`قاعدهٔ ${faDigits(index + 1)}: ${ASSIGNEE_KIND_LABELS[rule.kind]}`}>
      <div className="wfk-rule-h">
        <Select
          aria-label="نوع انجام‌دهنده"
          value={rule.kind}
          disabled={off}
          onChange={(k: AssigneeKind) => onChange?.(newRule(k))}
          options={ASSIGNEE_KINDS.map((k) => ({ value: k, label: ASSIGNEE_KIND_LABELS[k] }))}
        />
        {onRemove ? <Button type="text" icon={<Trash2 {...I14} />} aria-label={`حذف قاعدهٔ ${faDigits(index + 1)}`} onClick={onRemove} /> : null}
      </div>
      {body}
    </div>
  );
}

function RuleList({ rules, onChange, ctx, plain, addLabel }: { rules: AssigneeRule[]; onChange?: (r: AssigneeRule[]) => void; ctx: AssigneeContext; plain?: boolean; addLabel: string }) {
  return (
    <>
      {rules.map((r, i) => (
        <RuleEditor
          key={i}
          index={i}
          rule={r}
          plain={plain}
          {...ctx}
          onChange={onChange ? (x) => onChange(rules.map((y, j) => (j === i ? x : y))) : undefined}
          onRemove={onChange ? () => onChange(rules.filter((_, j) => j !== i)) : undefined}
        />
      ))}
      {onChange && rules.length < MAX_RULES ? (
        <Dropdown menu={{ items: ASSIGNEE_KINDS.map((k) => ({ key: k, label: ASSIGNEE_KIND_LABELS[k] })), onClick: ({ key }) => onChange([...rules, newRule(key as AssigneeKind)]) }} trigger={["click"]}>
          <Button icon={<Plus {...I14} />} className="self-start">
            {addLabel}
          </Button>
        </Dropdown>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The explanation line

/** Is every rule complete enough to be estimated (otherwise the server would only say what is missing)? */
const complete = (r: AssigneeRule): boolean => {
  switch (r.kind) {
    case "position":
      return !!r.position && (r.where !== "unit" || !!r.unit) && (r.where !== "unit_field" || !!r.unitField);
    case "group":
      return !!r.group;
    case "role":
      return !!r.role;
    case "users":
      return r.users.length > 0;
    case "field":
      return !!r.field;
    case "step_actor":
      return !!r.step;
    case "unit_head":
      return r.of !== "unit_field" || !!r.unitField;
    default:
      return true;
  }
};

function Estimate({ value, action, quorum }: { value: StepAssignees; action: StepAction; quorum?: Quorum | null }) {
  const { api, orgId, allows } = useOrg();
  const may = ESTIMATE_GATES.some((g) => allows(g));
  const ready = value.assignees.length > 0 && value.assignees.every(complete);
  const body = useDebounced(useMemo(() => JSON.stringify({ step: value, action, quorum: quorum ?? null }), [value, action, quorum]), 400);
  const q = useQuery({
    queryKey: ["wfk-estimate", orgId, body],
    queryFn: () => kitApi.estimate(api, JSON.parse(body)),
    enabled: may && ready,
    retry: false,
    staleTime: 30_000,
  });
  if (!value.assignees.length) return <p className="wfk-warn"><CircleAlert {...I14} aria-hidden /><span>این مرحله انجام‌دهنده ندارد؛ دست‌کم یک قاعده بیفزایید.</span></p>;
  if (!may || !ready) return null;
  if (q.isLoading) return <Loader label="شمردن انجام‌دهنده‌ها" />;
  if (q.error) return <p className="wfk-warn"><CircleAlert {...I14} aria-hidden /><span>{q.error instanceof ApiError ? q.error.message : "برآورد انجام‌دهنده‌ها ممکن نشد"}</span></p>;
  const r = q.data;
  if (!r) return null;
  return (
    <div aria-live="polite">
      {r.rules.map((x) => (
        <p key={x.index} className="wfk-line">
          {x.line}
        </p>
      ))}
      {r.warnings.map((w) => (
        <p key={w} className="wfk-warn">
          <CircleAlert {...I14} aria-hidden />
          <span>{w}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * The rules alone — no exclusions, «اگر کسی پیدا نشد» or fallbacks: a process's starters, the recipients of «اعلان», the
 * people a reassign escalation hands a step to. `plain` leaves out the holders' checkboxes.
 */
export function AssigneeRules({ value, onChange, fields, steps, addLabel = "افزودن قاعده", plain, className }: AssigneeContext & { value: AssigneeRule[]; onChange?: (r: AssigneeRule[]) => void; addLabel?: string; plain?: boolean; className?: string }) {
  return (
    <div className={["wfk-who", className].filter(Boolean).join(" ")}>
      <RuleList rules={value} onChange={onChange} ctx={{ fields, steps }} plain={plain} addLabel={addLabel} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The step's people

export function AssigneePicker({ value, onChange, action, quorum, fields, steps, className }: AssigneePickerProps) {
  const uid = useId();
  const ctx: AssigneeContext = { fields, steps };
  const [fallbackOpen, setFallbackOpen] = useState(!!value.fallback?.length);
  const excluded = exclusionsOf(value, action);
  const set = (patch: Partial<StepAssignees>) => onChange?.({ ...value, ...patch });
  const toggle = (x: Exclusion, on: boolean) => set({ exclude: on ? [...new Set([...excluded, x])] : excluded.filter((e) => e !== x) });
  const off = !onChange;
  return (
    <div className={["wfk-who", className].filter(Boolean).join(" ")}>
      <RuleList rules={value.assignees} onChange={onChange ? (assignees) => set({ assignees }) : undefined} ctx={ctx} addLabel={value.assignees.length ? "قاعدهٔ دیگر" : "افزودن انجام‌دهنده"} />
      <Estimate value={value} action={action} quorum={quorum} />
      <div role="group" aria-label="کنار گذاشته‌ها">
        <Checkbox checked={excluded.includes("requester")} disabled={off} onChange={(e) => toggle("requester", e.target.checked)}>
          درخواست‌دهنده انجام‌دهندهٔ این مرحله نباشد
        </Checkbox>
        <Checkbox checked={excluded.includes("earlier_actors")} disabled={off} onChange={(e) => toggle("earlier_actors", e.target.checked)}>
          کسانی که در مرحله‌های پیشین کاری کرده‌اند نباشند
        </Checkbox>
      </div>
      <div>
        <label className="wfk-lbl" htmlFor={`${uid}-if-nobody`}>
          اگر کسی پیدا نشد
        </label>
        <Select id={`${uid}-if-nobody`} value={ifNobodyOf(value)} disabled={off} onChange={(ifNobody) => set({ ifNobody })} options={IF_NOBODY.map((k) => ({ value: k, label: IF_NOBODY_LABELS[k] }))} />
      </div>
      {fallbackOpen || value.fallback?.length ? (
        <div className="wfk-who" role="group" aria-label="قاعده‌های جایگزین">
          <span className="wfk-lbl">پیش از آن، این قاعده‌ها پرسیده شوند</span>
          <RuleList rules={value.fallback ?? []} plain ctx={ctx} onChange={onChange ? (fallback) => set({ fallback: fallback.length ? fallback : undefined }) : undefined} addLabel="قاعدهٔ جایگزین" />
        </div>
      ) : onChange ? (
        <Button type="link" className="self-start" onClick={() => setFallbackOpen(true)}>
          قاعدهٔ جایگزین برای وقتی کسی پیدا نشد
        </Button>
      ) : null}
    </div>
  );
}

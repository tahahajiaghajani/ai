// The designer's inspector (design F §8.4, package F6): the settings of the step chosen on the canvas.
//   · a form step: its name, its action (تکمیل فرم، بررسی، تأیید) and an approval's rule; then the tabs «انجام‌دهنده»
//     (role first, then people: the kit's AssigneePicker), «فرم» (the form placed at the step and the rights matrix),
//     «مهلت» (time, reminders, escalations), «اعلان‌ها» (the seeded messages it sends, edited in «قانون‌های اعلان») and
//     «مسیرها» (where each way out leads — the canvas's connections, without a mouse);
//   · «شرط» and «انتخاب»: comparisons on the case's values; «موازی» and «پیوستن»; «انتظار»; «اعلان»; «جریان خودکار»;
//     «تعیین مقدار»; «پایان» with how the case ends; «آغاز».
// Every change goes through `onGraph` (undo and redo, the autosave); typing in one box is one step to undo.
import { useId, useMemo } from "react";
import { Link } from "react-router";
import { Button, Checkbox, Dropdown, Input, InputNumber, Segmented, Select, Tabs } from "antd";
import { CircleAlert, ExternalLink, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import type { FlowProblem } from "@shared/flows/types";
import {
  PROCESS_NODE_TYPES, cleanDuration, cleanRule, endOutcomeOf, formStepOf, isProcessNodeType, processNodeLabel, quorumOf,
  type AssigneeRule, type Escalation, type ProcessGraph, type ProcessNode, type Quorum, type StepAction,
} from "@shared/process";
import type { MoneyUnit } from "@shared/financial/logic";
import { faDigits } from "@shared/format";
import { cx, Note } from "../../../../components/blocks";
import { Loader } from "../../../../components/display";
import { AssigneePicker, AssigneeRules, ProcessNodeIcon, RightsMatrix, nodeTitle } from "../../kit";
import type { FlowOption } from "./api";
import {
  ACTION_OPTIONS, END_OPTIONS, ESCALATION_LABELS, ESCALATION_TO_LABELS, NEW_STEP_OPTIONS, QUORUM_OPTIONS, addFromPort, assigneesOf, assigneesPatch, autoOutcomes, caseRules,
  dropConnection, earlierSteps, formPatch, inputRows, itemConfig, joinPatch, newCaseKey, newEscalation, newStepOf, outcomeText, patchConfig, portRows, quorumPatch, rawCases,
  removeNode, setAction, setCases, setLabel, setPortTarget, startersText, stepNotices, stepTitles, tabProblems, valueRows, waitsInBusinessTime,
  type CaseField, type FormChoice, type FormInfo, type InspectorTab,
} from "./model";
import { CaseRulesEditor, DurationField, F, I14, PillMenu } from "./parts";

export interface InspectorContext {
  graph: ProcessGraph;
  editable: boolean;
  /** the forms the steps use, loaded (layout and field definitions) */
  forms: ReadonlyMap<string, FormInfo>;
  /** a form still loading */
  formLoading: (id: string) => boolean;
  /** the process forms a step may use */
  formChoices: FormChoice[];
  /** the case's values (the fields of the process's forms) */
  fields: CaseField[];
  unit: MoneyUnit;
  orgId: string;
  /** «فرم تازه از همین‌جا»: the person may make forms */
  canNewForm: boolean;
  /** the person's menu has «قانون‌های اعلان» */
  canNotify: boolean;
  /** the automations the person reads (null: loading; "denied": closed to them) */
  flows: FlowOption[] | null | "denied";
  /** the process's starters (the start step's line) */
  starters: AssigneeRule[];
}

export interface NodeInspectorProps extends InspectorContext {
  node: ProcessNode;
  /** this step's problems */
  problems: FlowProblem[];
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  /** a change of the graph; `key` merges typing in one box into one step to undo */
  onGraph: (g: ProcessGraph, key?: string) => void;
  onSelect: (id: string | null) => void;
  onNewForm: (step: string) => void;
  onSettings: (field?: string) => void;
}

/** What kind of step it is, in words («تأیید»، «شرط»…). */
function kindText(n: ProcessNode): string {
  if (n.type === "form_step") {
    const s = formStepOf(n.config);
    if (s.start) return "مرحلهٔ آغاز";
    return ACTION_OPTIONS.find((a) => a.value === s.action)?.label ?? "مرحلهٔ فرم";
  }
  return isProcessNodeType(n.type) ? PROCESS_NODE_TYPES[n.type].label : n.type;
}

function NodeProblems({ problems }: { problems: FlowProblem[] }) {
  if (!problems.length) return null;
  return (
    <ul className="wfp-probs" aria-label="ایرادهای این گام">
      {problems.map((p, i) => (
        <li key={i} className={cx("wfp-prob", p.level === "error" ? "is-error" : "is-warning")}>
          {p.level === "error" ? <CircleAlert {...I14} aria-hidden /> : <TriangleAlert {...I14} aria-hidden />}
          <span>{p.message}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// «مسیرها»: where each way out leads

function PortsEditor({ node, graph, editable, onGraph, onSelect }: Pick<NodeInspectorProps, "node" | "graph" | "editable" | "onGraph" | "onSelect">) {
  const uid = useId();
  const rows = portRows(graph, node.id);
  const titles = stepTitles(graph);
  const step = node.type === "form_step" ? formStepOf(node.config) : null;
  if (!rows.length) return <p className="rk-hint">پرونده در این گام به پایان می‌رسد.</p>;
  const pick = (port: string, v: string | null) => {
    const made = v ? newStepOf(v) : null;
    if (made) {
      const r = addFromPort(graph, node.id, port, made.item, { label: made.label, config: made.config ? { ...itemConfig(made.item), ...made.config } : undefined });
      onGraph(r.graph);
    } else onGraph(setPortTarget(graph, node.id, port, v));
  };
  return (
    <div className="wfp-ports">
      {rows.map((r) => {
        const id = `${uid}-${r.port.key}`;
        const current = r.targets[0];
        const options = r.options.some((o) => o.value === current) || !current ? r.options : [{ value: current, label: titles.get(current) ?? current }, ...r.options];
        return (
          <div key={r.port.key} className="wfp-port">
            <label className="wfp-port-l" htmlFor={r.port.multi ? undefined : id}>
              {r.port.label}
              {r.port.optional ? <small>اختیاری</small> : null}
            </label>
            {r.port.multi ? (
              <div className="wfp-branches">
                {r.targets.map((t) => (
                  <span key={t} className="wfp-branch">
                    <button type="button" className="ds-link" onClick={() => onSelect(t)}>
                      {titles.get(t) ?? t}
                    </button>
                    {editable ? <Button type="text" size="small" icon={<X {...I14} />} aria-label={`برداشتن شاخهٔ «${titles.get(t) ?? t}»`} onClick={() => onGraph(dropConnection(graph, node.id, r.port.key, t))} /> : null}
                  </span>
                ))}
                {editable ? (
                  <Select
                    value={null}
                    placeholder="شاخهٔ تازه به…"
                    aria-label={`شاخهٔ تازهٔ «${r.port.label}»`}
                    popupMatchSelectWidth={false}
                    onChange={(v) => v && pick(r.port.key, v)}
                    options={[{ label: "گام‌ها", options: r.options }, { label: "گام تازه", options: NEW_STEP_OPTIONS }]}
                  />
                ) : null}
              </div>
            ) : (
              <Select
                id={id}
                value={current ?? null}
                allowClear={!!current && editable}
                disabled={!editable}
                placeholder={r.port.optional ? "وصل نیست" : "به کجا برود؟"}
                popupMatchSelectWidth={false}
                onChange={(v) => pick(r.port.key, (v as string | null | undefined) ?? null)}
                options={(r.port.back ? options : [{ label: "گام‌ها", options }, { label: "گام تازه", options: NEW_STEP_OPTIONS }]) as { value: string; label: string }[]}
              />
            )}
            {r.port.back && current && step ? (
              <Select
                aria-label="بازگشت به چه کسی"
                value={step.returnTo === "rule" ? "rule" : "actor"}
                disabled={!editable}
                onChange={(v) => onGraph(patchConfig(graph, node.id, { returnTo: v === "rule" ? "rule" : undefined }))}
                options={[
                  { value: "actor", label: "به همان کسی که آن مرحله را انجام داده بود" },
                  { value: "rule", label: "به کسانی که قاعدهٔ آن مرحله می‌یابد" },
                ]}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A form step's tabs

function Escalations({ value, onChange, action, fields, steps }: { value: Escalation[]; onChange?: (v: Escalation[]) => void; action: StepAction; fields: CaseField[]; steps: { id: string; label: string }[] }) {
  const off = !onChange;
  const set = (i: number, x: Escalation) => onChange?.(value.map((y, j) => (j === i ? x : y)));
  return (
    <div className="wfp-escs">
      {value.map((x, i) => {
        const n = faDigits(i + 1);
        return (
          <div key={i} className="wfp-esc" role="group" aria-label={`تشدید ${n}`}>
            <div className="wfp-esc-h">
              <span>پس از</span>
              <DurationField value={x.after} disabled={off} label={`زمان تشدید ${n}`} onChange={(d) => d && set(i, { ...x, after: d })} />
              {off ? null : <Button type="text" size="small" icon={<Trash2 {...I14} />} aria-label={`حذف تشدید ${n}`} onClick={() => onChange?.(value.filter((_, j) => j !== i))} />}
            </div>
            <Select
              aria-label={`کار تشدید ${n}`}
              value={x.action}
              disabled={off}
              onChange={(a: Escalation["action"]) => set(i, { ...newEscalation(a, action), after: x.after })}
              options={(Object.keys(ESCALATION_LABELS) as Escalation["action"][]).map((k) => ({ value: k, label: ESCALATION_LABELS[k] }))}
            />
            {x.action === "notify" ? (
              <Select
                aria-label={`چه کسی باخبر شود (تشدید ${n})`}
                value={x.to}
                disabled={off}
                onChange={(to) => set(i, { ...x, to })}
                options={(Object.keys(ESCALATION_TO_LABELS) as (keyof typeof ESCALATION_TO_LABELS)[]).map((k) => ({ value: k, label: ESCALATION_TO_LABELS[k] }))}
              />
            ) : null}
            {x.action === "auto" ? (
              <Select aria-label={`تصمیم خودکار (تشدید ${n})`} value={x.outcome} disabled={off} onChange={(outcome) => set(i, { ...x, outcome })} options={autoOutcomes(action).map((o) => ({ value: o, label: outcomeText(o) }))} />
            ) : null}
            {x.action === "reassign" ? <AssigneeRules value={x.rules} onChange={off ? undefined : (rules) => set(i, { ...x, rules })} fields={fields} steps={steps} plain addLabel="به چه کسانی" /> : null}
          </div>
        );
      })}
      {off ? null : (
        <Dropdown
          trigger={["click"]}
          menu={{ items: (Object.keys(ESCALATION_LABELS) as Escalation["action"][]).map((k) => ({ key: k, label: ESCALATION_LABELS[k] })), onClick: ({ key }) => onChange?.([...value, newEscalation(key as Escalation["action"], action)]) }}
        >
          <Button size="small" icon={<Plus {...I14} />} className="self-start">
            تشدید
          </Button>
        </Dropdown>
      )}
    </div>
  );
}

function Notices({ p }: { p: NodeInspectorProps }) {
  const notices = stepNotices(p.graph, p.node.id);
  return (
    <div className="wfm-stack">
      {notices.length ? (
        <ul className="wfp-notices">
          {notices.map((x) => (
            <li key={x.name}>
              <strong>«{x.name}»</strong>
              <span>{x.when}</span>
              <small>{x.rule ? "قانون اعلان" : "زمان‌سنج این مرحله"}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rk-hint">این گام پیامی نمی‌فرستد.</p>
      )}
      <p className="rk-hint">متن این پیام‌ها برای همهٔ گردش‌کارها یکی است و در «قانون‌های اعلان» تغییر می‌کند.</p>
      {p.canNotify ? (
        <Link className="ds-link self-start" to={`/${p.orgId}/notify/rules`}>
          قانون‌های اعلان
        </Link>
      ) : null}
    </div>
  );
}

function FormStepBody(p: NodeInspectorProps) {
  const { node, graph, editable } = p;
  const uid = useId();
  const step = formStepOf(node.config);
  const start = !!step.start;
  const patch = (x: Record<string, unknown>) => p.onGraph(patchConfig(graph, node.id, x));
  const counts = tabProblems(p.problems);
  const steps = useMemo(() => earlierSteps(graph, node.id), [graph, node.id]);
  const info = step.form ? p.forms.get(step.form) : undefined;
  const choice = step.form && !p.formChoices.some((f) => f.id === step.form) ? [{ value: step.form, label: info?.name ?? "فرم دیگر" }] : [];
  const tabLabel = (t: InspectorTab, text: string) => (
    <span className="wfp-tab">
      {text}
      {counts[t] ? (
        <span className="wfp-tab-n" aria-label={`${faDigits(counts[t]!)} ایراد`}>
          {faDigits(counts[t]!)}
        </span>
      ) : null}
    </span>
  );

  const people = start ? (
    <div className="wfm-stack">
      <Note>«ثبت درخواست» را خود درخواست‌دهنده پر می‌کند؛ پرونده با «بازگشت برای اصلاح» هم به او برمی‌گردد.</Note>
      <p className="wfp-p">{startersText(p.starters)}</p>
      <Button className="self-start" onClick={() => p.onSettings("starters")}>
        آغازکنندگان
      </Button>
    </div>
  ) : (
    <AssigneePicker
      value={assigneesOf(node.config)}
      onChange={editable ? (v) => patch(assigneesPatch(v)) : undefined}
      action={step.action}
      quorum={step.action === "approve" ? quorumOf(step) : null}
      fields={p.fields}
      steps={steps}
    />
  );

  const form = (
    <div className="wfm-stack">
      <F label="فرم این مرحله" htmlFor={`${uid}-form`}>
        <Select
          id={`${uid}-form`}
          value={step.form ?? undefined}
          allowClear={editable}
          disabled={!editable}
          placeholder="فرمی برگزینید"
          showSearch={{ optionFilterProp: "label" }}
          onChange={(v) => patch(formPatch(node.config, (v as string | undefined) ?? null))}
          options={[...choice, ...p.formChoices.map((f) => ({ value: f.id, label: f.name }))]}
        />
      </F>
      <span className="wfp-acts">
        {editable && p.canNewForm ? (
          <Button size="small" icon={<Plus {...I14} />} onClick={() => p.onNewForm(node.id)}>
            فرم تازه از همین‌جا
          </Button>
        ) : null}
        {step.form ? (
          <Link className="ds-link wfp-ext" to={`/${p.orgId}/settings/forms/${step.form}`}>
            طراحی این فرم
            <ExternalLink {...I14} aria-hidden />
          </Link>
        ) : null}
      </span>
      {!step.form ? (
        <p className="rk-hint">فرمی برگزینید تا دسترسی این مرحله به فیلدهای آن را تعیین کنید.</p>
      ) : info ? (
        <RightsMatrix form={info.layout} fields={info.fields} value={step.rights} onChange={editable ? (rights) => patch({ rights }) : undefined} stepLabel={nodeTitle(node)} />
      ) : p.formLoading(step.form) ? (
        <Loader label="خواندن فرم" />
      ) : (
        <Note tone="warning">فرم این مرحله خوانده نشد؛ شاید حذف شده یا دسترسی به آن ندارید.</Note>
      )}
    </div>
  );

  const time = (
    <div className="wfm-stack">
      <F label="مهلت انجام" htmlFor={`${uid}-due`} hint="از وقتی مرحله برای کسی باز می‌شود.">
        <DurationField id={`${uid}-due`} label="مهلت انجام" value={step.due} disabled={!editable} clearable onChange={(d) => patch({ due: d ?? undefined })} />
      </F>
      {step.due ? (
        <Checkbox checked={step.business !== false} disabled={!editable} onChange={(e) => patch({ business: e.target.checked ? undefined : false })}>
          به وقت کاری (تعطیلات و ساعت‌های بیرون از کار شمرده نمی‌شود)
        </Checkbox>
      ) : null}
      <F label="یادآوری هر" htmlFor={`${uid}-remind`}>
        <DurationField id={`${uid}-remind`} label="فاصلهٔ یادآوری" value={step.remind_every} disabled={!editable} clearable onChange={(d) => patch({ remind_every: d ?? undefined })} />
      </F>
      <F label="تشدید" hint="وقتی مرحله تا این زمان انجام نشود.">
        <Escalations value={step.escalate ?? []} action={step.action} fields={p.fields} steps={steps} onChange={editable ? (list) => patch({ escalate: list.length ? list : undefined }) : undefined} />
      </F>
    </div>
  );

  return (
    <>
      {start ? null : (
        <F label="کار این مرحله">
          <Segmented block value={step.action} disabled={!editable} onChange={(a) => p.onGraph(setAction(graph, node.id, a as StepAction))} options={ACTION_OPTIONS} />
        </F>
      )}
      {step.action === "approve" ? (
        <div className="wfp-row2">
          <F label="قاعدهٔ تأیید" htmlFor={`${uid}-quorum`}>
            <Select
              id={`${uid}-quorum`}
              value={quorumOf(step)}
              disabled={!editable}
              popupMatchSelectWidth={false}
              onChange={(q) => patch(quorumPatch(step, q as Quorum))}
              options={QUORUM_OPTIONS}
            />
          </F>
          {step.quorum === "count" || step.quorum === "percent" ? (
            <F label={step.quorum === "count" ? "تعداد تأیید لازم" : "درصد تأیید لازم"} htmlFor={`${uid}-threshold`}>
              <InputNumber id={`${uid}-threshold`} min={1} max={step.quorum === "count" ? 50 : 100} value={step.threshold ?? null} disabled={!editable} onChange={(v) => patch({ threshold: v ?? undefined })} />
            </F>
          ) : null}
        </div>
      ) : null}
      <Tabs
        size="small"
        className="wfp-tabs"
        tabBarGutter={14}
        activeKey={p.tab}
        onChange={(k) => p.onTab(k as InspectorTab)}
        items={[
          { key: "people", label: tabLabel("people", "انجام‌دهنده"), children: people },
          { key: "form", label: tabLabel("form", "فرم"), children: form },
          { key: "time", label: tabLabel("time", "مهلت"), children: time },
          { key: "notices", label: tabLabel("notices", "اعلان‌ها"), children: <Notices p={p} /> },
          { key: "paths", label: tabLabel("paths", "مسیرها"), children: <PortsEditor {...p} /> },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The other steps

function BranchBody(p: NodeInspectorProps) {
  const c = (p.node.config ?? {}) as Record<string, unknown>;
  const patch = (x: Record<string, unknown>) => p.onGraph(patchConfig(p.graph, p.node.id, { mode: "data", ...x }));
  return (
    <>
      <F label="مقایسه‌ها" hint="اگر برقرار باشد پرونده از «بله» می‌رود، وگرنه از «خیر».">
        <CaseRulesEditor value={caseRules(c.rules)} onChange={p.editable ? (rules) => patch({ rules }) : undefined} fields={p.fields} unit={p.unit} />
      </F>
      <F label="برقرار باشد">
        <Segmented
          value={c.match === "any" ? "any" : "all"}
          disabled={!p.editable}
          onChange={(m) => patch({ match: m })}
          options={[
            { value: "all", label: "همهٔ مقایسه‌ها" },
            { value: "any", label: "یکی از مقایسه‌ها" },
          ]}
        />
      </F>
      <h3 className="wfm-panel-t">مسیرها</h3>
      <PortsEditor {...p} />
    </>
  );
}

function ChoiceBody(p: NodeInspectorProps) {
  const cases = rawCases(p.node.config);
  const set = (next: typeof cases) => p.onGraph(setCases(p.graph, p.node.id, next));
  const off = !p.editable;
  return (
    <>
      <div className="wfm-stack">
        {cases.map((c, i) => {
          const n = faDigits(i + 1);
          return (
            <div key={c.key || i} className="wfp-case" role="group" aria-label={`حالت ${n}`}>
              <div className="wfp-case-h">
                <Input
                  value={c.label}
                  placeholder={`حالت ${n}`}
                  maxLength={80}
                  disabled={off}
                  aria-label={`نام حالت ${n}`}
                  onChange={(e) => p.onGraph(setCases(p.graph, p.node.id, cases.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))), `case:${p.node.id}:${i}`)}
                />
                {off ? null : <Button type="text" size="small" icon={<Trash2 {...I14} />} aria-label={`حذف حالت ${n}`} onClick={() => set(cases.filter((_, j) => j !== i))} />}
              </div>
              <CaseRulesEditor value={caseRules(c.rules)} onChange={off ? undefined : (rules) => set(cases.map((x, j) => (j === i ? { ...x, rules } : x)))} fields={p.fields} unit={p.unit} />
              <Segmented
                size="small"
                value={c.match === "any" ? "any" : "all"}
                disabled={off}
                onChange={(m) => set(cases.map((x, j) => (j === i ? { key: x.key, label: x.label, rules: x.rules, ...(m === "any" ? { match: "any" as const } : {}) } : x)))}
                options={[
                  { value: "all", label: "همهٔ مقایسه‌ها" },
                  { value: "any", label: "یکی از آن‌ها" },
                ]}
              />
            </div>
          );
        })}
        {off ? null : (
          <Button size="small" icon={<Plus {...I14} />} className="self-start" onClick={() => set([...cases, { key: newCaseKey(cases), label: `حالت ${faDigits(cases.length + 1)}`, rules: [] }])}>
            حالت تازه
          </Button>
        )}
        <p className="rk-hint">نخستین حالتی که برقرار باشد مسیر پرونده است؛ اگر هیچ‌کدام نباشد، «هیچ‌کدام».</p>
      </div>
      <h3 className="wfm-panel-t">مسیرها</h3>
      <PortsEditor {...p} />
    </>
  );
}

function NotifyBody(p: NodeInspectorProps) {
  const c = (p.node.config ?? {}) as Record<string, unknown>;
  const uid = useId();
  const patch = (x: Record<string, unknown>, key?: string) => p.onGraph(patchConfig(p.graph, p.node.id, x), key);
  const to = (Array.isArray(c.to) ? c.to : []).map(cleanRule).filter((r): r is AssigneeRule => !!r);
  const steps = earlierSteps(p.graph, p.node.id);
  const subject = typeof c.subject === "string" ? c.subject : "";
  const body = typeof c.body === "string" ? c.body : "";
  return (
    <>
      <F label="گیرندگان">
        <AssigneeRules value={to} onChange={p.editable ? (rules) => patch({ to: rules }) : undefined} fields={p.fields} steps={steps} plain addLabel="افزودن گیرنده" />
      </F>
      <F label="عنوان" htmlFor={`${uid}-subject`} extra={p.editable ? <PillMenu fields={p.fields} onPick={(x) => patch({ subject: `${subject}${x}` })} /> : undefined}>
        <Input id={`${uid}-subject`} value={subject} maxLength={300} disabled={!p.editable} onChange={(e) => patch({ subject: e.target.value }, `subject:${p.node.id}`)} />
      </F>
      <F label="متن" htmlFor={`${uid}-body`} extra={p.editable ? <PillMenu fields={p.fields} onPick={(x) => patch({ body: `${body}${x}` })} /> : undefined}>
        <Input.TextArea id={`${uid}-body`} value={body} autoSize={{ minRows: 3, maxRows: 8 }} disabled={!p.editable} onChange={(e) => patch({ body: e.target.value }, `body:${p.node.id}`)} />
      </F>
      <h3 className="wfm-panel-t">مسیرها</h3>
      <PortsEditor {...p} />
    </>
  );
}

function SubflowBody(p: NodeInspectorProps) {
  const c = (p.node.config ?? {}) as Record<string, unknown>;
  const uid = useId();
  const patch = (x: Record<string, unknown>, key?: string) => p.onGraph(patchConfig(p.graph, p.node.id, x), key);
  const rows = inputRows(c);
  const setRows = (next: typeof rows, key?: string) => patch({ inputs: next.length ? next : undefined }, key);
  const flow = typeof c.flow === "string" ? c.flow : undefined;
  return (
    <>
      <F label="جریان خودکار" htmlFor={`${uid}-flow`} hint="جریان خودکار پرونده را رکورد خود می‌داند؛ مقدارهایی را که لازم دارد در «ورودی‌ها» بدهید.">
        {p.flows === "denied" ? (
          <Note>دیدن جریان‌های خودکار برای شما باز نیست.</Note>
        ) : (
          <Select
            id={`${uid}-flow`}
            value={flow}
            loading={p.flows === null}
            disabled={!p.editable}
            showSearch={{ optionFilterProp: "label" }}
            placeholder="جریان خودکاری برگزینید"
            onChange={(v) => patch({ flow: v })}
            options={(p.flows ?? []).map((f) => ({ value: f.id, label: f.published ? f.name : `${f.name} (منتشرنشده)`, disabled: !f.published && f.id !== flow }))}
          />
        )}
      </F>
      <F label="ورودی‌ها">
        <div className="wfp-rows">
          {rows.map((r, i) => (
            <div key={i} className="wfp-row">
              <Input dir="ltr" className="ds-mono" value={r.name} placeholder="name" disabled={!p.editable} aria-label={`نام ورودی ${faDigits(i + 1)}`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)), `in:${p.node.id}:${i}`)} />
              <Input value={r.value} placeholder="مقدار" disabled={!p.editable} aria-label={`مقدار ورودی ${faDigits(i + 1)}`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)), `iv:${p.node.id}:${i}`)} />
              {p.editable ? <PillMenu fields={p.fields} onPick={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, value: `${y.value}${x}` } : y)))} /> : null}
              {p.editable ? <Button type="text" size="small" icon={<Trash2 {...I14} />} aria-label={`حذف ورودی ${faDigits(i + 1)}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} /> : null}
            </div>
          ))}
          {p.editable ? (
            <Button size="small" icon={<Plus {...I14} />} className="self-start" onClick={() => setRows([...rows, { name: "", value: "" }])}>
              ورودی
            </Button>
          ) : null}
        </div>
      </F>
      <h3 className="wfm-panel-t">مسیرها</h3>
      <PortsEditor {...p} />
    </>
  );
}

function SetValuesBody(p: NodeInspectorProps) {
  const rows = valueRows(p.node.config);
  const used = new Set(rows.map(([k]) => k));
  const set = (next: [string, string][], key?: string) => p.onGraph(patchConfig(p.graph, p.node.id, { values: Object.fromEntries(next) }), key);
  return (
    <>
      <F label="مقدارهای پرونده" hint="مقدار را بنویسید یا از فیلدهای پرونده بسازید؛ با همان بررسی‌های فرم نوشته می‌شود.">
        <div className="wfp-rows">
          {rows.map(([k, v], i) => (
            <div key={i} className="wfp-row">
              <Select
                value={k || undefined}
                placeholder="فیلد"
                disabled={!p.editable}
                showSearch={{ optionFilterProp: "label" }}
                popupMatchSelectWidth={false}
                aria-label={`فیلد ${faDigits(i + 1)}`}
                onChange={(nk) => set(rows.map((r, j) => (j === i ? [nk, r[1]] : r)))}
                options={p.fields.filter((f) => f.name === k || !used.has(f.name)).map((f) => ({ value: f.name, label: f.label }))}
              />
              <Input value={v} disabled={!p.editable} aria-label={`مقدار ${faDigits(i + 1)}`} onChange={(e) => set(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)), `val:${p.node.id}:${i}`)} />
              {p.editable ? <PillMenu fields={p.fields} onPick={(x) => set(rows.map((r, j) => (j === i ? [r[0], `${r[1]}${x}`] : r)))} /> : null}
              {p.editable ? <Button type="text" size="small" icon={<Trash2 {...I14} />} aria-label={`حذف مقدار ${faDigits(i + 1)}`} onClick={() => set(rows.filter((_, j) => j !== i))} /> : null}
            </div>
          ))}
          {p.editable ? (
            <Button size="small" icon={<Plus {...I14} />} className="self-start" disabled={rows.some(([k]) => !k) || used.size >= p.fields.length} onClick={() => set([...rows, ["", ""]])}>
              مقدار
            </Button>
          ) : null}
        </div>
      </F>
      <h3 className="wfm-panel-t">مسیرها</h3>
      <PortsEditor {...p} />
    </>
  );
}

function OtherBody(p: NodeInspectorProps) {
  const { node, graph, editable } = p;
  const c = (node.config ?? {}) as Record<string, unknown>;
  const patch = (x: Record<string, unknown>) => p.onGraph(patchConfig(graph, node.id, x));
  switch (node.type) {
    case "trigger":
      return (
        <>
          <Note>هر پرونده با «ثبت درخواست» آغاز می‌شود؛ این گام تنظیمی ندارد.</Note>
          <h3 className="wfm-panel-t">مسیرها</h3>
          <PortsEditor {...p} />
        </>
      );
    case "parallel":
      return (
        <>
          <p className="rk-hint">پرونده در همهٔ شاخه‌ها هم‌زمان پیش می‌رود؛ شاخه‌ها در «پیوستن» به هم می‌رسند.</p>
          <h3 className="wfm-panel-t">شاخه‌ها</h3>
          <PortsEditor {...p} />
        </>
      );
    case "join": {
      const any = c.mode === "any";
      return (
        <>
          <F label="ادامه پس از">
            <Segmented
              value={any ? "any" : "all"}
              disabled={!editable}
              onChange={(m) => patch(joinPatch(m as "all" | "any"))}
              options={[
                { value: "all", label: "همهٔ شاخه‌ها" },
                { value: "any", label: "نخستین شاخه" },
              ]}
            />
          </F>
          {any ? <Note>با رسیدن نخستین شاخه، شاخه‌های دیگر لغو می‌شوند و کارهای باز آن‌ها «دیگر لازم نیست» می‌شود.</Note> : null}
          <h3 className="wfm-panel-t">مسیرها</h3>
          <PortsEditor {...p} />
        </>
      );
    }
    case "wait_duration":
      return (
        <>
          {c.mode === "until" ? (
            <Note
              action={
                editable ? (
                  <Button size="small" onClick={() => patch({ mode: "duration", until: undefined, duration: { amount: 1, unit: "day" } })}>
                    به جای آن مدتی صبر کند
                  </Button>
                ) : undefined
              }
            >
              این گام تا زمانی که داده‌ها می‌گویند صبر می‌کند.
            </Note>
          ) : (
            <>
              <F label="مدت انتظار">
                <DurationField label="مدت انتظار" value={cleanDuration(c.duration)} disabled={!editable} onChange={(d) => patch({ mode: "duration", duration: d ?? undefined })} />
              </F>
              {/* the engine waits in business time only when `business` is true; a missing key is calendar time */}
              <Checkbox checked={waitsInBusinessTime(c)} disabled={!editable} onChange={(e) => patch({ business: e.target.checked })}>
                به وقت کاری
              </Checkbox>
            </>
          )}
          <h3 className="wfm-panel-t">مسیرها</h3>
          <PortsEditor {...p} />
        </>
      );
    case "end":
      return (
        <>
          <F label="پرونده چگونه پایان می‌یابد">
            <Segmented value={endOutcomeOf(c)} disabled={!editable} onChange={(o) => patch({ outcome: o })} options={END_OPTIONS} />
          </F>
          <Notices p={p} />
        </>
      );
    default:
      return <PortsEditor {...p} />;
  }
}

// ---------------------------------------------------------------------------------------------------------------

/** The inspector of one step. */
export function NodeInspector(p: NodeInspectorProps) {
  const { node, graph, editable } = p;
  const uid = useId();
  const title = nodeTitle(node);
  const start = node.type === "form_step" && node.config?.start === true;
  const body =
    node.type === "form_step" ? (
      <FormStepBody {...p} />
    ) : node.type === "branch" ? (
      <BranchBody {...p} />
    ) : node.type === "choice" ? (
      <ChoiceBody {...p} />
    ) : node.type === "notify" ? (
      <NotifyBody {...p} />
    ) : node.type === "subflow" ? (
      <SubflowBody {...p} />
    ) : node.type === "set_values" ? (
      <SetValuesBody {...p} />
    ) : (
      <OtherBody {...p} />
    );
  return (
    <div className="wfp-insp">
      <div className="wfp-insp-h">
        <span className="wfp-insp-ic" aria-hidden>
          <ProcessNodeIcon type={node.type} size={16} />
        </span>
        <div className="wfp-insp-t">
          <h2>{title}</h2>
          <span className="rk-hint">{kindText(node)}</span>
        </div>
        {editable && node.type !== "trigger" && !start ? (
          <Button
            type="text"
            danger
            icon={<Trash2 {...I14} />}
            aria-label={`حذف «${title}»`}
            onClick={() => {
              p.onGraph(removeNode(graph, node.id));
              p.onSelect(null);
            }}
          />
        ) : null}
      </div>
      {node.type !== "trigger" ? (
        <F label="نام" htmlFor={`${uid}-label`}>
          <Input id={`${uid}-label`} value={node.label ?? ""} placeholder={processNodeLabel({ type: node.type, config: node.config })} maxLength={80} disabled={!editable} onChange={(e) => p.onGraph(setLabel(graph, node.id, e.target.value), `label:${node.id}`)} />
        </F>
      ) : null}
      <NodeProblems problems={p.problems} />
      {body}
    </div>
  );
}

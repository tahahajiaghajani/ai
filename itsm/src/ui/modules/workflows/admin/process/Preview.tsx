// «پیش‌نمایش» of the process designer (design F §8.4, package F6): a sample requester and sample values of the start
// form; the people each step would go to — F3's resolve (POST /positions/resolve), the very rules a step runs when it
// opens, with the steps before it as their actors — as notes on the canvas («علی احمدی — رئیس شعبه (شعبهٔ ونک)»); and a
// step's form as its first person would see it (F2's preview with the step's rights as they are on the screen). Only
// the people who may design or keep the organisation's structure may ask (F3's rule); the page offers it to them only.
// While a demo pack is loaded its people are offered first as sample requesters (a case one of them starts reaches
// the pack's holders; the organisation's own cases never do, FINAL-1) and marked «نمایشی» among a step's people; a
// warning names the steps that find nobody, and the chosen step says why (the resolver's notes) and what it then does.
import { useEffect, useId, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formStepOf, startOf, type ProcessGraph } from "@shared/process";
import { formValuesDef, type StepRights } from "@shared/forms/layout";
import type { MoneyUnit } from "@shared/financial/logic";
import { faDigits } from "@shared/format";
import { ApiError, errorText } from "../../../../lib/api";
import { useOrg } from "../../../../lib/org";
import { useDebounced } from "../../../../lib/hooks";
import { cx, Note } from "../../../../components/blocks";
import { Loader } from "../../../../components/display";
import { useMe, useSchema } from "../../../../records/data/hooks";
import type { TableMeta } from "../../../../records/model/types";
import { DemoTag, MemberSelect, nodeTitle, previewLines, previewVerdict } from "../../kit";
import { FORM_KEYS, formsApi, type FormPreview } from "../forms/api";
import { PreviewForm, type PreviewTab } from "../forms/parts";
import { hubApi } from "../hub/api";
import { DESIGNER_KEYS, designerApi, type ProcessDraft, type ResolveResult } from "./api";
import { assigneesOf, previewBlocked, previewNote, previewSteps, previewSummary, resolveBody, resolvedPeople, stableJson, type CaseField, type FormInfo } from "./model";
import { F } from "./parts";

export interface PreviewProps {
  graph: ProcessGraph;
  draft: ProcessDraft;
  fields: CaseField[];
  forms: ReadonlyMap<string, FormInfo>;
  unit: MoneyUnit;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** the canvas's line per step */
  onNotes: (notes: Record<string, string>) => void;
}

type Found = Record<string, { result?: ResolveResult; error?: string }>;

/** A step's form as a person sees it: F2's preview, from a persona when the person's own access is closed to the designer. */
function StepForm({ form, rights, as, fallback, values, onValues, unit, label }: { form: FormInfo; rights: StepRights | null; as: string; fallback: "requester" | "agent"; values: Record<string, unknown>; onValues: (v: Record<string, unknown>) => void; unit: MoneyUnit; label?: string }) {
  const { api, orgId } = useOrg();
  const { schema } = useSchema();
  const { tz } = useMe();
  const sampled = useDebounced(values, 400);
  const body = useMemo(() => ({ rights, as, values: Object.keys(sampled).length ? sampled : null }), [rights, as, sampled]);
  const pv = useQuery({
    queryKey: FORM_KEYS.preview(orgId, form.id, "designer", stableJson(body)),
    queryFn: async (): Promise<FormPreview & { persona?: boolean }> => {
      try {
        return await formsApi.preview(api, form.id, body);
      } catch (e) {
        // a member's field groups are part of their access: read through the persona when that is closed to the designer
        if (e instanceof ApiError && e.status === 403 && body.as !== fallback) return { ...(await formsApi.preview(api, form.id, { ...body, as: fallback })), persona: true };
        throw e;
      }
    },
    placeholderData: keepPreviousData,
    retry: false,
  });
  const tabs = useMemo<PreviewTab[]>(
    () =>
      (pv.data?.view.tabs ?? []).map((t) => ({
        label: t.label,
        sections: t.sections.map((s, si) => ({
          key: `${t.label}:${si}`,
          label: s.label,
          items: s.items.map((x) => (x.kind === "note" ? { kind: "note" as const, text: x.text, tone: x.tone } : { kind: "field" as const, name: x.name, field: x.field, right: x.right, span: x.span, label: x.label, help: x.help })),
        })),
      })),
    [pv.data],
  );
  const def = useMemo(() => ({ ...formValuesDef(form.layout, (n: string) => pv.data?.fields[n] ?? form.fields[n], form.name), can: { read: true as const, create: true } }) as TableMeta, [form, pv.data]);
  if (pv.error) return <Note tone="warning">{errorText(pv.error)}</Note>;
  if (!pv.data || !schema) return <Loader label="خواندن فرم" />;
  return (
    <div className="wfp-stepform">
      <p className="rk-hint">
        {[label, `از دید «${pv.data.as.label}»`].filter(Boolean).join("؛ ")}
        {pv.data.persona ? " (دسترسی خود این شخص برای شما باز نیست)" : ""}
      </p>
      <PreviewForm tabs={tabs} def={def} schema={schema} tz={tz} unit={unit} values={values} onChange={(k, v) => onValues({ ...values, [k]: v })} problems={pv.data.check?.problems} idPrefix={`wfp-pv-${form.id.slice(0, 8)}`} />
    </div>
  );
}

/** What a chosen step does for the sample requester when nobody (or too many) is found. */
function Verdict({ r, node }: { r: ResolveResult; node: ProcessGraph["nodes"][number] }) {
  const step = formStepOf(node.config);
  const v = previewVerdict(r, { action: step.action, ifNobody: step.ifNobody ?? null });
  return v ? <Note tone={v.tone}>{v.text}</Note> : null;
}

export function PreviewPanel(p: PreviewProps) {
  const { api, orgId } = useOrg();
  const { userId } = useMe();
  const uid = useId();
  const [requester, setRequester] = useState<string | null>(userId);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const sampled = useDebounced(values, 600);
  const steps = useMemo(() => previewSteps(p.graph), [p.graph]);
  const start = startOf(p.graph).start;
  const people = useMemo(() => steps.map((n) => [n.id, nodeTitle(n), assigneesOf(n.config), formStepOf(n.config).action, formStepOf(n.config).quorum ?? null]), [steps]);
  const sig = stableJson({ people, requester, sampled, managers: p.draft.managers, groups: p.draft.manager_groups, fields: p.fields.map((f) => [f.name, f.type, f.ref]) });
  const who = useQuery({ queryKey: ["wf-designer", orgId, "who", requester], queryFn: () => hubApi.people(api, [requester!]), enabled: !!requester, staleTime: 300_000 });
  const run = useQuery({
    queryKey: DESIGNER_KEYS.resolve(orgId, sig),
    enabled: !!requester,
    retry: false,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Found> => {
      const found: Found = {};
      const actors: Record<string, string[]> = start && requester ? { [start.id]: [requester] } : {};
      let previous: string | null = requester;
      for (const n of steps) {
        const blocked = previewBlocked(n);
        if (blocked) {
          found[n.id] = { error: blocked };
          continue;
        }
        try {
          const r = await designerApi.resolve(api, resolveBody(n, { requester: requester!, values: sampled, fields: p.fields, draft: p.draft, stepActors: actors, previous }));
          found[n.id] = { result: r };
          const ppl = resolvedPeople(r);
          actors[n.id] = ppl;
          if (ppl[0]) previous = ppl[0];
        } catch (e) {
          found[n.id] = { error: errorText(e) };
        }
      }
      return found;
    },
  });
  const requesterName = requester ? (who.data?.[requester] ?? "درخواست‌دهندهٔ نمونه") : "";
  const notes = useMemo(() => {
    const out: Record<string, string> = {};
    if (start && requester) out[start.id] = `${requesterName} — درخواست‌دهنده`;
    for (const [id, f] of Object.entries(run.data ?? {})) out[id] = f.result ? previewNote(f.result) : (f.error ?? "");
    return out;
  }, [run.data, start, requester, requesterName]);
  const { onNotes } = p;
  useEffect(() => onNotes(notes), [notes, onNotes]);
  useEffect(() => () => onNotes({}), [onNotes]);

  const startStep = start ? formStepOf(start.config) : null;
  const startForm = startStep?.form ? p.forms.get(startStep.form) : undefined;
  const sel = p.selected ? p.graph.nodes.find((n) => n.id === p.selected) : undefined;
  const selStep = sel?.type === "form_step" ? formStepOf(sel.config) : null;
  const selForm = selStep?.form ? p.forms.get(selStep.form) : undefined;
  const selFound = sel ? run.data?.[sel.id] : undefined;
  const firstPerson = selFound?.result ? resolvedPeople(selFound.result)[0] : undefined;
  const summary = previewSummary(steps, run.data);

  return (
    <section className="wfm-panel wfp-preview" aria-label="پیش‌نمایش">
      <h2 className="wfm-panel-t">پیش‌نمایش</h2>
      <F label="درخواست‌دهندهٔ نمونه" htmlFor={`${uid}-req`}>
        <MemberSelect id={`${uid}-req`} value={requester} onChange={(v) => setRequester((v as string | null) ?? null)} allowClear={false} demo="first" meFirst aria-label="درخواست‌دهندهٔ نمونه" />
      </F>
      {startForm && requester ? (
        <details className="wfp-sample">
          <summary>مقدارهای نمونهٔ «{start ? nodeTitle(start) : "ثبت درخواست"}»</summary>
          <StepForm form={startForm} rights={startStep?.rights ?? null} as={requester} fallback="requester" values={values} onValues={setValues} unit={p.unit} label="فرم آغاز" />
        </details>
      ) : null}
      <h3 className="wfp-sub">افراد هر مرحله</h3>
      {run.isFetching ? <Loader label="پیدا کردن افراد" /> : null}
      {summary && !run.isFetching ? <Note tone="warning">{summary}</Note> : null}
      {steps.length ? (
        <ol className="wfp-who-list">
          {steps.map((n) => {
            const f = run.data?.[n.id];
            const r = f?.result;
            const on = p.selected === n.id;
            return (
              <li key={n.id} className={cx(on && "is-sel", (f?.error || r?.status === "nobody" || r?.status === "too_many") && "is-warn")}>
                <button type="button" className="wfp-who-btn" onClick={() => p.onSelect(n.id)} aria-current={on ? "step" : undefined}>
                  <strong>{nodeTitle(n)}</strong>
                  <span>
                    {f ? (r ? previewNote(r) : f.error) : "…"}
                    {r && r.lines.length === 1 && previewLines(r)[0].demo ? <DemoTag /> : null}
                  </span>
                </button>
                {on && r && r.lines.length > 1 ? (
                  <ul className="wfp-who-more">
                    {previewLines(r)
                      .slice(0, 20)
                      .map((l) => (
                        <li key={l.line}>
                          {l.line}
                          {l.demo ? <DemoTag /> : null}
                        </li>
                      ))}
                    {r.lines.length > 20 ? <li>{`و ${faDigits(r.lines.length - 20)} نفر دیگر`}</li> : null}
                  </ul>
                ) : null}
                {on && r ? <Verdict r={r} node={n} /> : null}
                {on && r ? [...r.notes, ...r.warnings].map((w) => <p key={w} className="wfk-warn">{w}</p>) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rk-hint">هنوز مرحله‌ای پس از «ثبت درخواست» نیست.</p>
      )}
      {sel && selStep && !selStep.start ? (
        selForm ? (
          <>
            <h3 className="wfp-sub">فرم «{nodeTitle(sel)}»</h3>
            <StepForm form={selForm} rights={selStep.rights} as={firstPerson ?? "agent"} fallback="agent" values={values} onValues={setValues} unit={p.unit} />
          </>
        ) : (
          <p className="rk-hint">این مرحله هنوز فرم ندارد.</p>
        )
      ) : (
        <p className="rk-hint">مرحله‌ای را برگزینید تا فرم آن را از دید انجام‌دهنده‌اش ببینید.</p>
      )}
    </section>
  );
}

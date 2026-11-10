// «طراحی گردش‌کار»: the visual designer. A palette of steps (click to add after the selected step, or drag onto the
// canvas), the canvas (connect ports, drag, delete, zoom and fit, auto-layout top-to-bottom or right-to-left with
// dagre), and the property panel of the selected step or of the trigger. Problems are checked live with the shared
// validator and shown on the nodes. «ذخیره» keeps the draft; «انتشار» makes it a new version (running runs keep
// theirs); «فعال» turns the published flow on or off; «آزمایش» runs the draft now on a chosen record and paints each
// step's result on the canvas.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { App, Button, Drawer, Input, Segmented, Switch, Tooltip } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, LayoutGrid, Play, Save, Upload, Workflow } from "lucide-react";
import {
  NODE_GROUPS, NODE_TYPES, cleanGraph, emptyGraph, hasErrors, nodeLabel, triggerProblems, validateGraph,
  type FlowGraph, type FlowProblem, type NodeGroup, type NodeType, type TriggerConfig,
} from "@shared/flows";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ICON, Note } from "../../components/blocks";
import { RecordSelect, recordKeys, recordPath, useRecord, useSchema, type RecordResult } from "../../records";
import { FlowCanvas } from "./FlowCanvas";
import { NodeIcon } from "./icons";
import { NodeInspector, TriggerInspector, type TriggerDraft } from "./Inspector";
import { RunStateChip, RunSteps, statusesOf } from "./RunSteps";
import { flowKeys, flowsApi, useFlowCatalog, useRun } from "./api";
import { addNode, autoLayout, availablePills, paletteGroups, removeNodes, updateNode, type Direction, type FieldLite } from "./model";

function draftOf(row: Record<string, unknown>): TriggerDraft {
  return {
    trigger: (row.trigger as TriggerDraft["trigger"]) ?? "manual",
    trigger_table: (row.trigger_table as string) || null,
    trigger_events: Array.isArray(row.trigger_events) ? (row.trigger_events as string[]) : [],
    trigger_fields: Array.isArray(row.trigger_fields) ? (row.trigger_fields as string[]) : [],
    trigger_condition: row.trigger_condition ?? null,
    schedule: row.schedule ?? null,
    catalog_item: (row.catalog_item as string) || null,
    run_as: (row.run_as as TriggerDraft["run_as"]) ?? "trigger_user",
    run_as_user: (row.run_as_user as string) || null,
  };
}

function configOf(d: TriggerDraft): Partial<TriggerConfig> {
  return {
    kind: d.trigger,
    table: d.trigger_table,
    events: d.trigger_events as TriggerConfig["events"],
    fields: d.trigger_fields,
    condition: d.trigger_condition,
    schedule: d.schedule as TriggerConfig["schedule"],
    catalog_item: d.catalog_item,
    run_as: d.run_as,
    run_as_user: d.run_as_user,
  };
}

/** Graphs saved without positions (made through the API) are laid out once. */
const unplaced = (g: FlowGraph) => g.nodes.some((n) => !n.position);

export default function Designer() {
  const { id = "" } = useParams<{ id: string }>();
  const { api, orgId, writable } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const rec = useRecord("flow", id);
  const { schema } = useSchema();
  const catalog = useFlowCatalog();
  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [draft, setDraft] = useState<TriggerDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [testOpen, setTestOpen] = useState(false);
  const [testRecord, setTestRecord] = useState<string | null>(null);
  const [testInputs, setTestInputs] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const run = useRun(runId);
  const row = rec.data?.row as Record<string, any> | undefined;

  useEffect(() => {
    if (!row || graph) return;
    const g = cleanGraph(row.graph ?? emptyGraph());
    const start = g.nodes.length ? g : emptyGraph();
    setGraph(unplaced(start) ? autoLayout(start, start.layout?.direction ?? "TB") : start);
    setDraft(draftOf(row));
    setSelected(start.nodes.find((n) => n.type === "trigger")?.id ?? null);
  }, [row, graph]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const fieldsOf = useCallback(
    (t: string): FieldLite[] | undefined => schema?.def(t)?.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, readonly: f.readonly, system: f.system, hidden: f.hidden })),
    [schema],
  );
  const tableLabel = useCallback((k: string) => schema?.def(k)?.plural ?? k, [schema]);
  const trigger = useMemo(() => (draft ? configOf(draft) : null), [draft]);
  const problems = useMemo<FlowProblem[]>(
    () => (graph && trigger ? [...triggerProblems(trigger, { fieldsOf }), ...validateGraph(graph, { trigger, fieldsOf })] : []),
    [graph, trigger, fieldsOf],
  );
  const errors = problems.filter((p) => p.level === "error");
  const direction: Direction = graph?.layout?.direction ?? "TB";
  const canWrite = !!rec.data?.meta?.canWrite && writable;
  const readOnly = !canWrite;

  const change = useCallback((g: FlowGraph) => {
    setGraph(g);
    setDirty(true);
  }, []);
  const changeDraft = (patch: Partial<TriggerDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  const recordKey = recordKeys.record(orgId, "flow", id);
  const store = (r: RecordResult) => qc.setQueryData(recordKey, r);
  const persist = async (): Promise<RecordResult> => {
    const r = await api.patch<RecordResult>(`/r/flow/${id}`, { ...draft, graph, version: row?.version });
    store(r);
    setDirty(false);
    return r;
  };
  const save = useAction(() => persist(), { success: "پیش‌نویس ذخیره شد" });
  const publish = useAction(
    async () => {
      const version = dirty ? (await persist()).row.version : row!.version;
      return flowsApi.publish(api, id, version);
    },
    {
      success: (r) => `نسخهٔ ${faDigits(r.version.version_no)} منتشر شد`,
      onSuccess: () => qc.invalidateQueries({ queryKey: recordKey }),
    },
  );
  const toggle = useAction((on: boolean) => api.patch<RecordResult>(`/r/flow/${id}`, { active: on, version: row?.version }), {
    success: (r) => (r.row.active ? "گردش‌کار فعال شد" : "گردش‌کار غیرفعال شد"),
    onSuccess: (r) => store(r),
  });
  const test = useAction(
    () => {
      let inputs: Record<string, unknown> = {};
      if (testInputs.trim()) inputs = JSON.parse(testInputs);
      return flowsApi.test(api, id, { table: testRecord ? draft?.trigger_table : null, record_id: testRecord, inputs, graph: graph ?? undefined });
    },
    {
      onSuccess: (d) => {
        qc.setQueryData(flowKeys.run(orgId, d.run.id), d);
        setRunId(d.run.id);
      },
    },
  );

  if (rec.isLoading || (!graph && row)) return <Loader />;
  if (!row || !graph || !draft) return <EmptyState title="گردش‌کار پیدا نشد" icon={Workflow} />;

  const sel = graph.nodes.find((n) => n.id === selected) ?? null;
  const pills = sel && trigger ? availablePills(graph, sel.id, { trigger, fieldsOf }) : [];
  const add = (type: NodeType, position?: { x: number; y: number }) => {
    const r = addNode(graph, type, { after: position ? null : selected, position, direction });
    change(r.graph);
    setSelected(r.id);
  };
  const layout = (dir: Direction) => {
    change(autoLayout(graph, dir));
    setFitKey((k) => k + 1);
  };
  const statusChips = (
    <>
      {row.version_no ? <Chip tone="in">نسخهٔ {faDigits(row.version_no)}</Chip> : <Chip>منتشرنشده</Chip>}
      {row.active ? <Chip tone="accent">فعال</Chip> : <Chip>غیرفعال</Chip>}
      {dirty ? <Chip tone="warning">تغییر ذخیره‌نشده</Chip> : row.dirty && row.version_no ? <Chip tone="warning">پیش‌نویس منتشرنشده</Chip> : null}
      {errors.length ? <Chip tone="danger">{faDigits(errors.length)} ایراد</Chip> : null}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        back={`/${orgId}/${recordPath("flow", id)}`}
        title={String(row.name ?? "گردش‌کار")}
        subtitle={statusChips}
        actions={
          <>
            <Tooltip title={row.version_no ? "" : "ابتدا منتشر کنید"}>
              <Switch checked={!!row.active} onChange={(on) => toggle.mutate(on)} loading={toggle.isPending} disabled={readOnly || !row.version_no || dirty} aria-label="فعال" />
            </Tooltip>
            <Button icon={<FlaskConical {...ICON} />} onClick={() => setTestOpen(true)} disabled={readOnly}>
              آزمایش
            </Button>
            <Button icon={<Save {...ICON} />} onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={readOnly || !dirty}>
              ذخیره
            </Button>
            <Button type="primary" icon={<Upload {...ICON} />} onClick={() => publish.mutate(undefined)} loading={publish.isPending} disabled={readOnly || hasErrors(problems)}>
              انتشار
            </Button>
          </>
        }
      />
      {errors.length ? (
        <Note tone="danger">
          {errors.slice(0, 4).map((p, i) => (
            <div key={i}>
              {p.node ? (
                <Button type="link" size="small" style={{ paddingInline: 0, height: "auto" }} onClick={() => setSelected(p.node!)}>
                  {nodeLabel(graph.nodes.find((n) => n.id === p.node) ?? { type: "", label: p.node })}
                </Button>
              ) : null}
              {p.node ? ": " : ""}
              {p.message}
            </div>
          ))}
          {errors.length > 4 ? <div>و {faDigits(errors.length - 4)} ایراد دیگر</div> : null}
        </Note>
      ) : null}
      <div className="fl-designer">
        <aside className="fl-panel fl-palette" aria-label="گام‌ها">
          <div className="fl-panel-h">گام‌ها</div>
          <div className="fl-panel-b" style={{ gap: 2 }}>
            {paletteGroups().map((g) => (
              <div key={g.group}>
                <div className="fl-pal-group">{NODE_GROUPS[g.group as NodeGroup]}</div>
                {g.types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="fl-pal-item"
                    draggable={!readOnly}
                    disabled={readOnly}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-flow-node", t);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => add(t)}
                  >
                    <span className="fl-node-ic">
                      <NodeIcon type={t} />
                    </span>
                    <span>
                      {NODE_TYPES[t].label}
                      <small>{NODE_TYPES[t].hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>
        <div className="fl-center" style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Segmented
              size="small"
              value={direction}
              options={[
                { value: "TB", label: "بالا به پایین" },
                { value: "RL", label: "راست به چپ" },
              ]}
              onChange={(v) => layout(v as Direction)}
              disabled={readOnly}
            />
            <Button size="small" icon={<LayoutGrid {...ICON} />} onClick={() => layout(direction)} disabled={readOnly}>
              چیدمان خودکار
            </Button>
            {runId && run.data ? (
              <Button size="small" icon={<Play {...ICON} />} onClick={() => setTestOpen(true)}>
                نتیجهٔ آزمایش: <RunStateChip state={run.data.run.state} />
              </Button>
            ) : null}
          </div>
          <FlowCanvas
            graph={graph}
            direction={direction}
            problems={problems}
            statuses={runId ? statusesOf(run.data) : undefined}
            current={runId ? run.data?.run.current_nodes : undefined}
            selected={selected}
            readOnly={readOnly}
            trigger={trigger}
            triggerTitle={`شروع · ${draft.trigger === "record" && draft.trigger_table ? tableLabel(draft.trigger_table) : ""}`.replace(/ · $/, "")}
            tableLabel={tableLabel}
            onGraph={change}
            onSelect={setSelected}
            onDropType={(t, pos) => add(t, pos)}
            onProblem={(m) => message.warning(m)}
            fitKey={fitKey}
          />
        </div>
        <aside className="fl-panel fl-inspector" aria-label="ویژگی‌ها">
          {sel && sel.type === "trigger" ? (
            <TriggerInspector
              value={draft}
              onChange={changeDraft}
              problems={problems.filter((p) => !p.node || p.node === sel.id)}
              readOnly={readOnly}
              flowId={id}
              fieldsOf={fieldsOf}
              saved={!dirty}
            />
          ) : sel ? (
            <NodeInspector
              node={sel}
              trigger={trigger ?? {}}
              problems={problems.filter((p) => p.node === sel.id)}
              pills={pills}
              readOnly={readOnly}
              fieldsOf={fieldsOf}
              catalog={catalog.data}
              onChange={(patch) => change(updateNode(graph, sel.id, patch))}
              onRemove={() => {
                change(removeNodes(graph, [sel.id]));
                setSelected(null);
              }}
            />
          ) : (
            <div className="fl-panel-b">
              <EmptyState compact icon={Workflow} title="گامی را انتخاب کنید" />
            </div>
          )}
        </aside>
      </div>
      <Drawer open={testOpen} onClose={() => setTestOpen(false)} title="آزمایش گردش‌کار" size="large" destroyOnHidden={false}>
        <div className="fl-rows">
          <Note>گام‌ها با دسترسی شما و به‌راستی اجرا می‌شوند.</Note>
          {draft.trigger_table ? (
            <div>
              <div className="fl-field-label">رکورد {tableLabel(draft.trigger_table)}</div>
              <RecordSelect table={draft.trigger_table} value={testRecord} onChange={(v) => setTestRecord((v as string | null) ?? null)} allowClear />
            </div>
          ) : null}
          {draft.trigger !== "record" ? (
            <div>
              <div className="fl-field-label">ورودی‌ها (JSON)</div>
              <Input.TextArea dir="ltr" className="fl-mono" rows={3} value={testInputs} onChange={(e) => setTestInputs(e.target.value)} placeholder='{"n": 1}' />
            </div>
          ) : null}
          <Button type="primary" icon={<Play {...ICON} />} loading={test.isPending} disabled={hasErrors(problems)} onClick={() => test.mutate(undefined)} style={{ alignSelf: "flex-start" }}>
            اجرای آزمایشی
          </Button>
          {run.data ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <RunStateChip state={run.data.run.state} />
                <Button type="link" onClick={() => nav(`/${orgId}/flows/runs/${run.data!.run.id}`)}>
                  صفحهٔ اجرا
                </Button>
              </div>
              <RunSteps detail={run.data} />
            </>
          ) : null}
        </div>
      </Drawer>
    </div>
  );
}

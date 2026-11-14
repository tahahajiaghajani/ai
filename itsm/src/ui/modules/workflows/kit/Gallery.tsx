// «کیت گردش‌کار» (settings/workflows-kit): every component of the workflows kit drawn with the bank's sample process
// (./sample.ts) — the editable canvas with its problems, a case's diagram with the legend and the phone's step list,
// the rights matrix, the role-then-people picker, the position picker and the files input. Like «راهنمای طراحی» it is
// for the organisation's settings managers (settings: full), a living reference for the designer and the user pages
// built on the kit, and a visual test in light, dark and on phones. Nothing here is saved: the sample lives in the
// page, the files input's uploads stay in the page, and the pickers only read.
import { useMemo, useState } from "react";
import { Segmented } from "antd";
import { validateProcess, type ProcessGraph, type StepAssignees } from "@shared/process";
import { RIGHT_LABELS, type StepRights } from "@shared/forms/layout";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../lib/org";
import { PageHeader } from "../../../components/layout";
import { Card } from "../../../components/blocks";
import { EmptyState } from "../../../components/display";
import { ProcessCanvas } from "./ProcessCanvas";
import { StepLegend, StepList, usedStatuses } from "./StepLegend";
import { RightsMatrix } from "./RightsMatrix";
import { AssigneePicker } from "./AssigneePicker";
import { PositionPicker } from "./PositionPicker";
import { FilesInput, type FileItem } from "./FilesInput";
import { takenEdges, nodeTitle, addStep } from "./model";
import { SAMPLE_FIELDS, SAMPLE_FORM, SAMPLE_PROGRESS, sampleProcess, sampleStatuses } from "./sample";
import "./kit.css";

/** A page-local id for a file the sample «uploads» (it never leaves the page). */
const localId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`);

export default function Gallery() {
  const { can } = useOrg();
  const [graph, setGraph] = useState<ProcessGraph>(() => sampleProcess());
  const [selected, setSelected] = useState<string | null>(null);
  const [fit, setFit] = useState(0);
  const [refused, setRefused] = useState<string | null>(null);
  const diagram = useMemo(() => sampleProcess(), []);
  const statuses = useMemo(() => sampleStatuses(diagram), [diagram]);
  const taken = useMemo(() => takenEdges(diagram, SAMPLE_PROGRESS), [diagram]);
  const problems = useMemo(() => validateProcess(graph), [graph]);
  const [rights, setRights] = useState<StepRights>({ default: "read", fields: { u_note: "edit" } });
  const [who, setWho] = useState<StepAssignees>({ assignees: [{ kind: "manager", of: "requester" }] });
  const [position, setPosition] = useState<string | null>(null);
  const [docs, setDocs] = useState<unknown>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [view, setView] = useState<"canvas" | "list">("canvas");

  if (!can("settings", "full"))
    return (
      <>
        <PageHeader title="کیت گردش‌کار" />
        <EmptyState art="locked" title="این صفحه برای مدیران تنظیمات است" description="کیت گردش‌کار را مدیران تنظیمات سازمان می‌بینند." />
      </>
    );

  const errors = problems.filter((p) => p.level === "error");
  const steps = graph.nodes.filter((n) => n.type === "form_step").map((n) => ({ id: n.id, label: nodeTitle(n) }));
  return (
    <>
      <PageHeader title="کیت گردش‌کار" subtitle="نمونهٔ «درخواست تنخواه شعبه»؛ چیزی ذخیره نمی‌شود" />
      <div className="wfk-gallery">
        <Card
          title="طراحی گردش‌کار"
          meta={<span className="ds-num text-ink-3">{errors.length ? `${faDigits(errors.length)} ایراد` : "بی‌ایراد"}</span>}
        >
          <ProcessCanvas
            className="wfk-gallery-canvas"
            graph={graph}
            problems={problems}
            selected={selected}
            onSelect={setSelected}
            onGraph={(g) => {
              setGraph(g);
              setRefused(null);
            }}
            onDropType={(type, position) => setGraph((g) => addStep(g, type, { position }).graph)}
            onProblem={setRefused}
            fitKey={fit}
            label="نمودار نمونهٔ تنخواه شعبه (ویرایش)"
          />
          {refused ? <p className="wfk-warn" role="status">{refused}</p> : null}
          <p className="wfk-line">
            {selected ? `برگزیده: «${nodeTitle(graph.nodes.find((n) => n.id === selected) ?? graph.nodes[0])}»` : "مرحله‌ای را برگزینید"}
            {" · "}
            <button type="button" className="ds-link" onClick={() => (setGraph(sampleProcess()), setFit((x) => x + 1), setSelected(null))}>
              بازگرداندن نمونه
            </button>
          </p>
        </Card>

        <Card
          title="نمودار یک پرونده"
          tools={
            <Segmented
              size="small"
              value={view}
              onChange={(v) => setView(v as "canvas" | "list")}
              options={[
                { value: "canvas", label: "نمودار" },
                { value: "list", label: "فهرست مرحله‌ها" },
              ]}
              aria-label="نمایش"
            />
          }
        >
          {view === "canvas" ? (
            <ProcessCanvas className="wfk-gallery-canvas" graph={diagram} readOnly statuses={statuses} taken={taken} label="نمودار پروندهٔ نمونه" />
          ) : (
            <StepList graph={diagram} statuses={statuses} />
          )}
          <StepLegend only={usedStatuses(statuses)} />
        </Card>

        <Card title="دسترسی مرحلهٔ «تأیید رئیس شعبه» به فیلدها" meta={<span className="text-ink-3">پیش‌فرض: {RIGHT_LABELS[rights.default]}</span>}>
          <RightsMatrix form={SAMPLE_FORM} fields={SAMPLE_FIELDS} value={rights} onChange={setRights} stepLabel="تأیید رئیس شعبه" />
        </Card>

        <div className="wfk-pair">
          <Card title="انجام‌دهندهٔ مرحله">
            <AssigneePicker
              value={who}
              onChange={setWho}
              action="approve"
              quorum="any"
              steps={steps}
              fields={Object.values(SAMPLE_FIELDS).map((x) => ({ name: x.name, label: x.label, type: x.type, ref: x.ref ?? null }))}
            />
          </Card>
          <Card title="نقش سازمانی و پیوست">
            <div className="wfk-who">
              <div>
                <label className="wfk-lbl" htmlFor="wfk-g-pos">
                  نقش سازمانی
                </label>
                <PositionPicker id="wfk-g-pos" value={position} onChange={(v) => setPosition((v as string | null) ?? null)} />
              </div>
              <div>
                <span className="wfk-lbl">پیوست‌ها (نمونه؛ پرونده‌ها از این صفحه بیرون نمی‌روند)</span>
                <FilesInput
                  value={docs}
                  onChange={setDocs}
                  field={SAMPLE_FIELDS.u_docs}
                  files={files}
                  upload={async (file) => {
                    const item = { id: localId(), name: file.name, size: file.size };
                    setFiles((x) => [...x, item]);
                    return item;
                  }}
                />
              </div>
              <div>
                <span className="wfk-lbl">پیوست‌ها در رکوردی که هنوز ذخیره نشده</span>
                <FilesInput value={null} onChange={() => undefined} field={SAMPLE_FIELDS.u_docs} files={[]} />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

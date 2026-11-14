// A process's diagram for the person (design F §5 page 2, §8.6; package F7) at `workflows/p/:key`: the whole published
// diagram with my steps marked — «نوبت شما» where cases wait for me, «مرحلهٔ آیندهٔ شما» where my part may come — and
// the people of the others in words. Clicking my step opens its queue (the cases waiting for me there); with one case
// its form opens directly. The start step offers «شروع پروندهٔ تازه». A table view numbers the steps with their
// people, action and my part. Phones get the numbered list.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Segmented, Table } from "antd";
import { Play } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../lib/org";
import { useIsPhone } from "../../../lib/hooks";
import { Chip, EmptyState, Loader } from "../../../components/display";
import { relTime } from "../../../records/model/activity";
import { ProcessCanvas, StepLegend, StepList } from "../kit";
import { USER_KEYS, userApi, type ProcessView, type StepView } from "./api";
import { actionLabel, processMarks } from "./model";
import { DuePill, Head, useWf } from "./parts";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

function StepQueue({ view, step, onStart }: { view: ProcessView; step: StepView; onStart: () => void }) {
  const wf = useWf();
  return (
    <section className="wfu-panel" aria-label={`مرحلهٔ «${step.label}»`}>
      <h2 className="wfu-h2">{step.label}</h2>
      <p className="wfu-panel-m">
        <Chip tone="accent" dot={false}>
          {actionLabel(step.action)}
        </Chip>
        {step.mine ? <Chip tone="info">نقش شما</Chip> : null}
      </p>
      <p className="rk-hint">{step.people.join("، ") || "انجام‌دهنده تعیین نشده"}</p>
      {step.start ? (
        view.start.can_start ? (
          <Button type="primary" icon={<Play {...I16} />} onClick={onStart}>
            شروع پروندهٔ تازه
          </Button>
        ) : (
          <p className="rk-hint">این گردش‌کار را دیگران آغاز می‌کنند.</p>
        )
      ) : step.queue.length ? (
        <ul className="wfu-queue" aria-label="پرونده‌های منتظر شما در این مرحله">
          {step.queue.map((t) => (
            <li key={t.task_id}>
              <Link to={wf.to(wf.paths.step(t.case_id, t.task_id))} className="wfu-queue-i">
                <span className="wfu-queue-t">
                  {t.number ? <bdi className="ltr wfu-no">{t.number}</bdi> : null}
                  <span>{t.title || t.number}</span>
                </span>
                <span className="wfu-queue-m">
                  {t.since ? <span>{relTime(t.since)}</span> : null}
                  <DuePill due={t.due_at} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : step.mine ? (
        <p className="rk-hint">پرونده‌ای در این مرحله منتظر شما نیست.</p>
      ) : null}
    </section>
  );
}

export default function ProcessPage() {
  const { key = "" } = useParams();
  const { api, orgId } = useOrg();
  const wf = useWf();
  const nav = useNavigate();
  const phone = useIsPhone();
  const [mode, setMode] = useState<"diagram" | "table">("diagram");
  const [sel, setSel] = useState<string | null>(null);
  const view = useQuery({ queryKey: USER_KEYS.view(orgId, key), queryFn: () => userApi.view(api, key), staleTime: 30_000 });
  const data = view.data;
  const m = useMemo(() => (data ? processMarks(data.steps) : { statuses: {}, notes: {} }), [data]);
  if (view.isLoading) return <Loader />;
  if (view.isError || !data) return <EmptyState title="گردش‌کار پیدا نشد" description={view.error instanceof Error ? view.error.message : undefined} />;
  const start = () => nav(wf.to(wf.paths.start(data.process.key)));
  const waiting = data.steps.reduce((n, s) => n + s.queue.length, 0);
  const open = (id: string | null) => {
    const s = id ? data.steps.find((x) => x.key === id) : undefined;
    // one case waiting at my step: its form at once
    if (s && !s.start && s.queue.length === 1) {
      nav(wf.to(wf.paths.step(s.queue[0].case_id, s.queue[0].task_id)));
      return;
    }
    setSel(id);
  };
  const selected = sel ? data.steps.find((s) => s.key === sel) : undefined;
  const sub = [`نسخهٔ ${faDigits(data.version.version_no)}`, data.process.category, waiting ? `${faDigits(waiting)} پرونده منتظر شما` : null, data.process.status === "retired" ? "بازنشسته" : null].filter(Boolean).join(" · ");
  return (
    <div className="wfu-page">
      <Head
        title={data.process.name}
        sub={sub}
        back={{ to: wf.to(wf.paths.home("mine")), label: "گردش‌کارهای من" }}
        actions={
          data.start.can_start ? (
            <Button type="primary" icon={<Play {...I16} />} onClick={start}>
              شروع پروندهٔ تازه
            </Button>
          ) : null
        }
      />
      {data.process.description ? <p className="wfu-lead">{data.process.description}</p> : null}
      {!phone ? (
        <Segmented
          className="wfu-mode"
          value={mode}
          onChange={(v) => setMode(v as "diagram" | "table")}
          options={[
            { value: "diagram", label: "نمودار" },
            { value: "table", label: "جدول مرحله‌ها" },
          ]}
        />
      ) : null}
      {phone ? (
        <>
          <StepList graph={data.graph} statuses={m.statuses} notes={m.notes} onOpen={open} selected={sel} label={`مرحله‌های «${data.process.name}»`} />
          {selected ? <StepQueue view={data} step={selected} onStart={start} /> : null}
        </>
      ) : mode === "table" ? (
        <Table<StepView>
          rowKey="key"
          size="small"
          pagination={false}
          className="wfu-table"
          dataSource={data.steps}
          columns={[
            { key: "n", title: "#", width: 48, render: (_, __, i) => <span className="ds-num">{faDigits(i + 1)}</span> },
            { key: "label", title: "مرحله", render: (_, s) => s.label },
            { key: "action", title: "کار", width: 110, render: (_, s) => actionLabel(s.action) },
            { key: "people", title: "چه کسی", render: (_, s) => s.people.join("، ") || "—" },
            {
              key: "me",
              title: "نقش شما",
              render: (_, s) =>
                s.mine ? (
                  <span className="wfu-step-cell">
                    <Chip tone="info">نقش شما</Chip>
                    {s.queue.length ? (
                      <Button size="small" onClick={() => open(s.key)}>
                        {`${faDigits(s.queue.length)} پرونده منتظر شما`}
                      </Button>
                    ) : null}
                  </span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      ) : (
        <div className="wfu-split">
          <div className="wfu-diagram">
            <ProcessCanvas graph={data.graph} readOnly statuses={m.statuses} notes={m.notes} selected={sel} onSelect={open} label={`نمودار «${data.process.name}»`} className="wfu-canvas" />
            <StepLegend only={["mine_open", "mine_expected"]} />
          </div>
          <aside className="wfu-aside">
            {selected ? (
              <StepQueue view={data} step={selected} onStart={start} />
            ) : (
              <section className="wfu-panel" aria-label="مرحله‌های شما">
                <h2 className="wfu-h2">مرحله‌های شما</h2>
                {data.steps.some((s) => s.mine) ? (
                  <ul className="wfu-queue">
                    {data.steps
                      .filter((s) => s.mine)
                      .map((s) => (
                        <li key={s.key}>
                          <button type="button" className="wfu-queue-i" onClick={() => open(s.key)}>
                            <span className="wfu-queue-t">{s.label}</span>
                            <span className="wfu-queue-m">{s.start ? "آغاز پرونده" : s.queue.length ? `${faDigits(s.queue.length)} پرونده منتظر شما` : actionLabel(s.action)}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="rk-hint">در این گردش‌کار مرحله‌ای با شما نیست.</p>
                )}
                <p className="rk-hint">روی هر مرحله بزنید تا پرونده‌های منتظر شما در آن را ببینید.</p>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

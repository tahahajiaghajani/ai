// A run's page: its state, the graph of its version with each step's status, the step-by-step log, what it waits
// for (approvers decide here while the built-in approval stands in), its data when the member may see it, and
// «لغو اجرا».
import { useParams, useNavigate } from "react-router";
import { App, Button } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Workflow } from "lucide-react";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { Card, ICON } from "../../components/blocks";
import { useSchema } from "../../records";
import { FlowCanvas } from "./FlowCanvas";
import { RunStateChip, RunSteps, statusesOf, triggerLabel } from "./RunSteps";
import { flowKeys, flowsApi, useRun } from "./api";

export default function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { modal } = App.useApp();
  const { schema } = useSchema();
  const q = useRun(runId);
  const cancel = useAction(() => flowsApi.cancel(api, runId!), { success: "اجرا لغو شد", onSuccess: () => qc.invalidateQueries({ queryKey: flowKeys.all(orgId) }) });
  if (q.isLoading) return <Loader />;
  if (!q.data) return <EmptyState title="اجرا پیدا نشد" icon={Workflow} />;
  const d = q.data;
  const r = d.run;
  const tableLabel = (k: string) => schema?.def(k)?.plural ?? k;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back
        title={`اجرای «${r.flow_name}»`}
        subtitle={
          <>
            <RunStateChip state={r.state} /> {triggerLabel(r.test ? "test" : r.trigger_kind)} · {r.version_no ? `نسخهٔ ${faDigits(r.version_no)}` : "پیش‌نویس"} · {formatJalaliDateTime(r.started_at)}
          </>
        }
        actions={
          <>
            <Button icon={<Workflow {...ICON} />} onClick={() => nav(`/${orgId}/flows/${r.flow_id}/design`)}>
              طرح گردش‌کار
            </Button>
            {d.can_cancel ? (
              <Button
                danger
                icon={<Ban {...ICON} />}
                loading={cancel.isPending}
                onClick={() =>
                  modal.confirm({ title: "این اجرا لغو شود؟", okText: "لغو اجرا", okButtonProps: { danger: true }, cancelText: "انصراف", onOk: () => cancel.mutateAsync(undefined) })
                }
              >
                لغو اجرا
              </Button>
            ) : null}
          </>
        }
      />
      <div className="fl-run-grid">
        {d.graph ? (
          <Card title="مسیر اجرا" flush>
            <FlowCanvas
              className="fl-run-canvas"
              graph={d.graph}
              direction={d.graph.layout?.direction ?? "TB"}
              statuses={statusesOf(d)}
              current={r.current_nodes}
              readOnly
              tableLabel={tableLabel}
            />
          </Card>
        ) : null}
        <Card title={`گام‌ها (${faDigits(d.steps.length)})`}>
          <RunSteps detail={d} />
        </Card>
      </div>
      {d.context ? (
        <Card title="داده‌های اجرا">
          <pre className="fl-json">{JSON.stringify(d.context, null, 2)}</pre>
        </Card>
      ) : null}
    </div>
  );
}

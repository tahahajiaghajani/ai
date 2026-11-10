// «پیشنهادهای هوش مصنوعی» (docs/spec/AI.md §11.8): proposals routed to me or to one of my groups — an agent's, by the
// record's assignment or its approvers — and those made for me. Each is shown only when I may read its record and every
// field it involves (the server checks), and applied with my own access; a batch reports every row.
import "./agents.css";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented } from "antd";
import type { AiProposal } from "@shared/ai/types";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { EmptyState, JDateTime, Skeleton } from "../../components/display";
import { ProposalCard } from "../assistant/ProposalCard";
import { AGENT_KEYS, agentsApi } from "./api";

export default function ProposalsInbox() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"proposed" | "">("proposed");
  const q = useQuery({ queryKey: AGENT_KEYS.inbox(orgId, status), queryFn: () => agentsApi.inbox(api, status) });
  const changed = (_p: AiProposal) => void qc.invalidateQueries({ queryKey: ["ai-agents", orgId, "inbox"] });
  const go = (path: string, state?: unknown) => nav(`/${orgId}/${path}`, state ? { state } : undefined);
  const list = q.data?.actions ?? [];
  return (
    <div>
      <PageHeader title="پیشنهادهای هوش مصنوعی" />
      <div className="ag-inbox">
        <Segmented
          value={status}
          onChange={(v) => setStatus(v as "proposed" | "")}
          options={[
            { value: "proposed", label: "در انتظار" },
            { value: "", label: "همه" },
          ]}
        />
        {q.isLoading ? (
          <Skeleton rows={6} />
        ) : q.error ? (
          <EmptyState title="پیشنهادها بارگذاری نشد." description={(q.error as Error).message} action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} />
        ) : !list.length ? (
          <EmptyState title={status ? "پیشنهادی در انتظار شما نیست." : "پیشنهادی نیست."} />
        ) : (
          list.map((a) => (
            <div key={a.id}>
              <div className="ag-inbox-m">
                <span>{a.agent ? `عامل «${a.agent.name}»` : a.user.name ?? ""}</span>
                <JDateTime v={a.created_at} />
                {a.confirmed_by?.name ? <span>تصمیم: {a.confirmed_by.name}</span> : null}
              </div>
              <ProposalCard proposal={a} canDecide={a.can_decide} onChange={changed} onNavigate={go} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

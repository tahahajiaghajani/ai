// Agents a member may start on the record (the record's «هوش مصنوعی» panel): switched on, started «by hand», and
// allowed to the member's roles. The agent runs in the background with its own principal; its proposals come back to
// the record's people (and to «پیشنهادهای هوش مصنوعی»).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Tooltip } from "antd";
import { Bot } from "lucide-react";
import { AGENT_AUTONOMY } from "@shared/ai/agents";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { ICON14 } from "../../components/blocks";
import { agentsApi } from "./api";

export function RecordAgents({ table, id }: { table: string; id: string }) {
  const { api, orgId, can } = useOrg();
  const n = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["ai-agents", orgId, "for", table], queryFn: () => agentsApi.forTable(api, table), enabled: can("ai", "view"), staleTime: 60_000 });
  const agents = q.data?.agents ?? [];
  if (!agents.length) return null;
  const start = async (key: string) => {
    setBusy(key);
    try {
      const r = await agentsApi.start(api, key, { table, id });
      if (r.run_id) n.ok(r.message_fa);
      else n.error(new Error(r.message_fa));
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="sk-sec">عامل‌ها</div>
      <div className="sk-list" role="list">
        {agents.map((a) => (
          <div key={a.key} role="listitem" className="sk-row">
            <span className="sk-row-t" title={a.description}>
              {a.name}
            </span>
            <span className="sk-row-tag">{AGENT_AUTONOMY[a.autonomy].label}</span>
            <Tooltip title="آغاز عامل روی همین رکورد">
              <Button size="small" type="text" aria-label={`آغاز ${a.name}`} loading={busy === a.key} disabled={!!busy && busy !== a.key} icon={<Bot {...ICON14} />} onClick={() => void start(a.key)} />
            </Tooltip>
          </div>
        ))}
      </div>
    </>
  );
}

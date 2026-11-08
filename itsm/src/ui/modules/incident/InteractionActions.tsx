// «ثبت رخداد» on an open interaction without an incident (catalogue INC-044): the server creates the incident from the
// subject, transcript, caller and channel, links it with the wrap-up «رخداد ثبت شد» and the page opens the incident.
import { useNavigate } from "react-router";
import { Button } from "antd";
import { Siren } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { ICON14 } from "../../components/blocks";
import { recordPath, type RecordContext } from "../../records";
import { incidentApi } from "./api";

export default function InteractionActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const run = useAction(() => incidentApi.fromInteraction(api, String(ctx.row.id)), {
    success: "رخداد ثبت شد.",
    onSuccess: (d) => nav(`/${orgId}/${recordPath("incident", String(d.row.id))}`),
  });
  if (!ctx.meta.canWrite || ctx.row.state !== "open" || ctx.row.incident_id) return null;
  return (
    <Button type="primary" icon={<Siren {...ICON14} />} loading={run.isPending} onClick={() => run.mutate(undefined)}>
      ثبت رخداد
    </Button>
  );
}

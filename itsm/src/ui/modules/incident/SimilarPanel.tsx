// «رخدادهای مشابه» on an incident: incidents the caller may read that look like this one (same CI, service,
// subcategory, requester, title words — and the AI layer's neighbours when it is on), each with why it matched. Open
// ones can be merged into this incident or made its children; resolved ones show how they were solved.
import { useQuery } from "@tanstack/react-query";
import { Button, Popconfirm, Tooltip } from "antd";
import { GitMerge, CornerDownLeft } from "lucide-react";
import { Link } from "react-router";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Loader } from "../../components/display";
import { ICON14 } from "../../components/blocks";
import { ChoiceTag, recordPath, recordsApi, type RecordContext } from "../../records";
import { optionsOf } from "../../records/model/schema";
import { INCIDENT_KEYS, incidentApi, useIncidentRefresh } from "./api";
import { persian } from "./model";

export default function SimilarPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const refresh = useIncidentRefresh();
  const q = useQuery({ queryKey: INCIDENT_KEYS.similar(orgId, ctx.row.id), queryFn: () => incidentApi.similar(api, ctx.row.id), staleTime: 60_000 });
  const work = !!(ctx.meta as { incident?: { can_work?: boolean } }).incident?.can_work && !!ctx.row.active;
  const after = () => {
    ctx.refresh();
    void refresh();
  };
  const merge = useAction((id: string) => incidentApi.merge(api, ctx.row.id, [id]), {
    success: (d) => (d.merged.length ? "رخداد تکراری ادغام شد." : (d.failed[0]?.message ?? "ادغام انجام نشد")),
    onSuccess: after,
  });
  const child = useAction((hit: { id: string }) => recordsApi.update(api, "incident", hit.id, { parent_id: ctx.row.id }), { success: "به‌عنوان رخداد فرزند پیوند شد.", onSuccess: after });
  const stateField = ctx.def.fields.find((f) => f.name === "state");
  if (q.isLoading) return <Loader />;
  const hits = q.data?.hits ?? [];
  if (!hits.length) return <p className="text-[13px] text-ink-3">رخداد مشابهی پیدا نشد.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {hits.map((h) => (
        <li key={h.id} className="flex flex-col gap-1 rounded-md bg-sunken px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Link to={`/${orgId}/${recordPath("incident", h.id)}`} className="ds-link min-w-0 truncate text-[13px]">
              <bdi className="ds-num">{h.number}</bdi> {h.short_description}
            </Link>
            <span className="ms-auto shrink-0">
              <ChoiceTag option={stateField ? optionsOf(stateField, ctx.schema.choices).find((o) => o.value === h.state) : undefined} value={h.state} />
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
            <span className="ds-num">{persian(String(h.score))}٪</span>
            <span>{h.reasons.join("، ")}</span>
          </div>
          {!h.open && h.close_notes ? <p className="line-clamp-3 whitespace-pre-wrap text-[12px] text-ink-2">{h.close_notes}</p> : null}
          {work && h.open ? (
            <div className="flex gap-1.5 pt-0.5">
              <Popconfirm title={`${h.number} در این رخداد ادغام و لغو شود؟`} okText="ادغام" cancelText="انصراف" onConfirm={() => merge.mutate(h.id)}>
                <Button size="small" icon={<GitMerge {...ICON14} />} loading={merge.isPending && merge.variables === h.id}>
                  ادغام در این رخداد
                </Button>
              </Popconfirm>
              <Tooltip title="آن رخداد فرزند این رخداد می‌شود و با حل این رخداد حل می‌شود">
                <Button size="small" type="text" icon={<CornerDownLeft {...ICON14} />} onClick={() => child.mutate(h)} loading={child.isPending && child.variables?.id === h.id}>
                  فرزند این رخداد
                </Button>
              </Tooltip>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

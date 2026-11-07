// «خطاهای شناخته‌شدهٔ منطبق» on an open incident: published known errors whose symptoms, CI, service or category fit
// it, with their workaround; «اعمال راه‌حل موقت» links the known error (and its problem), copies the workaround and
// counts the use, «اعمال و حل» also resolves the incident with it.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { Wrench, CheckCheck } from "lucide-react";
import { Link } from "react-router";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Loader } from "../../components/display";
import { ICON14 } from "../../components/blocks";
import { RecordMarkdown, recordPath, type RecordContext } from "../../records";
import { INCIDENT_KEYS, incidentApi, useIncidentRefresh } from "./api";
import { persian } from "./model";

export default function KnownErrorPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const refresh = useIncidentRefresh();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: INCIDENT_KEYS.knownErrors(orgId, ctx.row.id), queryFn: () => incidentApi.knownErrors(api, ctx.row.id), staleTime: 60_000 });
  const work = !!(ctx.meta as { incident?: { can_work?: boolean } }).incident?.can_work;
  const apply = useAction(({ id, resolve }: { id: string; resolve: boolean }) => incidentApi.applyKnownError(api, ctx.row.id, id, resolve), {
    success: (_d) => "راه‌حل موقت به کار رفت.",
    onSuccess: () => {
      ctx.refresh();
      void refresh();
    },
  });
  if (q.isLoading) return <Loader />;
  const hits = q.data?.hits ?? [];
  if (!hits.length) return <p className="text-[13px] text-ink-3">خطای شناخته‌شده‌ای با این رخداد جور نیست.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {hits.map((k) => {
        const applied = ctx.row.known_error_id === k.id;
        return (
          <li key={k.id} className="flex flex-col gap-1 rounded-md bg-sunken px-2.5 py-2">
            <Link to={`/${orgId}/${recordPath("known_error", k.id)}`} className="ds-link text-[13px]">
              <bdi className="ds-num">{k.number}</bdi> {k.short_description}
            </Link>
            <div className="flex flex-wrap gap-x-2 text-[12px] text-ink-3">
              <span className="ds-num">{persian(String(k.score))}٪</span>
              <span>{k.reasons.join("، ")}</span>
              {k.use_count ? <span>· {persian(String(k.use_count))} بار به کار رفته</span> : null}
            </div>
            {k.workaround ? (
              open === k.id ? (
                <div className="text-[13px]">
                  <RecordMarkdown text={k.workaround} />
                </div>
              ) : (
                <button type="button" className="ds-link self-start text-[12px]" onClick={() => setOpen(k.id)}>
                  نمایش راه‌حل موقت
                </button>
              )
            ) : null}
            {work && !applied ? (
              <div className="flex gap-1.5 pt-0.5">
                <Button size="small" icon={<Wrench {...ICON14} />} onClick={() => apply.mutate({ id: k.id, resolve: false })} loading={apply.isPending && apply.variables?.id === k.id && !apply.variables.resolve}>
                  اعمال راه‌حل موقت
                </Button>
                <Button size="small" type="text" icon={<CheckCheck {...ICON14} />} onClick={() => apply.mutate({ id: k.id, resolve: true })} loading={apply.isPending && apply.variables?.id === k.id && apply.variables.resolve}>
                  اعمال و حل
                </Button>
              </div>
            ) : applied ? (
              <span className="text-[12px] text-ink-3">روی این رخداد به کار رفته است.</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

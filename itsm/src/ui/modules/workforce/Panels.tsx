// Record-page part of workforce: «پیشنهاد کارشناس» (WFM-009) on the work tables — the people of the record's team ranked
// by skill match × availability (presence, shift, time off) × spare capacity, with the reasons; picking one assigns the
// record through the record's own save (the engine checks the person may). A suggestion, never an automatic
// assignment; shown only to those who may change the record.
import { useQuery } from "@tanstack/react-query";
import { Button, Tooltip } from "antd";
import { toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { Chip, Loader } from "../../components/display";
import type { RecordContext } from "../../records";
import { WFM_KEYS, wfmApi } from "./api";

export function RoutingPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const canWrite = !!ctx.meta.canWrite;
  const q = useQuery({ queryKey: WFM_KEYS.routing(orgId, ctx.table, String(ctx.row.id)), queryFn: () => wfmApi.routing(api, ctx.table, String(ctx.row.id)), enabled: canWrite, retry: false });
  if (!canWrite) return null;
  if (q.isLoading) return <Loader />;
  if (q.isError) return <p className="text-[12px] text-ink-3">پیشنهاد کارشناس در دسترس نیست.</p>;
  const d = q.data;
  if (!d?.group_id) return <p className="text-[12px] text-ink-3">نخست گروه پشتیبانی را مشخص کنید.</p>;
  if (!d.candidates.length) return <p className="text-[12px] text-ink-3">عضوی در این گروه نیست.</p>;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {d.required.length ? <div className="flex flex-wrap gap-1">{d.required.map((r) => <Chip key={r.skill_id} tone="neutral" dot={false} title={r.why}>{r.name}</Chip>)}</div> : null}
      {d.candidates.slice(0, 5).map((c) => (
        <div key={c.user_id} className="flex items-center justify-between gap-2">
          <Tooltip title={c.reasons.join("؛ ")}>
            <span className={c.eligible ? undefined : "text-ink-3"}>{c.name} <span className="ds-num text-[12px] text-ink-3">{c.eligible ? `${toFa(Math.round(c.score * 100))}٪` : "—"}</span></span>
          </Tooltip>
          {c.eligible && ctx.row.assigned_to !== c.user_id ? <Button size="small" onClick={() => ctx.save({ assigned_to: c.user_id })}>ارجاع</Button> : ctx.row.assigned_to === c.user_id ? <Chip tone="in" dot={false}>کارشناس کنونی</Chip> : null}
        </div>
      ))}
      <p className="text-[11px] text-ink-3">رتبه: تطابق مهارت × در دسترس بودن × ظرفیت آزاد.</p>
    </div>
  );
}

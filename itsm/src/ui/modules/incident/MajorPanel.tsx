// «رخداد عمده» on an incident in the overlay: where it stands, its manager and communications lead, the coordination
// bridge, when the next stakeholder update is due, and the way into the war room.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Radio } from "lucide-react";
import { MAJOR_DECLARED, MAJOR_STATES } from "@shared/tables/incident";
import { useOrg } from "../../lib/org";
import { Chip } from "../../components/display";
import { ICON14 } from "../../components/blocks";
import { ChoiceTag, UserChip, type RecordContext } from "../../records";
import { cadence } from "./model";

export default function MajorPanel({ ctx }: { ctx: RecordContext }) {
  const { orgId } = useOrg();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const row = ctx.row;
  const state = String(row.major_state ?? "");
  const c = state === "accepted" ? cadence(row.next_update_at as string | null, now) : { tone: null, text: "" };
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <ChoiceTag option={MAJOR_STATES.find((o) => o.value === state)} value={state} strong />
      {row.mi_manager_id ? (
        <div className="flex items-center gap-2">
          <span className="text-ink-3">مدیر:</span>
          <UserChip id={row.mi_manager_id as string} display={ctx.display} />
        </div>
      ) : null}
      {row.mi_comms_id ? (
        <div className="flex items-center gap-2">
          <span className="text-ink-3">اطلاع‌رسانی:</span>
          <UserChip id={row.mi_comms_id as string} display={ctx.display} />
        </div>
      ) : null}
      {c.text ? <Chip tone={c.tone === "danger" ? "danger" : c.tone === "warning" ? "warning" : "neutral"}>{c.text}</Chip> : null}
      {row.bridge_url ? (
        <a href={String(row.bridge_url)} target="_blank" rel="noreferrer noopener" className="ds-link inline-flex items-center gap-1">
          <ExternalLink {...ICON14} aria-hidden /> پیوستن به جلسهٔ هماهنگی
        </a>
      ) : null}
      {MAJOR_DECLARED.includes(state) ? (
        <Link to={`/${orgId}/incidents/${row.id}/war-room`} className="ds-link inline-flex items-center gap-1">
          <Radio {...ICON14} aria-hidden /> اتاق عملیات
        </Link>
      ) : null}
    </div>
  );
}

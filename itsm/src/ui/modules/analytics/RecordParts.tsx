// Record-page extensions of the analytics tables: a schedule's Jalali-aware timing editor (the flows' schedule editor)
// with «ارسال اکنون», and an indicator's live check — whether its formula and parts are valid here and the value the
// viewer would see for the current period — with a link to the KPI hub.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { Send } from "lucide-react";
import { describeSchedule, type ScheduleSpec } from "@shared/flows";
import { formatJalaliDateTime } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { Loader } from "../../components/display";
import { ICON14, Note } from "../../components/blocks";
import type { RecordContext } from "../../records";
import { ScheduleEditor } from "../flows/ScheduleEditor";
import { analyticsApi } from "./api";
import { KpiTile } from "./parts";

export function ScheduleTab({ ctx }: { ctx: RecordContext }) {
  const { timezone } = useOrg();
  const [value, setValue] = useState<ScheduleSpec>(ctx.row.schedule as ScheduleSpec);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(ctx.row.schedule);
  return (
    <div className="flex flex-col gap-3">
      <ScheduleEditor value={value} onChange={setValue} disabled={!ctx.meta.canWrite} />
      <div className="an-muted">{describeSchedule(value, timezone)} — در منطقهٔ زمانی سازمان ({timezone})</div>
      {ctx.row.next_run_at ? <div>ارسال بعدی: {formatJalaliDateTime(String(ctx.row.next_run_at), timezone)}</div> : <div className="an-muted">ارسال بعدی ندارد (غیرفعال یا پایان‌یافته)</div>}
      {ctx.row.last_result ? <div className="an-muted">آخرین ارسال: {String(ctx.row.last_result)}</div> : null}
      {ctx.meta.canWrite ? (
        <div>
          <Button type="primary" disabled={!dirty} loading={saving} onClick={async () => {
            setSaving(true);
            await ctx.save({ schedule: value });
            setSaving(false);
          }}>
            ذخیرهٔ زمان‌بندی
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function SendNow({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const n = useNotify();
  const [busy, setBusy] = useState(false);
  if (!ctx.meta.canWrite) return null;
  return (
    <Button icon={<Send {...ICON14} />} loading={busy} onClick={async () => {
      setBusy(true);
      try {
        const r = await analyticsApi.send(api, ctx.row.id);
        const sent = r.outcomes.filter((o) => o.status === "sent").length;
        n.ok(`${faDigits(sent)} از ${faDigits(r.outcomes.length)} گیرنده گزارش را دریافت کردند`);
        ctx.refresh();
      } catch (e) {
        n.error(e);
      } finally {
        setBusy(false);
      }
    }}>
      ارسال اکنون
    </Button>
  );
}

export function IndicatorPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const body = { formula: String(ctx.row.formula ?? ""), parts: Array.isArray(ctx.row.parts) ? ctx.row.parts : [], breakdowns: Array.isArray(ctx.row.breakdowns) ? (ctx.row.breakdowns as string[]) : [], grain: String(ctx.row.grain ?? "month") };
  const q = useQuery({ queryKey: ["analytics", orgId, "check", body], queryFn: () => analyticsApi.checkIndicator(api, body), retry: false });
  if (q.isLoading) return <Loader />;
  if (q.error) return <Note tone="danger">{errorText(q.error)}</Note>;
  if (q.data?.problem) return <Note tone="warning">{q.data.problem}</Note>;
  return (
    <div className="flex flex-col gap-2">
      {q.data?.item ? <KpiTile item={{ ...q.data.item, name: String(ctx.row.name ?? ""), unit: (ctx.row.unit as never) ?? "number", target: ctx.row.target === null || ctx.row.target === undefined ? null : Number(ctx.row.target) }} compact /> : null}
      <Link className="ds-link" to={`/${orgId}/analytics/indicators/${ctx.row.id}`}>
        جزئیات و روند شاخص
      </Link>
    </div>
  );
}

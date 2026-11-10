// Record-page parts of service level management:
//   AgreementPanel   side panel of an agreement: the current compliance, «نمای ۳۶۰», the document and the targets from
//                    the offerings' commitments
//   TargetPanel      side panel of a target: the recommended hours per priority from history and the what-if replay
//                    (timer targets), or the period's value (manual targets)
//   XlaPanel         side panel «تجربه» of incidents and requested items: the record's experience score and why
//   ReviewActions    header action of a review: its pack
import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, InputNumber, Space } from "antd";
import { FileText, Gauge, Link2, RefreshCw, ScrollText } from "lucide-react";
import { toFa } from "@shared/jalali";
import { PRIORITY_KEYS } from "@shared/slm/logic";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Chip, Loader } from "../../components/display";
import { ICON } from "../../components/blocks";
import type { RecordContext } from "../../records";
import { SLM_KEYS, slmApi } from "./api";
import { DocumentDrawer } from "./Agreement360";
import { STATUS_LABEL, STATUS_TONE, type Row } from "./model";

export function AgreementPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const r = ctx.row as Row;
  const meta = (ctx.meta.slm ?? {}) as { can_write?: boolean; manages?: boolean };
  const [doc, setDoc] = useState(false);
  const link = useAction(() => slmApi.linkCommitments(api, String(r.id)), { success: (d) => (d.added ? `${toFa(d.added)} هدف از تعهدهای گزینه‌ها افزوده شد` : "تعهد تازه‌ای برای افزودن نبود"), onSuccess: () => ctx.refresh() });
  const status = String(r.compliance_status ?? "no_data");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
        <span className="ds-num">{r.compliance_pct === null || r.compliance_pct === undefined ? "—" : `${toFa(r.compliance_pct)}٪`}</span>
      </div>
      {r.watermelon ? <Chip tone="danger">سبز در توافق، قرمز در تجربه</Chip> : null}
      <Space wrap>
        <Link to={`/${orgId}/slm/agreements/${r.id}/360`}><Button size="small" icon={<Gauge {...ICON} />}>نمای ۳۶۰</Button></Link>
        <Button size="small" icon={<FileText {...ICON} />} onClick={() => setDoc(true)}>سند توافق</Button>
        {meta.can_write || meta.manages ? <Button size="small" icon={<Link2 {...ICON} />} loading={link.isPending} onClick={() => link.mutate(undefined)}>اهداف از تعهدها</Button> : null}
      </Space>
      <DocumentDrawer id={String(r.id)} open={doc} onClose={() => setDoc(false)} canAccept={!r.accepted_at && !!meta.can_write} onAccepted={() => ctx.refresh()} />
    </div>
  );
}

export function TargetPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const r = ctx.row as Row;
  const [p, setP] = useState(85);
  const [proposed, setProposed] = useState<Record<string, number | null>>({});
  const timer = r.kind === "timer";
  const q = useQuery({ queryKey: SLM_KEYS.recommend(orgId, String(r.id), p), queryFn: () => slmApi.recommend(api, String(r.id), p), enabled: timer });
  const sim = useAction(() => slmApi.simulate(api, String(r.id), proposed, p));
  const [manual, setManual] = useState<number | null>(null);
  const save = useAction(() => slmApi.manual(api, String(r.id), manual ?? 0), { success: "مقدار دوره ثبت شد", onSuccess: () => { ctx.refresh(); qc.invalidateQueries({ queryKey: SLM_KEYS.all }); } });
  if (r.kind === "manual") {
    return (
      <Space.Compact className="w-full">
        <InputNumber min={0} max={100} value={manual} onChange={(v) => setManual(v === null ? null : Number(v))} placeholder="مقدار این دوره" className="flex-1" />
        <Button type="primary" disabled={manual === null} loading={save.isPending} onClick={() => save.mutate(undefined)}>ثبت</Button>
      </Space.Compact>
    );
  }
  if (!timer) return <p className="text-[13px] text-ink-3">این هدف از دادهٔ خود سنجیده می‌شود.</p>;
  if (q.isLoading) return <Loader />;
  const d = q.data;
  if (!d) return null;
  const pct = (x: { pct: number | null }) => (x.pct === null ? "—" : `${toFa(x.pct)}٪`);
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-3">سابقه: {d.window.label}</span>
        <InputNumber size="small" min={50} max={99} value={p} onChange={(v) => setP(Number(v ?? 85))} addonAfter="صدک" style={{ inlineSize: 110 }} />
      </div>
      <table className="slm-table">
        <thead><tr><th scope="col">اولویت</th><th scope="col">کنونی</th><th scope="col">پیشنهاد</th><th scope="col">نمونه</th><th scope="col">آزمودن</th></tr></thead>
        <tbody>
          {PRIORITY_KEYS.map((k) => (
            <tr key={k}>
              <th scope="row" className="font-normal">{toFa(k)}</th>
              <td className="ds-num">{d.current[k] === null ? "—" : toFa(d.current[k]!)}</td>
              <td className="ds-num">{d.recommended[k].hours === null ? "—" : toFa(d.recommended[k].hours!)}</td>
              <td className="ds-num text-ink-3">{toFa(d.recommended[k].n)}</td>
              <td><InputNumber size="small" min={0} value={proposed[k] ?? null} onChange={(v) => setProposed({ ...proposed, [k]: v === null ? null : Number(v) })} style={{ inlineSize: 72 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>در موعد با ساعت‌های کنونی: <span className="ds-num">{pct(d.simulation.current)}</span> · با پیشنهاد: <span className="ds-num">{pct(d.simulation.recommended)}</span></div>
      <Button size="small" onClick={() => sim.mutate(undefined)} loading={sim.isPending} disabled={!Object.values(proposed).some((v) => v !== null && v !== undefined)}>شبیه‌سازی ساعت‌های آزمودنی</Button>
      {sim.data?.simulation.proposed ? <div>با ساعت‌های آزمودنی: <span className="ds-num">{pct(sim.data.simulation.proposed)}</span> ({toFa(sim.data.simulation.proposed.breached)} نقض از {toFa(sim.data.simulation.proposed.total)})</div> : null}
      <p className="text-[12px] text-ink-3">ساعت‌ها زمان کاری‌اند؛ شبیه‌سازی زمان رکوردهای پایان‌یافتهٔ سه ماه گذشته را با هدف تازه می‌سنجد.</p>
    </div>
  );
}

const BAND_TONE: Record<string, "in" | "accent" | "warning" | "danger"> = { excellent: "in", good: "accent", fair: "warning", poor: "danger" };
const BAND_LABEL: Record<string, string> = { excellent: "عالی", good: "خوب", fair: "متوسط", poor: "ضعیف" };

export function XlaPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const key = SLM_KEYS.xla(orgId, ctx.table, String(ctx.row.id));
  const q = useQuery({ queryKey: key, queryFn: () => slmApi.xla(api, ctx.table, String(ctx.row.id)) });
  const rescore = useAction(() => slmApi.rescore(api, ctx.table, String(ctx.row.id)), { onSuccess: (d) => qc.setQueryData(key, d) });
  if (q.isLoading) return <Loader />;
  const x = q.data?.xla;
  if (!x) return (
    <div className="flex items-center justify-between text-[13px] text-ink-3">
      <span>امتیاز تجربه‌ای ثبت نشده است.</span>
      <Button size="small" icon={<RefreshCw {...ICON} />} onClick={() => rescore.mutate(undefined)} loading={rescore.isPending}>سنجش</Button>
    </div>
  );
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex items-center justify-between">
        <span className="ds-t-figure ds-num">{toFa(x.score)}</span>
        <Chip tone={BAND_TONE[x.band] ?? "neutral"}>{BAND_LABEL[x.band] ?? x.band}</Chip>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center text-[12px]">
        <span>اطمینان<br /><span className="ds-num">{toFa(x.reliability)}</span></span>
        <span>کیفیت<br /><span className="ds-num">{toFa(x.quality)}</span></span>
        <span>{x.survey ? "نظر درخواست‌کننده" : "زحمت"}<br /><span className="ds-num">{toFa(x.effort)}</span></span>
      </div>
      <p className="text-ink-2">{x.explanation}</p>
      <Button size="small" icon={<RefreshCw {...ICON} />} onClick={() => rescore.mutate(undefined)} loading={rescore.isPending}>سنجش دوباره</Button>
    </div>
  );
}

export function ReviewActions({ ctx }: { ctx: RecordContext }) {
  const { orgId } = useOrg();
  return <Link to={`/${orgId}/slm/reviews/${ctx.row.id}/pack`}><Button icon={<ScrollText {...ICON} />}>بستهٔ بازبینی</Button></Link>;
}

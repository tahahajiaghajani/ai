// «پیکربندی و اثر» — the side panel configuration management adds to every record of another module that names a CI
// (`ci_id`: incidents, problems, changes, requests…; catalogue CMDB-016/017/078, SPF-010): the CI with its class,
// state and data health, how many services its failure reaches, «افزودن خدمت‌های متأثر» (the services the CI's
// dependencies reach, merged into the record's affected services) and «پیکربندی نادرست بود» (the correction, a note
// on the record and a finding for the CI's owner). Links open the map and impact analysis around the CI.
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, Modal, Space } from "antd";
import { GitFork, ListPlus, TriangleAlert, Zap } from "lucide-react";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { Chip, Loader } from "../../components/display";
import type { RecordContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import { cmdbApi, CMDB_KEYS } from "./api";
import { CiPicker } from "./CiPicker";

const ICON = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/** Does this table name a CI the panel can work with? */
export const hasCiField = (ctx: RecordContext) => ctx.def.module !== "cmdb" && ctx.def.fields.some((f) => f.name === "ci_id" && f.type === "ref" && f.ref === "ci");

export function CiContextPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const ciId = String(ctx.row.ci_id ?? "");
  const [wrong, setWrong] = useState(false);
  const [correct, setCorrect] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const ci = useQuery({ queryKey: ["cmdb", orgId, "ci-lite", ciId], queryFn: () => recordsApi.get(api, "ci", ciId), enabled: !!ciId, staleTime: 30_000, retry: false });
  const q = { ci_ids: [ciId], state: "down" as const, depth: 8 };
  const impact = useQuery({ queryKey: CMDB_KEYS.impact(orgId, q), queryFn: () => cmdbApi.impact(api, q), enabled: !!ciId && !!ci.data, staleTime: 60_000 });
  const hasAffected = ctx.def.fields.some((f) => f.name === "affected_services" && f.type === "refs");
  const canWrite = ctx.meta.canWrite && !ctx.meta.locked;
  const fill = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ services: { id: string }[]; restricted: number }>("/service_portfolio/affected", { ci_ids: [ciId] });
      const current = Array.isArray(ctx.row.affected_services) ? (ctx.row.affected_services as string[]) : [];
      const next = [...new Set([...current, ...r.services.map((s) => s.id)])];
      if (next.length === current.length) return 0;
      const ok = await ctx.save({ affected_services: next });
      return ok ? next.length - current.length : 0;
    },
    onSuccess: (n) => message.success(n ? `${fa(n)} خدمت به خدمت‌های متأثر افزوده شد` : "خدمت تازه‌ای پیدا نشد"),
    onError: (e: Error) => message.error(e.message),
  });
  const report = useMutation({
    mutationFn: () => cmdbApi.wrongCi(api, { table: ctx.def.key, id: String(ctx.row.id), correct_ci_id: correct, note: note.trim() || null }),
    onSuccess: () => {
      message.success("ثبت شد؛ مالک پیکربندی خبردار می‌شود");
      setWrong(false);
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  if (!ciId) return null;
  if (ci.isLoading) return <Loader />;
  if (!ci.data) return <p className="text-[13px] text-ink-3">پیکربندی این رکورد را نمی‌توانید ببینید.</p>;
  const row = ci.data.row as Record<string, unknown>;
  const meta = (ci.data.meta.cmdb ?? {}) as { class_label?: string };
  const d = impact.data;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <Link className="ds-link font-medium" to={`/${orgId}/cis/${ciId}`}>{String(row.name ?? "")}</Link>
      <span className="text-ink-3">
        {meta.class_label ?? String(row.class ?? "")}
        {row.number ? <span className="ds-ltr ds-num ms-2">{faDigits(String(row.number))}</span> : null}
      </span>
      <div className="flex flex-wrap gap-1">
        {row.operational_status === "non_operational" || row.operational_status === "repair" ? <Chip tone="danger">از کار افتاده</Chip> : null}
        {row.is_stale ? <Chip tone="warning">دادهٔ کهنه</Chip> : null}
        {typeof row.health_score === "number" ? <Chip tone="neutral" dot={false} fig>{`سلامت ${fa(row.health_score as number)}`}</Chip> : null}
      </div>
      {d ? (
        <p className="text-ink-2">
          از کار افتادنش به <b className="ds-num">{fa(d.counts.services)}</b> خدمت و <b className="ds-num">{fa(d.counts.cis)}</b> پیکربندی می‌رسد.
        </p>
      ) : null}
      <Space size={6} wrap>
        <Link to={`/${orgId}/cmdb/map?root=${ciId}`}><Button size="small" icon={<GitFork {...ICON} />}>نقشه</Button></Link>
        <Link to={`/${orgId}/cmdb/impact?ci=${ciId}`}><Button size="small" icon={<Zap {...ICON} />}>اثر</Button></Link>
        {hasAffected && canWrite ? <Button size="small" icon={<ListPlus {...ICON} />} loading={fill.isPending} onClick={() => fill.mutate()}>افزودن خدمت‌های متأثر</Button> : null}
        {canWrite ? <Button size="small" type="text" icon={<TriangleAlert {...ICON} />} onClick={() => setWrong(true)}>پیکربندی نادرست بود</Button> : null}
      </Space>
      <Modal open={wrong} title="پیکربندی نادرست" onCancel={() => setWrong(false)} onOk={() => report.mutate()} okText="ثبت" cancelText="انصراف" okButtonProps={{ loading: report.isPending }} destroyOnHidden>
        <div className="flex flex-col gap-3 text-[13px]">
          <label className="flex flex-col gap-1">
            <span className="text-ink-2">پیکربندی درست (اختیاری)</span>
            <CiPicker value={correct} onChange={(v) => setCorrect((v as string | null) ?? null)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-2">توضیح</span>
            <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} />
          </label>
        </div>
      </Modal>
    </div>
  );
}

export default CiContextPanel;

// «تابلوی تقاضاها» (PRJ-001/002/003/013): the intake kanban — one column per state from submitted to approved (and
// deferred), the cards sorted by their score (WSJF, RICE or weighted, as each demand chose), with the score's parts;
// an approved demand converts to a project in one click (project managers). Cards open their demand.
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Tooltip } from "antd";
import { Plus, FolderPlus } from "lucide-react";
import { toFa } from "@shared/jalali";
import { DEMAND_TYPES, SCORING_MODELS } from "@shared/tables/project";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ICON, ICON14 } from "../../components/blocks";
import { recordPath, newRecordPath } from "../../records";
import { PROJECT_KEYS, projectApi } from "./api";
import type { Row } from "./model";
import "./project.css";

const typeLabel = (v: unknown) => DEMAND_TYPES.find((o) => o.value === v)?.label ?? String(v ?? "");
const modelLabel = (v: unknown) => (SCORING_MODELS.find((o) => o.value === v)?.label ?? "").split(" ")[0] || "WSJF";

function parts(d: Row): string {
  if (d.scoring_model === "rice") return `RICE ${d.score_rice ?? "—"}`;
  if (d.scoring_model === "weighted") return `وزنی ${d.score_weighted ?? "—"}`;
  const p = [d.business_value, d.time_criticality, d.risk_reduction].map((x) => (x === null || x === undefined ? "?" : String(x)));
  return `(${p.join(" + ")}) ÷ ${d.job_size ?? "?"}`;
}

export default function Demands() {
  const { api, orgId, allows } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: PROJECT_KEYS.meta(orgId), queryFn: () => projectApi.meta(api) });
  const q = useQuery({ queryKey: PROJECT_KEYS.demands(orgId), queryFn: () => projectApi.demands(api) });
  const convert = useAction((id: string) => projectApi.convert(api, id), {
    success: (p) => `پروژهٔ ${p.number ?? ""} ساخته شد`,
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: PROJECT_KEYS.demands(orgId) });
      nav(`/${orgId}/${recordPath("project", p.id)}`);
    },
  });
  const manages = !!meta.data?.manages;
  const total = (q.data?.columns ?? []).reduce((s, c) => s + c.items.length, 0);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="تابلوی تقاضاها"
        actions={allows({ area: "project", op: "create" }) ? <Button type="primary" icon={<Plus {...ICON} />} onClick={() => nav(newRecordPath("demand"))}>تقاضای تازه</Button> : null}
      />
      {q.isLoading ? (
        <Loader />
      ) : !q.data || !total ? (
        <EmptyState title="تقاضای بازی نیست" />
      ) : (
        <div className="pj-board" role="list" aria-label="ستون‌های تقاضا">
          {q.data.columns.map((c) => (
            <section key={c.state} className="pj-col" role="listitem" aria-label={c.label}>
              <h2 className="flex items-center justify-between px-1 text-[13px] text-ink-2">
                <span>{c.label}</span>
                <span className="ds-num text-ink-3">{toFa(c.items.length)}</span>
              </h2>
              {c.items.map((d) => (
                <article key={d.id} className="pj-card">
                  <div className="flex items-start justify-between gap-2">
                    <Link className="ds-link text-[13px]" to={`/${orgId}/${recordPath("demand", d.id)}`}>{d.title}</Link>
                    <Tooltip title={`${modelLabel(d.scoring_model)}: ${parts(d)}`}>
                      <span className="pj-score ds-num" aria-label={`امتیاز ${d.score ?? "ندارد"}`}>{d.score === null || d.score === undefined ? "—" : toFa(Number(d.score))}</span>
                    </Tooltip>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
                    <span>{d.number}</span>
                    <Chip tone="accent">{typeLabel(d.type)}</Chip>
                    <span>{modelLabel(d.scoring_model)}</span>
                  </div>
                  {manages && ["approved", "qualified"].includes(String(d.state)) ? (
                    <Button size="small" icon={<FolderPlus {...ICON14} />} onClick={() => convert.mutate(d.id)} loading={convert.isPending && convert.variables === d.id}>تبدیل به پروژه</Button>
                  ) : null}
                </article>
              ))}
              {!c.items.length ? <p className="px-1 text-[12px] text-ink-3">خالی</p> : null}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

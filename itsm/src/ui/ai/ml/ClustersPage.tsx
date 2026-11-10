// «نامزدهای مسئله» (catalogue AI-045): clusters of similar incidents not linked to a problem, as the viewer may see them
// (only their readable members; a cluster with too few is not listed). «ثبت مسئله» creates a problem with the viewer's
// own access and links the members they may change; «نه» dismisses the cluster.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal } from "antd";
import { Bug, X } from "lucide-react";
import type { ClusterView } from "@shared/ai/ml";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Skeleton } from "../../components/display";
import { Card, ICON14 } from "../../components/blocks";
import { recordPath } from "../../records";
import { ML_KEYS, mlApi } from "./api";
import { pctFa } from "./model";
import "./ml.css";

function ClusterCard({ c, onDone }: { c: ClusterView; onDone: () => void }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(c.words.length ? `مشکل تکرارشونده: ${c.words.join("، ")}` : "مشکل تکرارشونده");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await mlApi.clusterProblem(api, c.id, c.table, title);
      n.ok(`مسئله ثبت شد و ${faDigits(r.linked)} رخداد به آن پیوست`);
      onDone();
      nav(`/${orgId}/${recordPath("problem", r.problem_id)}`);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };
  const dismiss = async () => {
    try {
      await mlApi.dismissCluster(api, c.id, c.table);
      onDone();
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <Card
      title={c.words.length ? c.words.join("، ") : "خوشهٔ رکوردهای مشابه"}
      meta={<span className="ml-muted">{faDigits(c.size)} رکورد · انسجام {pctFa(c.cohesion)}</span>}
      tools={
        <div className="flex gap-1">
          <Button size="small" type="primary" icon={<Bug {...ICON14} />} onClick={() => setOpen(true)}>
            ثبت مسئله
          </Button>
          <Button size="small" icon={<X {...ICON14} />} onClick={() => void dismiss()}>
            نه
          </Button>
        </div>
      }
    >
      <ul className="ml-members">
        {c.members.slice(0, 8).map((m) => (
          <li key={m.id}>
            <Link className="ds-link" to={`/${orgId}/${recordPath(c.table, m.id)}`}>
              <span className="ds-ltr">{m.number}</span> {m.title}
            </Link>
            <span className="ml-muted ds-num">{pctFa(m.sim)}</span>
          </li>
        ))}
      </ul>
      {c.members.length > 8 ? <p className="ml-muted">و {faDigits(c.members.length - 8)} رکورد دیگر</p> : null}
      <Modal open={open} title="ثبت مسئله از این خوشه" okText="ثبت" cancelText="انصراف" confirmLoading={busy} onOk={() => void create()} onCancel={() => setOpen(false)} destroyOnHidden>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-label="عنوان مسئله" />
        <p className="ml-muted">رکوردهایی که اجازهٔ تغییرشان را دارید به مسئله پیوند می‌خورند.</p>
      </Modal>
    </Card>
  );
}

export default function ClustersPage() {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ML_KEYS.clusters(orgId, "incident"), queryFn: () => mlApi.clusters(api, "incident") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ML_KEYS.clusters(orgId, "incident") });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="نامزدهای مسئله" />
      {q.isLoading ? <Skeleton rows={4} /> : null}
      {q.data && !q.data.clusters.length ? <EmptyState title="خوشه‌ای برای بررسی نیست" description="هر شب رخدادهای ۶۰ روز گذشته که به مسئله‌ای پیوند ندارند خوشه‌بندی می‌شوند." /> : null}
      <div className="ml-grid">
        {q.data?.clusters.map((c) => (
          <ClusterCard key={c.id} c={c} onDone={refresh} />
        ))}
      </div>
    </div>
  );
}

// An approval for the person asked to give it (PTL-012, PTL-034): what is asked — the request's title and description, who it
// is for, the answers of the order and its requester-safe facts (read through the approver's grant on that record) —
// and «تأیید» / «رد» with a comment (a rejection says why). Decided approvals show their outcome.
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, Skeleton } from "antd";
import { Check, X } from "lucide-react";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { ApiError, errorText } from "../../lib/api";
import { Chip } from "../../components/display";
import { RecordMarkdown } from "../../records";
import { PORTAL_KEYS, portalApi, usePortalRefresh, type PortalConfig } from "./api";
import { portalPath } from "./model";
import { Empty, I16, PageHead } from "./parts";

const STATE_LABEL: Record<string, string> = { waiting: "هنوز نوبت این مرحله نشده", requested: "منتظر تصمیم شما", approved: "تأیید شد", rejected: "رد شد", canceled: "لغو شد", no_longer_required: "دیگر لازم نیست", skipped: "کنار گذاشته شد" };

export default function Approval(_: { cfg: PortalConfig }) {
  const { id = "" } = useParams();
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const notify = useNotify();
  const refresh = usePortalRefresh();
  const q = useQuery({ queryKey: PORTAL_KEYS.approval(orgId, id), queryFn: () => portalApi.approval(api, id), retry: false });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const d = q.data;

  if (q.isLoading)
    return (
      <div className="pt-card">
        <Skeleton active paragraph={{ rows: 5 }} />
      </div>
    );
  if (!d) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return <Empty title={gone ? "این تأیید پیدا نشد" : "بارگذاری نشد"} text={gone ? "شاید دیگری تصمیم گرفته یا دیگر لازم نیست." : errorText(q.error)} action={<Button onClick={() => navigate(portalPath(orgId, "todo"))}>کارهای من</Button>} />;
  }

  const decide = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !comment.trim()) {
      setProblem("علت رد را بنویسید تا درخواست‌کننده بداند");
      return;
    }
    setBusy(decision);
    setProblem(null);
    try {
      await portalApi.decide(api, id, decision, comment.trim() || null);
      notify.ok(decision === "approved" ? "تأیید شد" : "رد شد؛ درخواست‌کننده باخبر می‌شود");
      void refresh.all();
      navigate(portalPath(orgId, "todo"));
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const r = d.record;
  return (
    <>
      <PageHead
        title={r.title || r.number || r.table_label}
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{r.table_label}</span>
            {r.number ? <bdi className="ltr">{r.number}</bdi> : null}
            {r.for_name ? <span>برای {r.for_name}</span> : null}
            {r.opened_by_name && r.opened_by_name !== r.for_name ? <span>ثبت‌کننده: {r.opened_by_name}</span> : null}
          </span>
        }
        back={{ to: portalPath(orgId, "todo"), label: "کارهای من" }}
        actions={<Chip tone={d.approval.state === "requested" ? "warning" : d.approval.state === "approved" ? "in" : "neutral"}>{STATE_LABEL[d.approval.state] ?? d.approval.state}</Chip>}
      />
      <div className="pt-two">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="pt-card flex flex-col gap-3">
            {r.description ? <RecordMarkdown text={r.description} /> : <span className="text-ink-3">شرحی نوشته نشده است.</span>}
            {d.answers.length ? (
              <dl className="pt-facts">
                {d.answers.map((a) => (
                  <div key={a.label} className="contents">
                    <dt>{a.label}</dt>
                    <dd>{a.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
          {d.approval.can_decide ? (
            <div className="pt-card flex flex-col gap-3">
              <label htmlFor="pt-approval-comment" className="font-medium">
                تصمیم شما
              </label>
              <Input.TextArea id="pt-approval-comment" value={comment} onChange={(e) => setComment(e.target.value)} autoSize={{ minRows: 2, maxRows: 8 }} maxLength={4000} placeholder="توضیح (برای رد لازم است)" />
              {problem ? <Alert type="error" title={problem} /> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="primary" icon={<Check {...I16} />} loading={busy === "approved"} disabled={!!busy} onClick={() => void decide("approved")}>
                  تأیید
                </Button>
                <Button danger icon={<X {...I16} />} loading={busy === "rejected"} disabled={!!busy} onClick={() => void decide("rejected")}>
                  رد
                </Button>
              </div>
            </div>
          ) : d.approval.comments ? (
            <div className="pt-card text-[13px]">
              <span className="font-medium">توضیح تصمیم: </span>
              {d.approval.comments}
            </div>
          ) : null}
        </div>
        <aside className="pt-card flex flex-col gap-2 text-[13px]">
          {d.approval.level_name ? (
            <span>
              <span className="text-ink-3">مرحله: </span>
              {d.approval.level_name}
            </span>
          ) : null}
          {d.approval.due_at ? (
            <span>
              <span className="text-ink-3">مهلت تصمیم: </span>
              {formatJalaliDateTime(d.approval.due_at)}
            </span>
          ) : null}
          {d.facts.length ? (
            <dl className="pt-facts mt-2">
              {d.facts.map((f) => (
                <div key={f.label} className="contents">
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </aside>
      </div>
    </>
  );
}

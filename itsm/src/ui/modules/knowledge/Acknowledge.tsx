// «خواندن و تأیید» (kb/acknowledge): the controlled documents (policies, circulars, regulations) the member is asked to
// read and acknowledge, with due dates — overdue first — and those already confirmed; each opens in the reading view,
// where «خواندم و می‌پذیرم» records the acknowledgement for the version in force. Also `ByNumber`: kb/n/KB000123 opens
// an article by its number (links between articles).
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "antd";
import { FileCheck2 } from "lucide-react";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, JDate, Loader } from "../../components/display";
import { recordsApi } from "../../records";
import { KB_KEYS, kbApi } from "./api";

export default function Acknowledge() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: KB_KEYS.attestations(orgId), queryFn: () => kbApi.attestations(api) });
  const items = [...(q.data?.items ?? [])].sort((a, b) => Number(!!a.acked_at) - Number(!!b.acked_at) || Number(b.overdue) - Number(a.overdue) || a.due_at.localeCompare(b.due_at));
  return (
    <div>
      <PageHeader title="خواندن و تأیید" back={`/${orgId}/kb`} />
      {q.isLoading ? <Loader /> : null}
      {!q.isLoading && !items.length ? <EmptyState icon={FileCheck2} title="سندی برای خواندن ندارید" /> : null}
      {items.length ? (
        <Card flush>
          <ul className="kb-list px-4">
            {items.map((x) => (
              <li key={x.id} className="flex-wrap">
                <Link className="ds-link min-w-0 flex-1" to={`/${orgId}/kb/a/${x.article_id}`}>
                  {x.article_title}
                </Link>
                <span className="text-[12px] text-ink-3">{x.title}</span>
                {x.acked_at ? (
                  <span className="text-[12px] text-in">
                    تأیید شد <JDate v={x.acked_at} />
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
                    مهلت <JDate v={x.due_at} />
                    {x.overdue ? <Tag color="error" variant="filled">گذشته</Tag> : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/** kb/a (the table path the record pages go back to): the list of every article. */
export function ToArticles() {
  const { orgId } = useOrg();
  const nav = useNavigate();
  useEffect(() => {
    void nav(`/${orgId}/kb/articles`, { replace: true });
  }, [nav, orgId]);
  return <Loader />;
}

export function ByNumber() {
  const { number = "" } = useParams();
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["knowledge", orgId, "number", number], queryFn: () => recordsApi.list(api, "kb_article", { q: number, size: 1, fields: ["number"] }) });
  const id = q.data?.rows[0]?.id;
  useEffect(() => {
    if (id) nav(`/${orgId}/kb/a/${id}`, { replace: true });
  }, [id, nav, orgId]);
  if (q.isLoading || id) return <Loader />;
  return (
    <div>
      <PageHeader title="مرکز دانش" back={`/${orgId}/kb`} />
      <EmptyState title={`مقالهٔ ${number} پیدا نشد`} description="شاید بازنشسته شده باشد یا به آن دسترسی نداشته باشید." />
    </div>
  );
}

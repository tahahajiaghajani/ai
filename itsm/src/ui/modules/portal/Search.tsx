// Search results (PTL-006, PTL-007): the AI answer card first — written only from what the person may read, with
// numbered sources, marked as AI or rule-based, abstaining when the sources say nothing — then the results grouped by
// kind. Nothing found: a way forward (report the problem, ask the assistant).
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Skeleton } from "antd";
import { ExternalLink, PenLine, Sparkles } from "lucide-react";
import { useOrg } from "../../lib/org";
import { RecordMarkdown } from "../../records";
import { PORTAL_KEYS, portalApi, portalSession, type PortalConfig } from "./api";
import { appPath, groupHits, portalPath } from "./model";
import { Empty, I16, PageHead, Section } from "./parts";
import { SearchBar } from "./SearchBar";

function AnswerCard({ q }: { q: string }) {
  const { api, orgId } = useOrg();
  const a = useQuery({ queryKey: [...PORTAL_KEYS.search(orgId, q), "answer"], queryFn: () => portalApi.answer(api, q), staleTime: 5 * 60_000, enabled: q.length >= 3 });
  if (a.isLoading) return <div className="pt-card"><Skeleton active paragraph={{ rows: 2 }} /></div>;
  const ans = a.data?.answer;
  if (!ans || !ans.text.trim()) return null;
  return (
    <section className="pt-card" aria-label="پاسخ هوشمند">
      <div className="mb-2 flex items-center gap-2 text-[13px] text-ink-3">
        <Sparkles {...I16} aria-hidden />
        {ans.abstained ? "پاسخی در منابع شما پیدا نشد" : ans.label}
      </div>
      <RecordMarkdown text={ans.text} />
      {ans.citations.length ? (
        <ol className="mt-3 flex flex-col gap-1 ps-5 text-[13px]">
          {ans.citations.map((c) => (
            <li key={c.n}>
              <Link className="ds-link" to={appPath(orgId, c.path)}>
                {c.title}
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export default function Search({ cfg }: { cfg: PortalConfig }) {
  const { api, orgId } = useOrg();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const q = (sp.get("q") ?? "").trim();
  const r = useQuery({ queryKey: [...PORTAL_KEYS.search(orgId, q), "full"], queryFn: () => portalApi.search(api, q, { session: portalSession() }), enabled: q.length >= 2 });
  const groups = groupHits(r.data?.hits ?? []);
  return (
    <>
      <PageHead title={q ? `جست‌وجوی «${q}»` : "جست‌وجو"} />
      <SearchBar initial={q} onSearch={(v) => setSp({ q: v })} />
      <div className="mt-5 flex flex-col gap-4">
        {cfg.portal.ai_answers && q ? <AnswerCard q={q} /> : null}
        {r.isLoading ? <Skeleton active /> : null}
        {r.data && r.data.zero ? (
          <Empty
            title="چیزی پیدا نشد"
            text="واژهٔ دیگری امتحان کنید یا مشکل را ثبت کنید تا کارشناسان رسیدگی کنند."
            action={cfg.can.report ? <Button icon={<PenLine {...I16} />} onClick={() => navigate(`${portalPath(orgId, "report")}?q=${encodeURIComponent(q)}`)}>ثبت مشکل</Button> : undefined}
          />
        ) : null}
        {groups.map((g) => (
          <Section key={g.kind} title={g.label}>
            <div className="pt-card is-flush">
              <ul className="pt-list">
                {g.hits.map((h) => (
                  <li key={`${h.kind}:${h.id}`}>
                    {h.external ? (
                      <a className="pt-row" href={h.path} target="_blank" rel="noopener noreferrer">
                        <span className="pt-row-b">
                          <span className="pt-row-t">{h.title}</span>
                          {h.snippet ? <span className="pt-row-m">{h.snippet}</span> : null}
                        </span>
                        <ExternalLink {...I16} aria-label="(در زبانهٔ تازه)" />
                      </a>
                    ) : (
                      <Link className="pt-row" to={appPath(orgId, h.path)} onClick={() => void portalApi.event(api, { kind: "click", query: q, ref_table: h.kind === "article" ? "kb_article" : null, ref_id: h.kind === "article" ? h.id : null })}>
                        <span className="pt-row-b">
                          <span className="pt-row-t">{h.title}</span>
                          {h.snippet || h.meta ? <span className="pt-row-m">{h.meta ? <span>{h.meta}</span> : null}{h.snippet ? <span>{h.snippet}</span> : null}</span> : null}
                        </span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        ))}
      </div>
    </>
  );
}

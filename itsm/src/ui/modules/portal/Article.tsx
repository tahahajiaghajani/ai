// An article in the portal (PTL-001, PTL-035): the knowledge module's reading view for a requester — the title, summary and
// banners, the body (never the internal section, which the server withholds anyway), related public articles, «آیا
// این مقاله کمک کرد؟» with a reason when it did not, stars where the base takes ratings, «خواندم و می‌پذیرم» when the
// person must acknowledge it, and a way forward when it did not help (report the problem with the article's title).
// Links to other articles stay in the portal (kb/n/<number>). `ByNumber` resolves such a link.
import { useEffect, useState, type MouseEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Rate, Skeleton } from "antd";
import { BookOpen, PenLine, ThumbsDown, ThumbsUp } from "lucide-react";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { ApiError, errorText } from "../../lib/api";
import { recordsApi } from "../../records";
import { ArticleBody } from "../knowledge/ArticleBody";
import { KB_KEYS, kbApi, kbSession } from "../knowledge/api";
import { NOT_HELPFUL_REASONS } from "../knowledge/model";
import { portalApi, type PortalConfig } from "./api";
import "../knowledge/knowledge.css";
import { portalPath } from "./model";
import { Empty, I16, PageHead, Section } from "./parts";

/** Keep in-app links of an article inside the portal: `/<org>/kb/n/KB…` and `/<org>/kb/a/<id>` open the portal's page. */
function useLocalLinks() {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  return (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") ?? "";
    const m = new RegExp(`^/${orgId}/kb/(n|a)/([^/?#]+)`).exec(href);
    if (!m || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(portalPath(orgId, m[1] === "n" ? `kb/n/${m[2]}` : `kb/${m[2]}`));
  };
}

function Feedback({ id, cfg, title, canFeedback, ratings, vote, rating }: { id: string; cfg: PortalConfig; title: string; canFeedback: boolean; ratings: boolean; vote: "helpful" | "not_helpful" | null; rating: number | null }) {
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useNotify();
  const [mine, setMine] = useState(vote);
  const [asking, setAsking] = useState(false);
  const [stars, setStars] = useState(rating ?? 0);
  useEffect(() => setMine(vote), [vote]);
  const send = async (helpful: boolean, reason?: string | null) => {
    try {
      await kbApi.vote(api, id, helpful, reason ?? null);
      setMine(helpful ? "helpful" : "not_helpful");
      setAsking(false);
      if (helpful) void kbApi.deflect(api, id, null, kbSession()).catch(() => undefined);
      void portalApi.event(api, { kind: helpful ? "deflect" : "feedback", ref_table: "kb_article", ref_id: id });
      void qc.invalidateQueries({ queryKey: KB_KEYS.read(orgId, id) });
    } catch (e) {
      notify.error(e);
    }
  };
  if (!canFeedback) return null;
  return (
    <div className="pt-card flex flex-col gap-3" aria-live="polite">
      {mine === "helpful" ? (
        <span className="font-medium">سپاس! خوشحالیم که کمک کرد.</span>
      ) : mine === "not_helpful" && !asking ? (
        <div className="flex flex-col gap-2">
          <span className="font-medium">سپاس از بازخوردتان؛ نویسندگان آن را می‌بینند.</span>
          {cfg.can.report ? (
            <div>
              <Button icon={<PenLine {...I16} />} onClick={() => navigate(`${portalPath(orgId, "report")}?q=${encodeURIComponent(title)}`)}>
                مشکلم حل نشد؛ گزارش می‌دهم
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <span className="font-medium">این مقاله کمک کرد؟</span>
          {asking ? (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] text-ink-3">چه چیزی کم بود؟</span>
              <div className="pt-choice-row">
                {NOT_HELPFUL_REASONS.map((r) => (
                  <button key={r.value} type="button" className="pt-chip-btn" onClick={() => void send(false, r.value)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button icon={<ThumbsUp {...I16} />} onClick={() => void send(true)}>
                بله، مشکلم حل شد
              </Button>
              <Button icon={<ThumbsDown {...I16} />} onClick={() => setAsking(true)}>
                نه
              </Button>
            </div>
          )}
        </>
      )}
      {ratings ? (
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-ink-3">امتیاز شما:</span>
          <Rate
            value={stars}
            onChange={async (v) => {
              setStars(v);
              try {
                await kbApi.rate(api, id, v);
              } catch (e) {
                notify.error(e);
              }
            }}
            aria-label="امتیاز مقاله از یک تا پنج"
          />
        </div>
      ) : null}
    </div>
  );
}

export default function Article({ cfg }: { cfg: PortalConfig }) {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const { api, orgId } = useOrg();
  const notify = useNotify();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const local = useLocalLinks();
  const q = useQuery({ queryKey: KB_KEYS.read(orgId, id), queryFn: () => kbApi.read(api, id, kbSession()), enabled: !!id, retry: false });
  const [acking, setAcking] = useState(false);
  const v = q.data;
  if (q.isLoading)
    return (
      <div className="pt-card">
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  const article = v?.article ?? null;
  const internal = !!article && (article.visibility === "internal" || article.wip === true);
  if (!v || !article || internal) {
    const gone = !v && q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return <Empty title={gone || internal ? "این مقاله پیدا نشد" : "بارگذاری نشد"} text={gone || internal ? "شاید بازنشسته شده یا برای شما منتشر نشده است." : errorText(q.error)} action={<Button onClick={() => navigate(portalPath(orgId, "kb"))}>مرکز دانش</Button>} />;
  }
  const title = String(article.title ?? "");
  const summary = typeof article.summary === "string" ? article.summary : null;
  const updated = (article.last_reviewed_at ?? article.published_at ?? article.updated_at) as string | null;
  const ack = v.my.acknowledgement;
  const related = v.related.filter((r) => !r.internal && !r.wip);
  const banners = v.banners.filter((b) => b.kind !== "internal" && b.kind !== "draft" && b.kind !== "ai");
  const from = sp.get("q");

  return (
    <>
      <PageHead
        title={title}
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            {v.base ? <span>{v.base.name}</span> : null}
            {v.path.length ? <span>{v.path.map((p) => p.name).join(" › ")}</span> : null}
            {updated ? <span>به‌روز: {formatJalali(String(updated).slice(0, 10))}</span> : null}
          </span>
        }
        back={{ to: from ? `${portalPath(orgId, "kb")}?q=${encodeURIComponent(from)}` : portalPath(orgId, "kb"), label: from ? "نتیجه‌های جست‌وجو" : "مرکز دانش" }}
      />
      <div className="pt-two">
        <div className="flex min-w-0 flex-col gap-4">
          {banners.map((b, i) => (
            <Alert
              key={`${b.kind}${i}`}
              type={b.tone === "danger" ? "error" : b.tone === "warning" ? "warning" : "info"}
              showIcon
              title={b.text}
              action={b.link ? <Link className="ds-link" to={portalPath(orgId, `kb/${b.link.id}`)}>{b.link.title}</Link> : undefined}
            />
          ))}
          {ack && !ack.acked_at ? (
            <Alert
              type="warning"
              showIcon
              title={`«${ack.title}»: این متن را بخوانید و تأیید کنید`}
              description={ack.due_at ? `مهلت: ${formatJalali(ack.due_at.slice(0, 10))}` : undefined}
              action={
                <Button
                  size="small"
                  type="primary"
                  loading={acking}
                  onClick={async () => {
                    setAcking(true);
                    try {
                      await kbApi.ack(api, ack.attestation_id);
                      notify.ok("ثبت شد؛ سپاس");
                      void qc.invalidateQueries({ queryKey: KB_KEYS.read(orgId, id) });
                      void qc.invalidateQueries({ queryKey: ["portal", orgId] });
                    } catch (e) {
                      notify.error(e);
                    } finally {
                      setAcking(false);
                    }
                  }}
                >
                  خواندم و می‌پذیرم
                </Button>
              }
            />
          ) : null}
          <article className="pt-card" onClickCapture={local}>
            {summary ? <p className="mt-0 text-[15px] text-ink-2">{summary}</p> : null}
            <ArticleBody text={v.body} />
          </article>
          <Feedback id={id} cfg={cfg} title={title} canFeedback={v.can.feedback} ratings={!!v.base?.allow_ratings} vote={v.my.vote} rating={v.my.rating} />
        </div>
        <aside className="flex flex-col gap-4">
          {v.toc.length > 2 ? (
            <nav className="pt-card flex flex-col gap-1.5 text-[13px]" aria-label="فهرست مقاله">
              <span className="font-medium">در این مقاله</span>
              {v.toc.map((h) => (
                <a key={h.slug} href={`#${h.slug}`} className="ds-link" style={{ paddingInlineStart: (h.level - 2) * 12 }}>
                  {h.text}
                </a>
              ))}
            </nav>
          ) : null}
          {related.length ? (
            <Section title="مقاله‌های مرتبط">
              <div className="pt-card is-flush">
                <ul className="pt-list">
                  {related.map((r) => (
                    <li key={r.id}>
                      <Link to={portalPath(orgId, `kb/${r.id}`)} className="pt-row">
                        <BookOpen {...I16} aria-hidden className="text-ink-3" />
                        <span className="pt-row-b">
                          <span className="pt-row-t">{r.title}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

/** kb/n/KB000123 inside the portal: the article of that number, if the person may read it. */
export function ByNumber() {
  const { number = "" } = useParams();
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["portal", orgId, "kb-number", number], queryFn: () => recordsApi.list(api, "kb_article", { q: number, size: 1, fields: ["number"] }), retry: false });
  const id = q.data?.rows[0]?.id;
  useEffect(() => {
    if (id) navigate(portalPath(orgId, `kb/${id}`), { replace: true });
  }, [id, navigate, orgId]);
  if (q.isLoading || id)
    return (
      <div className="pt-card">
        <Skeleton active />
      </div>
    );
  return <Empty title={`مقالهٔ ${number} پیدا نشد`} text="شاید بازنشسته شده یا برای شما منتشر نشده است." />;
}

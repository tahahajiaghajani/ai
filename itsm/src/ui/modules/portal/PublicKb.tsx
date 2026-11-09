// The published knowledge pages, without signing in (/p/kb/:token…, PTL-022, KB-031): what a knowledge publisher chose
// to show everyone — external bases, articles that are public by every rule (never internal, confidential or narrowed),
// searched by words, read with their images described and links to other public articles kept, «مفید بود؟» counted.
// The page holds no ids, numbers or names (the server sends an opaque slug per article) and reads only /api/public.
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Input } from "antd";
import { BookOpen, Info, ThumbsDown, ThumbsUp } from "lucide-react";
import { formatJalali } from "@shared/jalali";
import { ApiError } from "../../lib/api";
import { useDebounced } from "../../lib/hooks";
import { EmptyState, Loader } from "../../components/display";
import { CALLOUTS, remarkCallouts, type CalloutKind } from "../knowledge/model";
import { portalPublicApi, type PublicKbCard } from "./api";
import { I16 } from "./parts";
import "../knowledge/knowledge.css";
import "./portal.css";

const retry = (n: number, e: unknown) => !(e instanceof ApiError && e.status < 500) && n < 2;
const enc = encodeURIComponent;

function Gone({ error }: { error: unknown }) {
  const gone = error instanceof ApiError && (error.status === 404 || error.status === 410);
  return <EmptyState title={gone ? "این صفحه منتشر نیست" : "بارگذاری نشد"} description={gone ? "پیوند عوض شده یا انتشار آن متوقف شده است." : "کمی بعد دوباره امتحان کنید."} />;
}

function Cards({ token, items }: { token: string; items: PublicKbCard[] }) {
  return (
    <div className="pt-card is-flush">
      <ul className="pt-list">
        {items.map((a) => (
          <li key={a.slug}>
            <Link to={`/p/kb/${enc(token)}/a/${enc(a.slug)}`} className="pt-row">
              <BookOpen {...I16} aria-hidden className="text-ink-3" />
              <span className="pt-row-b">
                <span className="pt-row-t">{a.title}</span>
                {a.summary ? <span className="pt-row-m">{a.summary}</span> : null}
              </span>
              {a.base ? <span className="hidden text-[12px] text-ink-3 sm:inline">{a.base}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PublicKbHome() {
  const { token = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const [text, setText] = useState(sp.get("q") ?? "");
  const base = sp.get("base");
  const q = useDebounced(text.trim(), 350);
  const home = useQuery({ queryKey: ["public-kb", token], queryFn: () => portalPublicApi.kbHome(token), staleTime: 60_000, retry });
  const s = useQuery({ queryKey: ["public-kb", token, "search", q, base], queryFn: () => portalPublicApi.kbSearch(token, q, base), enabled: q.length >= 2 || !!base, staleTime: 30_000, retry });
  if (home.isLoading) return <Loader />;
  const h = home.data;
  if (!h) return <Gone error={home.error} />;
  const currentBase = h.bases.find((b) => b.key === base) ?? null;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSp(next, { replace: true });
  };
  return (
    <div className="pt-public" data-accent="indigo">
      <div>
        <h1>{currentBase ? currentBase.name : h.title}</h1>
        {(currentBase?.description ?? h.intro) ? <p className="mb-0 mt-1 text-ink-3">{currentBase?.description ?? h.intro}</p> : null}
      </div>
      <Input.Search
        size="large"
        allowClear
        placeholder="جست‌وجو در راهنماها…"
        aria-label="جست‌وجو در راهنماها"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          set({ q: e.target.value.trim() || null });
        }}
        style={{ maxInlineSize: 640 }}
      />
      {h.bases.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="list" aria-label="پایگاه‌ها">
          <button type="button" role="listitem" className="pt-chip-btn" aria-pressed={!base} onClick={() => set({ base: null })}>
            همه
          </button>
          {h.bases.map((b) => (
            <button key={b.key} type="button" role="listitem" className="pt-chip-btn" aria-pressed={base === b.key} onClick={() => set({ base: b.key })}>
              {b.name} <span className="text-ink-3">{b.count.toLocaleString("fa-IR")}</span>
            </button>
          ))}
        </div>
      ) : null}
      {q.length >= 2 || base ? (
        s.isLoading ? (
          <Loader />
        ) : s.data?.hits.length ? (
          <Cards token={token} items={s.data.hits} />
        ) : (
          <EmptyState compact title="مقاله‌ای پیدا نشد" description="واژهٔ دیگری امتحان کنید." />
        )
      ) : (
        <>
          {h.popular.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 text-[17px] font-medium">پرخواننده</h2>
              <Cards token={token} items={h.popular} />
            </section>
          ) : null}
          {h.recent.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 text-[17px] font-medium">تازه‌ها</h2>
              <Cards token={token} items={h.recent} />
            </section>
          ) : null}
          {!h.popular.length && !h.recent.length ? <EmptyState compact title="هنوز مقاله‌ای منتشر نشده است" /> : null}
        </>
      )}
    </div>
  );
}

const publicComponents = (token: string): Components => ({
  h1: ({ children }) => <h2>{children}</h2>,
  a: ({ href, children }) => {
    const h = String(href ?? "");
    if (h.startsWith(`/p/kb/${token}/`)) return <Link to={h}>{children}</Link>;
    if (/^(https?:|mailto:)/i.test(h))
      return (
        <a href={h} target="_blank" rel="noopener noreferrer nofollow">
          {children}
        </a>
      );
    if (h.startsWith("#")) return <a href={h}>{children}</a>;
    return <span>{children}</span>;
  },
  img: ({ alt }) => <span className="text-ink-3">{alt ? `(تصویر: ${alt})` : ""}</span>,
  code: ({ children, className }) => (
    <code dir="ltr" className={className}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <div className="kb-code">
      <pre dir="ltr">{children}</pre>
    </div>
  ),
  table: ({ children }) => (
    <div className="kb-table" tabIndex={0} role="region" aria-label="جدول">
      <table>{children}</table>
    </div>
  ),
  aside: ({ children, ...props }) => {
    const kind = ((props as Record<string, unknown>)["data-kind"] as CalloutKind) ?? "note";
    return (
      <aside className={`kb-callout is-${CALLOUTS[kind]?.tone ?? "info"}`} role="note">
        <span className="kb-callout-title">
          <Info size={14} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
          {CALLOUTS[kind]?.label ?? "یادداشت"}
        </span>
        {children as ReactNode}
      </aside>
    );
  },
});

const safeUrl = (url: string) => (/^(https?:|mailto:|#|\/p\/)/i.test(url) ? url : "");

export function PublicKbArticle() {
  const { token = "", slug = "" } = useParams();
  const a = useQuery({ queryKey: ["public-kb", token, "a", slug], queryFn: () => portalPublicApi.kbArticle(token, slug), staleTime: 60_000, retry });
  const [voted, setVoted] = useState<boolean | null>(null);
  const components = useMemo(() => publicComponents(token), [token]);
  if (a.isLoading) return <Loader />;
  const v = a.data;
  if (!v) return <Gone error={a.error} />;
  const vote = async (helpful: boolean) => {
    setVoted(helpful);
    try {
      await portalPublicApi.kbVote(token, slug, helpful);
    } catch {
      // a vote is a signal; the thanks stays
    }
  };
  return (
    <div className="pt-public" data-accent="indigo">
      <Link to={`/p/kb/${enc(token)}`} className="pt-back">
        همهٔ راهنماها
      </Link>
      <div>
        <h1>{v.title}</h1>
        <p className="mb-0 mt-1 flex flex-wrap gap-2 text-[13px] text-ink-3">
          {v.base ? <span>{v.base}</span> : null}
          {v.updated ? <span>به‌روز: {formatJalali(v.updated.slice(0, 10))}</span> : null}
        </p>
      </div>
      <article className="pt-card">
        {v.summary ? <p className="mt-0 text-[15px] text-ink-2">{v.summary}</p> : null}
        <div className="kb-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkCallouts]} skipHtml urlTransform={safeUrl} components={components}>
            {v.body}
          </ReactMarkdown>
        </div>
      </article>
      {v.feedback ? (
        <div className="pt-card flex flex-wrap items-center gap-3" aria-live="polite">
          {voted === null ? (
            <>
              <span className="font-medium">این راهنما کمک کرد؟</span>
              <Button icon={<ThumbsUp {...I16} />} onClick={() => void vote(true)}>
                بله
              </Button>
              <Button icon={<ThumbsDown {...I16} />} onClick={() => void vote(false)}>
                نه
              </Button>
            </>
          ) : (
            <span>{voted ? "سپاس! خوشحالیم که کمک کرد." : "سپاس از بازخوردتان؛ آن را برای بهتر شدن راهنما به کار می‌بریم."}</span>
          )}
        </div>
      ) : null}
      {v.related.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-[17px] font-medium">راهنماهای مرتبط</h2>
          <Cards token={token} items={v.related} />
        </section>
      ) : null}
    </div>
  );
}

// «مرکز دانش» (kb): the search box, «پرسش از دانش» (cited answers from the articles the member may read — retrieval
// runs with their access, so a base's or a category's audience limits what AI may quote), what waits for the member
// (reviews, knowledge tasks, documents to acknowledge, own drafts), the bases they read with their categories, and
// featured, popular, new and recently viewed articles. Requesters see the same page without the authoring parts.
import "./knowledge.css";
import "../../ai/ask/ask.css";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Segmented } from "antd";
import { BookOpenText, ClipboardCheck, FilePen, Inbox, ListTodo, Lock, Plus, Sparkles } from "lucide-react";
import type { KbCard } from "@shared/knowledge/api";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, JDate, Loader } from "../../components/display";
import { AskPanel } from "../../ai/ask/AskPanel";
import { useKbHome } from "./api";
import { SearchBox } from "./SearchBox";
import { categoryTree, faNum, type CategoryTree } from "./model";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export function ArticleList({ items, empty, showDate }: { items: KbCard[]; empty: string; showDate?: "published" | "reviewed" }) {
  const { orgId } = useOrg();
  if (!items.length) return <p className="text-[13px] text-ink-3">{empty}</p>;
  return (
    <ul className="kb-list">
      {items.map((a) => (
        <li key={a.id}>
          <Link className="ds-link min-w-0 flex-1 truncate" to={`/${orgId}/kb/a/${a.id}`} title={a.summary ?? undefined}>
            {a.title}
          </Link>
          {a.internal ? <Lock size={12} strokeWidth={1.4} className="shrink-0 text-ink-3" aria-label="فقط کارشناسان" /> : null}
          {showDate === "published" && a.published_at ? (
            <span className="shrink-0 text-[12px] text-ink-3">
              <JDate v={a.published_at} />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Tree({ nodes }: { nodes: CategoryTree[] }) {
  const { orgId } = useOrg();
  return (
    <ul className="kb-tree">
      {nodes.map((n) => (
        <li key={n.id}>
          <Link to={`/${orgId}/kb/search?category=${n.id}`}>
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
            {n.restricted ? <Lock size={12} strokeWidth={1.4} className="text-ink-3" aria-label="مخاطبان محدود" /> : null}
            <span className="ds-num text-[12px] text-ink-3">{faNum(n.total)}</span>
          </Link>
          {n.children.length ? <Tree nodes={n.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  const { orgId } = useOrg();
  const nav = useNavigate();
  const h = useKbHome();
  const [list, setList] = useState<"popular" | "recent" | "viewed">("popular");
  if (h.isLoading) return <Loader />;
  const d = h.data;
  if (!d) return <EmptyState icon={BookOpenText} title="مرکز دانش در دسترس نیست" description="دوباره امتحان کنید." />;
  const pending = [
    { key: "reviews", n: d.pending.reviews, label: "بازبینی منتظر شما", icon: ClipboardCheck, path: "kb/reviews" },
    { key: "tasks", n: d.pending.tasks, label: "کار دانش", icon: ListTodo, path: "kb/tasks" },
    { key: "attestations", n: d.pending.attestations, label: "سند برای خواندن و تأیید", icon: Inbox, path: "kb/acknowledge" },
    { key: "drafts", n: d.pending.drafts, label: "پیش‌نویس شما", icon: FilePen, path: "kb/drafts" },
  ].filter((p) => p.n > 0);
  const lists = { popular: d.popular, recent: d.recent, viewed: d.viewed };
  return (
    <div>
      <PageHeader
        title="مرکز دانش"
        actions={
          d.can.author ? (
            <Button type="primary" icon={<Plus {...I16} />} onClick={() => nav(`/${orgId}/kb/new`)}>
              مقالهٔ تازه
            </Button>
          ) : null
        }
      />
      <section className="kb-hero mb-6">
        <h1>چه چیزی را می‌خواهید بدانید؟</h1>
        <SearchBox autoFocus />
      </section>

      {pending.length ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {pending.map((p) => (
            <Link key={p.key} to={`/${orgId}/${p.path}`} className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink hover:border-line-3">
              <p.icon {...I16} className="text-ink-3" />
              <span className="ds-num font-medium">{faNum(p.n)}</span> {p.label}
            </Link>
          ))}
        </div>
      ) : null}

      {d.can.ai ? (
        <Card title={<span className="flex items-center gap-2"><Sparkles {...I16} /> پرسش از دانش</span>} className="mb-6">
          <AskPanel scope={{ tables: ["kb_article"] }} placeholder="پرسش خود را بنویسید؛ پاسخ از مقاله‌هایی که می‌بینید، با ارجاع" intro="پاسخ فقط از مقاله‌هایی نوشته می‌شود که شما اجازهٔ خواندنشان را دارید؛ برای هر جمله شمارهٔ منبع آمده است." compact />
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {d.bases.length ? (
            <section aria-label="پایگاه‌های دانش">
              <h2 className="ds-t-section mb-3">پایگاه‌های دانش</h2>
              <div className="kb-bases">
                {d.bases.map((b) => {
                  const tree = categoryTree(d.categories, b.id);
                  return (
                    <div key={b.id} className="kb-base">
                      <Link to={`/${orgId}/kb/search?base=${b.id}`} className="flex items-center gap-2 text-ink">
                        <BookOpenText {...I16} className="text-ink-3" />
                        <span className="ds-t-title min-w-0 flex-1 truncate">{b.name}</span>
                        {b.kind === "internal" ? <span className="text-[12px] text-ink-3">فقط کارشناسان</span> : null}
                      </Link>
                      {b.description ? <p className="m-0 line-clamp-2 text-[13px] text-ink-2">{b.description}</p> : null}
                      <span className="text-[12px] text-ink-3">
                        <span className="ds-num">{faNum(b.article_count)}</span> مقاله
                      </span>
                      {tree.length ? (
                        <details>
                          <summary className="cursor-pointer text-[12px] text-ink-3">دسته‌ها</summary>
                          <div className="mt-1">
                            <Tree nodes={tree} />
                          </div>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <EmptyState icon={BookOpenText} title="هنوز پایگاه دانشی برای شما نیست" description={d.can.manage ? "از «پایگاه‌های دانش» یک پایگاه بسازید." : undefined} />
          )}

          {d.featured.length ? (
            <Card title="مقاله‌های برگزیده">
              <ArticleList items={d.featured} empty="" />
            </Card>
          ) : null}
        </div>
        <Card
          title={
            <Segmented
              size="small"
              value={list}
              onChange={(v) => setList(v as typeof list)}
              options={[
                { value: "popular", label: "پرخواننده" },
                { value: "recent", label: "تازه" },
                { value: "viewed", label: "دیده‌شده" },
              ]}
            />
          }
        >
          <ArticleList items={lists[list]} empty={list === "viewed" ? "هنوز مقاله‌ای نخوانده‌اید." : "هنوز مقاله‌ای منتشر نشده است."} showDate={list === "recent" ? "published" : undefined} />
        </Card>
      </div>
    </div>
  );
}

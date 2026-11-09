// «دانش» in the portal (PTL-020): the knowledge a requester may read — never articles «فقط کارشناسان» nor internal
// bases, even for an agent browsing the portal — searched with the knowledge module's search (logged in the knowledge
// session, so a search that ends in reading counts as deflection), by base, with the most read and the newest.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Skeleton } from "antd";
import { BookOpen, PenLine } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { iconOf } from "../request/icons";
import type { KbCard } from "@shared/knowledge/api";
import { KB_KEYS, kbApi, kbSession } from "../knowledge/api";
import type { PortalConfig } from "./api";
import { portalPath } from "./model";
import { Empty, I16, I20, PageHead, Section } from "./parts";

function ArticleRow({ a, snippet, q }: { a: KbCard; snippet?: string | null; q?: string }) {
  const { orgId } = useOrg();
  return (
    <Link to={`${portalPath(orgId, `kb/${a.id}`)}${q ? `?q=${encodeURIComponent(q)}` : ""}`} className="pt-row">
      <BookOpen {...I16} aria-hidden className="text-ink-3" />
      <span className="pt-row-b">
        <span className="pt-row-t">{a.title}</span>
        {snippet || a.summary ? <span className="pt-row-m">{snippet || a.summary}</span> : null}
      </span>
      {a.base_name ? <span className="hidden text-[12px] text-ink-3 sm:inline">{a.base_name}</span> : null}
    </Link>
  );
}

export default function Knowledge({ cfg }: { cfg: PortalConfig }) {
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [text, setText] = useState(sp.get("q") ?? "");
  const base = sp.get("base");
  const q = useDebounced(text.trim(), 350);
  const home = useQuery({ queryKey: KB_KEYS.home(orgId), queryFn: () => kbApi.home(api), staleTime: 60_000 });
  const browsing = q.length >= 2 || !!base;
  const s = useQuery({
    queryKey: [...KB_KEYS.search(orgId, `portal:${base ?? ""}:${q}`)],
    queryFn: () => kbApi.search(api, { q, base, size: 30, session: kbSession(), channel: "portal", log: q.length >= 2 }),
    enabled: browsing,
    staleTime: 30_000,
  });
  const bases = (home.data?.bases ?? []).filter((b) => b.kind === "external" && b.article_count > 0);
  const current = bases.find((b) => b.id === base) ?? null;
  const pub = (cards: KbCard[] | undefined) => (cards ?? []).filter((c) => !c.internal && !c.wip);
  const hits = (s.data?.hits ?? []).filter((h) => !h.internal && !h.wip);
  const setBase = (id: string | null) => {
    const next = new URLSearchParams(sp);
    if (id) next.set("base", id);
    else next.delete("base");
    setSp(next, { replace: true });
  };

  return (
    <>
      <PageHead title={current ? current.name : "مرکز دانش"} sub={current?.description ?? "راهنماها و پاسخ پرسش‌های پرتکرار؛ بسیاری از مشکل‌ها همین‌جا حل می‌شوند."} back={current ? { to: portalPath(orgId, "kb"), label: "همهٔ دانش" } : undefined} />
      <div className="mb-4">
        <Input.Search
          size="large"
          allowClear
          placeholder="جست‌وجو در راهنماها…"
          aria-label="جست‌وجو در دانش"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const next = new URLSearchParams(sp);
            if (e.target.value.trim()) next.set("q", e.target.value.trim());
            else next.delete("q");
            setSp(next, { replace: true });
          }}
          style={{ maxInlineSize: 640 }}
        />
      </div>
      {!current && bases.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-2" role="list" aria-label="پایگاه‌های دانش">
          {bases.map((b) => (
            <button key={b.id} type="button" role="listitem" className="pt-chip-btn" onClick={() => setBase(b.id)}>
              {b.name} <span className="text-ink-3">{b.article_count.toLocaleString("fa-IR")}</span>
            </button>
          ))}
        </div>
      ) : null}
      {browsing ? (
        <Section title={q.length >= 2 ? `نتیجه‌های «${q}»` : "مقاله‌ها"}>
          {s.isLoading ? (
            <div className="pt-card">
              <Skeleton active />
            </div>
          ) : hits.length ? (
            <div className="pt-card is-flush">
              <ul className="pt-list">
                {hits.map((h) => (
                  <li key={h.id}>
                    <ArticleRow a={h} snippet={h.snippet} q={q} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty
              title="مقاله‌ای پیدا نشد"
              text="واژهٔ دیگری امتحان کنید؛ اگر پاسخی نیافتید، مشکل را گزارش کنید."
              action={cfg.can.report ? <Button icon={<PenLine {...I16} />} onClick={() => navigate(`${portalPath(orgId, "report")}${q ? `?q=${encodeURIComponent(q)}` : ""}`)}>گزارش مشکل</Button> : undefined}
            />
          )}
        </Section>
      ) : home.isLoading ? (
        <div className="pt-card">
          <Skeleton active />
        </div>
      ) : (
        <>
          {bases.length > 1 ? (
            <Section title="پایگاه‌های دانش">
              <div className="pt-grid is-small">
                {bases.map((b) => {
                  const Icon = iconOf(b.icon);
                  return (
                    <button key={b.id} type="button" className="pt-tile text-start" onClick={() => setBase(b.id)}>
                      <span className="pt-tile-ic" aria-hidden>
                        <Icon {...I20} />
                      </span>
                      <span className="pt-tile-b">
                        <span className="pt-tile-t">{b.name}</span>
                        <span className="pt-tile-m">{b.article_count.toLocaleString("fa-IR")} مقاله</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Section>
          ) : null}
          {pub(home.data?.featured).length ? (
            <Section title="برگزیده">
              <div className="pt-card is-flush">
                <ul className="pt-list">
                  {pub(home.data?.featured).map((a) => (
                    <li key={a.id}>
                      <ArticleRow a={a} />
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          ) : null}
          {pub(home.data?.popular).length ? (
            <Section title="پرخواننده">
              <div className="pt-card is-flush">
                <ul className="pt-list">
                  {pub(home.data?.popular).slice(0, 8).map((a) => (
                    <li key={a.id}>
                      <ArticleRow a={a} />
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          ) : null}
          {pub(home.data?.recent).length ? (
            <Section title="تازه‌ها">
              <div className="pt-card is-flush">
                <ul className="pt-list">
                  {pub(home.data?.recent).slice(0, 8).map((a) => (
                    <li key={a.id}>
                      <ArticleRow a={a} />
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          ) : null}
          {!pub(home.data?.popular).length && !pub(home.data?.recent).length && !pub(home.data?.featured).length ? <Empty title="هنوز مقاله‌ای برای شما منتشر نشده است" /> : null}
        </>
      )}
    </>
  );
}

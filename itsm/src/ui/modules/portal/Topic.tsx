// A topic of the portal (PTL-003): one place for a subject people think in («کار از راه دور»، «کارمند تازه») — its
// sub-topics, the services to order, the articles to read and the links to open, only those the person may see.
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { BookOpen, ExternalLink } from "lucide-react";
import { useOrg } from "../../lib/org";
import { ApiError, errorText } from "../../lib/api";
import { iconOf } from "../request/icons";
import { PORTAL_KEYS, portalApi, type PortalConfig } from "./api";
import { portalPath } from "./model";
import { Empty, I16, I20, ItemTile, PageHead, Section } from "./parts";

export default function Topic(_: { cfg: PortalConfig }) {
  const { id = "" } = useParams();
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: PORTAL_KEYS.topic(orgId, id), queryFn: () => portalApi.topic(api, id), retry: false });
  const t = q.data;
  if (q.isLoading)
    return (
      <div className="pt-card">
        <Skeleton active />
      </div>
    );
  if (!t) return <Empty title={q.error instanceof ApiError && q.error.status === 404 ? "این موضوع پیدا نشد" : "بارگذاری نشد"} text={q.error instanceof ApiError && q.error.status === 404 ? undefined : errorText(q.error)} />;
  const parent = t.path.length > 1 ? t.path[t.path.length - 2] : null;
  const empty = !t.children.length && !t.items.length && !t.articles.length && !t.links.length;
  return (
    <>
      <PageHead title={t.topic.name} sub={t.topic.description ?? undefined} back={parent ? { to: portalPath(orgId, `topics/${parent.id}`), label: parent.name } : { to: portalPath(orgId), label: "خانه" }} />
      {t.children.length ? (
        <Section title="زیرموضوع‌ها">
          <div className="pt-grid is-small">
            {t.children.map((c) => {
              const Icon = iconOf(c.icon);
              return (
                <Link key={c.id} to={portalPath(orgId, `topics/${c.id}`)} className="pt-tile">
                  <span className="pt-tile-ic" aria-hidden>
                    <Icon {...I20} />
                  </span>
                  <span className="pt-tile-b">
                    <span className="pt-tile-t">{c.name}</span>
                    {c.description ? <span className="pt-tile-d">{c.description}</span> : null}
                  </span>
                </Link>
              );
            })}
          </div>
        </Section>
      ) : null}
      {t.items.length ? (
        <Section title="خدمت‌ها">
          <div className="pt-grid">
            {t.items.map((it) => (
              <ItemTile key={it.id} item={it} />
            ))}
          </div>
        </Section>
      ) : null}
      {t.articles.length ? (
        <Section title="راهنماها">
          <div className="pt-card is-flush">
            <ul className="pt-list">
              {t.articles.map((a) => (
                <li key={a.id}>
                  <Link to={portalPath(orgId, `kb/${a.id}`)} className="pt-row">
                    <BookOpen {...I16} aria-hidden className="text-ink-3" />
                    <span className="pt-row-b">
                      <span className="pt-row-t">{a.title}</span>
                      {a.summary ? <span className="pt-row-m">{a.summary}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ) : null}
      {t.links.length ? (
        <Section title="پیوندها">
          <div className="pt-grid is-small">
            {t.links.map((l) => {
              const Icon = iconOf(l.icon);
              return (
                <a key={l.id} href={l.url} target={l.new_tab ? "_blank" : undefined} rel="noopener noreferrer" className="pt-tile">
                  <span className="pt-tile-ic" aria-hidden>
                    <Icon {...I20} />
                  </span>
                  <span className="pt-tile-b">
                    <span className="pt-tile-t">
                      {l.name} {l.new_tab ? <ExternalLink size={12} aria-label="(در زبانهٔ تازه)" /> : null}
                    </span>
                    {l.description ? <span className="pt-tile-d">{l.description}</span> : null}
                  </span>
                </a>
              );
            })}
          </div>
        </Section>
      ) : null}
      {empty ? <Empty title="هنوز چیزی در این موضوع نیست" /> : null}
    </>
  );
}

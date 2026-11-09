// The portal's home page (PTL-001, PTL-002): the big search under a greeting, then the widgets of the published layout
// in their order — announcements on air for the person, what waits for them, their open requests, popular services,
// favourites and recent orders, topics and categories, popular articles, today's service status, quick links, the
// assistant bar and the administrator's own text sections. Each widget shows nothing when it has nothing.
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { AlertTriangle, BookOpen, ExternalLink, FolderOpen, Info, MessageCircle, PenLine, Wrench } from "lucide-react";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { Loader } from "../../components/display";
import { RecordMarkdown } from "../../records";
import { iconOf } from "../request/icons";
import type { WidgetInstance } from "@shared/portal/logic";
import { PORTAL_WIDGETS } from "@shared/portal/logic";
import { PORTAL_KEYS, portalApi, usePortalHome, type PortalConfig, type PortalHome } from "./api";
import { greeting, portalPath } from "./model";
import { Empty, I16, I20, ItemTile, Section, TicketRow } from "./parts";
import { usePageTitle } from "../../components/shell/context";
import { SearchBar } from "./SearchBar";
import { statusLabel } from "@shared/service_portfolio/logic";

const ANN_ICON = { outage: AlertTriangle, degradation: AlertTriangle, maintenance: Wrench, info: Info } as const;

function Hero({ cfg }: { cfg: PortalConfig }) {
  const { me } = useSession();
  const { orgId } = useOrg();
  const first = (me?.user.full_name ?? "").split(" ")[0];
  return (
    <div className="pt-hero" data-hero={cfg.portal.hero}>
      <div className="pt-hero-greet">
        {greeting(new Date().getHours())}
        {first ? `، ${first}` : ""}
      </div>
      <h1>{cfg.portal.title}</h1>
      <p>{cfg.portal.subtitle}</p>
      <SearchBar autoFocus />
      <div className="pt-chips">
        {cfg.can.report ? (
          <Link className="pt-chip-btn" to={portalPath(orgId, "report")}>
            <PenLine {...I16} /> گزارش مشکل
          </Link>
        ) : null}
        {cfg.can.order ? (
          <Link className="pt-chip-btn" to={portalPath(orgId, "catalog")}>
            <FolderOpen {...I16} /> درخواست خدمت
          </Link>
        ) : null}
        {cfg.portal.chat_enabled ? (
          <Link className="pt-chip-btn" to={portalPath(orgId, "chat")}>
            <MessageCircle {...I16} /> گفتگو با {cfg.portal.chat_name}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Widget({ w, home, cfg }: { w: WidgetInstance; home: PortalHome; cfg: PortalConfig }) {
  const { orgId, api } = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const title = w.title || PORTAL_WIDGETS[w.type].label;
  const fav = async (id: string, on: boolean) => {
    await portalApi.favorite(api, id, on);
    await qc.invalidateQueries({ queryKey: PORTAL_KEYS.all(orgId) });
  };
  switch (w.type) {
    case "announcements":
      return home.announcements.length ? (
        <section className="pt-section" aria-label={title}>
          {home.announcements.map((a) => {
            const Icon = ANN_ICON[a.kind as keyof typeof ANN_ICON] ?? Info;
            return (
              <div key={a.id} className="pt-ann" data-kind={a.kind} role="status">
                <Icon {...I20} aria-hidden />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="pt-ann-t">{a.title}</span>
                  {a.body ? <div className="pt-ann-b"><RecordMarkdown text={a.body} /></div> : null}
                  {a.ends_at ? <span className="pt-ann-b">تا {formatJalali(a.ends_at.slice(0, 10))}</span> : null}
                </div>
              </div>
            );
          })}
        </section>
      ) : null;
    case "actions": {
      const a = home.actions;
      const tiles: [string, number, string][] = [
        ["تأییدهای منتظر شما", a.approvals, "todo"],
        ["منتظر پاسخ شما", a.waiting_you, "todo"],
        ["نظرسنجی‌ها", a.surveys, "todo"],
        ["خواندن و تأیید", a.acknowledgements, "todo"],
      ];
      if (!tiles.some(([, n]) => n > 0)) return null;
      return (
        <Section title={title}>
          <div className="pt-actions">
            {tiles.filter(([, n]) => n > 0).map(([label, n, path]) => (
              <Link key={label} to={portalPath(orgId, path)} className="pt-action" data-on="true">
                <b>{n.toLocaleString("fa-IR")}</b>
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </Section>
      );
    }
    case "my_items":
      return (
        <Section title={title} more={home.my.open > home.my.items.length ? <Link className="ds-link" to={portalPath(orgId, "requests")}>همه ({home.my.open.toLocaleString("fa-IR")})</Link> : null}>
          {home.my.items.length ? (
            <div className="pt-card is-flush">
              <ul className="pt-list">
                {home.my.items.map((c) => (
                  <li key={`${c.table}:${c.id}`}>
                    <TicketRow card={c} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty title="درخواست بازی ندارید" text="هر وقت چیزی لازم داشتید، از جست‌وجو یا «درخواست خدمت» شروع کنید." />
          )}
        </Section>
      );
    case "popular":
      return home.popular.length ? (
        <Section title={title} more={cfg.can.order ? <Link className="ds-link" to={portalPath(orgId, "catalog")}>همهٔ خدمت‌ها</Link> : null}>
          <div className="pt-grid">
            {home.popular.map((it) => (
              <ItemTile key={it.id} item={it} onFavorite={(on) => void fav(it.id, on)} />
            ))}
          </div>
        </Section>
      ) : null;
    case "favorites":
      return home.favorites.length ? (
        <Section title={title}>
          <div className="pt-grid is-small">
            {home.favorites.map((it) => (
              <ItemTile key={it.id} item={it} onFavorite={(on) => void fav(it.id, on)} />
            ))}
          </div>
        </Section>
      ) : null;
    case "categories":
      return home.categories.length ? (
        <Section title={title}>
          <div className="pt-grid is-small">
            {home.categories.map((c) => {
              const Icon = iconOf(c.icon);
              return (
                <Link key={c.id} to={portalPath(orgId, `catalog/${c.id}`)} className="pt-tile">
                  <span className="pt-tile-ic" aria-hidden>
                    <Icon {...I20} />
                  </span>
                  <span className="pt-tile-b">
                    <span className="pt-tile-t">{c.name}</span>
                    <span className="pt-tile-m">{c.count.toLocaleString("fa-IR")} خدمت</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </Section>
      ) : null;
    case "topics":
      return home.topics.length ? (
        <Section title={title}>
          <div className="pt-grid is-small">
            {home.topics.map((t) => {
              const Icon = iconOf(t.icon);
              return (
                <Link key={t.id} to={portalPath(orgId, `topics/${t.id}`)} className="pt-tile">
                  <span className="pt-tile-ic" aria-hidden>
                    <Icon {...I20} />
                  </span>
                  <span className="pt-tile-b">
                    <span className="pt-tile-t">{t.name}</span>
                    {t.description ? <span className="pt-tile-d">{t.description}</span> : null}
                  </span>
                </Link>
              );
            })}
          </div>
        </Section>
      ) : null;
    case "knowledge":
      return home.knowledge.length ? (
        <Section title={title} more={<Link className="ds-link" to={portalPath(orgId, "kb")}>مرکز دانش</Link>}>
          <div className="pt-card is-flush">
            <ul className="pt-list">
              {home.knowledge.map((a) => (
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
      ) : null;
    case "status":
      return home.status ? (
        <Section title={title} more={<Link className="ds-link" to={portalPath(orgId, "status")}>همهٔ خدمت‌ها</Link>}>
          <div className="pt-card is-flush">
            <ul className="pt-list">
              {home.status.services.map((s) => (
                <li key={s.name} className="pt-row">
                  <i className="pt-status-dot" data-s={s.status} aria-hidden />
                  <span className="pt-row-b">
                    <span className="pt-row-t">{s.name}</span>
                    {s.note ? <span className="pt-row-m">{s.note}</span> : null}
                  </span>
                  <span className="text-[13px] text-ink-3">{statusLabel(s.status)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ) : null;
    case "links":
      return home.links.length ? (
        <Section title={title}>
          <div className="pt-grid is-small">
            {home.links.map((l) => {
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
      ) : null;
    case "assistant":
      return cfg.portal.chat_enabled ? (
        <section className="pt-section">
          <div className="pt-card flex flex-wrap items-center gap-3">
            <span className="pt-tile-ic" aria-hidden>
              <MessageCircle {...I20} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{w.title || `${cfg.portal.chat_name} پاسخ می‌دهد، سفارش می‌گیرد و پیگیری می‌کند`}</span>
              <span className="text-[13px] text-ink-3">پرسشتان را به زبان خودتان بنویسید؛ هر وقت خواستید با کارشناس گفتگو کنید.</span>
            </div>
            <Button type="primary" onClick={() => navigate(portalPath(orgId, "chat"))}>
              شروع گفتگو
            </Button>
          </div>
        </section>
      ) : null;
    case "text":
      return w.text?.trim() ? (
        <Section title={w.title || ""}>
          <div className="pt-card">
            <RecordMarkdown text={w.text} />
          </div>
        </Section>
      ) : null;
    default:
      return null;
  }
}

export default function Home({ cfg }: { cfg: PortalConfig }) {
  const q = usePortalHome(cfg.portal.id, cfg.preview);
  usePageTitle(cfg.portal.name);
  return (
    <>
      <Hero cfg={cfg} />
      {q.isLoading ? <Loader /> : null}
      {q.data ? cfg.layout.filter((w) => w.enabled && w.type !== "search").map((w) => <Widget key={w.id} w={w} home={q.data!} cfg={cfg} />) : null}
    </>
  );
}

// The catalogue as the person may order from it (PTL-008): categories, a filter box, the services of the chosen
// category (or all), favourites with a star and the services they ordered lately. Only what the request module's
// `browse` gives them (audiences and entitlements decided on the server).
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Input, Segmented } from "antd";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { Loader } from "../../components/display";
import { PORTAL_KEYS, portalApi, usePortalCatalog, type PortalConfig } from "./api";
import { portalPath } from "./model";
import { Empty, ItemTile, PageHead, Section } from "./parts";

export default function Catalog({ cfg }: { cfg: PortalConfig }) {
  const { category } = useParams();
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const c = usePortalCatalog(category ?? null, q);
  const [view, setView] = useState<"all" | "fav">("all");
  const data = c.data;
  const current = data?.categories.find((x) => x.id === category) ?? null;
  const top = (data?.categories ?? []).filter((x) => x.count > 0);
  const fav = async (id: string, on: boolean) => {
    await portalApi.favorite(api, id, on);
    await qc.invalidateQueries({ queryKey: PORTAL_KEYS.all(orgId) });
  };
  const items = (data?.items ?? []).filter((i) => view === "all" || i.favorite);
  if (!cfg.can.order) return <Empty title="کاتالوگ خدمات برای شما باز نیست" />;
  return (
    <>
      <PageHead
        title={current ? current.name : "خدمت‌ها"}
        sub={current?.description ?? "خدمتی را برگزینید و فرم کوتاهش را پر کنید."}
        back={current ? { to: portalPath(orgId, "catalog"), label: "همهٔ خدمت‌ها" } : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input.Search allowClear placeholder="جست‌وجو در خدمت‌ها" aria-label="جست‌وجو در خدمت‌ها" value={text} onChange={(e) => setText(e.target.value)} style={{ maxInlineSize: 360 }} />
        <Segmented value={view} onChange={(v) => setView(v as "all" | "fav")} options={[{ value: "all", label: "همه" }, { value: "fav", label: "برگزیده‌ها" }]} />
      </div>
      {!current && top.length ? (
        <div className="mb-2 flex flex-wrap gap-2" role="list" aria-label="دسته‌ها">
          {top.slice(0, 24).map((x) => (
            <Link key={x.id} role="listitem" className="pt-chip-btn" to={portalPath(orgId, `catalog/${x.id}`)}>
              {x.name} <span className="text-ink-3">{x.count.toLocaleString("fa-IR")}</span>
            </Link>
          ))}
        </div>
      ) : null}
      {c.isLoading ? <Loader /> : null}
      {data && !q && !current && view === "all" && data.recent.length ? (
        <Section title="سفارش‌های اخیر شما">
          <div className="pt-grid is-small">
            {data.recent.map((it) => (
              <ItemTile key={it.id} item={it} onFavorite={(on) => void fav(it.id, on)} />
            ))}
          </div>
        </Section>
      ) : null}
      {data ? (
        <Section title={q ? `نتیجه‌های «${q}»` : view === "fav" ? "برگزیده‌های شما" : "همهٔ خدمت‌ها"}>
          {items.length ? (
            <div className="pt-grid">
              {items.map((it) => (
                <ItemTile key={it.id} item={it} onFavorite={(on) => void fav(it.id, on)} />
              ))}
            </div>
          ) : (
            <Empty title={view === "fav" ? "هنوز خدمتی را برنگزیده‌اید" : "خدمتی پیدا نشد"} text={view === "fav" ? "ستارهٔ کنار هر خدمت آن را این‌جا نگه می‌دارد." : "واژهٔ دیگری امتحان کنید یا مشکل را گزارش کنید."} />
          )}
        </Section>
      ) : null}
    </>
  );
}

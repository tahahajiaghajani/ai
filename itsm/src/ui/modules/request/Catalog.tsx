// «سفارش از کاتالوگ» — the agent and administrator side of ordering (the requester portal embeds the same order form
// later): catalogues and their category trees as the person may see them (audiences), featured items first, search
// (hidden items appear only when searched), ordering for someone else («سفارش برای»: the list becomes theirs, items
// the caller may not order for them say why), and each item opening its order drawer — order guides their guide,
// content items their link. «سفارش دوباره» from a requested item opens here with the earlier answers.
import { useMemo, useState } from "react";
import { Badge, Button, Input } from "antd";
import { Search, ShoppingCart, Star, ExternalLink } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import type { Answers } from "@shared/request/form";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { Field, ICON, ICON14, Note } from "../../components/blocks";
import { UserSelect, useMe } from "../../records";
import { useCart, useCatalog, type ItemCard } from "./api";
import { iconOf } from "./icons";
import { money, recurringText } from "./model";
import OrderDrawer from "./OrderDrawer";
import GuideDrawer from "./GuideDrawer";

export default function Catalog() {
  const { orgId } = useOrg();
  const { userId } = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [forUser, setForUser] = useState<string | null>(params.get("for"));
  const [place, setPlace] = useState<{ catalog?: string; category?: string; featured?: boolean }>({});
  const browse = useCatalog({ q: q.trim() || undefined, for: forUser && forUser !== userId ? forUser : undefined });
  const cart = useCart();
  // «سفارش دوباره»: ?item=<id> opens the item with the earlier answers (kept in sessionStorage by the record page)
  const [open, setOpen] = useState<{ item: ItemCard | null; id: string | null; initial: { answers?: Answers; quantity?: number } | null }>(() => {
    const id = params.get("item");
    let initial: { answers?: Answers; quantity?: number } | null = null;
    try {
      const raw = id ? sessionStorage.getItem(`itsm.request.reorder.${id}`) : null;
      initial = raw ? JSON.parse(raw) : null;
    } catch {
      initial = null;
    }
    return { item: null, id, initial };
  });
  const data = browse.data;

  const tree = useMemo(() => {
    if (!data) return [];
    return data.catalogs.map((c) => ({
      catalog: c,
      categories: data.categories.filter((x) => x.catalog_id === c.id && !x.parent_id).map((top) => ({ top, subs: data.categories.filter((x) => x.parent_id === top.id) })),
    }));
  }, [data]);

  const items = useMemo(() => {
    if (!data) return [];
    const within = (it: ItemCard) => {
      if (place.featured) return it.featured;
      if (place.category) {
        let c: string | null = it.category_id;
        for (let i = 0; c && i < 20; i++) {
          if (c === place.category) return true;
          c = data.categories.find((x) => x.id === c)?.parent_id ?? null;
        }
        return false;
      }
      if (place.catalog) return it.catalog_id === place.catalog;
      return true;
    };
    return data.items.filter(within);
  }, [data, place]);

  const select = (it: ItemCard) => {
    if (it.type === "content" && it.content_url) {
      window.open(it.content_url, "_blank", "noopener,noreferrer");
      return;
    }
    setOpen({ item: it, id: it.id, initial: null });
  };
  const close = () => {
    setOpen({ item: null, id: null, initial: null });
    if (params.get("item")) {
      params.delete("item");
      setParams(params, { replace: true });
    }
  };
  const banner = place.catalog ? data?.catalogs.find((c) => c.id === place.catalog)?.banner : data?.catalogs.length === 1 ? data.catalogs[0].banner : null;
  const guideOpen = open.item?.type === "order_guide";
  const cartCount = cart.data?.totals.count ?? 0;

  return (
    <>
      <PageHeader
        title="سفارش از کاتالوگ"
        actions={
          <Badge count={cartCount} size="small" offset={[-4, 4]}>
            <Button icon={<ShoppingCart {...ICON} />} onClick={() => navigate(`/${orgId}/catalog/cart`)}>
              سبد سفارش
            </Button>
          </Badge>
        }
      />
      <div className="rq-tools">
        <Input allowClear prefix={<Search {...ICON14} />} placeholder="جست‌وجو در کاتالوگ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجو در کاتالوگ" />
        <Field label="سفارش برای" className="rq-for">
          <UserSelect value={forUser ?? userId} onChange={(v) => setForUser(typeof v === "string" ? v : null)} allowClear={false} />
        </Field>
      </div>
      {banner ? <Note className="rq-banner">{banner}</Note> : null}
      {browse.isLoading ? <Loader /> : null}
      {data ? (
        <div className="rq-cat">
          <nav className="rq-tree" aria-label="دسته‌های کاتالوگ">
            <button type="button" aria-current={!place.catalog && !place.category && !place.featured} onClick={() => setPlace({})}>
              همهٔ اقلام <span className="rq-tree-n">{data.items.length.toLocaleString("fa-IR")}</span>
            </button>
            {data.items.some((i) => i.featured) ? (
              <button type="button" aria-current={!!place.featured} onClick={() => setPlace({ featured: true })}>
                <Star {...ICON14} /> برگزیده‌ها
              </button>
            ) : null}
            {tree.map(({ catalog, categories }) => (
              <div key={catalog.id}>
                {tree.length > 1 ? (
                  <button type="button" className="rq-tree-h" aria-current={place.catalog === catalog.id && !place.category} onClick={() => setPlace({ catalog: catalog.id })}>
                    {catalog.name}
                  </button>
                ) : null}
                {categories.map(({ top, subs }) => {
                  const Icon = iconOf(top.icon);
                  return (
                    <div key={top.id}>
                      <button type="button" aria-current={place.category === top.id} onClick={() => setPlace({ catalog: catalog.id, category: top.id })}>
                        <Icon {...ICON14} /> {top.name}
                        <span className="rq-tree-n">{top.count.toLocaleString("fa-IR")}</span>
                      </button>
                      {subs.map((s) => (
                        <button key={s.id} type="button" className="rq-tree-sub" aria-current={place.category === s.id} onClick={() => setPlace({ catalog: catalog.id, category: s.id })}>
                          {s.name}
                          <span className="rq-tree-n">{s.count.toLocaleString("fa-IR")}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>
          <div>
            {items.length ? (
              <div className="rq-cards">
                {items.map((it) => {
                  const Icon = iconOf(it.icon);
                  const recurring = recurringText(it.recurring_price, it.recurring_frequency);
                  return (
                    <button key={it.id} type="button" className="rq-card" onClick={() => select(it)} aria-disabled={!it.orderable && it.type !== "content"} title={it.why ?? undefined}>
                      <span className="rq-card-h">
                        <span className="rq-card-i" aria-hidden>
                          <Icon {...ICON} />
                        </span>
                        <span className="rq-card-t">{it.name}</span>
                        {it.featured ? <Star {...ICON14} aria-label="برگزیده" /> : null}
                        {it.type === "content" ? <ExternalLink {...ICON14} aria-label="پیوند" /> : null}
                      </span>
                      {it.short_description ? <span className="rq-card-d">{it.short_description}</span> : null}
                      <span className="rq-card-f">
                        {it.price && Number(it.price) > 0 ? <span>{money(it.price)}</span> : null}
                        {recurring ? <span>{recurring}</span> : null}
                        {it.promise ? <span>{it.promise}</span> : null}
                        {it.type === "order_guide" ? <span>راهنمای سفارش</span> : null}
                        {it.why ? <span className="rq-err">{it.why}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState title={q ? "قلمی با این جست‌وجو پیدا نشد" : "در این بخش قلمی برای سفارش نیست"} description={q ? "واژهٔ دیگری را امتحان کنید یا «درخواست دیگر» را بفرستید" : undefined} />
            )}
          </div>
        </div>
      ) : null}
      <OrderDrawer itemId={!guideOpen ? open.id : null} forUser={forUser} open={!!open.id && !guideOpen} onClose={close} initial={open.initial} />
      <GuideDrawer guideId={guideOpen ? open.id : null} forUser={forUser} open={guideOpen} onClose={close} />
    </>
  );
}

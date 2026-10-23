import { accountCopy } from "@/content/copy/account";
import { getCatalog } from "@/lib/catalog";
import type { Lang } from "@/lib/format";
import { requireMember, storeContact } from "@/lib/member";
import { proStatus } from "@/lib/pro";
import { getSettings } from "@/lib/settings";
import { CartView, NotPro, type CartProduct } from "@/components/account/cart-view";
import { AccountHeader } from "@/components/account/ui";

/**
 * /account/cart «سفارش جدید». The basket lives in the browser, so the page hands over the published
 * catalogue's names and pictures (never prices: those come from the Pro price layer after a session check).
 */
export async function CartPage({ lang }: { lang: Lang }) {
  const me = await requireMember(lang, "/account/cart");
  const c = accountCopy(lang).cart;
  const pro = await proStatus(me.id);
  if (!pro.active) {
    return (
      <>
        <AccountHeader lang={lang} title={c.title} />
        <NotPro lang={lang} />
      </>
    );
  }
  const [catalog, settings, contact] = await Promise.all([getCatalog(), getSettings(), storeContact()]);
  const products: CartProduct[] = catalog.products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name_fa: p.name_fa,
    name_en: p.name_en,
    image: p.images[0] ?? null,
    variants: p.variants.map((v) => ({ id: v.id, name_fa: v.name_fa, name_en: v.name_en, swatch: v.swatch, image: v.image })),
  }));
  const note = lang === "en" ? settings.shop.orderNote_en || settings.shop.orderNote_fa : settings.shop.orderNote_fa;
  return (
    <>
      <AccountHeader lang={lang} title={c.title} />
      <CartView
        lang={lang}
        products={products}
        seed={catalog.source === "seed"}
        orderNote={note}
        contact={contact}
        defaults={{ name: me.name, phone: me.phone, business: me.business, city: me.city, address: me.address, postal_code: me.postal_code }}
      />
    </>
  );
}

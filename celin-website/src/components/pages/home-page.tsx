import { getCatalog } from "@/lib/catalog";
import { getSlots, slotText, type ResolvedSlot } from "@/lib/slots";
import { t, type Lang } from "@/lib/i18n";
import { env } from "@/lib/env";
import { jsonLd, SITE } from "@/lib/seo";
import { homeCopy } from "@/content/copy/home";
import { Intro } from "@/components/fx/intro";
import { HomeHero } from "@/components/home/hero";
import { Aperture } from "@/components/home/aperture";
import { ProInvite } from "@/components/home/pro-invite";
import { Anniversary, Arcade, Craft, Featured, House, Ribbon, Statement } from "@/components/home/sections";

/** The home page: one showcase, from the arcade hero to the Pro invitation (static; prices never here). */
export async function HomePage({ lang }: { lang: Lang }) {
  const [catalog, slots] = await Promise.all([getCatalog(), getSlots()]);
  const c = homeCopy[lang];
  const s = (key: string) => slots[key] as ResolvedSlot;
  const txt = (key: string, field: string) => slotText(slots[key], field, lang);

  const collections = catalog.collections.filter((k) => k.visible !== false && k.media);
  const collectionNames = Object.fromEntries(catalog.collections.map((k) => [k.slug, t(k, "name", lang)]));
  const featured = [...catalog.products.filter((p) => p.featured), ...catalog.products.filter((p) => !p.featured)].slice(0, 8);

  return (
    <main>
      <Intro />
      <HomeHero
        lang={lang}
        d={{
          eyebrow: txt("home.hero.a", "eyebrow"),
          title: txt("home.hero.a", "title"),
          subtitle: txt("home.hero.a", "subtitle"),
          cta: txt("home.hero.a", "cta"),
          href: txt("home.hero.a", "href") || "/shop",
          all: c.all,
          a: { media: s("home.hero.a").media, mobile: s("home.hero.a").mobile, video: s("home.hero.a").video ?? null },
          b: s("home.hero.b").media,
          c: s("home.hero.c").media,
        }}
      />
      <Ribbon items={c.ribbon} />
      <Statement lang={lang} lines={[txt("home.statement", "line1"), txt("home.statement", "line2"), txt("home.statement", "line3")]} a={s("home.statement").media} b={s("home.statement.b").media} />
      {collections.length > 0 && <Arcade lang={lang} collections={collections} copy={c.arcade} />}
      <Anniversary
        lang={lang}
        d={{
          eyebrow: txt("home.anniversary", "eyebrow"),
          number: txt("home.anniversary", "number") || "20",
          title: txt("home.anniversary", "title"),
          subtitle: txt("home.anniversary", "subtitle"),
          body: txt("home.anniversary", "body"),
          body2: txt("home.anniversary", "body2"),
          closing: txt("home.anniversary", "closing"),
          cta: txt("home.anniversary", "cta"),
          href: txt("home.anniversary", "href") || "/maison",
          media: s("home.anniversary").media,
        }}
      />
      <Aperture
        lang={lang}
        d={{
          eyebrow: txt("home.interlude", "eyebrow"),
          title: txt("home.interlude", "title"),
          body: txt("home.interlude", "body"),
          cta: txt("home.interlude", "cta"),
          href: txt("home.interlude", "href") || "/craft",
          media: s("home.interlude").media,
          mobile: s("home.interlude").mobile,
          video: s("home.interlude").video ?? null,
        }}
      />
      {featured.length > 0 && <Featured lang={lang} products={featured} collectionNames={collectionNames} copy={c.featured} />}
      <Craft
        lang={lang}
        copy={c.craft}
        steps={[1, 2, 3, 4].map((i) => ({ title: txt(`home.craft.${i}`, "title"), body: txt(`home.craft.${i}`, "body"), media: s(`home.craft.${i}`).media }))}
      />
      <House
        lang={lang}
        d={{
          eyebrow: txt("home.house", "eyebrow"),
          title: txt("home.house", "title"),
          body: txt("home.house", "body"),
          cta: txt("home.house", "cta"),
          href: txt("home.house", "href") || "/maison",
          media: s("home.house").media,
          mobile: s("home.house").mobile,
          signature: c.house.signature,
          signatureLabel: c.house.signatureLabel,
        }}
      />
      <ProInvite
        lang={lang}
        d={{
          eyebrow: txt("home.pro", "eyebrow"),
          title: txt("home.pro", "title"),
          body: txt("home.pro", "body"),
          cta: txt("home.pro", "cta"),
          href: txt("home.pro", "href") || "/pro",
          code: c.pro.code,
          member: c.pro.member,
          perks: c.pro.perks,
          media: s("home.pro").media,
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            "@context": "https://schema.org",
            "@type": "JewelryStore",
            name: SITE[lang].name,
            alternateName: lang === "fa" ? "CELIN" : "سلین",
            description: SITE[lang].description,
            url: `${env.siteUrl}${lang === "en" ? "/en" : ""}`,
            logo: `${env.siteUrl}/brand/celin-logo.svg`,
            parentOrganization: { "@type": "Organization", name: lang === "fa" ? "گالری اعتماد" : "Etemad Gallery" },
          }),
        }}
      />
    </main>
  );
}

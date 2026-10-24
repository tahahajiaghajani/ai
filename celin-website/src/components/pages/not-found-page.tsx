import Link from "next/link";
import { getCatalog } from "@/lib/catalog";
import { href, t, type Lang } from "@/lib/i18n";
import { errorCopy } from "@/content/copy/errors";
import { Arch } from "@/components/fx/arch";
import { Aura } from "@/components/fx/aura";
import { Magnetic } from "@/components/fx/magnetic";
import { Icon } from "@/components/ui/icons";
import { Eyebrow } from "@/components/house/bits";
import { NightDoor } from "@/components/house/night-door";

/**
 * The site's own 404 (an unknown product, category or collection): the night doorway with «۴۰۴», three ways
 * back, and three collections to wander into. Rendered inside the site chrome.
 */
export async function NotFoundPage({ lang }: { lang: Lang }) {
  const c = errorCopy[lang].notFound;
  const catalog = await getCatalog().catch(() => null);
  const collections = (catalog?.collections ?? []).filter((k) => k.visible !== false && k.media).slice(0, 3);
  return (
    <main>
      <NightDoor lang={lang} under code={c.code} eyebrow={c.eyebrow} title={c.title} body={c.body} background={<Aura palette="espresso" light={0.85} />}>
        <Magnetic>
          <Link href={href(lang, "/")} className="btn btn-metal h-13 px-8">
            {c.home}
          </Link>
        </Magnetic>
        <Link href={href(lang, "/shop")} className="btn btn-line-light h-13">
          {c.shop}
        </Link>
        <Link href={href(lang, "/collections")} className="group inline-flex items-center gap-2 text-sm text-on-night">
          <span className="border-b border-on-night/40 pb-1 transition-colors group-hover:border-gold-on-dark">{c.collections}</span>
          <Icon name="arrow" className="size-4 rtl:-scale-x-100" />
        </Link>
      </NightDoor>
      {collections.length > 0 && (
        <section className="relative isolate bg-mesh-porcelain py-20 sm:py-24">
          <div className="container-lux">
            <Eyebrow center>{c.suggest}</Eyebrow>
            <ul className="mx-auto mt-12 grid max-w-4xl grid-cols-3 gap-3 sm:gap-10">
              {collections.map((k) => (
                <li key={k.slug}>
                  <Link href={href(lang, `/collections/${k.slug}`)} className="group block text-center" data-cursor="view">
                    <div className="relative px-1.5 pt-1.5 sm:px-2.5 sm:pt-2.5">
                      <Arch media={k.media} lang={lang} sizes="(min-width: 640px) 26vw, 30vw" ring="copper" unveil sparkle={6} frameClassName="fx-sheen" className="[--ring-gap:6px] sm:[--ring-gap:10px]" />
                    </div>
                    <span className="title-card mt-4 block text-ink transition-colors group-hover:text-gold-text">{t(k, "name", lang)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}

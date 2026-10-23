import Link from "next/link";
import type { CSSProperties } from "react";
import { getCatalog } from "@/lib/catalog";
import { getSlots, type ResolvedSlot } from "@/lib/slots";
import { href, type Lang } from "@/lib/i18n";
import type { Media } from "@/lib/media";
import { craftCopy } from "@/content/copy/craft";
import { homeCopy } from "@/content/copy/home";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { SplitWords } from "@/components/fx/split-words";
import { Icon } from "@/components/ui/icons";
import { Ribbon, SectionHead } from "@/components/home/sections";
import { Eyebrow } from "@/components/house/bits";
import { CraftStage } from "@/components/house/craft-stage";
import { HouseHero } from "@/components/house/hero";
import { Plating } from "@/components/house/plating";
import { slotReader } from "@/components/house/slot-reader";

/**
 * /craft — «هنر ساخت»: design → cubic zirconia → precise setting → rhodium & gold plating. The steps are the
 * home page's craft slots (texts and pictures), the long text is the brand's craft chapter; nothing else is
 * claimed. Paraiba hero, a lede, the four-step stage, the materials ribbon, «رودیوم · طلا», and two ways on.
 */
export async function CraftPage({ lang }: { lang: Lang }) {
  const [slots, catalog] = await Promise.all([getSlots(), getCatalog()]);
  const s = (key: string) => slots[key] as ResolvedSlot;
  const txt = slotReader(slots, lang);
  const c = craftCopy[lang];
  const firstCollection = catalog.collections.find((k) => k.visible !== false && k.media);

  const steps = [1, 2, 3, 4].map((i) => ({
    title: txt(`home.craft.${i}`, "title"),
    body: txt(`home.craft.${i}`, "body"),
    tags: c.steps.tags[i - 1] ?? [],
    media: s(`home.craft.${i}`).media,
  }));

  const next: { path: string; title: string; text: string; media: Media | null | undefined }[] = [
    { path: "/care", title: c.next.care.title, text: c.next.care.text, media: s("care.hero").media },
    { path: "/collections", title: c.next.collections.title, text: c.next.collections.text, media: firstCollection?.media ?? s("home.hero.a").media },
  ];

  return (
    <main>
      <HouseHero
        lang={lang}
        palette="paraiba"
        light={0.9}
        flip
        sparkle={16}
        d={{ eyebrow: txt("craft.hero", "eyebrow"), title: txt("craft.hero", "title"), subtitle: txt("craft.hero", "subtitle"), media: s("craft.hero").media, mobile: s("craft.hero").mobile, video: s("craft.hero").video }}
        latin={["CUBIC ZIRCONIA", "RHODIUM & GOLD"]}
      />

      {/* the brand's craft chapter */}
      <section className="relative isolate overflow-clip bg-mesh-porcelain py-24 sm:py-36">
        <ArchLines count={4} className="pointer-events-none absolute inset-x-0 -bottom-8 mx-auto h-[115%] w-[min(1000px,150vw)] opacity-60" />
        <div className="container-lux relative mx-auto max-w-5xl text-center">
          <Eyebrow center>{c.lede.eyebrow}</Eyebrow>
          <SplitWords as="p" text={c.lede.text} className="display mt-7 text-[clamp(1.4rem,2.7vw,2.35rem)] leading-[1.85]! font-semibold text-ink" />
        </div>
      </section>

      {/* four steps */}
      <section className="relative isolate bg-mesh-bone py-20 sm:py-28 lg:pb-12">
        <div className="container-lux">
          <SectionHead eyebrow={c.steps.eyebrow} title={c.steps.title} align="center" />
          <div className="mt-10 lg:mt-6">
            <CraftStage lang={lang} steps={steps} label={c.steps.step} />
          </div>
        </div>
      </section>

      <Ribbon items={homeCopy[lang].ribbon} />

      <Plating
        lang={lang}
        d={{
          eyebrow: c.plating.eyebrow,
          title: txt("craft.plating", "title"),
          body: txt("craft.plating", "body"),
          rhodium: c.plating.rhodium,
          gold: c.plating.gold,
          rhodiumTone: c.plating.rhodiumTone,
          goldTone: c.plating.goldTone,
          media: s("craft.plating").media,
          mobile: s("craft.plating").mobile,
        }}
      />

      {/* two ways on */}
      <section className="relative isolate overflow-clip bg-mesh-porcelain py-24 sm:py-32">
        <div className="container-lux">
          <div className="text-center">
            <Eyebrow center>{c.next.eyebrow}</Eyebrow>
            <SplitWords text={c.next.title} className="display mx-auto mt-4 max-w-4xl text-[clamp(2.4rem,6vw,5rem)] leading-[1.4]! font-bold" wordClassName="text-metal metal-live" />
          </div>
          <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-5 sm:gap-12">
            {next.map((n, i) => (
              <Link key={n.path} href={href(lang, n.path)} className="group block text-center" data-cursor="view" data-reveal style={{ "--d": i } as CSSProperties}>
                <div className="relative px-2 pt-2 sm:px-3 sm:pt-3">
                  <Arch media={n.media} lang={lang} sizes="(min-width: 1024px) 26vw, 44vw" ring="copper" sparkle={6} frameClassName="fx-sheen" className="[--ring-gap:8px] sm:[--ring-gap:10px]" />
                </div>
                <span className="mt-4 block h-px bg-[image:var(--metal-copper)] opacity-40" aria-hidden />
                <h2 className="display mt-5 text-2xl font-bold text-ink transition-colors duration-500 group-hover:text-gold-text sm:text-4xl">{n.title}</h2>
                <p className="mt-2 text-sm leading-7 text-muted sm:text-base">{n.text}</p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm text-ink">
                  <Icon name="arrow" className="size-4 transition-transform duration-500 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

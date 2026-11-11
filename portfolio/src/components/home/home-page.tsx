import type { Lang } from "@/lib/i18n";
import { EXPERTISE, PROFILE } from "@/content/profile";
import { ui } from "@/content/ui";
import { PROJECTS } from "@/content/projects";
import { PRODUCTS } from "@/content/products";
import { Hero } from "@/components/hero/hero";
import { Marquee } from "@/components/fx/marquee";
import { Manifesto, type Fact } from "@/components/home/manifesto";
import { Expertise } from "@/components/home/expertise";
import { WorkRail } from "@/components/home/work-rail";
import { WorkIndex } from "@/components/home/work-index";
import { SectionHead } from "@/components/home/section-head";
import { Method } from "@/components/home/method";
import { Journey } from "@/components/home/journey";
import { Trust } from "@/components/home/trust";
import { Toolbox } from "@/components/home/toolbox";
import { Ask } from "@/components/home/ask";
import { Contact } from "@/components/home/contact";
import { ProductSection } from "@/components/home/product";
import { BlogTeaser } from "@/components/home/blog-teaser";

// counted from the content, so the numbers stay true as work is added
const FACTS: Fact[] = [
  { value: PROJECTS.filter((p) => p.tier !== "lab").length + PRODUCTS.length, label: { fa: "سیستم و محصول تحویل‌شده در این پورتفولیو", en: "shipped systems & products in this portfolio" } },
  { value: EXPERTISE.length, label: { fa: "حوزه‌ی تخصصی، از RAG تا برند", en: "disciplines, from RAG to brand" } },
  { value: 2, label: { fa: "زبان، یک استاندارد", en: "languages, one standard" } },
  { value: 1, label: { fa: "نفر، از تحلیل تا استقرار", en: "person, from analysis to deployment" } },
];

const BAND = {
  fa: ["RAG", "LLM", "بینایی ماشین", "VLM", "ایجنت‌ها", "ورکفلو", "پایپ‌لاین", "فول‌استک", "داده", "طراحی", "برند", "موشن"],
  en: ["RAG", "LLMs", "Computer vision", "VLMs", "Agents", "Workflows", "Pipelines", "Full-stack", "Data", "Design", "Brand", "Motion"],
};

// the numbered sections in page order (the trust band has no number): adding one renumbers the rest
const ORDER = ["about", ...PRODUCTS.map((p) => p.slug), "expertise", "work", "method", "journey", "blog", "toolbox", "ask", "contact"];
const at = (key: string) => String(ORDER.indexOf(key) + 1).padStart(2, "0");

export function HomePage({ lang }: { lang: Lang }) {
  const fa = lang === "fa";
  const rail = PROJECTS.filter((p) => p.tier !== "lab");
  return (
    <>
      <Hero
        lang={lang}
        copy={{
          first: PROFILE.first[lang],
          last: PROFILE.last[lang],
          roles: PROFILE.roles[lang],
          headline: PROFILE.headline[lang],
          available: ui.hero.available[lang],
          scroll: ui.hero.scroll[lang],
          alt: fa ? "پرتره‌ی سیاه‌وسفید طاها آقاجانی" : "Black-and-white portrait of Taha Aghajani",
        }}
      />
      <div className="border-y border-line py-6">
        <Marquee items={[...BAND[lang], ...BAND[lang]]} className={`text-[clamp(2.4rem,6vw,5.5rem)] leading-none ${fa ? "font-bold" : "font-semibold tracking-[-0.04em]"}`} />
      </div>
      <Manifesto lang={lang} index={at("about")} facts={FACTS} />
      {/* Taha's own products, each in a section of its own; the bands alternate and the screens swap sides */}
      <div id="products">
        {PRODUCTS.map((p, i) => (
          <ProductSection key={p.slug} p={p} lang={lang} index={at(p.slug)} invert={i % 2 === 0} flip={i % 2 === 1} />
        ))}
      </div>
      <Expertise lang={lang} index={at("expertise")} />
      <WorkRail
        lang={lang}
        items={rail.map(({ slug, title, kicker, oneLiner, year, cover, stack }) => ({ slug, title, kicker, oneLiner, year, cover, stack }))}
        intro={
          <SectionHead
            lang={lang}
            index={at("work")}
            eyebrow={ui.sections.work[lang]}
            title={fa ? <>سیستم‌هایی که <span className="font-light">در دنیای واقعی کار می‌کنند</span></> : <>Systems that run <span className="font-serif font-normal italic">in the real world</span></>}
          />
        }
      />
      <WorkIndex lang={lang} items={PROJECTS.map(({ slug, title, kicker, year, cover, tier }) => ({ slug, title, kicker, year, cover, tier }))} />
      <Method lang={lang} index={at("method")} />
      <Journey lang={lang} index={at("journey")} />
      <Trust lang={lang} />
      <BlogTeaser lang={lang} index={at("blog")} />
      <Toolbox lang={lang} index={at("toolbox")} />
      <Ask lang={lang} index={at("ask")} />
      <Contact lang={lang} index={at("contact")} />
    </>
  );
}

import { copy, type Lang } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { organizationJsonLd } from "@/lib/seo";
import { Hero } from "@/components/home/hero";
import { Marquee } from "@/components/home/marquee";
import { Manifesto } from "@/components/home/manifesto";
import { AiSection } from "@/components/home/ai-section";
import { Services } from "@/components/home/services";
import { Work } from "@/components/home/work";
import { Stats } from "@/components/home/stats";
import { Process } from "@/components/home/process";
import { Ceo } from "@/components/home/ceo";
import { DemosCta } from "@/components/home/demos-cta";
import { SupportContact } from "@/components/home/support-contact";
import { RevealObserver } from "@/components/site/reveal-observer";

export async function HomePage({ lang }: { lang: Lang }) {
  const t = copy(lang);
  const { site } = await getSettings();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: organizationJsonLd(lang, site) }} />
      <Hero t={t} />
      <Marquee items={t.marquee} />
      <Manifesto t={t} />
      <div className="cv-auto">
        <AiSection lang={lang} t={t} />
      </div>
      <div className="cv-auto">
        <Services t={t} />
      </div>
      <Stats lang={lang} site={site} />
      <div className="cv-auto">
        <Work t={t} />
      </div>
      <div className="cv-auto">
        <Ceo lang={lang} t={t} site={site} />
      </div>
      <div className="cv-auto">
        <Process lang={lang} t={t} />
      </div>
      <DemosCta lang={lang} t={t} />
      <SupportContact lang={lang} t={t} site={site} />
      <RevealObserver />
    </>
  );
}

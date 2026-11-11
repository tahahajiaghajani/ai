import type { Product } from "@/content/types";
import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { Media, Caption } from "@/components/work/media";
import { ProductMark } from "@/components/brand/product-marks";
import { ProductEditions } from "@/components/home/product-editions";

/**
 * One of Taha's own products, in a home-page section of its own (id = the product's slug): its mark and name, its
 * screens, what it is, its editions (the web version live, the rest locked — ask for them), and what it does.
 * `flip` puts the screens on the other side, so two products in a row alternate.
 */
export function ProductSection({ p, lang, index, invert = false, flip = false }: { p: Product; lang: Lang; index: string; invert?: boolean; flip?: boolean }) {
  const fa = lang === "fa";
  const [lead, second] = p.shots;
  const facts = [
    { k: ui.product.role[lang], v: p.role[lang] },
    { k: ui.product.period[lang], v: p.period[lang] },
    { k: ui.product.status[lang], v: p.status[lang] },
  ];
  const captions = p.shots.map((s) => (s.kind === "art" ? "" : s.caption?.[lang] ?? "")).filter(Boolean);

  return (
    <section id={p.slug} aria-labelledby={`${p.slug}-name`} className={invert ? "tone-invert" : ""}>
      <div className="mx-auto max-w-[1800px] px-5 py-24 md:px-10 md:py-36">
        {/* ------------------------------------------------------------ name */}
        <header className="grid grid-cols-12 gap-x-4 gap-y-8 border-t border-line pt-6">
          <p className="col-span-12 flex items-center gap-3 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted md:col-span-3">
            <span className="text-fg">{num(lang, index)}</span>
            <span className="h-px w-6 bg-line-strong" />
            <span className={fa ? "font-fa text-[0.8rem] normal-case tracking-normal" : ""}>{p.category[lang]}</span>
          </p>
          <div className="col-span-12 md:col-span-9">
            <div className="flex items-center gap-[clamp(1rem,2.4vw,2.25rem)]">
              <span data-fade className="shrink-0">
                <ProductMark slug={p.slug} className="h-[clamp(3.2rem,8vw,7.5rem)] w-auto" />
              </span>
              <h2 id={`${p.slug}-name`} data-split className={`text-display ${fa ? "font-black leading-[1.2]" : "font-semibold leading-[0.95] tracking-[-0.045em]"}`}>
                {p.name[lang]}
              </h2>
            </div>
            <p data-fade className={`mt-6 text-lead text-fg-2 md:mt-8 ${fa ? "font-light leading-[1.5]" : "font-serif italic leading-[1.2]"}`}>{p.tagline[lang]}</p>
          </div>
        </header>

        {/* ------------------------------------------------------------ screens + what it is + editions */}
        <div className="mt-16 grid grid-cols-12 gap-x-4 gap-y-14 md:mt-24 lg:gap-y-0">
          {lead ? (
            <figure className={`col-span-12 lg:col-span-7 lg:row-start-1 ${flip ? "lg:col-start-6" : "lg:col-start-1"}`}>
              {/* the second screen hangs over the lead's lower corner; the padding keeps its room in the flow */}
              <div className={`relative ${second ? "pb-[22%]" : ""}`}>
                <div data-reveal className="group relative">
                  <div data-reveal-inner>
                    <Media m={lead} lang={lang} sizes="(min-width: 1024px) 56vw, 100vw" />
                  </div>
                </div>
                {second ? (
                  <div className={`group absolute bottom-0 w-[54%] shadow-[0_40px_90px_-30px_rgb(0_0_0/0.55)] ${flip ? "start-[-2%] xl:start-[-6%]" : "end-[-2%] xl:end-[-6%]"}`}>
                    <div data-reveal>
                      <div data-reveal-inner>
                        <Media m={second} lang={lang} sizes="(min-width: 1024px) 30vw, 54vw" />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              {captions.length ? <Caption lang={lang} className="mt-5">{captions.join(" · ")}</Caption> : null}
            </figure>
          ) : null}

          {/* five columns beside the screens up to 1279 px, four (with a column of air) from there */}
          <div className={`col-span-12 flex flex-col gap-12 lg:col-span-5 lg:row-start-1 xl:col-span-4 ${flip ? "lg:col-start-1" : "lg:col-start-8 xl:col-start-9"}`}>
            <p data-fade className="text-[clamp(1.02rem,1.3vw,1.18rem)] leading-[1.85] text-fg-2">{p.summary[lang]}</p>
            <div data-fade>
              <ProductEditions product={p.name[lang]} editions={p.editions} lang={lang} />
            </div>
            <dl data-fade className="grid gap-px border-t border-line">
              {facts.map((f) => (
                <div key={f.k} className="grid grid-cols-[6.5rem_1fr] gap-4 border-b border-line py-3.5">
                  <dt className="eyebrow eyebrow-fa pt-0.5">{f.k}</dt>
                  <dd className="text-[0.88rem] leading-relaxed">{f.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* ------------------------------------------------------------ what it does */}
        <div className="mt-24 grid grid-cols-12 gap-x-4 gap-y-6 md:mt-32">
          <p className="eyebrow eyebrow-fa col-span-12 md:col-span-3">{ui.product.features[lang]}</p>
          <div className="col-span-12 md:col-span-9">
            <ol className="grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
              {p.features[lang].map((f, i) => (
                <li key={i} data-fade className="flex gap-5 bg-bg p-6 md:p-7">
                  <span className="font-mono text-xs text-faint">{num(lang, String(i + 1).padStart(2, "0"))}</span>
                  <span className="min-w-0 flex-1 leading-relaxed text-fg-2">{f}</span>
                </li>
              ))}
            </ol>
            <ul className="mt-8 flex flex-wrap gap-2" dir="ltr">
              {p.stack.map((s) => (
                <li key={s} className="rounded-full border border-line px-3.5 py-1.5 font-mono text-[0.68rem] text-fg-2">{s}</li>
              ))}
            </ul>
            {p.note ? <p className="mt-6 text-sm text-muted">{p.note[lang]}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

import type { Lang } from "@/lib/i18n";
import { href } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { PROFILE } from "@/content/profile";
import { Mark } from "@/components/brand/logo";
import { BackToTop } from "@/components/site/back-to-top";
import { LocalClock } from "@/components/site/local-clock";

export function Footer({ lang }: { lang: Lang }) {
  const c = PROFILE.contact;
  const rows = [
    { k: "Email", v: c.email, href: `mailto:${c.email}`, ltr: true },
    { k: lang === "fa" ? "تلفن" : "Phone", v: PROFILE.contact.phoneDisplay[lang], href: `tel:${c.phone}`, ltr: true }, // digit groups read left to right in both languages
    { k: "Telegram", v: lang === "fa" ? "پیام در تلگرام" : "Message on Telegram", href: c.telegram },
    { k: "GitHub", v: "tahahajiaghajani", href: c.github, ltr: true },
  ];
  return (
    <footer className="relative overflow-hidden border-t border-line">
      <div className="mx-auto max-w-[1800px] px-5 pt-24 md:px-10 md:pt-32">
        <div className="grid gap-16 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="eyebrow eyebrow-fa mb-6">{ui.footer.say[lang]}</p>
            <a href={`${href(lang, "/")}#contact`} className="group block" data-cursor-label={lang === "fa" ? "شروع" : "Start"}>
              <span data-split className="block text-[clamp(2.6rem,6.4vw,6.5rem)] font-semibold leading-[1.02] tracking-tight">
                {lang === "fa" ? "مسئله‌ی سختی دارید؟" : "Got a hard problem?"}
              </span>
              <span data-split className="block font-serif text-[clamp(2.6rem,6.4vw,6.5rem)] italic leading-[1.1] text-muted transition-colors duration-500 group-hover:text-fg">
                {lang === "fa" ? "بیایید حلش کنیم." : "Let’s engineer it."}
              </span>
            </a>
          </div>
          <dl className="grid content-end gap-px self-end sm:grid-cols-2 lg:col-span-5">
            {rows.map((r) => (
              <div key={r.k} className="border-t border-line py-5">
                <dt className="eyebrow mb-2">{r.k}</dt>
                <dd>
                  <a href={r.href} className="link-draw text-lg" dir={r.ltr ? "ltr" : undefined} target={r.href.startsWith("http") ? "_blank" : undefined} rel={r.href.startsWith("http") ? "noopener noreferrer" : undefined}>
                    {r.v}
                  </a>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="mt-24 select-none md:mt-32" aria-hidden>
        <p className="latin flex justify-center gap-[0.18em] whitespace-nowrap text-[11.6vw] font-semibold uppercase leading-[0.8] tracking-[-0.045em]" dir="ltr">
          <span>Taha</span>
          <span className="text-outline">Aghajani</span>
        </p>
      </div>

      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-6 text-[0.78rem] text-muted md:px-10">
        <div className="flex items-center gap-3">
          <Mark className="size-5 text-fg" />
          <span>© {lang === "fa" ? "۱۴۰۵" : "2026"} · {ui.footer.rights[lang]}</span>
        </div>
        <LocalClock lang={lang} />
        <span className="hidden md:inline">{ui.footer.built[lang]}</span>
        <BackToTop label={ui.footer.top[lang]} />
      </div>
    </footer>
  );
}

import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { PROFILE } from "@/content/profile";
import { RequestForm } from "@/components/request/request-form";

/** Start a project: what happens next and how to reach Taha directly, beside the AI-triaged request form. */
export function Contact({ lang }: { lang: Lang }) {
  const fa = lang === "fa";
  const c = PROFILE.contact;
  const steps = fa
    ? ["هوش مصنوعی درخواست را می‌خواند، دسته‌بندی و خلاصه می‌کند.", "طاها همان لحظه در تلگرام باخبر می‌شود.", "یک کد پیگیری می‌گیرید؛ پاسخ همان‌جا می‌آید."]
    : ["AI reads, classifies and summarises your request.", "Taha is notified on Telegram right away.", "You get a tracking code — the reply lands there."];
  return (
    <section id="contact" className="mx-auto max-w-[1800px] px-5 py-24 md:px-10 md:py-36">
      <div className="grid grid-cols-12 gap-x-4 gap-y-16">
        <div className="col-span-12 lg:col-span-5">
          <p className="mb-6 flex items-center gap-3 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted">
            <span className="text-fg">{num(lang, "09")}</span>
            <span className="h-px w-6 bg-line-strong" />
            <span className={fa ? "font-fa text-[0.8rem] normal-case tracking-normal" : ""}>{ui.sections.contact[lang]}</span>
          </p>
          <h2 data-split className={`text-title ${fa ? "font-bold leading-[1.3]" : "font-semibold leading-[1.02] tracking-[-0.035em]"}`}>{ui.request.title[lang]}</h2>
          <p data-fade className="mt-6 max-w-[44ch] leading-relaxed text-fg-2">{ui.request.lead[lang]}</p>
          <ol className="mt-12 grid gap-5">
            {steps.map((s, i) => (
              <li key={i} data-fade className="flex items-baseline gap-4 border-t border-line pt-5">
                <span className="font-mono text-xs text-faint">{num(lang, `0${i + 1}`)}</span>
                <span className="text-fg-2">{s}</span>
              </li>
            ))}
          </ol>
          <div data-fade className="mt-12 border-t border-line pt-8">
            <p className="mb-4 text-[0.8rem] text-muted">{ui.request.or[lang]}</p>
            <div className="grid gap-3 text-lg">
              <a href={`mailto:${c.email}`} dir="ltr" className="link-draw w-fit">{c.email}</a>
              <a href={`tel:${c.phone}`} dir="ltr" className="link-draw w-fit">{c.phoneDisplay.en}</a>
              <a href={c.telegram} target="_blank" rel="noopener noreferrer" className="link-draw w-fit">{fa ? "تلگرام ↗" : "Telegram ↗"}</a>
            </div>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-6 lg:col-start-7">
          <RequestForm lang={lang} />
        </div>
      </div>
    </section>
  );
}

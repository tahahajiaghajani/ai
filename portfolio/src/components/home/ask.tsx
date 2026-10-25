import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { ChatPanel } from "@/components/chat/chat-panel";

/** The assistant, inline: what it is on one side, the live conversation on the other. */
export function Ask({ lang }: { lang: Lang }) {
  const fa = lang === "fa";
  return (
    <section id="ask" className="tone-invert">
      <div className="mx-auto grid max-w-[1800px] grid-cols-12 gap-x-4 gap-y-12 px-5 py-24 md:px-10 md:py-32">
        <div className="col-span-12 flex flex-col justify-between gap-10 lg:col-span-5">
          <div>
            <p className="mb-6 flex items-center gap-3 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted">
              <span className="text-fg">{num(lang, "08")}</span>
              <span className="h-px w-6 bg-line-strong" />
              <span className={fa ? "font-fa text-[0.8rem] normal-case tracking-normal" : ""}>{ui.sections.ask[lang]}</span>
            </p>
            <h2 data-split className={`text-title ${fa ? "font-bold leading-[1.3]" : "font-semibold leading-[1.02] tracking-[-0.035em]"}`}>
              {fa ? <>از دستیاری بپرسید که <span className="font-light">کارهای من را می‌شناسد.</span></> : <>Ask an assistant <span className="font-serif font-normal italic">that knows my work.</span></>}
            </h2>
            <p data-fade className="mt-6 max-w-[46ch] leading-relaxed text-fg-2">
              {fa
                ? "یک نمونه‌ی کوچک از همان چیزی که برای سازمان‌ها می‌سازم: RAG روی دانش واقعی، پاسخ مستند، بدون حدس. دانشش از محتوای همین سایت ساخته می‌شود و با Gemini پاسخ می‌دهد."
                : "A small instance of what I build for organisations: RAG over real knowledge, grounded answers, no guessing. Its knowledge is generated from this site's own content and it answers with Gemini."}
            </p>
          </div>
          <dl data-fade className="grid grid-cols-3 gap-px border border-line bg-line text-center">
            {[
              { k: "Retrieval", v: "BM25 · fa/en" },
              { k: "Model", v: "Gemini chain" },
              { k: "Guardrails", v: fa ? "فقط از دانش" : "grounded only" },
            ].map((x) => (
              <div key={x.k} className="bg-bg p-4">
                <dt className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-faint">{x.k}</dt>
                <dd className="mt-1 text-[0.82rem]">{x.v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="col-span-12 lg:col-span-7">
          <ChatPanel className="h-[min(640px,80svh)]" tall />
        </div>
      </div>
    </section>
  );
}

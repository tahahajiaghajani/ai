import type { Lang } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { ORGS } from "@/content/orgs";

/**
 * The organisations behind the work, as quiet single-colour marks with their names in a ruled grid (two across on
 * phones, four on wide screens, beside the label); from xl up, hovering a mark swaps its name for what Taha did
 * there. An organisation without a logo file is left out, except a bank, which then shows its name large.
 */
export function Trust({ lang }: { lang: Lang }) {
  const fa = lang === "fa";
  const orgs = ORGS.filter((o) => o.logo || o.bank);
  // empty cells that complete the last row (the grid's gaps are the rules, so every cell must be painted)
  const wide = (4 - (orgs.length % 4)) % 4;
  const narrow = orgs.length % 2;
  // on wide screens the label fills the first column of every row of marks
  const rows = Math.max(1, Math.ceil(orgs.length / 4));
  return (
    <section aria-label={ui.sections.trust[lang]} className="border-y border-line">
      <div className="mx-auto max-w-[1800px] md:px-10">
        <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-[1fr_repeat(4,minmax(0,1fr))]">
          <p
            style={{ "--rows": rows } as React.CSSProperties}
            className="col-span-2 flex items-center bg-bg px-5 py-8 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted md:col-span-1 md:[grid-row:span_var(--rows)] md:px-0 md:py-0"
          >
            <span className={fa ? "font-fa text-[0.85rem] normal-case tracking-normal" : ""}>{ui.sections.trust[lang]}</span>
          </p>
          {orgs.map((o) => (
            // the painted cell has no aspect ratio, so it stretches to its row: a cell with a ratio would stay short
            // beside a taller neighbour and let the rule colour show under it
            <div key={o.key} className="flex bg-bg">
              <div className="group relative flex aspect-[3/2] w-full flex-col items-center justify-center gap-3 p-5 md:aspect-[4/3] md:gap-4 md:p-6">
                {o.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.logo} alt="" className="org-logo h-11 w-auto max-w-[62%] object-contain group-hover:scale-105 md:h-14" />
                ) : null}
                {/* the name under every mark (an emblem alone does not say whose it is); a bank without a logo file shows it large */}
                <p
                  className={`max-w-[90%] text-center transition-opacity duration-500 xl:group-hover:opacity-0 ${
                    o.logo ? `text-muted ${fa ? "text-[0.8rem] leading-snug" : "text-[0.72rem] leading-snug"}` : fa ? "text-[1.15rem] font-bold leading-snug opacity-85 md:text-[1.35rem]" : "text-[1.05rem] font-semibold leading-tight tracking-[-0.02em] opacity-85 md:text-[1.25rem]"
                  }`}
                >
                  {o.name[lang]}
                </p>
                {/* the swap needs room under the mark: in narrower cells the line would wrap up over the logo */}
                <p className="absolute inset-x-4 bottom-4 hidden text-center text-[0.72rem] leading-snug text-fg-2 opacity-0 transition-opacity duration-500 group-hover:opacity-100 xl:block">{o.relation[lang]}</p>
              </div>
            </div>
          ))}
          {Array.from({ length: wide }, (_, i) => (
            <div key={`w${i}`} aria-hidden className="hidden bg-bg md:block" />
          ))}
          {narrow ? <div aria-hidden className="bg-bg md:hidden" /> : null}
        </div>
      </div>
    </section>
  );
}

"use client";

import { productCopy } from "@/content/copy/product";
import { num, type Lang } from "@/lib/format";

/**
 * «نوع فروش»: single and/or packs of 2–5 sizes, as the admin allows (public terms: shown to everyone, readable without
 * JS). One choice is a plain line; several are buttons like the options above. A pack's line says what it holds.
 */
export function PackChoice({ lang, packs, pack, setPack }: { lang: Lang; packs: number[]; pack: number; setPack: (n: number) => void }) {
  const tr = productCopy[lang];
  const label = (n: number) => (n === 1 ? tr.single : tr.packName(num(n, lang)));
  const help = pack > 1 && <p className="mt-2.5 font-ui text-xs leading-6 text-muted">{tr.packHelp(num(pack, lang))}</p>;
  if (packs.length === 1) {
    return (
      <div className="mt-5 border-t border-gold/20 pt-5">
        <p className="font-ui text-sm text-ink">{tr.packOnly(num(pack, lang))}</p>
        {help}
      </div>
    );
  }
  return (
    <fieldset className="mt-5 border-t border-gold/20 pt-5">
      <legend className="sr-only">{tr.pack}</legend>
      <p className="mb-3 font-ui text-sm text-ink-2" aria-hidden>
        {tr.pack}
        <span className="ms-2 text-ink">{label(pack)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {packs.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={n === pack}
            onClick={() => setPack(n)}
            className={`flex h-11 min-w-16 items-center justify-center border px-3 text-sm transition-colors duration-300 ${n === pack ? "border-ink bg-white text-ink shadow-[inset_0_0_0_1px_var(--color-ink)]" : "border-line-strong bg-white/50 text-ink-2 hover:border-gold"}`}
          >
            {label(n)}
          </button>
        ))}
      </div>
      {help}
    </fieldset>
  );
}

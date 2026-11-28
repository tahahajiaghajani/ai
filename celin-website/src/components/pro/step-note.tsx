"use client";

import { useState } from "react";
import { commonCopy } from "@/content/copy/common";
import { formatPct, num, type Lang } from "@/lib/format";
import { nextStep, offPct, pctFor, type Pricing } from "@/lib/pricing";

/**
 * The quantity discount while a member buys (members only: Pro and a ladder without steps render nothing). Every
 * piece of the order counts, whichever design: `pieces` is the whole order — on the product page the basket plus
 * the `chosen` pieces about to be added, in the basket the basket itself.
 * - A polite live region says when a step is reached: on the product page when the quantity being chosen takes the
 *   order to a step the basket alone has not reached; in the basket when a change of quantity moves it up a step.
 *   Its words change only with the step, so a screen reader hears it once per step, never on every click.
 * - Under it, a quiet line (not live: it changes on every click) says how many more pieces reach the next step.
 */
export function StepNote({ lang, pricing, pieces, chosen = 0, className = "" }: { lang: Lang; pricing: Pricing; pieces: number; chosen?: number; className?: string }) {
  const c = commonCopy(lang).steps;
  const pct = pctFor(pieces, pricing);
  // the basket: the step changed since the last render (no effect: React's "previous value" state pattern)
  const [seen, setSeen] = useState(pct);
  const [risen, setRisen] = useState(false);
  if (pct !== seen) {
    setSeen(pct);
    setRisen(pct < seen);
  }
  if (!pricing.steps.length) return null;
  const off = offPct(pricing.listPct, pct);
  const next = nextStep(pieces, pricing);
  const crossed = chosen > 0 && pctFor(pieces - chosen, pricing) > pct;
  const reached = off > 0 && (chosen > 0 ? crossed : risen) ? (chosen > 0 ? c.reachedChoosing(formatPct(off, lang)) : c.reached(formatPct(off, lang))) : "";
  return (
    <div className={`font-ui text-xs leading-6 ${className}`}>
      {/* always in the page (an empty block has no height), so assistive tech hears what appears in it */}
      <p aria-live="polite" className="text-success">
        {reached && (
          <span key={pct} className="block animate-fade-in">
            {reached}
          </span>
        )}
      </p>
      {next && <p className="text-gold-text">{c.next(num(next.more, lang), formatPct(offPct(pricing.listPct, next.pct), lang))}</p>}
    </div>
  );
}

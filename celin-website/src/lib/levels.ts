import type { LevelsInfo } from "@/content/copy/account";
import { formatPct, formatPrice, num, type Lang } from "@/lib/format";
import { ladder, pricingFor, type PricingSettings } from "@/lib/pricing";

/**
 * The settings behind the words of /pro and /account/pro (src/lib/pricing.ts): the members' price as a multiple of
 * the wholesale price, the quantity discount's ladder in percent off the whole invoice, and the Pro window and
 * threshold. Never prices themselves — the pages that show it are static and the same for everyone.
 */
export function levelsInfo(pro: PricingSettings & { proThreshold: number; proDays: number }, lang: Lang): LevelsInfo {
  const member = pricingFor("member", pro);
  const times = member.listPct > 100 ? new Intl.NumberFormat(lang === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 2 }).format(member.listPct / 100) : null;
  const rows = member.steps.length ? ladder(member) : [];
  const steps = rows.slice(1);
  const pick = steps[1] ?? steps[0];
  return {
    times,
    steps: steps.length > 0,
    days: num(pro.proDays, lang),
    threshold: pro.proThreshold > 0 && pro.proDays > 0 ? formatPrice(pro.proThreshold, lang) : null,
    ladder: rows.map((r) => ({ from: num(r.from, lang), to: r.to === null ? null : num(r.to, lang), off: r.off > 0 ? formatPct(r.off, lang) : null, wholesale: r.pct === 100 })),
    firstMin: steps[0] ? num(steps[0].from, lang) : null,
    maxOff: steps.length ? formatPct(steps[steps.length - 1].off, lang) : null,
    example: pick ? { n: num(pick.from, lang), off: formatPct(pick.off, lang) } : null,
  };
}

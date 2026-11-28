import { accountCopy, type LevelsInfo } from "@/content/copy/account";
import type { Lang } from "@/lib/format";

/**
 * «تخفیف تعداد» in full, for /pro and /account/pro: the ladder from the settings (pieces in one order → percentage
 * off the whole invoice, never a price), the rules with a worked example, and how Pro differs. A server component
 * (no hooks): it reads only the settings-driven numbers of src/lib/levels.ts.
 */
export function DiscountLadder({ lang, levels, titleAs: Title = "h3", id, wide = false }: { lang: Lang; levels: LevelsInfo; titleAs?: "h2" | "h3"; id?: string; wide?: boolean }) {
  const c = accountCopy(lang).proPage;
  // wide (the /pro band): the ladder beside its rules from large screens up; otherwise one column
  return (
    <div className={wide ? "lg:grid lg:grid-cols-2 lg:items-start lg:gap-16" : ""}>
      <div>
        <Title id={id} className="title-card text-ink">
          {c.ladderTitle}
        </Title>
        <table className="mt-5 w-full max-w-xl font-ui text-sm">
          <caption className="sr-only">{c.ladderCaption}</caption>
          <thead>
            <tr className="border-b border-gold/30 text-xs text-muted">
              <th scope="col" className="py-2.5 pe-4 text-start font-normal">
                {c.ladderPieces}
              </th>
              <th scope="col" className="py-2.5 text-end font-normal">
                {c.ladderOff}
              </th>
            </tr>
          </thead>
          <tbody>
            {levels.ladder.map((r) => (
              <tr key={r.from} className="border-b border-gold/15">
                <th scope="row" className="py-3 pe-4 text-start font-normal text-ink-2 tabular-nums">
                  {c.ladderRange(r.from, r.to)}
                </th>
                <td className={`py-3 text-end tabular-nums ${r.off ? "text-ink" : "text-muted"}`}>
                  {r.off ? c.ladderOffCell(r.off) : c.ladderNone}
                  {r.wholesale && <span className="ms-2 text-xs text-gold-text">{c.ladderWholesale}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={wide ? "lg:pt-6" : ""}>
        <ul className="mt-6 max-w-xl space-y-2.5 font-ui text-sm leading-7 text-ink-2">
          {c.ladderRules(levels).map((rule) => (
            <li key={rule} className="flex items-start gap-3">
              <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rotate-45 bg-gold" />
              {rule}
            </li>
          ))}
        </ul>
        <p className="mt-5 max-w-xl border-s border-gold/50 ps-4 font-ui text-sm leading-7 text-muted">{c.ladderPro(levels)}</p>
      </div>
    </div>
  );
}

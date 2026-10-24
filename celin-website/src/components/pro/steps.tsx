import { commonCopy } from "@/content/copy/common";
import { num, type Lang } from "@/lib/format";

/**
 * The four steps of membership — request → store approval → your code → prices — as rhombi on one hairline.
 * `current` is the step in progress (0–3); 4 = all done. Reads in the page's direction.
 */
export function ProSteps({ lang, current, tone = "light", className = "" }: { lang: Lang; current: number; tone?: "light" | "night"; className?: string }) {
  const c = commonCopy(lang).proSheet;
  const n = c.steps.length;
  return (
    <ol aria-label={c.stepsLabel} data-tone={tone} className={`pro-steps ${className}`}>
      {c.steps.map((label, i) => {
        const at = i < current ? "done" : i === current ? "now" : "next";
        return (
          <li key={label} data-at={at} aria-current={at === "now" ? "step" : undefined}>
            <span aria-hidden className="pro-step-mark" />
            <span className="pro-step-label">
              <span className="sr-only">{c.stepOf(num(i + 1, lang), num(n, lang))}: </span>
              {label}
              {at !== "next" && <span className="sr-only"> ({at === "done" ? c.stepDone : c.stepNow})</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

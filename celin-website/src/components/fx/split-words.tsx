import type { CSSProperties, ElementType } from "react";

/**
 * A heading whose words rise one after another from a soft mask when it enters the viewport
 * (RevealObserver sets data-in). Words, never letters: Persian letters join. "\n" breaks the line.
 * Server-rendered and readable without JS; reduced motion shows it at once.
 */
export function SplitWords({
  text,
  as: Tag = "h2",
  className = "",
  delay = 0,
  immediate = false,
  style,
  id,
  wordClassName = "",
}: {
  text: string;
  as?: ElementType;
  className?: string;
  /** ms before the first word */
  delay?: number;
  /** reveal on mount (hero) instead of on scroll */
  immediate?: boolean;
  style?: CSSProperties;
  id?: string;
  /** e.g. a metal gradient — applied to every word (gradients do not reach through transformed children) */
  wordClassName?: string;
}) {
  let i = 0;
  const lines = text.split("\n");
  return (
    <Tag id={id} className={`fx-words ${className}`} data-fx={immediate ? "now" : ""} style={{ ...style, "--delay": immediate ? `calc(var(--intro-delay, 0s) + ${delay}ms)` : `${delay}ms` } as CSSProperties}>
      {lines.map((line, li) => {
        const words = line
          .split(/\s+/)
          .filter(Boolean)
          .map((w, wi, arr) => (
            <span key={wi}>
              <span className="w">
                <span className={wordClassName} style={{ "--i": i++ } as CSSProperties}>
                  {w}
                </span>
              </span>
              {wi < arr.length - 1 ? " " : null}
            </span>
          ));
        return lines.length > 1 ? (
          <span key={li} className="block">
            {words}
          </span>
        ) : (
          words
        );
      })}
    </Tag>
  );
}
